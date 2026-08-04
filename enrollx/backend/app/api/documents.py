"""Document proxy routes — the one sanctioned exception to Plan 4's
"do not modify any backend" rule (DISPATCH-CONTEXT.md, plan defect #12: the
roadmap binds this proxy to Plan 4, "DataCore blob API (Plan 1 builds; Plans
4-5 proxy)").

Forwards to DataCore's real blob API
(`datacore/src/datacore/api/document_routes.py`): `POST /api/documents/{tenant_id}`
and `GET /api/documents/{tenant_id}/{document_id}/url`.

Security property this module exists to hold: `document.uploaded_by` is a
DataCore-required field DataCore itself cannot verify (`store.put_entity`
does not validate against the model definition). `CreateDocumentRequest`
below has NO `uploaded_by` field, so a client that supplies one in the
request body has it silently dropped by pydantic's default `extra="ignore"`
behaviour — it never reaches `body`, and the outgoing DataCore payload is
built field-by-field from `body` plus a value derived from the authenticated
caller (`user["user_id"]`), so there is no code path through which a
client-supplied value could reach DataCore. Plan 5's parent-download access
control (`uploaded_by == "parent:{application_id}"`) is only an access
control as long as this holds.
"""
import logging

import httpx
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel

from app.config import settings
from app.tenancy import require_staff_tenant

logger = logging.getLogger(__name__)

router = APIRouter()


class CreateDocumentRequest(BaseModel):
    application_id: str
    item_id: str | None = None
    filename: str
    content_type: str
    size: int
    sensitive: bool = False


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
    staff caller (`user["user_id"]`) — never read from the client body,
    which has no such field to read (see module docstring)."""
    resp = _dc_request("POST", f"/api/documents/{tenant_id}", user.get("_token"), {
        "application_id": body.application_id,
        "item_id": body.item_id,
        "filename": body.filename,
        "content_type": body.content_type,
        "size": body.size,
        "sensitive": body.sensitive,
        "uploaded_by": user.get("user_id", "staff"),
    })
    if resp.status_code not in (200, 201):
        # The status code is forwarded (the client needs to distinguish a 404
        # from a 502), but NOT the body: DataCore's error text is an internal
        # detail — it can name storage keys, upstream hosts and model fields —
        # and this is the boundary where that stops. Logged for operators,
        # replaced with a stable message for the caller.
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
        # Same boundary rule as create_document above.
        logger.warning("DataCore document url failed (%s): %s",
                       resp.status_code, resp.text)
        raise HTTPException(resp.status_code, "Document URL request failed")
    return resp.json()
