// machine + steps -> StageModel. Pure; no React, no fetch.
//
// Grouping key: (action, to, who, guards-without-actor_role, effects) —
// everything except `from` (design ruling, Amendment B). Two transitions
// join a group only when they are indistinguishable apart from where they
// leave from, which is exactly the condition under which one Exits-panel
// card can faithfully re-emit both.
import type { GuardRef, MachineDef, TransitionDef, WorkflowStepDef } from '../../types/designer.ts';
import type { MoveGroup, MoveMember, Stage, StageModel, Who } from './types.ts';
import { finishStageId, orderStages } from './spine.ts';

/** Stable, order-insensitive-per-key JSON for use in a grouping key. Params
 * are authored objects whose key order is whatever the backend serialized;
 * two params dicts with the same content must produce the same key. */
function stableJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
    a < b ? -1 : a > b ? 1 : 0,
  );
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableJson(v)}`).join(',')}}`;
}

function splitActorRole(guards: GuardRef[]): { roleGuard: GuardRef | null; rest: GuardRef[] } {
  const idx = guards.findIndex((g) => g.primitive === 'actor_role');
  if (idx === -1) return { roleGuard: null, rest: guards };
  return {
    roleGuard: guards[idx],
    // Only the FIRST actor_role is absorbed. A transition carrying two is
    // pathological; the second stays in `rest` and renders as an ordinary
    // guard rather than being dropped.
    rest: [...guards.slice(0, idx), ...guards.slice(idx + 1)],
  };
}

function whoForActor(actor: TransitionDef['actor']): Who {
  return actor === 'system' ? 'automatic' : actor;
}

/** Two members merge into `who: 'both'` only when they are a family/staff
 * pair from the SAME stage — that is the shape `_withdraw_pair`/`_drop_pair`
 * emit, and the only shape one "Who can do it" control can re-emit. */
function foldWho(members: MoveMember[]): Who {
  const actors = new Set(members.map((m) => m.actor));
  if (actors.size === 1) return whoForActor(members[0].actor);
  if (actors.size === 2 && actors.has('family') && actors.has('staff')) return 'both';
  // Anything else (e.g. system mixed with family) cannot be one control.
  // Callers never build this — `groupKey` includes the actor set, so a mixed
  // set can only arise from a hand-edited machine. Report the first actor
  // and let each member keep its own; `write.ts` writes `member.actor`, not
  // `group.who`, so nothing is lost.
  return whoForActor(members[0].actor);
}

/**
 * The grouping key. Note what is IN it: the actor set is folded to
 * "family+staff pair or not", so a `_drop_pair` joins, while a lone staff
 * transition does not join a family one from a different stage.
 */
function groupKey(t: TransitionDef, rest: GuardRef[]): string {
  const actorClass = t.actor === 'system' ? 'system' : 'human';
  return [t.action, t.to, actorClass, stableJson(rest), stableJson(t.effects)].join('|');
}

export function readStageModel(machine: MachineDef, steps: WorkflowStepDef[]): StageModel {
  const { ordered, depths } = orderStages(machine);

  const stages: Stage[] = ordered.map((state) => ({
    stage_id: state.state_id,
    name: state.name,
    kind: state.kind,
    depth: depths[state.state_id],
    step_ids: steps
      .filter((step) => step.available_in.includes(state.state_id))
      .map((step) => step.step_id),
  }));

  const byKey = new Map<string, MoveGroup>();
  machine.transitions.forEach((t, order) => {
    const { roleGuard, rest } = splitActorRole(t.guards);
    const key = groupKey(t, rest);
    const member: MoveMember = {
      transition_id: t.transition_id,
      from: t.from,
      actor: t.actor,
      roleGuard,
      order,
    };
    const existing = byKey.get(key);
    if (existing) {
      existing.members.push(member);
      existing.who = foldWho(existing.members);
      return;
    }
    byKey.set(key, {
      key,
      action: t.action,
      to: t.to,
      who: whoForActor(t.actor),
      guards: rest,
      effects: t.effects,
      members: [member],
    });
  });

  // Groups in first-member declaration order, so the panels read in the same
  // order the machine declares.
  const groups = [...byKey.values()].sort(
    (a, b) => Math.min(...a.members.map((m) => m.order)) - Math.min(...b.members.map((m) => m.order)),
  );

  return { stages, groups, finishStageId: finishStageId(machine) };
}

/**
 * An exit is a group landing on a TERMINAL stage that is not the finish.
 *
 * Purely presentational: it decides whether a group renders in the Exits
 * panel or as a move on its stage. Both surfaces edit the same `MoveGroup`
 * and both write back through `writeMachine`, so getting this wrong makes
 * the editor less readable, never incorrect.
 */
export function isExitGroup(group: MoveGroup, model: StageModel): boolean {
  const target = model.stages.find((s) => s.stage_id === group.to);
  if (!target || target.kind !== 'terminal') return false;
  return target.stage_id !== model.finishStageId;
}
