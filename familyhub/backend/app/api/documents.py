# familyhub/backend/app/api/documents.py
"""Token-scoped document facade (spec §8: familyhub presigns for parents).

WHY THIS MODULE IS THE ENTIRE ENFORCEMENT POINT
-----------------------------------------------
DataCore's blob API has NO authorization of any kind: there is no `Depends`
import anywhere in `datacore/src/datacore/api/document_routes.py`, and
neither `create_document` (line 100-101) nor `get_document_url` (line
161-162) takes an auth parameter. Anything that can reach DataCore on the
private network can create a document attributed to anyone, or fetch a
download URL for any document in any tenant. Nothing downstream of this
module re-checks either property.

Authorization order, identical on both routes -- no upstream write or
presign call is made until every check has passed:

1. Cheap local validation (content type / size) -- never touches the network.
2. enrollx validates the magic-link token via
   `GET /internal/application-by-token/{token}`. That is the ONLY signature
   check: enrollx's `resolve_token` verifies against the row's STORED
   `token_version` (internal.py:50-62), which is the revocation mechanism.
   familyhub holds no `link_secret` and must never attempt to verify.
3. The scope is taken from enrollx's answer -- `application.entity_id` --
   and cross-checked against the token's own middle segment. `parse_token`
   is decode-only, so it is a convenience for reading the tenant, not a
   credential; the tripwire makes a disagreement fail closed rather than
   attributing an upload to the wrong family.
4. Facade authorization: item kind/ownership on upload, `uploaded_by`
   ownership on download.
5. Only then is DataCore's blob API called.

THE `uploaded_by` PROPERTY
--------------------------
`uploaded_by` is DERIVED (`f"parent:{application entity_id}"`), never
accepted. `CreateDocumentBody` below declares no `uploaded_by`,
`application_id`, `sensitive` or `storage_key` field, so pydantic's
`extra="ignore"` drops a client-supplied one before the handler ever sees
the body -- the same technique (and the same test standard: assert the
SERIALIZED OUTBOUND BODY) as enrollx's staff proxy,
`enrollx/backend/app/api/documents.py:36-43,59-73` /
`test_create_document_ignores_client_supplied_uploaded_by`. The outbound
payload is then built field by field, so there is no dict-merge path by
which an unexpected key could ride along.

The two `uploaded_by` forms are ASYMMETRIC. Parent uploads are
`parent:{application entity_id}` (internal.py:149-150). Staff uploads are
the BARE DataCore `user_id`, falling back to the literal `"staff"`
(enrollx documents.py:72) -- there is NO `staff:` prefix. So the download
rule is exact equality against this token's own tag, never a prefix test
and never "anything unprefixed is safe".
"""
import json as jsonlib
import re
from typing import Optional

from fastapi import APIRouter, HTTPException, Response, status
from pydantic import BaseModel, ConfigDict

from app.relay import relay as _relay
from app.relay import upstream_unavailable
from app.tokenutil import parse_token
from app.upstream import call_upstream, datacore, enrollx, internal_headers

router = APIRouter()

# ADJUST(bindings) checked: DataCore's own allow-list, verbatim --
# datacore/src/datacore/api/document_routes.py:28-36. Rejecting here as well
# keeps a junk upload off the network entirely; DataCore still rejects
# independently (400). Roadmap-contract default was already correct; no
# change made.
ALLOWED_CONTENT_TYPES = {
    "application/pdf",
    "image/jpeg",
    "image/png",
    "image/heic",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
}
MAX_SIZE_BYTES = 20 * 1024 * 1024  # DataCore: document_routes.py:36

# Mirrors enrollx's `_ID_RE` (registration/datacore.py:32), the regex every
# id-shaped value must satisfy before it is placed in a URL path. Applied
# here to the two values this module interpolates into DataCore URLs
# (tenant_id, document_id) so path-injection is impossible LOCALLY rather
# than only because some upstream happened to validate first.
_ID_RE = re.compile(r"[A-Za-z0-9_-]+")


def _id_safe(value: str) -> bool:
    return bool(value) and bool(_ID_RE.fullmatch(value))


def _data(entity) -> dict:
    """Read an entity's fields.

    enrollx's internal routes return FLATTENED DataCore rows (bindings §2:
    internal.py:123-130), not `{entity_id, entity_type, base_data}`
    envelopes -- but `base_data` is unwrapped when present so this module
    keeps working if a caller ever hands it the envelope shape.
    """
    if not isinstance(entity, dict):
        return {}
    inner = entity.get("base_data")
    return inner if isinstance(inner, dict) else entity


def _fetch_bundle(token: str):
    """(bundle, None) on success; (None, error_response) otherwise.

    The GET doubles as the token check: enrollx answers 401 for a malformed,
    forged or revoked token. 4xx is relayed verbatim (a parent whose link
    expired deserves the real answer); >=500 is masked by `relay`.
    """
    resp = call_upstream(
        "GET",
        # ADJUST(bindings) checked: bindings §3 confirms this exact path and
        # its `{application, items, config}` response -- internal.py:123-130.
        # Roadmap-contract default was already correct; no change made.
        enrollx(f"/internal/application-by-token/{token}"),
        headers=internal_headers(),
    )
    if resp.status_code >= 400:
        return None, _relay(resp)
    try:
        bundle = resp.json()
    except ValueError:
        return None, upstream_unavailable()
    if not isinstance(bundle, dict):
        return None, upstream_unavailable()
    return bundle, None


def _scope(token: str, bundle: dict):
    """(tenant_id, application_entity_id, None) or (None, None, error).

    The application entity_id comes from enrollx's own resolution of the
    token -- the authoritative answer -- and must agree with the token's
    middle segment (which enrollx signed over: tokens.py:31-37,54-57). A
    disagreement can only mean a contract change or a bug, and silently
    preferring either value would mis-attribute an upload, so fail closed.
    """
    tenant_id, token_application_id = parse_token(token)
    app_raw = bundle.get("application")
    app_raw = app_raw if isinstance(app_raw, dict) else {}
    app_row = _data(app_raw)
    entity_id = str(app_row.get("entity_id") or app_raw.get("entity_id") or "")
    if not entity_id or entity_id != token_application_id:
        return None, None, upstream_unavailable()
    if not _id_safe(tenant_id) or not _id_safe(entity_id):
        return None, None, upstream_unavailable()
    return tenant_id, entity_id, None


def _find_item(bundle: dict, item_id: str):
    """Resolve `item_id` against THIS application's items, or None.

    The identifier convention (bindings §5): the wire key is `item_id` but
    the value hosts send is the row's `entity_id` -- enrollx-frontend does
    exactly this for its own uploads (ApplicationEntryPage.tsx:161 and
    283-296), and it is the value stored on staff-uploaded documents, so
    matching on the business `item_id` field alone would 400 every real
    upload. The business id is accepted as a fallback, but the resolved
    entity_id is always what gets forwarded, so a document's `item_id`
    always means the same thing regardless of which the caller sent.
    """
    items = bundle.get("items")
    if not isinstance(items, list):
        return None
    for raw in items:
        data = _data(raw)
        candidate = raw.get("entity_id") if isinstance(raw, dict) else None
        if candidate == item_id or data.get("entity_id") == item_id:
            return data, str(candidate or data.get("entity_id") or "")
    for raw in items:
        data = _data(raw)
        if data.get("item_id") == item_id:
            entity_id = raw.get("entity_id") if isinstance(raw, dict) else None
            return data, str(entity_id or "")
    return None


def _blocks_of(config) -> list:
    """`registration_config.blocks` is a JSON STRING on the flattened row
    (engine.py:299 json.loads it; ApplicationEntryPage.tsx:106-108 does the
    same on the frontend). Accept a real list too."""
    blocks = _data(config).get("blocks")
    if isinstance(blocks, str):
        try:
            blocks = jsonlib.loads(blocks)
        except (ValueError, TypeError):
            return []
    return blocks if isinstance(blocks, list) else []


def _sensitive_for(config, item_data: dict) -> bool:
    """Sensitivity of the doc definition this item was derived from.

    Items are derived one-per-doc with `title = doc["name"]` inside the
    matching `documents` block (`registration/items.py:52-59`), so
    (block_id, title) identifies the definition.

    Fails CLOSED (True) when the item is a document item whose definition
    can't be found -- e.g. a doc renamed in the config after the items were
    derived. A wrongly-`sensitive` document is still always visible to the
    parent who uploaded it (enrollx's listing shows own uploads regardless
    of sensitivity, internal.py:153-154), so the strict default costs
    nothing, whereas a wrongly-non-sensitive one permanently widens who may
    see a family's medical or financial paperwork.
    """
    for block in _blocks_of(config):
        if not isinstance(block, dict) or block.get("block_id") != item_data.get("block_id"):
            continue
        docs = (block.get("config") or {}).get("docs")
        for doc in docs if isinstance(docs, list) else []:
            if isinstance(doc, dict) and doc.get("name") == item_data.get("title"):
                return bool(doc.get("sensitive", False))
    return True


class CreateDocumentBody(BaseModel):
    # SECURITY: no `uploaded_by`, `application_id`, `sensitive` or
    # `storage_key` field here, deliberately. `extra="ignore"` (pydantic's
    # default, stated explicitly so a later edit can't flip it invisibly)
    # drops any such key before the handler runs, and every one of those
    # values is derived server-side below. Do not add them.
    model_config = ConfigDict(extra="ignore")

    item_id: Optional[str] = None
    filename: str
    content_type: str
    size: int


@router.post("/application/{token}/documents")
def create_document(token: str, body: CreateDocumentBody) -> Response:
    """Presign an upload slot for this token's application."""
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

    bundle, error = _fetch_bundle(token)
    if error is not None:
        return error
    tenant_id, application_entity_id, error = _scope(token, bundle)
    if error is not None:
        return error

    item_entity_id = None
    sensitive = False
    if body.item_id is not None:
        found = _find_item(bundle, body.item_id)
        if found is None or found[0].get("kind") != "document":
            # Covers an unknown item, an item belonging to another
            # application, and an item of the wrong kind. The bundle is the
            # only source of truth for which items are this parent's.
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST,
                detail="item_id does not name a document item of this application",
            )
        item_data, item_entity_id = found
        sensitive = _sensitive_for(bundle.get("config"), item_data)

    resp = call_upstream(
        "POST",
        # ADJUST(bindings) checked: bindings §3 confirms this exact path,
        # its required `uploaded_by` field and its 201
        # `{document_id, upload_url, storage_key}` response, with NO auth
        # dependency (document_routes.py:100-101,45-59,151-157). The
        # roadmap-contract default was already correct; no change made.
        datacore(f"/api/documents/{tenant_id}"),
        json_body={
            # `application_id` on a document holds the application's
            # ENTITY_ID: enrollx's listing filters on exactly that
            # (internal.py:151-152), so anything else would make the
            # document invisible to its own uploader.
            "application_id": application_entity_id,
            "item_id": item_entity_id,
            "filename": body.filename,
            "content_type": body.content_type,
            "size": body.size,
            "sensitive": sensitive,
            # DERIVED, never client-supplied: `application_entity_id` came
            # from enrollx's resolution of a token whose signature covers
            # it, so this tag is exactly as trustworthy as the token. It is
            # also the sole basis of the download rule below -- if this
            # value could be steered, that rule would be decorative.
            "uploaded_by": f"parent:{application_entity_id}",
        },
    )
    return _relay(resp)


@router.get("/application/{token}/documents/{document_id}/url")
def get_document_url(token: str, document_id: str) -> Response:
    """Presign a download URL -- own uploads only.

    `document_id == entity_id` for documents (document_routes.py:131-137),
    so the id a client sends is a GLOBAL handle: it can name any document
    in any tenant, and DataCore will presign any of them without asking who
    is calling. Two things stop that here, both local to this handler:

    * The id must appear in `GET /internal/application-by-token/{token}/documents`,
      which enrollx scopes to this token's application. Another family's or
      another tenant's document is simply not in that list -> 404, before
      any DataCore call.
    * The listed row's `uploaded_by` must equal this application's own
      parent tag exactly -> 403 otherwise. Asking enrollx rather than
      re-deriving the visibility rule locally keeps the two services from
      drifting apart.

    Only an id echoed back BY enrollx is ever interpolated into DataCore's
    URL, and the tenant comes from the signed token, so no crafted path
    segment can reach DataCore even if both checks were somehow satisfied.
    """
    bundle, error = _fetch_bundle(token)
    if error is not None:
        return error
    tenant_id, application_entity_id, error = _scope(token, bundle)
    if error is not None:
        return error

    resp = call_upstream(
        "GET",
        # ADJUST(bindings) checked: bindings §3/§8 confirm this exact path
        # and its `{documents: [{entity_id, document_id, filename,
        # uploaded_by, item_id}]}` response (internal.py:144-161).
        # Roadmap-contract default was already correct; no change made.
        enrollx(f"/internal/application-by-token/{token}/documents"),
        headers=internal_headers(),
    )
    if resp.status_code >= 400:
        return _relay(resp)
    try:
        listing = resp.json()
    except ValueError:
        return upstream_unavailable()
    documents = listing.get("documents") if isinstance(listing, dict) else None
    if not isinstance(documents, list):
        return upstream_unavailable()

    match = None
    for raw in documents:
        data = _data(raw)
        ids = {data.get("document_id"), data.get("entity_id")}
        if isinstance(raw, dict):
            ids.add(raw.get("entity_id"))
        if document_id in ids:
            match = data
            break
    if match is None:
        raise HTTPException(
            status.HTTP_404_NOT_FOUND, detail="No such document on this application")

    # Exact equality, never a "parent:" prefix test: a tag naming a
    # different application must not pass, and staff tags carry no prefix
    # of their own to key off.
    if match.get("uploaded_by") != f"parent:{application_entity_id}":
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            detail="Parents may only view documents they uploaded themselves",
        )

    resolved_id = str(match.get("document_id") or match.get("entity_id") or "")
    if not _id_safe(resolved_id):
        return upstream_unavailable()

    dresp = call_upstream(
        "GET",
        # ADJUST(bindings) checked: bindings §3 confirms this exact path and
        # its `{download_url}` response, with NO auth dependency
        # (document_routes.py:161-169). No X-Internal-Key here -- that
        # secret belongs to the enrollx hop only. Roadmap-contract default
        # was already correct; no change made.
        datacore(f"/api/documents/{tenant_id}/{resolved_id}/url"),
    )
    return _relay(dresp)
