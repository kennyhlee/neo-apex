// ---- Runtime data shapes (Plan 4) -----------------------------------------

// The status vocabulary is GENERATED from apexflow's `ItemStatus` StrEnum
// (`apexflow/backend/app/workflows/shared.py`) -- see
// `./itemStatus.generated.ts`. Re-exported here so every existing
// `from '@neoapex/flow-runtime'` import keeps resolving, and so there is
// still exactly one place a consumer needs to know about.
import type { ItemStatus } from './itemStatus.generated';

export type { ItemStatus };
export { ITEM_STATUSES, ITEM_DONE_STATUSES } from './itemStatus.generated';

/** One field inside a form block (same shape as an entity-model field). */
export interface FlowField {
  name: string;
  type: 'str' | 'number' | 'bool' | 'date' | 'datetime' | 'email' | 'phone' | 'selection';
  required: boolean;
  options?: string[];
  multiple?: boolean;
  default?: unknown;
}

/**
 * Item statuses that count as "done" for gating (spec §5).
 *
 * @deprecated Import `ITEM_DONE_STATUSES` instead -- same values, generated
 * from apexflow's `ITEM_DONE_STATUSES` rather than spelled here.
 */
export { ITEM_DONE_STATUSES as DONE_ITEM_STATUSES } from './itemStatus.generated';

// ---- ApexFlow workflow types (Plan 2) --------------------------------------
//
// TS mirrors of `apexflow/backend/app/workflows/schema.py`'s WIRE shapes
// (i.e. what `model_dump(by_alias=True)` emits and what this side must send
// back), per the Plan 2 interface map §2i. `schema.py` uses trailing
// underscores (`all_`/`any_`/`not_`) only because `all`/`any`/`not` are
// Python builtins/keywords; every model has `populate_by_name=True` so the
// Python side can construct from either spelling, but the WIRE spelling —
// and therefore this file's spelling — is the alias with no underscore.
// `TransitionDef.from_` (wire key `"from"`) is machine-level and not needed
// by this renderer, so it has no mirror here.

/** Wire mirror of `schema.py`'s `Condition` (`:54-69`). */
export interface Condition {
  source: string;
  op: 'eq' | 'ne' | 'in' | 'empty' | 'not_empty' | 'truthy';
  /**
   * Required to be a list when `op === 'in'` (`Condition`'s own model
   * validator enforces this server-side, `schema.py:69-86`); otherwise the
   * comparison operand for `eq`/`ne`, unused by `empty`/`not_empty`/`truthy`.
   */
  value?: unknown;
}

/** Wire mirror of `schema.py`'s `ConditionItem = Union[Condition, ConditionGroup]` (`:92`). */
export type ConditionItem = Condition | ConditionGroupDef;

/**
 * Wire mirror of `schema.py`'s `ConditionGroup` (`:95-107`). Exactly one of
 * `all`/`any`/`not` is semantically set — the Python side enforces this
 * with a model validator (`:109-117`) — but on the actual wire, the
 * backend's `model_dump(by_alias=True)` (what `designer.py`'s routes emit)
 * serializes ALL THREE keys, with `null` for the two that are unset; it
 * does NOT omit them. This TS type marks all three optional for
 * convenience, but a `ConditionGroupDef` read off the wire will have all
 * three keys present with two of them `null` — callers (`evaluateCondition`
 * in particular) must check `Array.isArray(...)`, not `!== undefined`, to
 * find the set one.
 */
export interface ConditionGroupDef {
  all?: ConditionItem[] | null;
  any?: ConditionItem[] | null;
  not?: ConditionItem[] | null;
}

/** Wire mirror of `schema.py`'s `FieldPick` (`:176-178`). */
export interface FieldPick {
  name: string;
  required: boolean;
}

/** Wire mirror of `schema.py`'s `RepeatSpec` (`:183-185`). */
export interface RepeatSpec {
  min: number;
  max: number;
}

/** Wire mirror of `schema.py`'s `SectionDef` (`:193-199`). */
export interface WorkflowSectionDef {
  section_id: string;
  entity_model: string;
  fields: FieldPick[];
  mode: 'create' | 'match_or_create';
  repeat?: RepeatSpec | null;
}

/** Wire mirror of `schema.py`'s `StepDef` (`:203-222`). */
export interface WorkflowStepDef {
  step_id: string;
  type: 'form' | 'documents' | 'message';
  title: string;
  required: boolean;
  blocking: boolean;
  available_in: string[];
  show_if?: ConditionGroupDef | null;
  /** `null`/absent means "use the type's semantic default" (form/message ->
   *  auto, documents -> staff) — `schema.py` itself does not apply that
   *  default, so this renderer doesn't need to either. */
  review?: 'staff' | 'auto' | null;
  config: Record<string, unknown>;
}

// ---- Runtime item/document views (Plan 3) ----------------------------------
//
// What the family/staff runtime channels (`StepRenderer`'s `'family'`/
// `'staff'` modes) pass alongside `steps`/`draft`: one `WorkflowItemView` per
// applicable step, matched to its step by `step_id` (not by array position —
// a step with no `show_if`-visible/derived item simply has none in the
// array). `InstanceDocumentView` is the flat list of already-uploaded files
// for a workflow instance; a `documents`-step's uploads are found by
// filtering on `item_id` against that step's matched `WorkflowItemView.
// entity_id`.

/** One workflow-instance item, as the family/staff runtime sees it. */
export interface WorkflowItemView {
  entity_id: string;
  step_id: string;
  kind: 'form' | 'documents' | 'message-ack';
  title: string;
  status: ItemStatus;
  blocking: boolean;
}

/** One already-uploaded document on a workflow instance. */
export interface InstanceDocumentView {
  document_id: string;
  filename: string;
  item_id?: string;
}
