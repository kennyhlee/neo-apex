"""Entity CRUD proxy routes — forward to DataCore.

`_proxy_to_datacore` uses `httpx.AsyncClient` (awaited), NOT the sync
`httpx.request()` helper it used to call. That sync call was a blocking,
synchronous socket call made directly inside an `async def` route handler
with no `run_in_threadpool` wrapper — it monopolized Uvicorn's single
asyncio event loop for the full DataCore round-trip. Under real browser
load (concurrent XHRs: CORS preflights, the actual request, other tabs'
polling/autosave all arriving close together) every one of those gets
serialized onto that one blocked thread, and the sync call additionally
opens a brand-new unpooled TCP connection to DataCore on every single
invocation — the two together are what apexflow's Plan 2 gate exposed as
an intermittent, instant `httpx.RequestError` that a one-shot curl (no
contention) never triggers. Ported the fix from
apexflow/backend/app/api/entities.py (hardening wave, Task 5) — same
awaited `httpx.AsyncClient` shape.
"""
import httpx
from fastapi import APIRouter, Depends, HTTPException, Request, Response, status

from app.config import settings
from app.tenancy import require_tenant_match

router = APIRouter()


async def _proxy_to_datacore(
    method: str, path: str, request: Request, token: str
) -> Response:
    """Shared helper: read body if applicable, forward, return verbatim."""
    body = await request.body() if method in ("POST", "PUT", "PATCH") else None
    content_type = request.headers.get("content-type", "application/json")
    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.request(
                method,
                f"{settings.datacore_url}{path}",
                content=body,
                headers={
                    "Content-Type": content_type,
                    "Authorization": token,
                },
            )
    except httpx.RequestError:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="DataCore is unreachable",
        )
    return Response(
        content=resp.content,
        status_code=resp.status_code,
        media_type=resp.headers.get("content-type", "application/json"),
    )


@router.post("/entities/{tenant_id}/{entity_type}")
async def create_entity(
    tenant_id: str,
    entity_type: str,
    request: Request,
    user=Depends(require_tenant_match),
) -> Response:
    return await _proxy_to_datacore(
        "POST", f"/api/entities/{tenant_id}/{entity_type}", request, user["_token"]
    )


# Specific routes BEFORE the {entity_id} catch-all to avoid route conflicts
@router.post("/entities/{tenant_id}/{entity_type}/archive")
async def archive_entities(
    tenant_id: str,
    entity_type: str,
    request: Request,
    user=Depends(require_tenant_match),
) -> Response:
    return await _proxy_to_datacore(
        "POST",
        f"/api/entities/{tenant_id}/{entity_type}/archive",
        request,
        user["_token"],
    )


@router.post("/entities/{tenant_id}/{entity_type}/restore")
async def restore_entities(
    tenant_id: str,
    entity_type: str,
    request: Request,
    user=Depends(require_tenant_match),
) -> Response:
    return await _proxy_to_datacore(
        "POST",
        f"/api/entities/{tenant_id}/{entity_type}/restore",
        request,
        user["_token"],
    )


@router.get("/entities/{tenant_id}/{entity_type}/next-id")
async def next_id(
    tenant_id: str,
    entity_type: str,
    request: Request,
    user=Depends(require_tenant_match),
) -> Response:
    return await _proxy_to_datacore(
        "GET",
        f"/api/entities/{tenant_id}/{entity_type}/next-id",
        request,
        user["_token"],
    )


@router.post("/entities/{tenant_id}/{entity_type}/duplicate-check")
async def duplicate_check(
    tenant_id: str,
    entity_type: str,
    request: Request,
    user=Depends(require_tenant_match),
) -> Response:
    return await _proxy_to_datacore(
        "POST",
        f"/api/entities/{tenant_id}/{entity_type}/duplicate-check",
        request,
        user["_token"],
    )


# Generic update route LAST so the specific routes match first
@router.put("/entities/{tenant_id}/{entity_type}/{entity_id}")
async def update_entity(
    tenant_id: str,
    entity_type: str,
    entity_id: str,
    request: Request,
    user=Depends(require_tenant_match),
) -> Response:
    return await _proxy_to_datacore(
        "PUT",
        f"/api/entities/{tenant_id}/{entity_type}/{entity_id}",
        request,
        user["_token"],
    )
