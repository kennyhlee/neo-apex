# familyhub/backend/app/api/documents.py
"""Token-scoped document facade.

Task 10 retarget: this module used to call DataCore's blob API directly,
doing its OWN token validation (`GET /internal/application-by-token/{token}`
against enrollx), item resolution, and sensitivity derivation from
`registration_config.blocks` before ever reaching DataCore. apexflow's Task
10 adds token-scoped document proxy routes of its own
(`/internal/instance-by-token/{token}/documents`) that now own ALL of that:
token verification, `uploaded_by` derivation
(`family:{instance_entity_id}`), and the sensitive/ownership visibility rule
on download (apexflow/backend/app/api/internal.py). This module is now a
THIN proxy: local, network-free validation (content type, size, rate limit,
token shape) plus a straight pass-through to apexflow.

Local validation still happens here (not just at apexflow) so a junk upload
never spends a round trip at all -- same "cheap checks before any network
call" ordering the previous version used. `parse_token` is decode-only (see
`app/tokenutil.py`) -- it is NOT a credential check, just a cheap shape
filter so a garbage token 400s before any upstream call.

Task 6 (Plan 3): route prefix renamed `/application/{token}/documents...` ->
`/instance/{token}/documents...`, matching `api/instance.py`'s rename.
`sensitive` is no longer accepted from the client at all -- apexflow now
DERIVES it server-side from the pinned definition's `docs[].sensitive`
metadata (Plan 3 Task 4's `_derived_sensitive`), so there is no longer a
documented gap here to carry forward.
"""
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Response, status
from pydantic import BaseModel, ConfigDict

from app.ratelimit import limit_document_presign
from app.relay import relay as _relay
from app.tokenutil import parse_token
from app.upstream import apexflow, apexflow_headers, call_upstream

router = APIRouter()

ALLOWED_CONTENT_TYPES = {
    "application/pdf",
    "image/jpeg",
    "image/png",
    "image/heic",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
}
MAX_SIZE_BYTES = 20 * 1024 * 1024  # apexflow/DataCore: same limit, advisory only


class CreateDocumentBody(BaseModel):
    # SECURITY: no `uploaded_by` field here, deliberately. `extra="ignore"`
    # (pydantic's default, stated explicitly) drops any such key before the
    # handler runs -- apexflow's own token-scoped create route derives
    # `uploaded_by` server-side regardless, so this is defense in depth, not
    # the only thing standing between a client and a spoofed value.
    model_config = ConfigDict(extra="ignore")

    item_id: Optional[str] = None
    filename: str
    content_type: str
    size: int


@router.post("/instance/{token}/documents",
             dependencies=[Depends(limit_document_presign)])
def create_document(token: str, body: CreateDocumentBody) -> Response:
    """Presign an upload slot for this token's instance.

    Rate limited per IP: this is the platform's only token-scoped route that
    WRITES, and DataCore's size check is advisory (see ratelimit.py).
    """
    if body.content_type not in ALLOWED_CONTENT_TYPES:
        raise HTTPException(
            status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
            detail="Accepted types: pdf, jpeg, png, heic, docx",
        )
    if body.size <= 0:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="File is empty")
    if body.size > MAX_SIZE_BYTES:
        raise HTTPException(
            status.HTTP_413_CONTENT_TOO_LARGE,
            detail="File must be 20 MB or smaller",
        )
    # Shape-check the token before spending an upstream call on it.
    parse_token(token)

    resp = call_upstream(
        "POST",
        apexflow(f"/internal/instance-by-token/{token}/documents"),
        json_body={
            "item_id": body.item_id,
            "filename": body.filename,
            "content_type": body.content_type,
            "size": body.size,
        },
        headers=apexflow_headers(),
    )
    return _relay(resp)


@router.get("/instance/{token}/documents")
def list_documents(token: str) -> Response:
    """Token-scoped list of this instance's visible documents.

    Pure relay: apexflow's internal route already scopes to the instance
    and hides other uploaders' sensitive documents."""
    parse_token(token)
    resp = call_upstream(
        "GET",
        apexflow(f"/internal/instance-by-token/{token}/documents"),
        headers=apexflow_headers(),
    )
    return _relay(resp)


@router.get("/instance/{token}/documents/{document_id}/url")
def get_document_url(token: str, document_id: str) -> Response:
    """Presign a download URL -- own uploads (or non-sensitive documents of
    this instance) only. Ownership/sensitivity enforcement now lives
    entirely in apexflow's internal.py (module docstring)."""
    parse_token(token)
    resp = call_upstream(
        "GET",
        apexflow(f"/internal/instance-by-token/{token}/documents/{document_id}/url"),
        headers=apexflow_headers(),
    )
    return _relay(resp)
