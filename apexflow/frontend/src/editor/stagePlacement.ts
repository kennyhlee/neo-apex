// Pure helpers for putting an existing step into a stage, or taking it out
// of just one, without touching any other step. Deliberately kept outside
// `src/editor/stage/` — that layer is the finished, heavily-tested
// StageModel/MoveGroup vocabulary; these two functions operate directly on
// `WorkflowStepDef[]`, the shape `StepEditor`/`StageCard` already share, and
// have nothing to do with machine states or transitions.
//
// Both are total, idempotent-safe, and touch only the one step named by
// `stepId` — every other element of `steps` is returned by reference
// (`Array.prototype.map`'s untouched-branch identity), so callers relying on
// reference equality to skip re-renders of sibling rows are not defeated.
import type { WorkflowStepDef } from '../types/designer.ts';

/**
 * Adds `stageId` to one step's `available_in` — the "Add an existing step
 * here" control (design spec: "a step appearing in several stages is
 * expressed by adding it to each"). No new `step_id` is minted; this is the
 * only way, now that the checkbox grid is hidden in stage mode, to put an
 * already-authored step into a second stage.
 *
 * No-op (returns an array with that step unchanged) if the step already
 * lists `stageId` — selecting an already-present step from the picker
 * cannot duplicate the entry. No-op entirely (steps array returned as-is,
 * new reference per the `.map` above but no step object changes) if no step
 * matches `stepId`.
 */
export function addStepToStage(
  steps: WorkflowStepDef[],
  stepId: string,
  stageId: string,
): WorkflowStepDef[] {
  return steps.map((step) =>
    step.step_id === stepId && !step.available_in.includes(stageId)
      ? { ...step, available_in: [...step.available_in, stageId] }
      : step,
  );
}

/**
 * Removes `stageId` from one step's `available_in` — "Remove from this
 * stage". Every other step, and every other stage this step is available
 * in, is left exactly as it was.
 *
 * Intended behaviour when `stageId` is the step's LAST entry: the step is
 * kept, with `available_in: []` — not deleted. An empty `available_in` is
 * already a reachable, meaningful state in this editor (see
 * `StepEditor.tsx`'s `newStep` doc comment: "silently inert" but not
 * invalid); it means "authored, but not currently placed anywhere."
 * Deleting the step object here would collapse "remove from this stage"
 * into "delete everywhere" for the single-stage case, which is exactly the
 * ambiguity the separate "delete everywhere" control exists to resolve —
 * the two controls must stay behaviourally distinct regardless of how many
 * stages a step happens to be in at the moment either is clicked.
 */
export function removeStepFromStage(
  steps: WorkflowStepDef[],
  stepId: string,
  stageId: string,
): WorkflowStepDef[] {
  return steps.map((step) =>
    step.step_id === stepId
      ? { ...step, available_in: step.available_in.filter((id) => id !== stageId) }
      : step,
  );
}
