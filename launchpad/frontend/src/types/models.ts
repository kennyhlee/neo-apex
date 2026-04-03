export interface User {
  user_id: string;
  name: string;
  email: string;
  tenant_id: string;
  tenant_name: string;
  role: "admin" | "staff" | "teacher" | "parent";
}

export interface OnboardingStep {
  id: string;
  label: string;
  completed: boolean;
}

export interface OnboardingStatus {
  steps: OnboardingStep[];
  is_complete: boolean;
}

export interface TenantProfile {
  tenant_id: string;
  name: string;
  [key: string]: unknown;
}

export const FIELD_TYPES = ["str", "number", "bool", "date", "datetime", "email", "phone", "selection"] as const;
export type FieldType = typeof FIELD_TYPES[number];

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
