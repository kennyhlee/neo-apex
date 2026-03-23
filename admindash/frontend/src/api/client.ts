import type { StudentsResponse, TenantsResponse } from '../types/models.ts';

const API_BASE = 'http://localhost:8080';

export async function fetchStudents(
  tenant: string,
  limit: number,
  offset: number,
): Promise<StudentsResponse> {
  const params = new URLSearchParams({
    tenant,
    limit: String(limit),
    offset: String(offset),
  });
  const resp = await fetch(`${API_BASE}/students?${params}`);
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  return resp.json();
}

export async function fetchTenants(): Promise<TenantsResponse> {
  const resp = await fetch(`${API_BASE}/tenants`);
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  return resp.json();
}
