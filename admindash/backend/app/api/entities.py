"""Entity CRUD proxy routes — forward to DataCore."""
import httpx
from fastapi import APIRouter, Depends, HTTPException, Request, Response, status

from app.auth import require_authenticated_user
from app.config import settings

router = APIRouter()


async def _proxy_to_datacore(
    method: str, path: str, request: Request, token: str
) -> Response:
    """Shared helper: read body if applicable, forward, return verbatim."""
    body = await request.body() if method in ("POST", "PUT", "PATCH") else None
    content_type = request.headers.get("content-type", "application/json")
    try:
        resp = httpx.request(
            method,
            f"{settings.datacore_url}{path}",
            content=body,
            headers={
                "Content-Type": content_type,
                "Authorization": token,
            },
            timeout=30.0,
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
    user=Depends(require_authenticated_user),
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
    user=Depends(require_authenticated_user),
) -> Response:
    return await _proxy_to_datacore(
        "POST",
        f"/api/entities/{tenant_id}/{entity_type}/archive",
        request,
        user["_token"],
    )


@router.get("/entities/{tenant_id}/{entity_type}/next-id")
async def next_id(
    tenant_id: str,
    entity_type: str,
    request: Request,
    user=Depends(require_authenticated_user),
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
    user=Depends(require_authenticated_user),
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
    user=Depends(require_authenticated_user),
) -> Response:
    return await _proxy_to_datacore(
        "PUT",
        f"/api/entities/{tenant_id}/{entity_type}/{entity_id}",
        request,
        user["_token"],
    )
