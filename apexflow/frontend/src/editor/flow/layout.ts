// StageModel -> FlowLayout. Pure; no React, no fetch, no mutation of its
// input.
//
// The whole module is PRESENTATIONAL. `write.ts` never consults it and
// nothing here round-trips. A machine whose graph confuses these rules still
// draws every stage and every move — it just reads in a less helpful order.
// That is the same guarantee `spine.ts` makes about `orderStages`, and it is
// what lets this file use heuristics without endangering the authoring path.
//
// Two ideas carry the layout:
//
//   1. THE SPINE IS THE SHORTEST PATH from the initial stage to the finish,
//      following non-exit moves. Everything else reachable goes on the rail.
//      This is deliberately NOT `stageDepths` — BFS depth answers "how far
//      from the start", which is the right question for ordering a list and
//      the wrong one for placing a branch. Under BFS, signup's `confirmed`
//      is depth 1 and `offered` is depth 2, so the accept-offer move would
//      point backwards up the page.
//
//   2. A RAIL DETOUR OCCUPIES THE ROWS BETWEEN the spine nodes it departs
//      from and returns to, so the drawing reads top to bottom in the order
//      things actually happen.
import { isExitGroup } from '../stage/read.ts';
import type { MoveGroup, Stage, StageModel } from '../stage/types.ts';
import type { Column, FlowEdge, FlowExit, FlowLayout, FlowNode } from './types.ts';

/** `Stage.name` is free text an author may leave blank; the id is always
 * there. Mirrors `StageEditor`'s own `stageName` fallback. */
function displayName(stage: Stage): string {
  return stage.name || stage.stage_id;
}

/**
 * The shortest path from the initial stage to the finish, following moves
 * that are not exits.
 *
 * Returns an empty array when there is no initial stage, no finish, or no
 * path between them — every one of which the editor can produce (adding a
 * stage mints an unreachable one; changing a role can remove the only
 * initial stage). Callers treat an empty spine as "no spine" rather than as
 * an error, because the validation rail already reports those machines.
 */
function shortestPath(
  stages: Stage[],
  adjacency: Map<string, Set<string>>,
  finishId: string | null,
): string[] {
  const initial = stages.find((s) => s.kind === 'initial');
  if (!initial || !finishId) return [];
  if (initial.stage_id === finishId) return [initial.stage_id];

  // BFS, recording each node's predecessor so the path can be walked back.
  const previous = new Map<string, string>();
  const seen = new Set([initial.stage_id]);
  const queue = [initial.stage_id];
  while (queue.length > 0) {
    const current = queue.shift() as string;
    for (const next of adjacency.get(current) ?? []) {
      if (seen.has(next)) continue;
      seen.add(next);
      previous.set(next, current);
      if (next === finishId) {
        const path = [finishId];
        let step = finishId;
        while (previous.has(step)) {
          step = previous.get(step) as string;
          path.unshift(step);
        }
        return path;
      }
      queue.push(next);
    }
  }
  return [];
}

export function buildFlowLayout(model: StageModel): FlowLayout {
  const { stages, groups, finishStageId } = model;

  const exitGroups = groups.filter((g) => isExitGroup(g, model));
  const moveGroups = groups.filter((g) => !isExitGroup(g, model));

  // Stages that are exit targets are drawn in the exits strip, never as a
  // node — so they are excluded from the graph before anything is placed.
  const exitTargets = new Set(exitGroups.map((g) => g.to));
  const drawn = stages.filter((s) => !exitTargets.has(s.stage_id));
  const drawnIds = new Set(drawn.map((s) => s.stage_id));

  // Adjacency over drawn stages only. A move whose target is an exit target
  // is already gone; a move whose target does not exist at all is the
  // validator's problem, and skipping it here keeps `FlowEdge.to` honest
  // (every edge names a node that exists — asserted in layout.test.ts).
  const adjacency = new Map<string, Set<string>>();
  for (const group of moveGroups) {
    if (!drawnIds.has(group.to)) continue;
    for (const member of group.members) {
      if (!drawnIds.has(member.from)) continue;
      const next = adjacency.get(member.from) ?? new Set<string>();
      next.add(group.to);
      adjacency.set(member.from, next);
    }
  }

  const spineIds = shortestPath(drawn, adjacency, finishStageId);
  const onSpine = new Set(spineIds);

  // ---- row assignment -----------------------------------------------------
  // Walk the spine in path order. Before each spine node, drain any rail
  // nodes reachable from what has already been placed, depth-first — so a
  // detour sits between the spine nodes it leaves from and returns to.
  const placed: string[] = [];
  const seen = new Set<string>();

  function drainRailFrom(stageId: string) {
    for (const next of adjacency.get(stageId) ?? []) {
      if (seen.has(next) || onSpine.has(next)) continue;
      seen.add(next);
      placed.push(next);
      drainRailFrom(next); // depth-first: a detour off a detour stays with it
    }
  }

  for (const id of spineIds) {
    if (!seen.has(id)) {
      seen.add(id);
      placed.push(id);
    }
    drainRailFrom(id);
  }

  // Anything still unplaced is unreachable from the spine — or there was no
  // spine at all. Either way it is drawn, in `orderStages` order, after
  // everything that could be placed. `drawn` is already in that order.
  for (const stage of drawn) {
    if (seen.has(stage.stage_id)) continue;
    seen.add(stage.stage_id);
    placed.push(stage.stage_id);
  }

  const stageById = new Map(drawn.map((s) => [s.stage_id, s]));
  const nodes: FlowNode[] = placed.map((id, row) => {
    const stage = stageById.get(id) as Stage;
    return {
      stage_id: stage.stage_id,
      name: displayName(stage),
      kind: stage.kind,
      // With no spine at all, everything lands in one column rather than
      // being arbitrarily split — `hasRail` then reports false and the view
      // renders narrow.
      column: (spineIds.length === 0 || onSpine.has(id) ? 'spine' : 'rail') as Column,
      row,
      stepCount: stage.step_ids.length,
      isFinish: stage.stage_id === finishStageId,
    };
  });

  const rowOf = new Map(nodes.map((n) => [n.stage_id, n.row]));

  // ---- edges --------------------------------------------------------------
  // One edge per (group, source stage). A group is keyed on everything except
  // `from` (see `stage/types.ts`), so signup's `submit` is one group with one
  // member and enrollment's `withdraw` is one group with many — the drawing
  // needs a line per source, and the key is suffixed to keep React keys
  // distinct.
  const edges: FlowEdge[] = [];
  for (const group of moveGroups) {
    if (!drawnIds.has(group.to)) continue;
    const toRow = rowOf.get(group.to);
    for (const from of [...new Set(group.members.map((m) => m.from))]) {
      if (!drawnIds.has(from)) continue;
      const fromRow = rowOf.get(from);
      edges.push({
        key: `${group.key}@${from}`,
        from,
        to: group.to,
        action: group.action,
        who: group.who,
        // A move that lands at or above where it started is the only kind
        // routed outside the two columns, which is what makes a cycle read
        // as a cycle rather than as a stray line.
        backward: fromRow !== undefined && toRow !== undefined && toRow <= fromRow,
        guardCount: group.guards.length,
      });
    }
  }

  // ---- exits --------------------------------------------------------------
  const nameOf = new Map(stages.map((s) => [s.stage_id, displayName(s)]));
  const exits: FlowExit[] = exitGroups.map((group: MoveGroup) => ({
    key: group.key,
    to: group.to,
    name: nameOf.get(group.to) ?? group.to,
    action: group.action,
    who: group.who,
    fromNames: [...new Set(group.members.map((m) => m.from))].map((id) => nameOf.get(id) ?? id),
  }));

  return {
    nodes,
    edges,
    exits,
    rowCount: nodes.length,
    hasRail: nodes.some((n) => n.column === 'rail'),
  };
}
