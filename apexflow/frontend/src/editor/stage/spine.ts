// Stage ordering. The design says stage order is read "from the transition
// graph"; this is that, made specific.
//
// Order is BFS distance from the initial stage, ties broken by declaration
// order — with one correction. Pure BFS puts an exit target wherever its
// shortest inbound edge lands it, which for enrollment means `withdrawn`
// (one hop from `draft`) renders THIRD of nine stages, between `waitlisted`
// and `in_review`. An exit target is where a workflow stops, not a step
// along the way, so every terminal stage except the finish sorts after the
// finish.
//
// NOTE: ordering is PRESENTATIONAL. `write.ts` never consults it. A machine
// whose graph confuses this function still round-trips exactly; it just
// renders its stages in a less helpful order.
import type { MachineDef, StateDef } from '../../types/designer.ts';

/** Sorts after every reachable stage; unreachable stages keep declaration
 * order among themselves. */
const UNREACHABLE = Number.MAX_SAFE_INTEGER;

export function stageDepths(machine: MachineDef): Record<string, number> {
  const declared = new Set(machine.states.map((s) => s.state_id));
  const depths: Record<string, number> = {};
  for (const state of machine.states) depths[state.state_id] = UNREACHABLE;

  const initial = machine.states.find((s) => s.kind === 'initial');
  // No initial stage is a validation error the rail already reports. Leave
  // every depth UNREACHABLE rather than inventing a root, so the editor
  // still renders something the author can fix.
  if (!initial) return depths;

  const adjacency = new Map<string, string[]>();
  for (const t of machine.transitions) {
    const next = adjacency.get(t.from) ?? [];
    next.push(t.to);
    adjacency.set(t.from, next);
  }

  depths[initial.state_id] = 0;
  const queue = [initial.state_id];
  while (queue.length > 0) {
    const current = queue.shift() as string;
    for (const next of adjacency.get(current) ?? []) {
      if (!declared.has(next)) continue; // dangling `to` — the validator's problem
      if (depths[next] !== UNREACHABLE) continue;
      depths[next] = depths[current] + 1;
      queue.push(next);
    }
  }
  return depths;
}

/**
 * The terminal stage forward progress ends at: the DEEPEST terminal stage,
 * ties broken by declaration order.
 *
 * Measured against both shipped templates: enrollment's terminals are
 * `enrolled` (depth 4), `declined` (3), and `withdrawn` (1) — the finish is
 * `enrolled`. Signup's are `completed` (2) and `dropped` (1) — the finish is
 * `completed`. Taking the first-declared terminal instead would happen to be
 * right for both and would break the moment an author reorders the states.
 */
export function finishStageId(machine: MachineDef): string | null {
  const depths = stageDepths(machine);
  const declaredIndex = new Map(machine.states.map((s, i) => [s.state_id, i]));
  const terminals = machine.states.filter((s) => s.kind === 'terminal');
  if (terminals.length === 0) return null;
  let best = terminals[0];
  for (const candidate of terminals.slice(1)) {
    const deeper = depths[candidate.state_id] > depths[best.state_id];
    const tied = depths[candidate.state_id] === depths[best.state_id];
    const earlier =
      (declaredIndex.get(candidate.state_id) ?? 0) < (declaredIndex.get(best.state_id) ?? 0);
    if (deeper || (tied && earlier)) best = candidate;
  }
  return best.state_id;
}

export function orderStages(machine: MachineDef): {
  ordered: StateDef[];
  depths: Record<string, number>;
} {
  const depths = stageDepths(machine);
  const finish = finishStageId(machine);
  const declaredIndex = new Map(machine.states.map((s, i) => [s.state_id, i]));

  /** 0 = on the spine, 1 = an exit target. */
  const rank = (s: StateDef) => (s.kind === 'terminal' && s.state_id !== finish ? 1 : 0);

  const ordered = [...machine.states].sort((a, b) => {
    const byRank = rank(a) - rank(b);
    if (byRank !== 0) return byRank;
    const byDepth = depths[a.state_id] - depths[b.state_id];
    if (byDepth !== 0) return byDepth;
    return (declaredIndex.get(a.state_id) ?? 0) - (declaredIndex.get(b.state_id) ?? 0);
  });
  return { ordered, depths };
}
