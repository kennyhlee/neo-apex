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
 * `status` or `config_version`), and enrollx's engine rejects a form answer
 * that targets one with a 400. The Python side restates it as
 * `engine.ENGINE_OWNED_APPLICATION_FIELDS` — the two MUST stay identical.
 *
 * `registration_application_id` is included even though the spec's field
 * table omits it: DataCore auto-assigns `"{entity_type}_id"` when absent and
 * `create_application` pre-sets it, so it is engine-owned in practice.
 */
export const ENGINE_OWNED_APPLICATION_FIELDS: readonly string[] = [
  'application_id',
  'registration_application_id',
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
