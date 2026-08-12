"""Thin staff proxies to apexflow-backend (papermite-proxy pattern, extract.py:63-79).

Plain `def` routes: FastAPI threadpools them, so sync httpx cannot block the
event loop (the open item-15 debt in entities.py must not grow). The three
body-forwarding routes (create_instance, instance_action, create_document)
are `async def` ONLY to read the raw request body; the actual upstream call
is offloaded via `starlette.concurrency.run_in_threadpool` so no sync httpx
call runs inline inside an `async def`.
"""
import httpx
from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from starlette.concurrency import run_in_threadpool

from app.config import settings
from app.tenancy import require_tenant_match

router = APIRouter()


def _relay(method: str, path: str, token: str, json_body: dict | None = None) -> Response:
    try:
        resp = httpx.request(
            method,
            f"{settings.apexflow_backend_url}{path}",
            json=json_body,
            headers={"Authorization": token},
            timeout=30.0,
        )
    except httpx.RequestError:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, detail="ApexFlow is unreachable")
    return Response(
        content=resp.content,
        status_code=resp.status_code,
        media_type=resp.headers.get("content-type", "application/json"),
    )


def _relay_bytes(method: str, path: str, token: str, content: bytes, content_type: str) -> Response:
    """Sync sibling of `_relay` for the body-forwarding routes: forwards raw
    bytes + Content-Type verbatim instead of re-encoding a dict as JSON."""
    try:
        resp = httpx.request(
            method,
            f"{settings.apexflow_backend_url}{path}",
            content=content,
            headers={"Authorization": token, "Content-Type": content_type},
            timeout=30.0,
        )
    except httpx.RequestError:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, detail="ApexFlow is unreachable")
    return Response(
        content=resp.content,
        status_code=resp.status_code,
        media_type=resp.headers.get("content-type", "application/json"),
    )


@router.get("/workflows/{tenant_id}/definitions")
def list_definitions(tenant_id: str, user=Depends(require_tenant_match)) -> Response:
    return _relay("GET", f"/api/workflows/{tenant_id}/definitions", user["_token"])


@router.get("/workflows/{tenant_id}/definitions/{entity_id}/bundle")
def definition_bundle(tenant_id: str, entity_id: str, user=Depends(require_tenant_match)) -> Response:
    return _relay(
        "GET", f"/api/workflows/{tenant_id}/definitions/{entity_id}/bundle", user["_token"]
    )


@router.post("/workflows/{tenant_id}/definitions/{definition_id}/instances")
async def create_instance(
    tenant_id: str, definition_id: str, request: Request, user=Depends(require_tenant_match)
) -> Response:
    # async ONLY to read the body; the forward itself is offloaded via a
    # thread. Body relayed verbatim (channel/context/email).
    content = await request.body()
    content_type = request.headers.get("content-type", "application/json")
    return await run_in_threadpool(
        _relay_bytes,
        "POST",
        f"/api/workflows/{tenant_id}/definitions/{definition_id}/instances",
        user["_token"],
        content,
        content_type,
    )


@router.get("/workflows/{tenant_id}/instances/{instance_entity_id}/allowed-actions")
def allowed_actions(
    tenant_id: str, instance_entity_id: str, user=Depends(require_tenant_match)
) -> Response:
    return _relay(
        "GET",
        f"/api/workflows/{tenant_id}/instances/{instance_entity_id}/allowed-actions",
        user["_token"],
    )




# NOTE: there is deliberately no `POST /definitions/{entity_id}/actions` proxy.
# Workflow lifecycle — publish/deprecate/archive/unarchive/delete — belongs to
# the ApexFlow designer, not to AdminDash, which exists to manage the WORK ITEMS
# flowing through workflows that already exist. Hiding the buttons would not have
# been enough: this route relayed every action verbatim, so a caller holding an
# AdminDash token could still have deleted a workflow through it.


@router.get("/workflows/{tenant_id}/definitions/{definition_id}/instances")
def lineage_instances(
    tenant_id: str, definition_id: str, user=Depends(require_tenant_match)
) -> Response:
    """Every work item of one lineage, open and closed — backs the work-item
    management table."""
    return _relay(
        "GET",
        f"/api/workflows/{tenant_id}/definitions/{definition_id}/instances",
        user["_token"],
    )


@router.post("/workflows/{tenant_id}/instances/{instance_entity_id}/actions")
async def instance_action(
    tenant_id: str, instance_entity_id: str, request: Request, user=Depends(require_tenant_match)
) -> Response:
    content = await request.body()
    content_type = request.headers.get("content-type", "application/json")
    return await run_in_threadpool(
        _relay_bytes,
        "POST",
        f"/api/workflows/{tenant_id}/instances/{instance_entity_id}/actions",
        user["_token"],
        content,
        content_type,
    )


@router.post("/workflows/{tenant_id}/documents")
async def create_document(
    tenant_id: str, request: Request, user=Depends(require_tenant_match)
) -> Response:
    # → apexflow POST /api/documents/{tenant_id}  (201 relayed via the returned
    # Response's own status_code — no decorator status override)
    content = await request.body()
    content_type = request.headers.get("content-type", "application/json")
    return await run_in_threadpool(
        _relay_bytes,
        "POST",
        f"/api/documents/{tenant_id}",
        user["_token"],
        content,
        content_type,
    )


@router.get("/workflows/{tenant_id}/documents/{document_id}/url")
def document_url(tenant_id: str, document_id: str, user=Depends(require_tenant_match)) -> Response:
    return _relay("GET", f"/api/documents/{tenant_id}/{document_id}/url", user["_token"])
