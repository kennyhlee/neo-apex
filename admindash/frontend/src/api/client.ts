import type {
  StudentsResponse,
  TenantsResponse,
  ModelResponse,
  CreateEntityResponse,
  ExtractResponse,
  QueryStudentsParams,
  QueryStudentsResponse,
  NextIdResponse,
  DuplicateCheckRequest,
  DuplicateCheckResponse,
} from '../types/models.ts';

import { DATACORE_URL, PAPERMITE_BACKEND_URL } from '../config.ts';

const API_BASE = 'http://localhost:8080';
const DATACORE_API_BASE = DATACORE_URL;
const PAPERMITE_API_BASE = PAPERMITE_BACKEND_URL;
const TOKEN_KEY = 'neoapex_token';

function authHeaders(): Record<string, string> {
  const token = localStorage.getItem(TOKEN_KEY);
  return token ? { Authorization: `Bearer ${token}` } : {};
}

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
      headers: authHeaders(),
      body: formData,
    },
  );
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  return resp.json();
}

export interface QueryResult {
  rows: Record<string, unknown>[];
  total: number;
}

export async function runQuery(
  tenantId: string,
  tableType: string,
  sql: string,
): Promise<QueryResult> {
  const params = new URLSearchParams({ sql });
  const resp = await fetch(
    `${DATACORE_API_BASE}/api/query/${tenantId}/${tableType}?${params}`,
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

export async function fetchNextStudentId(
  tenantId: string,
): Promise<NextIdResponse> {
  const resp = await fetch(
    `${DATACORE_API_BASE}/api/entities/${tenantId}/student/next-id`,
  );
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  return resp.json();
}

export async function checkDuplicateStudents(
  tenantId: string,
  data: DuplicateCheckRequest,
): Promise<DuplicateCheckResponse> {
  const resp = await fetch(
    `${DATACORE_API_BASE}/api/entities/${tenantId}/student/duplicate-check`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    },
  );
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  return resp.json();
}
