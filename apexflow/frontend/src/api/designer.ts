// Designer read/write API, bound EXACTLY to apexflow-backend's Task 2 +
// Plan 1 route shapes (interface map §2a/§2i, api/designer.py,
// api/definitions.py — both read directly off apexflow/backend/app/api/ on
// disk, not from memory).
import { APEXFLOW_API_URL } from '../config.ts';
import { asNumber } from '../utils/numeric.ts';
import type {
  DefinitionBundle,
  DefinitionLifecycleAction,
  DefinitionRow,
  ListDefinitionsResponse,
  PrimitivesCatalog,
  ValidateResult,
} from '../types/designer.ts';

const API_BASE = APEXFLOW_API_URL;
const TOKEN_KEY = 'neoapex_token';

function authHeaders(): Record<string, string> {
  const token = localStorage.getItem(TOKEN_KEY);
  return token ? { Authorization: `Bearer ${token}` } : {};
}

/**
 * Thrown instead of a bare `Error` when the backend responds with a parsed
 * JSON body worth inspecting (publish's `{errors: [...]}` 409, retire's
 * `{open_instances: N}` 409) — admindash's client has no structured error
 * shape in general (map §1d / cross-cutting note 2), but these two route
 * responses carry real data callers need, so this mirrors admindash's own
 * one precedent for that (`convertLead`'s 409 special-case).
 */
export class ApiError extends Error {
  status: number;
  body: unknown;

  constructor(status: number, body: unknown) {
    super(`HTTP ${status}`);
    this.name = 'ApiError';
    this.status = status;
    this.body = body;
  }
}

async function parseOrThrow<T>(resp: Response): Promise<T> {
  if (resp.ok) return resp.json();
  let body: unknown = undefined;
  try {
    body = await resp.json();
  } catch {
    /* non-JSON error body — ApiError.body stays undefined */
  }
  throw new ApiError(resp.status, body);
}

/**
 * GET /api/workflows/{tenant_id}/definitions — api/designer.py:79.
 *
 * `version` and `open_instances` are coerced to real numbers here (see
 * utils/numeric.ts's `asNumber` doc comment) so every caller downstream —
 * this file's other exports included — gets a value it can safely do
 * arithmetic on, rather than each page having to remember to coerce a
 * flattened-string field itself.
 */
export async function listDefinitions(tenantId: string): Promise<ListDefinitionsResponse> {
  const resp = await fetch(`${API_BASE}/api/workflows/${tenantId}/definitions`, {
    headers: authHeaders(),
  });
  const data = await parseOrThrow<ListDefinitionsResponse>(resp);
  return {
    definitions: data.definitions.map((entry) => ({
      ...entry,
      version: asNumber(entry.version),
      open_instances: asNumber(entry.open_instances),
    })),
  };
}

/**
 * GET /api/workflows/{tenant_id}/definitions/{entity_id}/bundle —
 * api/designer.py:122. `definition.version` coerced per `listDefinitions`'s
 * comment above — the bundle route returns the same flattened row's raw
 * `version` value.
 */
export async function getBundle(tenantId: string, entityId: string): Promise<DefinitionBundle> {
  const resp = await fetch(
    `${API_BASE}/api/workflows/${tenantId}/definitions/${entityId}/bundle`,
    { headers: authHeaders() },
  );
  const data = await parseOrThrow<DefinitionBundle>(resp);
  return {
    ...data,
    definition: { ...data.definition, version: asNumber(data.definition.version) },
  };
}

/**
 * POST /api/workflows/{tenant_id}/definitions/{entity_id}/validate —
 * api/designer.py:155. Dry-run only, no body. MUST return exactly the
 * errors `publishDefinition` would 409 with (designer.py:158-162's own
 * binding contract).
 */
export async function validateDefinition(
  tenantId: string,
  entityId: string,
): Promise<ValidateResult> {
  const resp = await fetch(
    `${API_BASE}/api/workflows/${tenantId}/definitions/${entityId}/validate`,
    { method: 'POST', headers: authHeaders() },
  );
  return parseOrThrow(resp);
}

/** GET /api/workflows/{tenant_id}/primitives — api/designer.py:186. */
export async function getPrimitives(tenantId: string): Promise<PrimitivesCatalog> {
  const resp = await fetch(`${API_BASE}/api/workflows/${tenantId}/primitives`, {
    headers: authHeaders(),
  });
  return parseOrThrow(resp);
}

/**
 * POST /api/workflows/{tenant_id}/definitions/{entity_id}/actions —
 * api/definitions.py:38. `{action, force_cancel?}` body — `force_cancel`
 * only means anything for `action: "retire"` (api/definitions.py:51-54);
 * harmless to omit for the other three actions.
 *
 * Publish 409s with `{errors: [...]}` when the definition fails
 * `validate_definition` (definitions.py:114-117) — the row is never touched
 * in that path. Retire 409s with `{open_instances: N}` when instances are
 * open and `force_cancel` is not set (definitions.py:208-211). Both surface
 * as `ApiError` with the parsed body on `.body`.
 */
export async function lifecycleAction(
  tenantId: string,
  entityId: string,
  action: DefinitionLifecycleAction,
  opts?: { force_cancel?: boolean },
): Promise<DefinitionRow> {
  const resp = await fetch(
    `${API_BASE}/api/workflows/${tenantId}/definitions/${entityId}/actions`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify({ action, ...opts }),
    },
  );
  const data = await parseOrThrow<DefinitionRow>(resp);
  // `version` coerced per listDefinitions's comment — this is the same
  // flattened `workflow_definition` row, returned directly by the backend.
  return { ...data, version: asNumber(data.version) };
}

/** `lifecycleAction(tenantId, entityId, 'publish')` — named per the brief's Interfaces list. */
export function publishDefinition(tenantId: string, entityId: string): Promise<DefinitionRow> {
  return lifecycleAction(tenantId, entityId, 'publish');
}
