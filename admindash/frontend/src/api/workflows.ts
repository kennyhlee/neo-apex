// Staff-side ApexFlow proxy client. Bound EXACTLY to admindash-backend's
// Task 9 proxy routes (all mounted under /api by main.py, all under
// admindash/backend/app/api/workflows.py's own /workflows/{tenant_id}/...
// paths): list definitions, definition bundle, create instance,
// allowed-actions, post action. Fetch pattern + authHeaders copied from
// `client.ts` rather than imported, per that file's own convention of one
// `authHeaders` per API client module (apexflow-frontend's `designer.ts`
// does the same — interface map §9's localStorage table notes these are
// "independent copies, not shared code").
import type { ModelFieldSource, WorkflowStepDef } from '@neoapex/flow-runtime';
import { ADMINDASH_API_URL } from '../config.ts';
import { asNumber } from '../utils/workflowData.ts';

const API_BASE = ADMINDASH_API_URL;
const TOKEN_KEY = 'neoapex_token';

function authHeaders(): Record<string, string> {
  const token = localStorage.getItem(TOKEN_KEY);
  return token ? { Authorization: `Bearer ${token}` } : {};
}

/**
 * Thrown instead of a bare `Error` when the backend responds with a parsed
 * JSON body worth inspecting — the 409 allowed-actions/guard-failure body
 * an action POST can return is exactly the shape Task 11's drawer needs to
 * show *why* an action is blocked. Port of
 * `apexflow/frontend/src/api/designer.ts:33-54`'s `ApiError` (admindash's
 * `client.ts` only ever throws a bare `Error(\`HTTP ${status}\`)`, which
 * loses that body).
 */
export class WorkflowApiError extends Error {
  status: number;
  body: unknown;

  constructor(status: number, body: unknown) {
    super(`HTTP ${status}`);
    this.name = 'WorkflowApiError';
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
    /* non-JSON error body — WorkflowApiError.body stays undefined */
  }
  throw new WorkflowApiError(resp.status, body);
}

// ---- Definitions -----------------------------------------------------------

export interface DefinitionListEntry {
  entity_id: string;
  definition_id: string;
  name: string;
  version: number;
  status: string;
  lineage_status: string;
  channel_access: string;
  health: string;
  open_instances: number;
  family_url?: string;
  parse_error?: string;
}

/** GET /api/workflows/{tenant_id}/definitions — one row per lineage-version
 * row (draft/published/superseded all included; apexflow's own doc comment
 * on `designer.py::list_definitions`). `version`/`open_instances` are
 * coerced with `asNumber` (DataCore flattens every scalar column to a
 * string — interface map §2c — and `designer.py`'s route forwards
 * `row.get("version")` unchanged), same reasoning as apexflow-frontend's
 * own `designer.ts::listDefinitions`. */
export async function listWorkflowDefinitions(
  tenantId: string,
): Promise<{ definitions: DefinitionListEntry[] }> {
  const resp = await fetch(`${API_BASE}/api/workflows/${tenantId}/definitions`, {
    headers: authHeaders(),
  });
  const data = await parseOrThrow<{ definitions: DefinitionListEntry[] }>(resp);
  return {
    definitions: data.definitions.map((entry) => ({
      ...entry,
      version: asNumber(entry.version),
      open_instances: asNumber(entry.open_instances),
    })),
  };
}

export interface MachineStateDef {
  state_id: string;
  name: string;
  kind: string;
}

export interface MachineTransitionDef {
  transition_id: string;
  from: string;
  to: string;
  action: string;
  actor: string;
  guards: { primitive: string; params: Record<string, unknown> }[];
  effects: { primitive: string; params: Record<string, unknown> }[];
}

export interface DefinitionDetail {
  entity_id: string;
  definition_id: string;
  name: string;
  version: number;
  status: string;
  lineage_status: string;
  channel_access: string;
  machine: { states: MachineStateDef[]; transitions: MachineTransitionDef[] };
  /** Wire mirror of `schema.py`'s `StepDef` list — typed via flow-runtime's
   * own `WorkflowStepDef` (Task 12) rather than a loose `Record<string,
   * unknown>[]`, since `StaffEntryPage` feeds this straight into
   * `StepRenderer`/`draftToSectionAnswers`/`sectionAnswersToDraft`, all of
   * which require the real shape. */
  steps: WorkflowStepDef[];
}

export interface DefinitionBundle {
  definition: DefinitionDetail;
  /** Task 4 finding: a referenced entity model that was never set up at
   * this tenant comes back `null` — callers (`StaffEntryPage`) must filter
   * before handing this to `StepRenderer`, which types `models` with no
   * null. */
  models: Record<string, ModelFieldSource | null>;
  health: string;
  errors: string[];
}

/** GET /api/workflows/{tenant_id}/definitions/{entity_id}/bundle — the
 * parsed machine/steps for one definition row. */
export async function getDefinitionBundle(
  tenantId: string,
  entityId: string,
): Promise<DefinitionBundle> {
  const resp = await fetch(
    `${API_BASE}/api/workflows/${tenantId}/definitions/${entityId}/bundle`,
    { headers: authHeaders() },
  );
  return parseOrThrow(resp);
}

// ---- Instances --------------------------------------------------------------

export interface CreateWorkflowInstanceBody {
  context: Record<string, unknown>;
  channel: 'staff';
  applicant_email?: string;
}

/** POST /api/workflows/{tenant_id}/definitions/{definition_id}/instances */
export async function createWorkflowInstance(
  tenantId: string,
  definitionId: string,
  body: CreateWorkflowInstanceBody,
): Promise<{ instance: Record<string, unknown>; items: Record<string, unknown>[] }> {
  const resp = await fetch(
    `${API_BASE}/api/workflows/${tenantId}/definitions/${definitionId}/instances`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify(body),
    },
  );
  return parseOrThrow(resp);
}

/** GET /api/workflows/{tenant_id}/instances/{instance_entity_id}/allowed-actions */
export async function getAllowedActions(
  tenantId: string,
  instanceEntityId: string,
): Promise<{ state: string; allowed: string[] }> {
  const resp = await fetch(
    `${API_BASE}/api/workflows/${tenantId}/instances/${instanceEntityId}/allowed-actions`,
    { headers: authHeaders() },
  );
  return parseOrThrow(resp);
}

export interface PostInstanceActionBody {
  action: string;
  [key: string]: unknown;
}

/** POST /api/workflows/{tenant_id}/instances/{instance_entity_id}/actions —
 * non-OK responses (incl. the 409 allowed-list body) surface via
 * `WorkflowApiError`, not a bare thrown `Error`. */
export async function postInstanceAction(
  tenantId: string,
  instanceEntityId: string,
  body: PostInstanceActionBody,
): Promise<Record<string, unknown>> {
  const resp = await fetch(
    `${API_BASE}/api/workflows/${tenantId}/instances/${instanceEntityId}/actions`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify(body),
    },
  );
  return parseOrThrow(resp);
}

// ---- Documents ---------------------------------------------------------

export interface CreateDocumentBody {
  instance_id: string;
  item_id?: string;
  filename: string;
  content_type: string;
  size: number;
  sensitive?: boolean;
}

/** Apexflow's `POST /api/documents/{tenant_id}` presign response, relayed
 * verbatim by Task 9's proxy — identical shape to familyhub's `DocumentSlot`
 * (`document_id`/`upload_url`/`storage_key`), reimplemented here rather than
 * shared since the two channels' API clients are independent copies by
 * convention (interface map §9's localStorage table note applies to API
 * clients generally, not just token storage). */
export interface DocumentSlot {
  document_id: string;
  upload_url: string;
  storage_key: string;
}

/** POST /api/workflows/{tenant_id}/documents — Task 9's staff document-create
 * proxy (→ apexflow `POST /api/documents/{tenant_id}`). `uploaded_by` is
 * derived server-side from the authenticated staff caller; there is no such
 * field to send from here (`apexflow/backend/app/api/documents.py`'s
 * `CreateDocumentRequest` has none). Step 2 of the staff upload flow: PUT the
 * file bytes to `upload_url` with the SAME `Content-Type` sent here (R2's
 * signature binds it), then `postInstanceAction(..., { action:
 * 'complete_item', item_id, payload_ref: document_id })`. */
export async function createDocument(
  tenantId: string,
  body: CreateDocumentBody,
): Promise<DocumentSlot> {
  const resp = await fetch(`${API_BASE}/api/workflows/${tenantId}/documents`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify(body),
  });
  return parseOrThrow(resp);
}

/** GET /api/workflows/{tenant_id}/documents/{document_id}/url — Task 9's
 * staff document-download proxy. `document_id` here is a `document` row's
 * DataCore `entity_id` (DataCore assigns the sequential `document_id` value
 * AS the row's `entity_id` at create time — `document_routes.py`'s
 * `create_document`, `entity_id=document_id` — so a `document` row's own
 * `entity_id`/`document_id` fields are always identical; either can be
 * passed here). Relays apexflow's own `get_document_url` response shape
 * unchanged: `{ download_url: string }`. */
export async function getDocumentUrl(
  tenantId: string,
  documentId: string,
): Promise<{ download_url: string }> {
  const resp = await fetch(
    `${API_BASE}/api/workflows/${tenantId}/documents/${documentId}/url`,
    { headers: authHeaders() },
  );
  return parseOrThrow(resp);
}
