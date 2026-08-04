import { FAMILYHUB_API_URL } from '../config.ts';
import type { RegistrationConfigDef, FlowBlock } from '@neoapex/flow-runtime';
import {
  entityData,
  type CapacityState,
  type DecodedToken,
  type DocumentSlot,
  type EntityRecord,
  type HubBundle,
  type RegistrationBundle,
  type StartResponse,
  type TenantSummary,
} from '../types/registration.ts';

/**
 * Native fetch only -- familyhub-frontend holds NO credential of its own.
 * The magic-link token in the URL path (or, pre-start, nothing at all) is
 * the only thing that scopes a request. Never add an Authorization header,
 * a JWT, or any token/credential storage here.
 */
const API_BASE = FAMILYHUB_API_URL;

/**
 * Carries the upstream HTTP status so callers can distinguish "this link
 * is genuinely bad" (401/404) from a transient failure (a masked 5xx, a
 * 429, a dropped mobile connection) -- the backend's `relay()` goes out of
 * its way to preserve enrollx's real 401 and mask a genuine 5xx to a fixed
 * 502 specifically so the client can tell the two apart; this is what
 * reads that distinction back out instead of discarding it. Message shape
 * is unchanged (`HTTP {status}`), so any existing `.message` reader keeps
 * working.
 */
export class FacadeError extends Error {
  readonly status: number;

  constructor(status: number) {
    super(`HTTP ${status}`);
    this.name = 'FacadeError';
    this.status = status;
  }
}

async function jsonOrThrow<T>(resp: Response): Promise<T> {
  if (!resp.ok) throw new FacadeError(resp.status);
  return resp.json() as Promise<T>;
}

/**
 * `registration_config.blocks` is a JSON STRING on every wire shape this
 * client reads (both the pre-start config bundle and the post-start hub
 * bundle) -- enrollx never parses it before handing the row back
 * (`enrollx/backend/app/registration/engine.py` `get_published_config` /
 * `get_config_for_application` return the raw filtered row). `version` is
 * likewise a DataCore top-level field, so it arrives as a string. Both are
 * coerced here, once, so every consumer of `RegistrationBundle.config` /
 * `HubBundle.config` gets a real `RegistrationConfigDef` with `blocks:
 * FlowBlock[]` ready for `FlowRenderer` -- no second parse anywhere else.
 *
 * Values INSIDE a successfully-parsed `blocks` array are real JS types
 * already (object/array/number/bool as JSON produced them) and must not be
 * coerced again.
 */
function normalizeConfig(raw: EntityRecord | null | undefined): RegistrationConfigDef {
  const data = entityData(raw);
  const rawBlocks = data.blocks;
  let blocks: FlowBlock[] = [];
  if (typeof rawBlocks === 'string') {
    try {
      const parsed = JSON.parse(rawBlocks);
      if (Array.isArray(parsed)) blocks = parsed as FlowBlock[];
    } catch {
      blocks = [];
    }
  } else if (Array.isArray(rawBlocks)) {
    blocks = rawBlocks as FlowBlock[];
  }
  return {
    config_id: String(data.config_id ?? ''),
    version: Number(data.version ?? 1),
    status: (data.status as RegistrationConfigDef['status']) ?? 'published',
    blocks,
  };
}

interface RawConfigBundle {
  config: EntityRecord;
  tenant: TenantSummary;
  capacity: CapacityState;
}

/**
 * GET /api/registration/{tenant_id} -> `{config, tenant, capacity}`.
 *
 * Registration is admission to the school as a whole for one school year
 * (spec §1) -- there is no program segment. Fullness comes from
 * `capacity.full` (a freshly-computed boolean, no coercion needed) and is
 * school-wide for the current school year; there is no fullness field
 * anywhere else, so do not invent one.
 *
 * The `config.blocks` this returns are already MODEL-HYDRATED by enrollx --
 * familyhub holds no DataCore credential, so an entity-sourced form block
 * would otherwise render with no fields at all. Never try to resolve model
 * fields client-side.
 */
export async function fetchRegistrationBundle(
  tenantId: string,
): Promise<RegistrationBundle> {
  const resp = await fetch(
    `${API_BASE}/api/registration/${encodeURIComponent(tenantId)}`,
  );
  const raw = await jsonOrThrow<RawConfigBundle>(resp);
  return { config: normalizeConfig(raw.config), tenant: raw.tenant, capacity: raw.capacity };
}

/**
 * POST /api/registration/{tenant_id}/start -> enrollx's start response
 * (`{application, items, token, link}`) plus familyhub's own `hub_url`
 * (a relative in-app path, see `StartResponse.hub_url`).
 */
export async function startRegistration(
  tenantId: string,
  applicantEmail: string,
): Promise<StartResponse> {
  const resp = await fetch(
    `${API_BASE}/api/registration/${encodeURIComponent(tenantId)}/start`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ applicant_email: applicantEmail }),
    },
  );
  return jsonOrThrow<StartResponse>(resp);
}

interface RawHubBundle {
  application: EntityRecord;
  items: EntityRecord[];
  config: EntityRecord;
}

/** GET /api/application/{token} -> `{application, items, config}`. */
export async function fetchApplication(token: string): Promise<HubBundle> {
  const resp = await fetch(`${API_BASE}/api/application/${encodeURIComponent(token)}`);
  const raw = await jsonOrThrow<RawHubBundle>(resp);
  return { application: raw.application, items: raw.items, config: normalizeConfig(raw.config) };
}

async function putAction(
  token: string,
  payload: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const resp = await fetch(`${API_BASE}/api/application/${encodeURIComponent(token)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return jsonOrThrow<Record<string, unknown>>(resp);
}

// The facade allowlists exactly {save_draft, complete_item, submit} and
// 403s anything else BEFORE proxying (defense in depth -- enrollx enforces
// the identical allowlist again). Params verified against
// enrollx/backend/app/registration/actions.py: save_draft -> draft_data;
// complete_item -> item_id (+ optional payload_ref, there is NO `payload`
// field); submit -> no params at all.

export const saveDraft = (token: string, draftData: Record<string, unknown>) =>
  putAction(token, { action: 'save_draft', draft_data: draftData });

/**
 * @param itemId MUST be the item's DataCore `entity_id` (e.g.
 * `entityData(item).entity_id` from a `HubBundle.items` row), never the
 * business `item_id` field -- the backend keys `_require_item` on
 * `entity_id` and a business id 404s silently on every real call.
 * @param payloadRef optional -- e.g. a just-uploaded document_id.
 */
export const completeItem = (token: string, itemId: string, payloadRef?: string) =>
  putAction(token, {
    action: 'complete_item',
    item_id: itemId,
    ...(payloadRef ? { payload_ref: payloadRef } : {}),
  });

/** No params -- sending anything beyond `{action: 'submit'}` is a defect. */
export const submitApplication = (token: string) => putAction(token, { action: 'submit' });

/**
 * POST /api/application/request-link -- ALWAYS `200 {"status": "ok"}`,
 * identical whether or not the email matched an application (no account
 * enumeration). Resolves on any 2xx; a genuine outage still surfaces as a
 * thrown error (masked 502 from the facade), which is not itself a
 * distinguishing signal since it's identical for every email.
 */
export async function requestLink(tenantId: string, email: string): Promise<void> {
  const resp = await fetch(`${API_BASE}/api/application/request-link`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tenant_id: tenantId, email }),
  });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
}

/**
 * POST /api/application/{token}/documents -- presigns an upload slot.
 * @param meta.item_id MUST be the document item's `entity_id` (same
 * identifier-trap rule as `completeItem`), when provided at all.
 */
export async function createDocumentSlot(
  token: string,
  meta: { item_id?: string; filename: string; content_type: string; size: number },
): Promise<DocumentSlot> {
  const resp = await fetch(`${API_BASE}/api/application/${encodeURIComponent(token)}/documents`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(meta),
  });
  return jsonOrThrow<DocumentSlot>(resp);
}

/**
 * Full parent upload flow: presign slot -> PUT bytes to R2 -> `complete_item`
 * with the new document as `payload_ref`.
 *
 * @param itemId MUST be the document item's `entity_id` -- this is exactly
 * the value `flow-runtime`'s `onUploadDocument(blockId, doc, file, itemId?)`
 * carries through, so pass it straight through without reimplementing the
 * title-match workaround Plan 4 deleted. The Content-Type sent in the PUT
 * must match the one declared when presigning -- R2's signature binds it.
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
  await completeItem(token, itemId, slot.document_id);
  return slot.document_id;
}

/**
 * GET /api/application/{token}/documents/{document_id}/url -> `{download_url}`.
 * `document_id` is the ONE genuine exception to the identifier trap:
 * DataCore sets `entity_id = document_id` at create time, so the id you
 * already have (e.g. an item's `payload_ref`) is correct here as-is.
 */
export async function getDocumentUrl(token: string, documentId: string): Promise<string> {
  const resp = await fetch(
    `${API_BASE}/api/application/${encodeURIComponent(token)}/documents/${encodeURIComponent(documentId)}/url`,
  );
  const body = await jsonOrThrow<{ download_url: string }>(resp);
  return body.download_url;
}

/**
 * POST /api/application/{token}/checkout -> Stripe Checkout URL, carried in
 * the response's `checkout_url` key.
 * @param itemId optional (the facade's `CheckoutBody.item_id` is optional
 * too) -- but when passed, per the identifier trap, MUST be the payment
 * item's `entity_id`, matching what `flow-runtime`'s `onCheckout(itemId)`
 * hands you.
 */
export async function startCheckout(token: string, itemId?: string): Promise<string> {
  const resp = await fetch(`${API_BASE}/api/application/${encodeURIComponent(token)}/checkout`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ item_id: itemId ?? null }),
  });
  const body = await jsonOrThrow<{ checkout_url: string }>(resp);
  return body.checkout_url;
}

/**
 * Decode (NOT verify) a magic-link token's plaintext segments. Purely a
 * display convenience -- carries no proof of authenticity. familyhub holds
 * no `link_secret` and must never attempt real verification; only
 * enrollx's `resolve_token` (reached through the facade routes above)
 * authenticates a token.
 */
export function decodeToken(token: string): DecodedToken | null {
  try {
    const padded = token + '='.repeat((4 - (token.length % 4)) % 4);
    const raw = atob(padded.replace(/-/g, '+').replace(/_/g, '/'));
    // Exact 3-segment split, mirroring enrollx's own parse_link_token: a
    // token decodes to (tenant, application entity_id, signature) in
    // exactly one way. This function ignores the signature -- it is not a
    // verification -- but keeps the same segment-count strictness so a
    // malformed token reads as null rather than a misleading partial value.
    const parts = raw.split('.');
    if (parts.length !== 3) return null;
    const [tenantId, applicationEntityId] = parts;
    if (!tenantId || !applicationEntityId) return null;
    return { tenantId, applicationEntityId };
  } catch {
    return null;
  }
}
