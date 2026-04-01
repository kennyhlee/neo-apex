import type {
  StudentsResponse,
  TenantsResponse,
  ModelResponse,
  CreateEntityResponse,
  ExtractResponse,
  QueryStudentsParams,
  QueryStudentsResponse,
} from '../types/models.ts';

const API_BASE = 'http://localhost:8080';
const DATACORE_API_BASE = 'http://localhost:8081';
const PAPERMITE_API_BASE = 'http://localhost:8000';

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

export async function fetchStudentModel(
  tenantId: string,
): Promise<ModelResponse> {
  const resp = await fetch(
    `${DATACORE_API_BASE}/api/models/${tenantId}/student`,
  );
  if (resp.status === 404) throw new Error('Student model not configured');
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  return resp.json();
}

export async function createStudent(
  tenantId: string,
  baseData: Record<string, unknown>,
  customFields: Record<string, unknown>,
): Promise<CreateEntityResponse> {
  const resp = await fetch(
    `${DATACORE_API_BASE}/api/entities/${tenantId}/student`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        base_data: baseData,
        custom_fields: customFields,
      }),
    },
  );
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  return resp.json();
}

export async function extractStudentFromDocument(
  tenantId: string,
  file: File,
): Promise<ExtractResponse> {
  const formData = new FormData();
  formData.append('file', file);
  const resp = await fetch(
    `${PAPERMITE_API_BASE}/api/extract/${tenantId}/student`,
    {
      method: 'POST',
      body: formData,
    },
  );
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  return resp.json();
}

export async function queryStudents(
  tenantId: string,
  params: QueryStudentsParams = {},
): Promise<QueryStudentsResponse> {
  const searchParams = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value != null && value !== '') {
      searchParams.set(key, String(value));
    }
  }
  const resp = await fetch(
    `${DATACORE_API_BASE}/api/entities/${tenantId}/student/query?${searchParams}`,
  );
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  return resp.json();
}
