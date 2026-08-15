// TS mirror of `apexflow/backend/app/chat/patch_ops.py` — the complete set of
// edits the chat assistant may propose against an open draft.
//
// This is a WIRE CONTRACT on three sides: the backend dumps these ops
// BY ALIAS (`validate_ops`), they travel verbatim inside a `proposal` SSE
// frame, and the patch card applies them against the editor's in-memory
// definition. Field names and alias spellings are load-bearing — in
// particular:
//
// * `add_move` carries `from`, never `from_`. Python spells the field `from_`
//   because `from` is a keyword; the alias is the wire key, matching
//   `TransitionDef`'s own alias (types/designer.ts:53) so an op can be handed
//   straight into a TransitionDef.
// * The ops say STAGE where `schema.py` says STATE (`stage_id` ->
//   `machine.states[].state_id`). The editor is stage-centric and the admin
//   reading the patch card sees stages, so the vocabulary follows the product.
//   The translation happens in exactly one place: the card's apply function.
// * There is no `set_show_if` op — `update_step` with `patch: {show_if: ...}`
//   is the same power, since `show_if` is an ordinary StepDef field.
//
// `patch` payloads are `Record<string, unknown>` rather than a partial of the
// target model, matching the backend's `dict[str, Any]`: the merged result is
// validated as a whole on the save PUT that Apply triggers, which is also
// where id coherence (does this stage exist, does removing it strand a move)
// is checked. Nothing here validates beyond shape.
import type { WorkflowSectionDef, WorkflowStepDef } from '../types/designer.ts';

export type StageKind = 'initial' | 'active' | 'terminal';
export type MoveActor = 'family' | 'staff' | 'system';
export type ChannelAccess = 'staff_only' | 'family';

// --- stages (machine.states) -------------------------------------------------

export interface AddStageOp {
  op: 'add_stage';
  stage_id: string;
  name: string;
  kind: StageKind;
}

export interface RenameStageOp {
  op: 'rename_stage';
  stage_id: string;
  name: string;
}

export interface SetStageKindOp {
  op: 'set_stage_kind';
  stage_id: string;
  kind: StageKind;
}

export interface RemoveStageOp {
  op: 'remove_stage';
  stage_id: string;
}

// --- moves (machine.transitions) ---------------------------------------------

export interface AddMoveOp {
  op: 'add_move';
  transition_id: string;
  /** Wire key is `from` (`AddMove.from_`'s alias), matching TransitionDef. */
  from: string;
  to: string;
  action: string;
  actor: MoveActor;
  guards: unknown[];
  effects: unknown[];
}

export interface UpdateMoveOp {
  op: 'update_move';
  transition_id: string;
  /** A free-form subset of TransitionDef's fields (to/action/actor/guards/effects). */
  patch: Record<string, unknown>;
}

export interface RemoveMoveOp {
  op: 'remove_move';
  transition_id: string;
}

// --- steps -------------------------------------------------------------------

export interface AddStepOp {
  op: 'add_step';
  /**
   * A full StepDef shape — but NOT normalized, which is why this is not
   * plainly `WorkflowStepDef`. `AddStep.step` is `dict[str, Any]`
   * server-side and `validate_ops` dumps it back exactly as the model
   * authored it (`propose_patch` parses a throwaway `StepDef` off it purely
   * to reject malformed steps, then discards the normalized copy). So any
   * key carrying a backend default can be ABSENT on the wire — and `config`
   * is one (`StepDef.config` is `Field(default_factory=dict)`) while
   * `WorkflowStepDef.config` is required.
   *
   * The `config?:` override below encodes that hazard in the type instead of
   * leaving it to this comment: `op.step.config.sections` is a real crash
   * that `WorkflowStepDef` would have type-checked. The apply function
   * materializes the default (`step.config ?? {}`).
   *
   * `show_if`/`review` need no override — they are already optional on both
   * sides.
   */
  step: Omit<WorkflowStepDef, 'config'> & { config?: Record<string, unknown> };
  /** `null`/absent = append. */
  position?: number | null;
}

export interface UpdateStepOp {
  op: 'update_step';
  step_id: string;
  patch: Record<string, unknown>;
}

export interface RemoveStepOp {
  op: 'remove_step';
  step_id: string;
}

// --- sections (step.config.sections) -----------------------------------------

export interface AddSectionOp {
  op: 'add_section';
  step_id: string;
  /**
   * A full SectionDef shape, unnormalized like `AddStepOp.step` — and in fact
   * weaker: `AddSection.section` is `dict[str, Any]` server-side and is not
   * parsed at ALL before the card sees it (only `add_step`'s step is), so a
   * malformed section reaches the card and fails on the save PUT.
   *
   * No `config`-style override is needed here even so. The two SectionDef
   * fields carrying backend defaults — `title` and `description`, both
   * `= ""` — are already optional on `WorkflowSectionDef`, so the type does
   * not claim any key the wire can legitimately omit. Everything else
   * (`section_id`, `entity_model`, `fields`, `mode`) is required on both
   * sides: absent means malformed, not defaulted.
   */
  section: WorkflowSectionDef;
}

export interface UpdateSectionOp {
  op: 'update_section';
  step_id: string;
  section_id: string;
  patch: Record<string, unknown>;
}

export interface RemoveSectionOp {
  op: 'remove_section';
  step_id: string;
  section_id: string;
}

// --- definition-level --------------------------------------------------------

export interface SetChannelAccessOp {
  op: 'set_channel_access';
  value: ChannelAccess;
}

/** The 14-op union, discriminated on `op` exactly as pydantic discriminates it. */
export type PatchOp =
  | AddStageOp
  | RenameStageOp
  | SetStageKindOp
  | RemoveStageOp
  | AddMoveOp
  | UpdateMoveOp
  | RemoveMoveOp
  | AddStepOp
  | UpdateStepOp
  | RemoveStepOp
  | AddSectionOp
  | UpdateSectionOp
  | RemoveSectionOp
  | SetChannelAccessOp;
