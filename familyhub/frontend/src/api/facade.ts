import { FAMILYHUB_API_URL } from '../config.ts';
import type { WorkflowDraft, WorkflowSectionDef, WorkflowStepDef } from '@neoapex/flow-runtime';
import {
  type DecodedToken,
  type DocumentSlot,
  type InstanceBundle,
  type StartResponse,
  type WorkflowBundle,
} from '../types/workflow.ts';

/**
 * Native fetch only -- familyhub-frontend holds NO credential of its own.
 * The magic-link token in the URL path (or, pre-start, nothing at all) is
 * the only thing that scopes a request. Never add an Authorization header,
 * a JWT, or any token/credential storage here.
 */
const API_BASE = FAMILYHUB_API_URL;

/**
 * Carries the upstream HTTP status AND (best-effort) parsed body so callers
 * can distinguish "this link is genuinely bad" (401/404) from a transient
 * failure (a masked 5xx, a 429, a dropped mobile connection), and can read
 * a structured error's `detail.reason` -- the backend's `relay()` goes out
 * of its way to preserve apexflow's real 4xx body verbatim (FastAPI wraps
 * an `HTTPException(409, {"reason": ...})` as `{"detail": {"reason": ...}}`
 * on the wire) and mask a genuine 5xx to a fixed 502 specifically so the
 * client can tell the two apart; this is what reads that distinction back
 * out instead of discarding it. `body` is `undefined` when the response
 * carried no parseable JSON (e.g. the masked 502's own fixed body still
 * parses fine, but a network-level failure never reaches `jsonOrThrow` at
 * all). Message shape is unchanged (`HTTP {status}`), so any existing
 * `.message` reader keeps working.
 */
export class FacadeError extends Error {
  readonly status: number;
  readonly body: unknown;

  constructor(status: number, body: unknown = undefined) {
    super(`HTTP ${status}`);
    this.name = 'FacadeError';
    this.status = status;
    this.body = body;
  }
}

async function jsonOrThrow<T>(resp: Response): Promise<T> {
  if (!resp.ok) {
    let body: unknown;
    try {
      body = await resp.json();
    } catch {
      body = undefined;
    }
    throw new FacadeError(resp.status, body);
  }
  return resp.json() as Promise<T>;
}

/**
 * GET /api/workflows/{tenant_id}/{definition_id} -> apexflow's config
 * bundle (`{definition, models, tenant, capacity, lineage_status}`),
 * relayed VERBATIM by familyhub-backend since Task 6 -- no reshape, no
 * `blocks: []` placeholder. Public/unauthenticated: this is the pre-start
 * read, never needs a token.
 *
 * A non-`"active"` `lineage_status` is NOT an error here -- the bundle is
 * still returned in full so the caller (RegisterPage) can render its
 * friendly "no longer accepting new submissions" page instead of a bare
 * 404/500. `startWorkflow` is the actual 409 gate against starting a NEW
 * instance on a non-active lineage.
 */
export async function fetchWorkflowBundle(
  tenantId: string,
  definitionId: string,
): Promise<WorkflowBundle> {
  const resp = await fetch(
    `${API_BASE}/api/workflows/${encodeURIComponent(tenantId)}/${encodeURIComponent(definitionId)}`,
  );
  return jsonOrThrow<WorkflowBundle>(resp);
}

/**
 * POST /api/workflows/{tenant_id}/{definition_id}/start -> apexflow's start
 * response relayed with `hub_url` added by familyhub-backend (a relative
 * in-app path, see `StartResponse.hub_url`).
 *
 * On a 409, `err.body` is `{"detail": {"reason": "lineage_not_active" |
 * "definition_stale" | "definition_broken", ...}}` (`engine.py::
 * create_instance`'s own doc comment) -- callers should branch on
 * `(err.body as any)?.detail?.reason` rather than treating every 409 the
 * same way.
 */
export async function startWorkflow(
  tenantId: string,
  definitionId: string,
  applicantEmail: string,
): Promise<StartResponse> {
  const resp = await fetch(
    `${API_BASE}/api/workflows/${encodeURIComponent(tenantId)}/${encodeURIComponent(definitionId)}/start`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ applicant_email: applicantEmail }),
    },
  );
  return jsonOrThrow<StartResponse>(resp);
}

/** GET /api/instance/{token} -> `{instance, items, definition, allowed}`, relayed verbatim. */
export async function fetchInstance(token: string): Promise<InstanceBundle> {
  const resp = await fetch(`${API_BASE}/api/instance/${encodeURIComponent(token)}`);
  return jsonOrThrow<InstanceBundle>(resp);
}

async function putAction(
  token: string,
  payload: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const resp = await fetch(`${API_BASE}/api/instance/${encodeURIComponent(token)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return jsonOrThrow<Record<string, unknown>>(resp);
}

// Task 6 retired the hand-synced PARENT_ACTIONS allowlist on the backend --
// which action strings are permitted on the family channel is entirely
// apexflow's authority now (its BLOCKED_TOKEN_ACTIONS 403 and actor-gating
// relay back verbatim through `putAction`'s `jsonOrThrow`). This file still
// exposes only the three named helpers below plus the generic `runAction`
// for whatever the machine currently advertises via `InstanceBundle.allowed`.

/**
 * `engine.py::save_draft`'s wire param is `section_answers` -- a NESTED,
 * per-section-id dict (bindings §4b), not `StepRenderer`'s flat dotted-key
 * `WorkflowDraft`. Callers MUST build this via `draftToSectionAnswers`
 * below; sending `WorkflowDraft` directly (or the old `draft_data` key) is
 * a confirmed silent no-op on the backend (bindings §10 finding 1).
 */
export const saveDraft = (token: string, sectionAnswers: Record<string, unknown>) =>
  putAction(token, { action: 'save_draft', section_answers: sectionAnswers });

/**
 * @param itemId MUST be the item's DataCore `entity_id` (e.g. `entityId(item)`
 * from an `InstanceBundle.items` row), never the business `item_id` field
 * -- the backend keys `_require_item` on `entity_id` and a business id
 * 404s silently on every real call.
 */
export const completeItem = (token: string, itemId: string) =>
  putAction(token, { action: 'complete_item', item_id: itemId });

/**
 * Any action name from `InstanceBundle.allowed` other than `save_draft`/
 * `complete_item` (those two are wired through `saveDraft`/`completeItem`
 * above, which carry item-specific params those two actions need). No
 * further params -- every other action the family channel can legally run
 * (`submit`, `withdraw`, `resubmit`, ...) takes none.
 */
export const runAction = (token: string, action: string) => putAction(token, { action });

/**
 * POST /api/instance/request-link -- ALWAYS `200 {"status": "ok"}`,
 * identical whether or not the email matched an instance (no account
 * enumeration). Resolves on any 2xx; a genuine outage still surfaces as a
 * thrown error (masked 502 from the facade), which is not itself a
 * distinguishing signal since it's identical for every email.
 */
export async function requestLink(tenantId: string, email: string): Promise<void> {
  const resp = await fetch(`${API_BASE}/api/instance/request-link`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tenant_id: tenantId, email }),
  });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
}

/**
 * POST /api/instance/{token}/documents -- presigns an upload slot.
 * @param meta.item_id MUST be the document item's `entity_id` (same
 * identifier-trap rule as `completeItem`), when provided at all.
 */
export async function createDocumentSlot(
  token: string,
  meta: { item_id?: string; filename: string; content_type: string; size: number },
): Promise<DocumentSlot> {
  const resp = await fetch(`${API_BASE}/api/instance/${encodeURIComponent(token)}/documents`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(meta),
  });
  return jsonOrThrow<DocumentSlot>(resp);
}

/**
 * Full parent upload flow: presign slot -> PUT bytes to R2 -> `complete_item`
 * against the same item.
 *
 * @param itemId MUST be the document item's `entity_id` -- this is exactly
 * the value `flow-runtime`'s `StepRenderer` `onUploadDocument(itemEntityId, file)`
 * carries through, so pass it straight through. The Content-Type sent in
 * the PUT must match the one declared when presigning -- R2's signature
 * binds it.
 */
export async function uploadDocumentFile(
  token: string,
  itemId: string,
  file: File,
): Promise<string> {
  const contentType = file.type || 'application/pdf';
  const slot = await createDocumentSlot(token, {
    item_id: itemId,
    filename: file.name,
    content_type: contentType,
    size: file.size,
  });
  const put = await fetch(slot.upload_url, {
    method: 'PUT',
    headers: { 'Content-Type': contentType },
    body: file,
  });
  if (!put.ok) throw new Error(`Upload failed: HTTP ${put.status}`);
  await completeItem(token, itemId);
  return slot.document_id;
}

/**
 * GET /api/instance/{token}/documents/{document_id}/url -> `{download_url}`.
 * `document_id` is the ONE genuine exception to the identifier trap:
 * DataCore sets `entity_id = document_id` at create time, so the id you
 * already have is correct here as-is.
 */
export async function getDocumentUrl(token: string, documentId: string): Promise<string> {
  const resp = await fetch(
    `${API_BASE}/api/instance/${encodeURIComponent(token)}/documents/${encodeURIComponent(documentId)}/url`,
  );
  const body = await jsonOrThrow<{ download_url: string }>(resp);
  return body.download_url;
}

/**
 * Decode (NOT verify) a magic-link token's plaintext segments. Purely a
 * display convenience -- carries no proof of authenticity. familyhub holds
 * no `link_secret` and must never attempt real verification; only
 * apexflow's `resolve_token` (reached through the facade routes above)
 * authenticates a token.
 */
export function decodeToken(token: string): DecodedToken | null {
  try {
    const padded = token + '='.repeat((4 - (token.length % 4)) % 4);
    const raw = atob(padded.replace(/-/g, '+').replace(/_/g, '/'));
    // Exact 3-segment split, mirroring apexflow's own parse_link_token: a
    // token decodes to (tenant, instance entity_id, signature) in exactly
    // one way. This function ignores the signature -- it is not a
    // verification -- but keeps the same segment-count strictness so a
    // malformed token reads as null rather than a misleading partial value.
    const parts = raw.split('.');
    if (parts.length !== 3) return null;
    const [tenantId, instanceEntityId] = parts;
    if (!tenantId || !instanceEntityId) return null;
    return { tenantId, instanceEntityId };
  } catch {
    return null;
  }
}

// ---- WorkflowDraft <-> section_answers converters --------------------------
//
// No converter for this existed anywhere in the codebase before this task
// (bindings §4c/§10 finding 8) -- StepRenderer's flat, dotted-key
// `WorkflowDraft` and `engine.py::save_draft`'s nested per-section-id
// `section_answers` are NOT the same shape. Both directions are exact
// mirrors of bindings §4c's derivation, keyed off the SAME `steps` array
// `StepRenderer` itself renders from, so a stale/renamed section can never
// desync the two.

function formSectionsOf(step: WorkflowStepDef): WorkflowSectionDef[] {
  const sections = step.config.sections;
  return Array.isArray(sections) ? (sections as WorkflowSectionDef[]) : [];
}

/**
 * Flatten a `WorkflowDraft` into `save_draft`'s `section_answers` shape.
 *
 * - Non-repeat section: one dict entry per declared field pick present in
 *   `draft` at its `"{section_id}.{field}"` key, collected into
 *   `{field_name: value}` and written to `section_answers[section_id]` --
 *   but ONLY if at least one field was actually present, so an untouched
 *   section is omitted rather than sent as `{}` (avoids clobbering
 *   already-saved answers for a section this particular draft snapshot
 *   never touched -- `save_draft` shallow-merges per section, but an empty
 *   dict is still a no-op either way; omitting keeps the wire payload
 *   honest about what changed).
 * - Repeat section: the WHOLE row array, copied straight across from the
 *   bare `section_id` key, only when it actually IS an array (matches
 *   `save_draft`'s REPLACE semantics for repeat sections -- a dict-shaped
 *   or missing value here would 400).
 *
 * Deliberately NEVER emits a `context.*` key or a `"{step_id}.ack"` key --
 * both are structurally impossible to produce since this only ever reads
 * keys shaped from a REAL section's `section_id`/field-pick names, never
 * pattern-matches `draft`'s own keys the way `buildConditionData` guards
 * against having to (`engine.py` would 400 either one as an undeclared
 * `section_id` regardless).
 */
export function draftToSectionAnswers(
  steps: WorkflowStepDef[],
  draft: WorkflowDraft,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const step of steps) {
    if (step.type !== 'form') continue;
    for (const section of formSectionsOf(step)) {
      if (!section.repeat) {
        const entry: Record<string, unknown> = {};
        for (const pick of section.fields) {
          const key = `${section.section_id}.${pick.name}`;
          if (Object.prototype.hasOwnProperty.call(draft, key)) {
            entry[pick.name] = draft[key];
          }
        }
        if (Object.keys(entry).length > 0) out[section.section_id] = entry;
      } else {
        const rows = draft[section.section_id];
        if (Array.isArray(rows)) out[section.section_id] = rows;
      }
    }
  }
  return out;
}

/**
 * The literal inverse of `draftToSectionAnswers` -- hydrate a fetched
 * instance's `draft_data` (already `JSON.parse`d into `section_answers`'s
 * nested shape) into a flat `WorkflowDraft` `StepRenderer` can consume.
 *
 * - Non-repeat section: spread `saved[section_id]`'s entries out to
 *   `"{section_id}.{field}"` keys.
 * - Repeat section: copy `saved[section_id]` straight across to the bare
 *   `section_id` key, unchanged.
 *
 * A `section_id` declared in `steps` but absent from `saved` (nothing
 * answered yet) simply contributes no keys -- not an error.
 */
export function sectionAnswersToDraft(
  steps: WorkflowStepDef[],
  saved: Record<string, unknown>,
): WorkflowDraft {
  const out: WorkflowDraft = {};
  for (const step of steps) {
    if (step.type !== 'form') continue;
    for (const section of formSectionsOf(step)) {
      const value = saved[section.section_id];
      if (value === undefined) continue;
      if (!section.repeat) {
        if (value && typeof value === 'object' && !Array.isArray(value)) {
          for (const [field, v] of Object.entries(value as Record<string, unknown>)) {
            out[`${section.section_id}.${field}`] = v;
          }
        }
      } else if (Array.isArray(value)) {
        out[section.section_id] = value;
      }
    }
  }
  return out;
}
