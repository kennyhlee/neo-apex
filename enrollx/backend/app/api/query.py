"""Generic SQL query proxy route — forwards POST /api/query to DataCore."""
import httpx
from fastapi import APIRouter, Depends, HTTPException, Request, Response, status

from app.config import settings
from app.tenancy import assert_query_tenant_match, assert_sql_is_safe_read, require_staff

router = APIRouter()


@router.post("/query")
async def query(
    request: Request, user=Depends(require_staff)
) -> Response:
    """Read raw bytes, forward to DataCore /api/query, return verbatim."""
    body = await request.body()
    try:
        payload = await request.json()
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Request body must be valid JSON",
        )
    if not isinstance(payload, dict):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Request body must be a JSON object",
        )
    assert_query_tenant_match(payload.get("tenant_id"), user)
    assert_sql_is_safe_read(payload.get("sql", ""))
    content_type = request.headers.get("content-type", "application/json")
    try:
        resp = httpx.post(
            f"{settings.datacore_url}/api/query",
            content=body,
            headers={
                "Content-Type": content_type,
                "Authorization": user["_token"],
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
