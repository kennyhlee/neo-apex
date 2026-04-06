import type {
  EntityResult,
  ExtractionResult,
  FieldMapping,
  FinalizeCommitResponse,
  ModelConfig,
  SchemaMap,
  TenantModel,
  TestUser,
} from "../types/models";

import { PAPERMITE_API_URL } from "../config";

const BASE_URL = PAPERMITE_API_URL;
const TOKEN_KEY = "neoapex_token";

// ─── Token helpers ────────────────────────────────────────────

export function getStoredToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function storeToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token);
}

export function clearToken(): void {
  localStorage.removeItem(TOKEN_KEY);
}

/**
 * Redeem an exchange code received via URL param for a real token.
 */
export async function redeemExchangeCode(code: string): Promise<string> {
  const res = await fetch(`${BASE_URL}/redeem-code`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code }),
  });
  if (!res.ok) throw new Error("Failed to redeem code");
  const data = await res.json();
  storeToken(data.token);
  return data.token;
}

// ─── Auth fetch ───────────────────────────────────────────────

async function authFetch(url: string, init?: RequestInit): Promise<Response> {
  const token = getStoredToken();
  const headers = new Headers(init?.headers);
  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }
  return fetch(url, { ...init, headers });
}

// ─── Login (no auth required) ─────────────────────────────────

export async function login(
  email: string,
  password: string
): Promise<{ token: string; user: TestUser }> {
  const res = await fetch(`${BASE_URL}/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.detail || "Login failed");
  }
  return res.json();
}

// ─── Authenticated API calls ──────────────────────────────────

export async function getCurrentUser(): Promise<TestUser> {
  const res = await authFetch(`${BASE_URL}/me`);
  if (!res.ok) throw new Error("Failed to fetch user");
  return res.json();
}

export async function getSchema(): Promise<SchemaMap> {
  const res = await authFetch(`${BASE_URL}/schema`);
  if (!res.ok) throw new Error("Failed to fetch schema");
  return res.json();
}

export async function getAvailableModels(): Promise<ModelConfig> {
  const res = await authFetch(`${BASE_URL}/config/models`);
  if (!res.ok) throw new Error("Failed to fetch models");
  return res.json();
}

export async function getActiveModel(
  tenantId: string
): Promise<TenantModel | null> {
  const res = await authFetch(`${BASE_URL}/tenants/${tenantId}/model`);
  if (!res.ok) throw new Error("Failed to fetch model");
  const data = await res.json();
  return data;
}

export async function uploadDocument(
  tenantId: string,
  file: File,
  modelId: string
): Promise<ExtractionResult> {
  const formData = new FormData();
  formData.append("file", file);
  formData.append("model_id", modelId);

  const res = await authFetch(`${BASE_URL}/tenants/${tenantId}/upload`, {
    method: "POST",
    body: formData,
  });
  if (!res.ok) {
    const detail = await res.json().catch(() => ({}));
    throw new Error(detail.detail || "Upload failed");
  }
  return res.json();
}

/**
 * Convert a stored TenantModel back into an ExtractionResult
 * so it can be loaded into the Review page for manual editing.
 */
export function modelToExtraction(
  model: TenantModel
): ExtractionResult {
  const entities: EntityResult[] = [];

  for (const [entityType, def] of Object.entries(model.model_definition)) {
    const entity: Record<string, unknown> = {};
    const fieldMappings: FieldMapping[] = [];
    const customFields: Record<string, unknown> = {};

    for (const field of def.base_fields) {
      const value = field.name === "tenant_id" ? model.tenant_id : "";
      entity[field.name] = value;
      fieldMappings.push({
        field_name: field.name,
        value,
        source: "base_model",
        required: field.required,
        field_type: field.type,
        ...(field.options && { options: field.options }),
        ...(field.multiple !== undefined && { multiple: field.multiple }),
      });
    }

    for (const field of def.custom_fields) {
      entity[field.name] = "";
      customFields[field.name] = "";
      fieldMappings.push({
        field_name: field.name,
        value: "",
        source: "custom_field",
        required: field.required,
        field_type: field.type,
        ...(field.options && { options: field.options }),
        ...(field.multiple !== undefined && { multiple: field.multiple }),
      });
    }

    entity.custom_fields = customFields;

    entities.push({
      entity_type: entityType.toUpperCase(),
      entity,
      field_mappings: fieldMappings,
    });
  }

  return {
    extraction_id: `edit-${Date.now()}`,
    tenant_id: model.tenant_id,
    filename: model.source_filename,
    entities,
    raw_text: "",
    status: "pending_review",
  };
}

export async function commitFinalize(
  tenantId: string,
  extraction: ExtractionResult
): Promise<FinalizeCommitResponse> {
  const res = await authFetch(`${BASE_URL}/tenants/${tenantId}/finalize/commit`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ extraction }),
  });
  if (!res.ok) {
    const detail = await res.json().catch(() => ({}));
    throw new Error(detail.detail || "Finalization failed");
  }
  return res.json();
}
