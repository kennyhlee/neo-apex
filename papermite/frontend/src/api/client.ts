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

export async function uploadDocuments(
  tenantId: string,
  files: File[],
  modelId: string
): Promise<ExtractionResult> {
  const formData = new FormData();
  for (const file of files) {
    formData.append("files", file);
  }
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
 * Merge a freshly-extracted ExtractionResult into an existing one (used when
 * appending additional documents to an already-finalized model). For each
 * entity type, the base's fields are kept and any newly-discovered fields from
 * `incoming` are added; selection options present in both are unioned. Base
 * field definitions (types, defaults, required) always win — appending adds
 * coverage, it never rewrites the existing schema.
 */
export function mergeExtractionResults(
  base: ExtractionResult,
  incoming: ExtractionResult
): ExtractionResult {
  const byType = new Map<string, EntityResult>();
  for (const entity of base.entities) {
    byType.set(entity.entity_type, {
      ...entity,
      entity: { ...entity.entity },
      field_mappings: entity.field_mappings.map((m) => ({ ...m })),
    });
  }

  for (const incomingEntity of incoming.entities) {
    const existing = byType.get(incomingEntity.entity_type);
    if (!existing) {
      byType.set(incomingEntity.entity_type, {
        ...incomingEntity,
        entity: { ...incomingEntity.entity },
        field_mappings: incomingEntity.field_mappings.map((m) => ({ ...m })),
      });
      continue;
    }
    const indexByName = new Map(
      existing.field_mappings.map((m, i) => [m.field_name, i] as const)
    );
    for (const mapping of incomingEntity.field_mappings) {
      const idx = indexByName.get(mapping.field_name);
      if (idx === undefined) {
        indexByName.set(mapping.field_name, existing.field_mappings.length);
        existing.field_mappings.push({ ...mapping });
        existing.entity[mapping.field_name] = mapping.value;
      } else if (mapping.field_type === "selection" && mapping.options?.length) {
        const current = existing.field_mappings[idx];
        const merged = [...(current.options ?? [])];
        for (const opt of mapping.options) {
          if (!merged.includes(opt)) merged.push(opt);
        }
        existing.field_mappings[idx] = { ...current, options: merged };
      }
    }
  }

  return {
    ...base,
    entities: Array.from(byType.values()),
  };
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
        ...(field.default !== undefined && { default: field.default }),
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
        ...(field.default !== undefined && { default: field.default }),
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
