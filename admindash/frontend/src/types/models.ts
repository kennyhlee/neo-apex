export interface TestUser {
  user_id: string;
  name: string;
  email: string;
  tenant_id: string;
  tenant_name: string;
  role: string;
}

export interface Student {
  student_id: string;
  first_name: string;
  last_name: string;
  middle_name?: string;
  preferred_name?: string;
  dob?: string;
  grade_level?: string;
  email?: string;
  gender?: string;
  guardian_ids: string[];
  custom_fields: Record<string, unknown>;
  // Flattened fields from API join
  enrollment_status?: string;
  guardian1_first_name?: string;
  guardian1_last_name?: string;
  guardian1_phone?: string;
}

export interface Guardian {
  guardian_id: string;
  first_name: string;
  last_name: string;
  email?: string;
  phone?: string;
  relationship?: string;
}

export interface StudentsResponse {
  data: Student[];
  total: number;
}


export interface ModelFieldDefinition {
  name: string;
  type: 'str' | 'number' | 'bool' | 'date' | 'datetime' | 'email' | 'phone' | 'selection';
  required: boolean;
  options?: string[];
  multiple?: boolean;
  default?: unknown;
}

export interface ModelDefinition {
  base_fields: ModelFieldDefinition[];
  custom_fields: ModelFieldDefinition[];
}

export interface ModelResponse {
  entity_type: string;
  model_definition: ModelDefinition;
}

export interface CreateEntityResponse {
  entity_type: string;
  entity_id: string;
  base_data: Record<string, unknown>;
  custom_fields: Record<string, unknown>;
  _version: number;
  _status: string;
}

export interface ExtractResponse {
  fields: Record<string, string>;
}


export interface QueryStudentsResponse {
  data: Record<string, unknown>[];
  total: number;
}

export interface NextIdResponse {
  next_id: string;
  tenant_abbrev: string;
  entity_abbrev: string;
  sequence: number;
}

export interface DuplicateMatch {
  entity_id: string;
  student_id: string;
  first_name: string;
  last_name: string;
  dob: string;
  primary_address: string;
  similarity_score: number;
}

export interface DuplicateCheckRequest {
  first_name: string;
  last_name: string;
  dob: string;
  primary_address: string;
}

export interface DuplicateCheckResponse {
  matches: DuplicateMatch[];
}

export const DEFAULT_LEAD_STAGES = ['New', 'Contacted', 'Tour Scheduled', 'Toured', 'Enrolled', 'Lost'] as const;
// Backward-compat alias
export const LEAD_STAGES = DEFAULT_LEAD_STAGES;
// Relaxed to string — stages are now customer-defined via model
export type LeadStage = string;

export interface Lead {
  entity_id: string;
  lead_id?: string;
  guardian_name: string;
  email?: string;
  phone?: string;
  student_first_name?: string;
  student_last_name?: string;
  grade_of_interest?: string;
  message?: string;
  source: 'web_form' | 'manual' | 'email_import';
  stage: string;
  converted_family_id?: string;
  _created_at?: string;
  _updated_at?: string;
  // Index signature for dynamically-defined custom fields
  [key: string]: unknown;
}

export interface LeadModelField {
  name: string;
  type: string;
  required?: boolean;
  options?: string[];
  multiple?: boolean;
}

export interface LeadActivity {
  entity_id: string;
  lead_id: string;
  type: 'call' | 'email' | 'note' | 'stage_change';
  body: string;
  stage_from?: string;
  stage_to?: string;
  created_by: string;
  _created_at?: string;
}
