export interface TestUser {
  user_id: string;
  name: string;
  email: string;
  tenant_id: string;
  tenant_name: string;
  role: string;
}

export const FIELD_TYPES = ["str", "number", "bool", "date", "datetime", "email", "phone", "selection"] as const;
export type FieldType = typeof FIELD_TYPES[number];

export interface FieldMapping {
  field_name: string;
  value: unknown;
  source: "base_model" | "custom_field";
  required: boolean;
  field_type: FieldType;
  options?: string[];
  multiple?: boolean;
}

export interface EntityResult {
  entity_type: string;
  entity: Record<string, unknown>;
  field_mappings: FieldMapping[];
}

export interface ExtractionResult {
  extraction_id: string;
  tenant_id: string;
  filename: string;
  entities: EntityResult[];
  raw_text: string;
  status: "pending_review" | "finalized";
}

export interface ModelConfig {
  default: string;
  models: string[];
}

export interface SchemaField {
  type: string;
  required: boolean;
  default: string | null;
}

export type EntitySchema = Record<string, SchemaField>;
export type SchemaMap = Record<string, EntitySchema>;

export interface FieldDefinition {
  name: string;
  type: FieldType;
  required: boolean;
  options?: string[];
  multiple?: boolean;
}

export interface EntityModelDefinition {
  base_fields: FieldDefinition[];
  custom_fields: FieldDefinition[];
}

export type ModelDefinition = Record<string, EntityModelDefinition>;

export interface TenantModel {
  tenant_id: string;
  version: number;
  status: "active" | "archived";
  model_definition: ModelDefinition;
  source_filename: string;
  created_by: string;
  created_at: string;
}

export interface FinalizePreviewResponse {
  status: "unchanged" | "pending_confirmation";
  tenant_id: string;
  version: number;
  entity_count: number;
  model_definition: ModelDefinition;
  source_filename: string;
  created_by?: string;
  created_at?: string;
}

export interface FinalizeCommitResponse {
  status: "finalized" | "unchanged";
  tenant_id: string;
  version: number;
  entity_count: number;
  model_definition: ModelDefinition;
  source_filename: string;
  created_by: string;
  created_at: string;
}
