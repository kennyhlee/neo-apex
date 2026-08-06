# apexflow/backend/app/api/documents.py
"""Staff-facing document blob proxy (Task 10).

Ported from enrollx/backend/app/api/documents.py (interface map §1's
sibling module, cited directly by task-10-brief.md's Produces block). Same
security property this module exists to hold: `document.uploaded_by` is a
DataCore-required field DataCore itself cannot verify (`store.put_entity`
does not validate against the model definition). `CreateDocumentRequest`
below has NO `uploaded_by` field, so a client-supplied one in the request
body is silently dropped by pydantic's default `extra="ignore"` -- it never
reaches `body`, and the outgoing DataCore payload is built field-by-field
from `body` plus a value derived from the authenticated caller
(`user["user_id"]`), so there is no code path through which a
client-supplied value could reach DataCore.

`sensitive` is the same story (final-review fix wave, finding I1):
`CreateDocumentRequest` below has NO `sensitive` field either -- a
client-supplied one is silently dropped by pydantic's default
`extra="ignore"`. It is instead DERIVED server-side from the PINNED
definition of `body.instance_id`'s instance, via
`app.workflows.shared.derived_document_sensitive` -- the same helper
`app/api/internal.py::create_document_by_token` uses on the family surface
(Plan 3 Task 4 built the derivation there first; this route never got the
same treatment until now, which is exactly the gap that let a staff upload
of a definition-declared-sensitive doc land `sensitive=False` and become
visible to any family magic-link holder via `documents_by_token`'s
"own upload OR non-sensitive" rule).

Error-relay convention: DataCore's status code IS forwarded (the client
needs to distinguish a 404 from a 413), but the body never is -- DataCore's
error text can name storage keys, upstream hosts, and model fields. This is
the STAFF surface's policy; the family/token-scoped surface
(`app/api/internal.py`) instead masks every non-2xx to a fixed 502 -- see
that module's docstring for why the two channels deliberately diverge
(interface map Gotcha E).

`instance_id` here (not `application_id`) names the field this API accepts
from a staff caller -- apexflow's own vocabulary (a `workflow_instance`'s
DataCore entity_id). DataCore's blob API itself has a FIXED, un-renameable
field name (`application_id`, out of scope to change), so the outbound
payload still uses that literal JSON key.
"""
import logging

import httpx
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel

from app.auth import require_staff_tenant
from app.config import settings
from app.workflows import datacore as dc
from app.workflows import machine
from app.workflows.shared import derived_document_sensitive

logger = logging.getLogger(__name__)

router = APIRouter()


class CreateDocumentRequest(BaseModel):
    instance_id: str
    item_id: str | None = None
    filename: str
    content_type: str
    size: int


def _derive_sensitive_for_staff(tenant_id: str, instance_id: str, item_id: str | None,
                                user: dict) -> bool:
    """Resolve `instance_id` -> pinned `EvalContext` -> `derived_document_sensitive`,
    mirroring `app/api/internal.py::create_document_by_token`'s derivation
    for the family surface. `False` (never a raised error) whenever any leg
    of that resolution fails to resolve -- an unknown/foreign `instance_id`,
    or an instance whose pinned `workflow_definition` row is missing --
    since this route's job is presigning an upload, not validating the
    caller's `instance_id`; the derivation is a best-effort security
    upgrade, not a new way for `POST /documents` to 404/500 on a client
    value it never validated before this fix either. `item_id` absent/
    unresolvable also reads as `False`, same as the family surface."""
    token = user.get("_token")
    instance_row = dc.get_entity(tenant_id, "workflow_instance", instance_id, token)
    if instance_row is None:
        return False
    try:
        ctx = machine.build_eval_context(
            tenant_id, instance_row, actor=user.get("user_id", "staff"), token=token,
        )
    except HTTPException:
        return False
    return derived_document_sensitive(ctx, item_id)


def _dc_request(method: str, path: str, token: str | None,
                json_body: dict | None = None) -> httpx.Response:
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = token
    try:
        return httpx.request(
            method, f"{settings.datacore_url}{path}",
            json=json_body, headers=headers, timeout=30.0,
        )
    except httpx.RequestError:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, "DataCore is unreachable")


@router.post("/documents/{tenant_id}", status_code=201)
def create_document(tenant_id: str, body: CreateDocumentRequest,
                    user=Depends(require_staff_tenant)):
    """Presign an upload. `uploaded_by` is derived from the authenticated
    staff caller (`user["user_id"]`) -- never read from the client body,
    which has no such field to read (see module docstring). `sensitive` is
    likewise derived, from the pinned definition, via
    `_derive_sensitive_for_staff` -- also never read from the client body."""
    sensitive = _derive_sensitive_for_staff(tenant_id, body.instance_id, body.item_id, user)
    resp = _dc_request("POST", f"/api/documents/{tenant_id}", user.get("_token"), {
        "application_id": body.instance_id,  # DataCore's own fixed field name
        "item_id": body.item_id,
        "filename": body.filename,
        "content_type": body.content_type,
        "size": body.size,
        "sensitive": sensitive,
        "uploaded_by": user.get("user_id", "staff"),
    })
    if resp.status_code not in (200, 201):
        logger.warning("DataCore document create failed (%s): %s",
                       resp.status_code, resp.text)
        raise HTTPException(resp.status_code, "Document create failed")
    return resp.json()


@router.get("/documents/{tenant_id}/{document_id}/url")
def get_document_url(tenant_id: str, document_id: str,
                     user=Depends(require_staff_tenant)):
    resp = _dc_request(
        "GET", f"/api/documents/{tenant_id}/{document_id}/url", user.get("_token"))
    if resp.status_code != 200:
        logger.warning("DataCore document url failed (%s): %s",
                       resp.status_code, resp.text)
        raise HTTPException(resp.status_code, "Document URL request failed")
    return resp.json()
