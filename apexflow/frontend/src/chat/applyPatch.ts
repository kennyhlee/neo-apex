// Applies a chat `proposal` frame's ops to the open draft's machine/steps.
//
// This is the ONE place the chat layer's STAGE vocabulary is translated into
// the schema's STATE vocabulary (`patchOps.ts`'s header: `stage_id` ->
// `machine.states[].state_id`).
//
// Three properties this module is built around, in order of how badly their
// absence would hurt:
//
// 1. PURE. Nothing reachable from `machine` or `steps` is written to. Every
//    edit replaces the element (and its containing array) with a new object,
//    so the caller's current draft is a valid thing to keep holding — which
//    is what makes "Apply" cancellable and what makes property 2 free.
// 2. ALL-OR-NOTHING. A bad reference anywhere in `ops` throws
//    `PatchApplyError` and the caller's inputs are untouched, because the
//    partial result only ever existed in this function's locals. There is no
//    rollback path to get wrong.
// 3. NO `src/editor/` IMPORTS. The chat layer deliberately does not depend on
//    editor internals. Two editor semantics are therefore RE-STATED here —
//    the single-initial rule (`stageOps.ts::setStageKind`) and
//    `remove_stage`'s three-way cleanup (`stageOps.ts::removeStage`) — and
//    are pinned by `__tests__/applyPatch.test.ts`, not by the editor's suite.
//
// What this module does NOT check: whether an id an op INTRODUCES resolves.
// `add_move`'s `from`/`to`, `add_step`'s `available_in`, an `update_move`
// patch's `to` — all pass through unvalidated, matching `patchOps.ts`'s
// stated contract ("id coherence ... is checked" on the save PUT that Apply
// triggers). Checking them here would also make op ORDER load-bearing in a
// way the backend never promised: an `add_move` listed before the `add_stage`
// that mints its target is a perfectly good patch. Only ids an op must
// RESOLVE to do its work — the thing being renamed, updated or removed — are
// required to exist, plus the ids an op would DUPLICATE.
import type { ChannelAccess, PatchOp } from './patchOps.ts';
import type {
  EffectRef,
  GuardRef,
  MachineDef,
  StateDef,
  TransitionDef,
  WorkflowSectionDef,
  WorkflowStepDef,
} from '../types/designer.ts';

/** Thrown when an op names something that does not exist, or would duplicate
 *  something that does. The message always names the offending id — the patch
 *  card surfaces it verbatim, so it has to read as prose. */
export class PatchApplyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PatchApplyError';
  }
}

export interface PatchApplyResult {
  machine: MachineDef;
  steps: WorkflowStepDef[];
  /** Set only when a `set_channel_access` op was applied; otherwise absent, so
   *  the caller can tell "unchanged" from "explicitly set to staff_only". */
  channelAccess?: ChannelAccess;
}

// --- lookup helpers ----------------------------------------------------------

function mustFindState(states: StateDef[], stageId: string, opName: string): number {
  const index = states.findIndex((s) => s.state_id === stageId);
  if (index < 0) throw new PatchApplyError(`${opName}: no stage "${stageId}" in this workflow`);
  return index;
}

function mustFindTransition(
  transitions: TransitionDef[],
  transitionId: string,
  opName: string,
): number {
  const index = transitions.findIndex((t) => t.transition_id === transitionId);
  if (index < 0) throw new PatchApplyError(`${opName}: no move "${transitionId}" in this workflow`);
  return index;
}

function mustFindStep(steps: WorkflowStepDef[], stepId: string, opName: string): number {
  const index = steps.findIndex((s) => s.step_id === stepId);
  if (index < 0) throw new PatchApplyError(`${opName}: no step "${stepId}" in this workflow`);
  return index;
}

function mustFindSection(
  sections: WorkflowSectionDef[],
  sectionId: string,
  stepId: string,
  opName: string,
): number {
  const index = sections.findIndex((s) => s.section_id === sectionId);
  if (index < 0) {
    throw new PatchApplyError(`${opName}: no section "${sectionId}" on step "${stepId}"`);
  }
  return index;
}

/** `step.config.sections`, defaulted — `config` is free-form `Record<string,
 *  unknown>`, so a step that has never held a section simply has no key. */
function sectionsOf(step: WorkflowStepDef): WorkflowSectionDef[] {
  const sections = step.config.sections;
  return Array.isArray(sections) ? (sections as WorkflowSectionDef[]) : [];
}

/** Copy of `list` with index `at` replaced. (Plain map rather than ES2023's
 *  `Array.prototype.with`, which nothing else in this frontend relies on.) */
function replaceAt<T>(list: T[], at: number, value: T): T[] {
  return list.map((item, index) => (index === at ? value : item));
}

/** Replaces one step's sections, leaving the rest of `config` alone. */
function withSections(step: WorkflowStepDef, sections: WorkflowSectionDef[]): WorkflowStepDef {
  return { ...step, config: { ...step.config, sections } };
}

/**
 * The single-initial rule, re-stated from `stageOps.ts::setStageKind`:
 * `validate.py`'s `_state_errors` requires exactly one initial state, so
 * whichever stage held the role loses it to `active` the moment another takes
 * it. `exceptId` keeps a stage that is ALREADY initial from demoting itself.
 */
function demoteInitial(states: StateDef[], exceptId: string): StateDef[] {
  return states.map((s) =>
    s.kind === 'initial' && s.state_id !== exceptId ? { ...s, kind: 'active' as const } : s,
  );
}

// --- the apply ---------------------------------------------------------------

export function applyPatch(
  machine: MachineDef,
  steps: WorkflowStepDef[],
  ops: PatchOp[],
): PatchApplyResult {
  let states: StateDef[] = machine.states;
  let transitions: TransitionDef[] = machine.transitions;
  let nextSteps: WorkflowStepDef[] = steps;
  let channelAccess: ChannelAccess | undefined;

  for (const op of ops) {
    switch (op.op) {
      case 'add_stage': {
        if (states.some((s) => s.state_id === op.stage_id)) {
          throw new PatchApplyError(`add_stage: stage "${op.stage_id}" already exists`);
        }
        const base = op.kind === 'initial' ? demoteInitial(states, op.stage_id) : states;
        states = [...base, { state_id: op.stage_id, name: op.name, kind: op.kind }];
        break;
      }

      case 'rename_stage': {
        const index = mustFindState(states, op.stage_id, 'rename_stage');
        states = replaceAt(states, index, { ...states[index], name: op.name });
        break;
      }

      case 'set_stage_kind': {
        const index = mustFindState(states, op.stage_id, 'set_stage_kind');
        const base = op.kind === 'initial' ? demoteInitial(states, op.stage_id) : states;
        states = replaceAt(base, index, { ...base[index], kind: op.kind });
        break;
      }

      case 'remove_stage': {
        // `stageOps.ts::removeStage`'s contract, re-stated: the state, every
        // transition touching EITHER end (a dangling `to` fails
        // `_state_ref_errors` at publish just as a dangling `from` does), and
        // the id stripped from every step's `available_in` — the steps
        // themselves survive.
        mustFindState(states, op.stage_id, 'remove_stage');
        states = states.filter((s) => s.state_id !== op.stage_id);
        transitions = transitions.filter((t) => t.from !== op.stage_id && t.to !== op.stage_id);
        nextSteps = nextSteps.map((step) =>
          step.available_in.includes(op.stage_id)
            ? { ...step, available_in: step.available_in.filter((id) => id !== op.stage_id) }
            : step,
        );
        break;
      }

      case 'add_move': {
        if (transitions.some((t) => t.transition_id === op.transition_id)) {
          throw new PatchApplyError(`add_move: move "${op.transition_id}" already exists`);
        }
        transitions = [
          ...transitions,
          {
            transition_id: op.transition_id,
            from: op.from,
            to: op.to,
            action: op.action,
            actor: op.actor,
            guards: op.guards as GuardRef[],
            effects: op.effects as EffectRef[],
          },
        ];
        break;
      }

      case 'update_move': {
        const index = mustFindTransition(transitions, op.transition_id, 'update_move');
        transitions = replaceAt(transitions, index, {
          ...transitions[index],
          ...op.patch,
        } as TransitionDef);
        break;
      }

      case 'remove_move': {
        mustFindTransition(transitions, op.transition_id, 'remove_move');
        transitions = transitions.filter((t) => t.transition_id !== op.transition_id);
        break;
      }

      case 'add_step': {
        if (nextSteps.some((s) => s.step_id === op.step.step_id)) {
          throw new PatchApplyError(`add_step: step "${op.step.step_id}" already exists`);
        }
        // `config` is optional on the wire (`StepDef.config` carries a
        // server-side default_factory) but required on `WorkflowStepDef`.
        const step: WorkflowStepDef = { ...op.step, config: op.step.config ?? {} };
        // `position` is CLAMPED to [0, length], not fed to splice's own
        // semantics: a negative index would otherwise silently mean "count
        // back from the end", which is never what a model that emitted
        // `position: -1` meant, and is unreviewable on the patch card.
        const raw = op.position ?? nextSteps.length;
        const at = Math.min(Math.max(raw, 0), nextSteps.length);
        nextSteps = [...nextSteps.slice(0, at), step, ...nextSteps.slice(at)];
        break;
      }

      case 'update_step': {
        // Shallow merge, `show_if` included — there is no `set_show_if` op
        // because `show_if` is an ordinary StepDef field (patchOps.ts header).
        const index = mustFindStep(nextSteps, op.step_id, 'update_step');
        nextSteps = replaceAt(nextSteps, index, {
          ...nextSteps[index],
          ...op.patch,
        } as WorkflowStepDef);
        break;
      }

      case 'remove_step': {
        mustFindStep(nextSteps, op.step_id, 'remove_step');
        nextSteps = nextSteps.filter((s) => s.step_id !== op.step_id);
        break;
      }

      case 'add_section': {
        const stepIndex = mustFindStep(nextSteps, op.step_id, 'add_section');
        const sections = sectionsOf(nextSteps[stepIndex]);
        if (sections.some((s) => s.section_id === op.section.section_id)) {
          throw new PatchApplyError(
            `add_section: section "${op.section.section_id}" already exists on step "${op.step_id}"`,
          );
        }
        nextSteps = replaceAt(
          nextSteps,
          stepIndex,
          withSections(nextSteps[stepIndex], [...sections, op.section]),
        );
        break;
      }

      case 'update_section': {
        const stepIndex = mustFindStep(nextSteps, op.step_id, 'update_section');
        const sections = sectionsOf(nextSteps[stepIndex]);
        const index = mustFindSection(sections, op.section_id, op.step_id, 'update_section');
        const merged = { ...sections[index], ...op.patch } as WorkflowSectionDef;
        nextSteps = replaceAt(
          nextSteps,
          stepIndex,
          withSections(nextSteps[stepIndex], replaceAt(sections, index, merged)),
        );
        break;
      }

      case 'remove_section': {
        const stepIndex = mustFindStep(nextSteps, op.step_id, 'remove_section');
        const sections = sectionsOf(nextSteps[stepIndex]);
        mustFindSection(sections, op.section_id, op.step_id, 'remove_section');
        nextSteps = replaceAt(
          nextSteps,
          stepIndex,
          withSections(
            nextSteps[stepIndex],
            sections.filter((s) => s.section_id !== op.section_id),
          ),
        );
        break;
      }

      case 'set_channel_access': {
        channelAccess = op.value;
        break;
      }

      default: {
        // The frontend and the backend deploy from independent version lines,
        // so a newer backend CAN send an op this build has never heard of. The
        // `never` assignment makes ADDING a 15th member to `PatchOp` a compile
        // error here (a plain 14-case switch would not — TS does not enforce
        // exhaustiveness without it), and the throw makes an op arriving from
        // an ahead-of-us backend a REFUSED patch rather than a silently
        // dropped edit. Silent dropping is the dangerous failure: Apply would
        // report success having applied 4 of 5 edits, and the author would
        // have no way to see the fifth went missing.
        const _exhaustive: never = op;
        void _exhaustive;
        throw new PatchApplyError(
          `unsupported op "${(op as { op: string }).op}" — this workflow editor is older than the assistant that proposed it`,
        );
      }
    }
  }

  return { machine: { states, transitions }, steps: nextSteps, channelAccess };
}
