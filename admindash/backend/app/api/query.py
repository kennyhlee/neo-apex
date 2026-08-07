"""Generic SQL query proxy route — forwards POST /api/query to DataCore.

The DataCore call uses an awaited `httpx.AsyncClient`, NOT the sync
`httpx.post()` it used to call directly inside this `async def` handler
with no `run_in_threadpool` wrapper — the same event-loop-blocking defect
fixed in `app/api/entities.py`'s `_proxy_to_datacore` (see that module's
docstring). Under concurrent browser load every such call monopolized
Uvicorn's single asyncio event loop for the full DataCore round-trip AND
opened a brand-new unpooled TCP connection each time, which together
produced apexflow's Plan 2 gate defect: an intermittent, instant
`httpx.RequestError` a one-shot curl never reproduces. Ported the fix from
apexflow/backend/app/api/query.py (hardening wave, Task 5), for
consistency with entities.py's shape.
"""
import httpx
from fastapi import APIRouter, Depends, HTTPException, Request, Response, status

from app.auth import require_authenticated_user
from app.config import settings
from app.tenancy import assert_query_tenant_match, assert_sql_is_safe_read

router = APIRouter()


@router.post("/query")
async def query(
    request: Request, user=Depends(require_authenticated_user)
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
        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.post(
                f"{settings.datacore_url}/api/query",
                content=body,
                headers={
                    "Content-Type": content_type,
                    "Authorization": user["_token"],
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
