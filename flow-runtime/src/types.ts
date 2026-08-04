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
  program_id: string;
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
  program_id: string;
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
