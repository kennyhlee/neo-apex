export interface TestUser {
  user_id: string;
  username: string;
  password: string;
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

export interface TenantsResponse {
  tenants: { id: string; name?: string }[];
}
