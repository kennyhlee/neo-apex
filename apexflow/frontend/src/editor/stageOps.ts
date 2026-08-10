// The four authoring controls the deleted Machine tab carried and the stage
// editor did not reinstate: add a stage, remove a stage, add a move out of a
// stage, add a cross-cutting exit. Pure functions only, no React — the
// caller (StageEditor/StageCard/ExitsPanel) commits the result through
// `writeMachine`, same as every other edit this editor makes.
//
// Deliberately kept outside `src/editor/stage/` — that layer is the
// finished, heavily-tested StageModel/MoveGroup vocabulary (round-tripping
// what was READ). These four functions MINT new stages/transitions, which
// is a different concern; they consume `stage/write.ts`'s exports rather
// than re-deriving them.
import { NEW_ORDER, NEW_STAGE_INDEX, actorsFor, roleGuardFor } from './stage/write.ts';
import type { MoveGroup, MoveMember, Stage, StageModel } from './stage/types.ts';
import type { WorkflowStepDef } from '../types/designer.ts';

function uniqueSuffix(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

/**
 * A new stage's kind fills whatever role the machine is currently MISSING —
 * verbatim the rule commit `cadd3b8` landed for the deleted MachineEditor.tsx
 * `newState` (initial, then terminal, then active).
 *
 * Hardcoding `active` made "Add a stage" counter-productive: a brand-new
 * workflow already reports "no initial state"/"no terminal state", and an
 * `active` addition leaves both errors standing while adding a third
 * ("non-terminal but has no outgoing transition"). Filling the missing role
 * instead means adding a stage moves the machine toward valid, never away
 * from it. The kind stays freely editable afterwards (StageCard does not
 * expose that yet, matching the deleted UI's own scope).
 */
export function newStage(existing: Stage[]): Stage {
  const kind: Stage['kind'] = !existing.some((s) => s.kind === 'initial')
    ? 'initial'
    : !existing.some((s) => s.kind === 'terminal')
      ? 'terminal'
      : 'active';
  return {
    stage_id: `state-${uniqueSuffix()}`,
    name: '',
    kind,
    // Presentational only (see Stage['depth']'s doc comment) and immediately
    // superseded the moment the caller's `commit` re-derives the model from
    // the written machine — 0 is as good a placeholder as any.
    depth: 0,
    declaredIndex: NEW_STAGE_INDEX,
    step_ids: [],
  };
}

/** Appends one new stage. Every existing stage and every group is untouched. */
export function addStage(model: StageModel): StageModel {
  return { ...model, stages: [...model.stages, newStage(model.stages)] };
}

/**
 * Removes a stage and everything that cannot survive without it:
 * - the stage itself;
 * - every group member whose `from` is the removed stage;
 * - every group whose `to` is the removed stage outright — those
 *   transitions would otherwise dangle and fail `_state_ref_errors` at
 *   publish, regardless of where their OTHER members (if any) leave from;
 * - any group left with zero members once the above are applied;
 * - the stage id from every step's `available_in` (the step itself
 *   survives, same contract as `stagePlacement.ts`'s `removeStepFromStage`).
 *
 * Returns both the model and the updated steps — `available_in` lives on
 * `WorkflowStepDef`, not on the `StageModel`, so both must change together.
 */
export function removeStage(
  model: StageModel,
  stageId: string,
  steps: WorkflowStepDef[],
): { model: StageModel; steps: WorkflowStepDef[] } {
  const stages = model.stages.filter((s) => s.stage_id !== stageId);
  const groups = model.groups
    .filter((g) => g.to !== stageId)
    .map((g) => ({ ...g, members: g.members.filter((m) => m.from !== stageId) }))
    .filter((g) => g.members.length > 0);
  const nextSteps = steps.map((step) =>
    step.available_in.includes(stageId)
      ? { ...step, available_in: step.available_in.filter((id) => id !== stageId) }
      : step,
  );
  return {
    model: {
      ...model,
      stages,
      groups,
      finishStageId: model.finishStageId === stageId ? null : model.finishStageId,
    },
    steps: nextSteps,
  };
}

/**
 * Adds one move out of `fromStageId`.
 *
 * `who: 'staff'`, `guards: []`, `effects: []`, a single member with
 * `order: NEW_ORDER` and `roleGuard: null` — a new transition must not
 * acquire an `actor_role` guard it was not authored with (see
 * `write.ts`'s `membersForWho` for why an unguarded single-actor group stays
 * unguarded).
 *
 * Target defaults to the next stage in model (spine) order after the
 * source, or the finish stage if the source is last; falls back to the
 * source stage itself only in the degenerate case where the machine has
 * neither, so `writeMachine` is never handed a transition with no `to`.
 *
 * Action defaults to a name not already used by another group leaving that
 * stage, so the new move cannot collide into an existing `(from, action)`
 * group and disturb its unguarded-last ordering (see `write.ts`'s
 * `NEW_ORDER` doc comment).
 */
export function addMove(model: StageModel, fromStageId: string): StageModel {
  const index = model.stages.findIndex((s) => s.stage_id === fromStageId);
  const next = index >= 0 ? model.stages[index + 1] : undefined;
  const to = next?.stage_id ?? model.finishStageId ?? fromStageId;

  const takenActions = new Set(
    model.groups.filter((g) => g.members.some((m) => m.from === fromStageId)).map((g) => g.action),
  );
  let action = 'move';
  let n = 2;
  while (takenActions.has(action)) {
    action = `move_${n}`;
    n += 1;
  }

  const member: MoveMember = {
    transition_id: `t_${action}_${fromStageId}_staff`,
    from: fromStageId,
    actor: 'staff',
    roleGuard: null,
    order: NEW_ORDER,
  };
  const group: MoveGroup = {
    key: `new-move-${uniqueSuffix()}`,
    action,
    to,
    who: 'staff',
    guards: [],
    effects: [],
    members: [member],
  };
  return { ...model, groups: [...model.groups, group] };
}

/**
 * True when the machine has a terminal stage that is not the finish — the
 * only shape `addExit` can target. Kept separate from `addExit` so the
 * button can be disabled with an explanation instead of being clicked into
 * producing nothing (or an invalid machine).
 */
export function canAddExit(model: StageModel): boolean {
  return model.stages.some((s) => s.kind === 'terminal' && s.stage_id !== model.finishStageId);
}

/**
 * Adds one cross-cutting exit rule: `who: 'both'`, targeting the first
 * terminal stage that is not the finish, with one family/staff member pair
 * per non-terminal stage — the same shape `_drop_pair`/`_withdraw_pair`
 * author by hand. Each member carries `roleGuardFor(actor)`: a `'both'`
 * group cannot be expressed without one (see `write.ts`'s `membersForWho`
 * doc comment — `_unguarded_branch_errors` allows at most one unguarded
 * transition per `(from, action)` group, so a family/staff pair from the
 * same stage needs a guard on at least one of them, and the editor's
 * convention is both). All members land at `order: NEW_ORDER`.
 *
 * No-op (returns `model` unchanged) if `canAddExit(model)` is false — the UI
 * gates the button on that same check, so this is a defensive fallback, not
 * the primary guard.
 */
export function addExit(model: StageModel): StageModel {
  const target = model.stages.find((s) => s.kind === 'terminal' && s.stage_id !== model.finishStageId);
  if (!target) return model;

  const action = `exit_${uniqueSuffix()}`;
  const nonTerminal = model.stages.filter((s) => s.kind !== 'terminal');
  const members: MoveMember[] = nonTerminal.flatMap((stage) =>
    actorsFor('both').map((actor) => ({
      transition_id: `t_${action}_${stage.stage_id}_${actor}`,
      from: stage.stage_id,
      actor,
      roleGuard: roleGuardFor(actor),
      order: NEW_ORDER,
    })),
  );
  const group: MoveGroup = {
    key: `new-exit-${uniqueSuffix()}`,
    action,
    to: target.stage_id,
    who: 'both',
    guards: [],
    effects: [],
    members,
  };
  return { ...model, groups: [...model.groups, group] };
}
