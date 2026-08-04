export interface TestUser {
  user_id: string;
  name: string;
  email: string;
  tenant_id: string;
  tenant_name: string;
  role: string;
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

export interface CreateEntityResponse {
  entity_type: string;
  entity_id: string;
  base_data: Record<string, unknown>;
  custom_fields: Record<string, unknown>;
  _version: number;
  _status: string;
}

export interface NextIdResponse {
  next_id: string;
  tenant_abbrev: string;
  entity_abbrev: string;
  sequence: number;
}
