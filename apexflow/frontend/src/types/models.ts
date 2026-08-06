/**
 * Ported from admindash/frontend/src/types/models.ts (interface map §1a) —
 * trimmed to the shape AuthContext needs. ApexFlow has no staff-facing
 * student/family/lead surfaces of its own.
 */
export interface TestUser {
  user_id: string;
  name: string;
  email: string;
  tenant_id: string;
  tenant_name: string;
  role: string;
}
