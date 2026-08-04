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
