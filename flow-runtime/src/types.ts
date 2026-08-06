export type BlockType = 'form' | 'documents' | 'payment_plan' | 'payment' | 'message' | 'review';

export interface FlowBlock {
  block_id: string;
  type: BlockType;
  title: string;
  required: boolean;
  blocking: boolean;
  due_days_after_approval?: number;
  config: Record<string, unknown>;
}

export interface RegistrationConfigDef {
  config_id: string;
  version: number;
  status: 'draft' | 'published' | 'archived';
  blocks: FlowBlock[];
}

export type FlowMode = 'parent' | 'staff' | 'preview';

// ---- Runtime data shapes (Plan 4) -----------------------------------------

export type ApplicationStatus =
  | 'draft' | 'submitted' | 'in_review' | 'pending_items' | 'approved'
  | 'enrolled' | 'waitlisted' | 'declined' | 'withdrawn';

export type ItemStatus =
  | 'not_started' | 'in_progress' | 'submitted' | 'verified' | 'rejected' | 'waived';

export type ItemKind = 'form' | 'document' | 'esign' | 'payment';

/** The slice of a registration_application entity the renderer needs. */
export interface ApplicationSummary {
  application_id: string;
  school_year: string;
  status: ApplicationStatus;
  channel_started: 'parent' | 'admin';
  config_version: number;
  applicant_email?: string;
}

/** One application_item entity row. */
export interface ApplicationItem {
  item_id: string;
  application_id: string;
  block_id: string;
  kind: ItemKind;
  title: string;
  status: ItemStatus;
  blocking: boolean;
  due_at?: string;
  completed_by?: string;
  payload_ref?: string;
  /** Set by the backend when the owning block carries due_days_after_approval
   *  (items.py `_item()`); base_model.json:152. */
  due_days_after_approval?: number;
}

/** One field inside a form block (same shape as an entity-model field). */
export interface FlowField {
  name: string;
  type: 'str' | 'number' | 'bool' | 'date' | 'datetime' | 'email' | 'phone' | 'selection';
  required: boolean;
  options?: string[];
  multiple?: boolean;
  default?: unknown;
}

/** One required document inside a documents block (spec §4). */
export interface RequiredDoc {
  name: string;
  description?: string;
  sensitive: boolean;
  blocking: boolean;
  due_days_after_approval?: number;
}

export type PaymentPlanKind = 'pay_in_full' | 'deposit';

/** One entry of payment_plan config's plans[] (Plan 3 contract). */
export interface PaymentPlanOption {
  type: PaymentPlanKind;
  /** integer cents; present on deposit plans. */
  deposit_amount?: number;
}

/** Item statuses that count as "done" for gating (spec §5). */
export const DONE_ITEM_STATUSES: readonly ItemStatus[] = ['submitted', 'verified', 'waived'];

/** The `form` block `entity_type` naming the application itself. */
export const APPLICATION_ENTITY_TYPE = 'registration_application';

/**
 * Base fields of `registration_application` owned by the registration engine.
 *
 * Two consumers, one list: the hosts exclude these when hydrating an
 * application-model form block (a parent must never be shown an editable
 * `status` or `config_version`), and apexflow's engine rejects a form answer
 * that targets one with a 400 (`save_draft`, `app/workflows/engine.py`).
 *
 * NOT the same list as apexflow's `schema.ENGINE_OWNED_FIELDS` (that one is
 * `workflow_instance`-scoped: `instance_id`, `state`, `subject_refs`, etc. —
 * see `apexflow/backend/app/workflows/schema.py`). This constant is the
 * registration-era `registration_application` field set, retained here
 * specifically for the Phase 3 blocks compiler (`familyhub`'s config bundle
 * still ships `"blocks": []` — `familyhub/backend/app/api/registration.py`
 * — pending that compiler); it is not required to track apexflow's constant
 * and the two are allowed to diverge. (Pre-Task-12 this was enrollx's
 * `engine.ENGINE_OWNED_APPLICATION_FIELDS`.)
 *
 * `registration_application_id` is included even though the spec's field
 * table omits it: DataCore auto-assigns `"{entity_type}_id"` when absent and
 * `create_application` pre-sets it, so it is engine-owned in practice.
 *
 * `school_id` is here for the same reason, one step removed: Papermite's
 * extraction emits it from the application PDF, but WHICH school is already
 * implied by the tenant the application belongs to. Asking an applicant to
 * type it is asking them to restate the URL they arrived on. It is excluded
 * from every applicant-facing form and rejected on write; the school is
 * surfaced as read-only context instead (`FlowRendererProps.schoolName`).
 */
export const ENGINE_OWNED_APPLICATION_FIELDS: readonly string[] = [
  'application_id',
  'registration_application_id',
  'school_id',
  'school_year',
  'status',
  'family_id',
  'student_id',
  'config_version',
  'channel_started',
  'applicant_email',
  'token_version',
  'draft_data',
  'submitted_at',
  'decided_at',
];

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
