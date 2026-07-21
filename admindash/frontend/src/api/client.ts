import type {
  CreateEntityResponse,
  ExtractResponse,
  NextIdResponse,
  DuplicateCheckRequest,
  DuplicateCheckResponse,
  Lead,
  LeadActivity,
} from '../types/models.ts';

import { ADMINDASH_API_URL } from '../config.ts';

const API_BASE = ADMINDASH_API_URL;
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
  const resp = await fetch(`${API_BASE}/api/query`, {
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

export async function updateEntity(
  tenantId: string,
  entityType: string,
  entityId: string,
  baseData: Record<string, unknown>,
  customFields: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const resp = await fetch(
    `${API_BASE}/api/entities/${tenantId}/${entityType}/${entityId}`,
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
    `${API_BASE}/api/entities/${tenantId}/${entityType}`,
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
    `${API_BASE}/api/extract/${tenantId}/student`,
    {
      method: 'POST',
      headers: authHeaders(),
      body: formData,
    },
  );
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  return resp.json();
}

export interface AvailableModelsResponse {
  default: string;
  models: { id: string; label?: string }[];
}

export async function fetchAvailableModels(): Promise<AvailableModelsResponse> {
  const resp = await fetch(`${API_BASE}/api/config/models`, {
    headers: authHeaders(),
  });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  return resp.json();
}

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

export async function checkDuplicateStudents(
  tenantId: string,
  data: DuplicateCheckRequest,
): Promise<DuplicateCheckResponse> {
  const resp = await fetch(
    `${API_BASE}/api/entities/${tenantId}/student/duplicate-check`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify(data),
    },
  );
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  return resp.json();
}

export async function listLeads(tenantId: string, stage?: string): Promise<Lead[]> {
  const q = stage ? `?stage=${encodeURIComponent(stage)}` : '';
  const resp = await fetch(`${API_BASE}/api/leads/${tenantId}${q}`, { headers: authHeaders() });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  return (await resp.json()).leads as Lead[];
}

export async function getLead(tenantId: string, leadId: string): Promise<Lead> {
  const resp = await fetch(`${API_BASE}/api/leads/${tenantId}/${leadId}`, { headers: authHeaders() });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  return resp.json();
}

export async function createLead(tenantId: string, fields: Partial<Lead>): Promise<Lead> {
  const resp = await fetch(`${API_BASE}/api/leads/${tenantId}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify(fields),
  });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  return resp.json();
}

export async function updateLeadStage(tenantId: string, leadId: string, stage: string): Promise<Lead> {
  const resp = await fetch(`${API_BASE}/api/leads/${tenantId}/${leadId}/stage`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ stage }),
  });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  return resp.json();
}

export async function listActivities(tenantId: string, leadId: string): Promise<LeadActivity[]> {
  const resp = await fetch(`${API_BASE}/api/leads/${tenantId}/${leadId}/activities`, { headers: authHeaders() });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  return (await resp.json()).activities as LeadActivity[];
}

export async function addActivity(tenantId: string, leadId: string, type: string, body: string): Promise<LeadActivity> {
  const resp = await fetch(`${API_BASE}/api/leads/${tenantId}/${leadId}/activities`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ type, body }),
  });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  return resp.json();
}

export interface ConvertPayload {
  family_name: string; primary_address: string;
  primary_email?: string; primary_phone?: string;
  student_first_name: string; student_last_name: string; grade_level?: string;
}
export async function convertLead(tenantId: string, leadId: string, payload: ConvertPayload) {
  const resp = await fetch(`${API_BASE}/api/leads/${tenantId}/${leadId}/convert`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify(payload),
  });
  if (resp.status === 409) throw new Error(await resp.text());
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  return resp.json();
}

// Public intake — NO auth header.
export async function submitPublicLead(tenantId: string, fields: Partial<Lead>): Promise<void> {
  const resp = await fetch(`${API_BASE}/api/public/leads/${tenantId}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(fields),
  });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
}
