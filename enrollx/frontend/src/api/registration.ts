import type { RequiredDoc } from '@neoapex/flow-runtime';
import { ENROLLX_API_URL } from '../config.ts';
import { authHeaders, jsonOrThrow } from './client.ts';
import type { ApplicationRow, ItemRow } from '../types/registration.ts';

const API_BASE = ENROLLX_API_URL;

/**
 * 201 response envelope from `engine.create_application` — verified
 * (INTERFACE-MAP §3): `{application, items}`, not a bare `ApplicationRow`.
 */
export interface CreateApplicationResponse {
  application: ApplicationRow;
  items: ItemRow[];
}

export async function createApplication(
  tenantId: string,
  body: { school_year: string; channel: 'admin'; applicant_email?: string },
): Promise<CreateApplicationResponse> {
  const resp = await fetch(`${API_BASE}/api/registration/${tenantId}/applications`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify(body),
  });
  return jsonOrThrow(resp);
}

/** The single typed-action endpoint (Plan 2). 409 = transition not allowed. */
export async function postApplicationAction(
  tenantId: string,
  applicationId: string,
  action: string,
  params: Record<string, unknown> = {},
): Promise<Record<string, unknown>> {
  const resp = await fetch(
    `${API_BASE}/api/registration/${tenantId}/applications/${applicationId}/actions`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify({ action, ...params }),
    },
  );
  return jsonOrThrow(resp);
}

/**
 * publish_config rides the action endpoint, but is the sole handler in the
 * dispatch table where the `{application_id}` path slot is NOT an
 * application id — it takes the `registration_config` entity_id instead
 * (verified: `enrollx/backend/app/registration/actions.py:387-397`,
 * `_publish_config`). The handler reads no body params, so none are sent.
 */
export async function publishConfig(
  tenantId: string,
  configEntityId: string,
): Promise<Record<string, unknown>> {
  return postApplicationAction(tenantId, configEntityId, 'publish_config');
}

/** Plan 3 checkout — response carries `checkout_url` (verified: `checkout_service.py:259-260`). */
export async function startCheckout(
  tenantId: string,
  applicationId: string,
  itemId: string,
): Promise<{ checkout_url: string }> {
  const resp = await fetch(
    `${API_BASE}/api/registration/${tenantId}/applications/${applicationId}/checkout`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify({ item_id: itemId }),
    },
  );
  return jsonOrThrow(resp);
}

export async function getDocumentUrl(
  tenantId: string,
  documentId: string,
): Promise<{ download_url: string }> {
  const resp = await fetch(
    `${API_BASE}/api/documents/${tenantId}/${documentId}/url`,
    { headers: authHeaders() },
  );
  return jsonOrThrow(resp);
}

/**
 * Full upload path for one required doc: presign via the document proxy, PUT
 * the bytes to R2, then complete the item so status derivation runs (Plan 2).
 *
 * No `uploaded_by` in the body: the enrollx proxy derives it from the
 * caller's JWT (the staff `user_id`) and must not accept it from here
 * (DISPATCH-CONTEXT, roadmap; DataCore blob API).
 *
 * NOTE: `POST /api/documents/{tenant_id}` and
 * `GET /api/documents/{tenant_id}/{document_id}/url` do not exist on
 * enrollx-backend yet (INTERFACE-MAP Discrepancy #1 / Gaps §5) — this
 * function and `getDocumentUrl` above are written against the contract Task
 * 10 is expected to add. They will 404 until that proxy lands.
 */
export async function uploadDocumentForItem(
  tenantId: string,
  applicationId: string,
  itemId: string,
  doc: RequiredDoc,
  file: File,
): Promise<string> {
  const presignResp = await fetch(`${API_BASE}/api/documents/${tenantId}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({
      application_id: applicationId,
      item_id: itemId,
      filename: file.name,
      content_type: file.type || 'application/octet-stream',
      size: file.size,
      sensitive: doc.sensitive,
    }),
  });
  const presign = await jsonOrThrow<{ document_id: string; upload_url: string }>(presignResp);

  const putResp = await fetch(presign.upload_url, {
    method: 'PUT',
    headers: { 'Content-Type': file.type || 'application/octet-stream' },
    body: file,
  });
  if (!putResp.ok) throw new Error(`Upload failed: HTTP ${putResp.status}`);

  // `payload_ref`, not `payload` — verified against the real dispatch table
  // (actions.py:102-106).
  await postApplicationAction(tenantId, applicationId, 'complete_item', {
    item_id: itemId,
    payload_ref: presign.document_id,
  });
  return presign.document_id;
}
