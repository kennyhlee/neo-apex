import type {
  CreateEntityResponse,
  ExtractResponse,
  NextIdResponse,
  DuplicateCheckRequest,
  DuplicateCheckResponse,
} from '../types/models.ts';

import { DATACORE_URL, PAPERMITE_BACKEND_URL } from '../config.ts';

const DATACORE_API_BASE = DATACORE_URL;
const PAPERMITE_API_BASE = PAPERMITE_BACKEND_URL;
const TOKEN_KEY = 'neoapex_token';

function authHeaders(): Record<string, string> {
  const token = localStorage.getItem(TOKEN_KEY);
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export async function postQuery(
  tenantId: string,
  table: 'entities' | 'models' | 'tenants',
  sql: string,
): Promise<{ data: Record<string, unknown>[]; total: number }> {
  const resp = await fetch(`${DATACORE_API_BASE}/api/query`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ tenant_id: tenantId, table, sql }),
  });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  return resp.json();
}

export async function archiveEntities(
  tenantId: string,
  entityType: string,
  entityIds: string[],
): Promise<{ archived: number }> {
  const resp = await fetch(
    `${DATACORE_API_BASE}/api/entities/${tenantId}/${entityType}/archive`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify({ entity_ids: entityIds }),
    },
  );
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  return resp.json();
}

export async function updateEntity(
  tenantId: string,
  entityType: string,
  entityId: string,
  baseData: Record<string, unknown>,
  customFields: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const resp = await fetch(
    `${DATACORE_API_BASE}/api/entities/${tenantId}/${entityType}/${entityId}`,
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify({
        base_data: baseData,
        custom_fields: customFields,
      }),
    },
  );
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  return resp.json();
}

export async function createEntity(
  tenantId: string,
  entityType: string,
  baseData: Record<string, unknown>,
  customFields: Record<string, unknown>,
): Promise<CreateEntityResponse> {
  const resp = await fetch(
    `${DATACORE_API_BASE}/api/entities/${tenantId}/${entityType}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
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

export async function fetchNextEntityId(
  tenantId: string,
  entityType: string,
): Promise<NextIdResponse> {
  const resp = await fetch(
    `${DATACORE_API_BASE}/api/entities/${tenantId}/${entityType}/next-id`,
    { headers: authHeaders() },
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
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify(data),
    },
  );
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  return resp.json();
}
