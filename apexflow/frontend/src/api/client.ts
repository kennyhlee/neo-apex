// Typed fetch wrapper + generic entity/query calls, ported from
// admindash/frontend/src/api/client.ts (interface map §1d), bound to
// apexflow-backend's own proxy routes (map §6a/§6b, ported byte-for-byte
// into apexflow/backend/app/api/{entities,query}.py in Task 1 — see
// apexflow/backend/app/api/entities.py:49-136, query.py:22-62).
//
// There is no shared generic request()/fetchJson() wrapper in the admindash
// source and no structured error shape beyond a bare `Error('HTTP
// ${status}')` (map §1d / cross-cutting note 2) — kept identical here.
import { APEXFLOW_API_URL } from '../config.ts';

const API_BASE = APEXFLOW_API_URL;
const TOKEN_KEY = 'neoapex_token';

function authHeaders(): Record<string, string> {
  const token = localStorage.getItem(TOKEN_KEY);
  return token ? { Authorization: `Bearer ${token}` } : {};
}

/** Double single quotes so a value is safe to interpolate into a SQL literal. */
export function escapeSql(value: string): string {
  return value.replace(/'/g, "''");
}

export type TableName = 'entities' | 'models' | 'tenants';

export interface QueryResult {
  data: Record<string, unknown>[];
  total: number;
}

/** POST /api/query — bound to apexflow/backend/app/api/query.py:22. */
export async function postQuery(
  tenantId: string,
  table: TableName,
  sql: string,
): Promise<QueryResult> {
  const resp = await fetch(`${API_BASE}/api/query`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ tenant_id: tenantId, table, sql }),
  });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  return resp.json();
}

export interface CreateEntityResponse {
  entity_id: string;
  [key: string]: unknown;
}

/** POST /api/entities/{tenant_id}/{entity_type} — entities.py:49. */
export async function createEntity(
  tenantId: string,
  entityType: string,
  baseData: Record<string, unknown>,
  customFields: Record<string, unknown> = {},
): Promise<CreateEntityResponse> {
  const resp = await fetch(`${API_BASE}/api/entities/${tenantId}/${entityType}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ base_data: baseData, custom_fields: customFields }),
  });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  return resp.json();
}

/** PUT /api/entities/{tenant_id}/{entity_type}/{entity_id} — entities.py:123. */
export async function updateEntity(
  tenantId: string,
  entityType: string,
  entityId: string,
  baseData: Record<string, unknown>,
  customFields: Record<string, unknown> = {},
): Promise<Record<string, unknown>> {
  const resp = await fetch(
    `${API_BASE}/api/entities/${tenantId}/${entityType}/${entityId}`,
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify({ base_data: baseData, custom_fields: customFields }),
    },
  );
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  return resp.json();
}

/** POST /api/entities/{tenant_id}/{entity_type}/archive — entities.py:62. */
export async function archiveEntities(
  tenantId: string,
  entityType: string,
  entityIds: string[],
): Promise<{ archived: number }> {
  const resp = await fetch(
    `${API_BASE}/api/entities/${tenantId}/${entityType}/archive`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify({ entity_ids: entityIds }),
    },
  );
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  return resp.json();
}

/** POST /api/entities/{tenant_id}/{entity_type}/restore — entities.py:77. */
export async function restoreEntities(
  tenantId: string,
  entityType: string,
  entityIds: string[],
): Promise<{ restored: number }> {
  const resp = await fetch(
    `${API_BASE}/api/entities/${tenantId}/${entityType}/restore`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify({ entity_ids: entityIds }),
    },
  );
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  return resp.json();
}

export interface NextIdResponse {
  next_id: string;
}

/** GET /api/entities/{tenant_id}/{entity_type}/next-id — entities.py:92. */
export async function fetchNextEntityId(
  tenantId: string,
  entityType: string,
): Promise<NextIdResponse> {
  const resp = await fetch(
    `${API_BASE}/api/entities/${tenantId}/${entityType}/next-id`,
    { headers: authHeaders() },
  );
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  return resp.json();
}

/**
 * Generic authenticated GET against the apexflow backend, shared by
 * api/designer.ts. Exported so callers needing a one-off endpoint don't
 * have to re-derive authHeaders()/API_BASE.
 */
export async function apiGet<T>(path: string): Promise<T> {
  const resp = await fetch(`${API_BASE}${path}`, { headers: authHeaders() });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  return resp.json();
}

/** Generic authenticated POST against the apexflow backend. */
export async function apiPost<T>(path: string, body?: unknown): Promise<T> {
  const resp = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  return resp.json();
}
