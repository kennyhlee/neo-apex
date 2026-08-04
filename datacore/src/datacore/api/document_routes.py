"""Document blob API routes — presigned R2 upload/download URLs backed by
`document` entity records.

Mirrors the generic entity-creation conventions in routes.py: sequential IDs
via the DEFAULT_ABBREVS/sequence mechanism, writes go through
`store.put_entity` (the same path the generic entity POST uses), and reads
go through `store.get_active_entity` (the same path `put_tenant` and
`next_entity_id` use). The document's business ID doubles as its entity_id
(the same convention `tenant` uses) so a GET by document_id is a direct
`get_active_entity` lookup rather than a table scan.
"""
from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from datacore.api.routes import DEFAULT_ABBREVS, _max_entity_seq
from datacore.documents import build_storage_key, presign_download, presign_upload
from datacore.store import Store

router = APIRouter(prefix="/api/documents", tags=["documents"])

_store: Store | None = None

ENTITY_TYPE = "document"

ALLOWED_CONTENT_TYPES = {
    "application/pdf",
    "image/jpeg",
    "image/png",
    "image/heic",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
}

MAX_SIZE_BYTES = 20 * 1024 * 1024  # 20 MB


def register_document_routes(app, store: Store) -> None:
    global _store
    _store = store
    app.include_router(router)


class CreateDocumentRequest(BaseModel):
    application_id: str
    item_id: str | None = None
    filename: str
    content_type: str
    size: int
    sensitive: bool = False


def _validate_filename(filename: str) -> None:
    """Reject filenames that could escape the tenant's key prefix.

    The storage key interpolates this value directly
    (`{tenant_id}/{application_id}/{document_id}/{filename}`), so a filename
    containing a path separator or a `..` segment could place the object
    outside the tenant's prefix in the bucket — breaking tenant isolation.
    Reject outright rather than sanitize: silently rewriting a filename could
    still collide or leave the caller confused about what was actually
    stored, and a legitimate filename never needs a path separator.
    """
    if not filename or not filename.strip():
        raise HTTPException(status_code=400, detail="filename is required")
    if "/" in filename or "\\" in filename:
        raise HTTPException(status_code=400, detail="filename must not contain path separators")
    if filename == "." or ".." in filename.split("/"):
        raise HTTPException(status_code=400, detail="filename must not contain '..' segments")


def _next_document_id(tenant_id: str) -> tuple[str, str, str]:
    """Allocate the next sequential document_id. Returns (document_id, year, entity_abbrev)."""
    tenant = _store.get_active_entity(tenant_id, "tenant", tenant_id)
    if tenant is None:
        raise HTTPException(status_code=400, detail="Tenant not set up")

    abbrev = tenant["base_data"].get("_abbrev", tenant_id[:3].upper())
    year = str(datetime.now(timezone.utc).year)
    yy = year[-2:]
    seq_record = _store.get_sequence(tenant_id, ENTITY_TYPE, year)
    entity_abbrev = seq_record["entity_abbrev"] or DEFAULT_ABBREVS.get(ENTITY_TYPE, "DC")
    prefix = f"{abbrev}-{entity_abbrev}{yy}"
    counter_seq = seq_record["counter"]
    data_seq = _max_entity_seq(_store, tenant_id, ENTITY_TYPE, prefix)
    next_seq = max(counter_seq, data_seq) + 1
    document_id = f"{prefix}{next_seq:04d}"
    return document_id, year, entity_abbrev


@router.post("/{tenant_id}")
def create_document(tenant_id: str, body: CreateDocumentRequest):
    """Register a document and return a presigned upload URL for its bytes."""
    if body.content_type not in ALLOWED_CONTENT_TYPES:
        raise HTTPException(status_code=400, detail=f"Unsupported content type: {body.content_type}")
    if body.size > MAX_SIZE_BYTES:
        raise HTTPException(status_code=413, detail="File exceeds the 20 MB limit")
    _validate_filename(body.filename)

    document_id, year, entity_abbrev = _next_document_id(tenant_id)
    storage_key = build_storage_key(tenant_id, body.application_id, document_id, body.filename)

    base_data = {
        "document_id": document_id,
        "application_id": body.application_id,
        "item_id": body.item_id,
        "filename": body.filename,
        "content_type": body.content_type,
        "size": body.size,
        "storage_key": storage_key,
        "sensitive": body.sensitive,
        "uploaded_at": datetime.now(timezone.utc).isoformat(),
    }

    try:
        _store.put_entity(
            tenant_id=tenant_id,
            entity_type=ENTITY_TYPE,
            entity_id=document_id,
            base_data=base_data,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    # Keep the sequence counter in sync with the ID we just assigned, same as
    # the generic create_entity handler in routes.py.
    current = _store.get_sequence(tenant_id, ENTITY_TYPE, year)["counter"]
    seq = int(document_id[-4:])
    while current < seq:
        _store.increment_sequence(tenant_id, ENTITY_TYPE, year, entity_abbrev=entity_abbrev)
        current += 1

    upload_url = presign_upload(storage_key, body.content_type)

    return JSONResponse(
        status_code=201,
        content={
            "document_id": document_id,
            "upload_url": upload_url,
            "storage_key": storage_key,
        },
    )


@router.get("/{tenant_id}/{document_id}/url")
def get_document_url(tenant_id: str, document_id: str):
    """Return a presigned download URL for an existing document."""
    entity = _store.get_active_entity(tenant_id, ENTITY_TYPE, document_id)
    if entity is None:
        raise HTTPException(status_code=404, detail="Document not found")

    storage_key = entity["base_data"]["storage_key"]
    return {"download_url": presign_download(storage_key)}
