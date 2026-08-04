import type { ApplicationStatus, ItemKind, ItemStatus } from '@neoapex/flow-runtime';

export interface ApplicationRow {
  entity_id: string;
  application_id: string;
  school_year: string;
  status: ApplicationStatus;
  channel_started: 'parent' | 'admin';
  config_version: number;
  applicant_email?: string;
  draft_data?: string;
  submitted_at?: string;
  decided_at?: string;
  [key: string]: unknown;
}

export interface ItemRow {
  entity_id: string;
  item_id: string;
  application_id: string;
  block_id: string;
  kind: ItemKind;
  title: string;
  status: ItemStatus;
  blocking: boolean | string;
  due_at?: string;
  completed_by?: string;
  payload_ref?: string;
  [key: string]: unknown;
}

export interface ActivityRow {
  entity_id: string;
  activity_id: string;
  application_id: string;
  type: 'status_change' | 'item_change' | 'note' | 'email_sent';
  from_value?: string;
  to_value?: string;
  actor: string;
  at: string;
  [key: string]: unknown;
}

export interface PaymentRow {
  entity_id: string;
  payment_id: string;
  application_id: string;
  kind: 'deposit' | 'balance' | 'full' | 'offline';
  amount: number;
  currency: string;
  status: 'pending' | 'paid' | 'failed' | 'refunded';
  provider: 'stripe' | 'offline';
  provider_ref?: string;
  recorded_by?: string;
  paid_at?: string;
  [key: string]: unknown;
}

export interface DocumentRow {
  entity_id: string;
  document_id: string;
  application_id: string;
  item_id?: string;
  filename: string;
  content_type: string;
  size: number;
  sensitive: boolean | string;
  uploaded_by: string;
  uploaded_at: string;
  [key: string]: unknown;
}

export interface ConfigRow {
  entity_id: string;
  config_id: string;
  version: number;
  status: 'draft' | 'published' | 'archived';
  blocks: string; // JSON-serialized FlowBlock[]
  [key: string]: unknown;
}
