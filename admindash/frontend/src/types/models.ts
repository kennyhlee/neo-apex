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

export interface Tenant {
  id: string;
  name: string;
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
