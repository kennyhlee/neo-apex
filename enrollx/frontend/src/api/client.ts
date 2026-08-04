import type { CreateEntityResponse, NextIdResponse } from '../types/models.ts';
import { ENROLLX_API_URL } from '../config.ts';

const API_BASE = ENROLLX_API_URL;
const TOKEN_KEY = 'neoapex_token';

export function authHeaders(): Record<string, string> {
  const token = localStorage.getItem(TOKEN_KEY);
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export async function jsonOrThrow<T>(resp: Response): Promise<T> {
  if (!resp.ok) throw new Error(`HTTP ${resp.status}: ${await resp.text()}`);
  return resp.json() as Promise<T>;
}

/** Double single quotes so a value is safe inside a SQL string literal. */
export function escapeSql(value: string): string {
  return value.replace(/'/g, "''");
}

export async function postQuery(
  tenantId: string,
  table: 'entities' | 'models',
  sql: string,
): Promise<{ data: Record<string, unknown>[]; total: number }> {
  const resp = await fetch(`${API_BASE}/api/query`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ tenant_id: tenantId, table, sql }),
  });
  return jsonOrThrow(resp);
}

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
  return jsonOrThrow(resp);
}

export async function updateEntity(
  tenantId: string,
  entityType: string,
  entityId: string,
  baseData: Record<string, unknown>,
  customFields: Record<string, unknown> = {},
): Promise<Record<string, unknown>> {
  const resp = await fetch(`${API_BASE}/api/entities/${tenantId}/${entityType}/${entityId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ base_data: baseData, custom_fields: customFields }),
  });
  return jsonOrThrow(resp);
}

export async function fetchNextEntityId(
  tenantId: string,
  entityType: string,
): Promise<NextIdResponse> {
  const resp = await fetch(
    `${API_BASE}/api/entities/${tenantId}/${entityType}/next-id`,
    { headers: authHeaders() },
  );
  return jsonOrThrow(resp);
}
