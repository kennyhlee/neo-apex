# apexflow/backend/app/api/query.py
"""Generic SQL query proxy route — forwards POST /api/query to DataCore.

Ported from admindash/backend/app/api/query.py (interface map §6b) — same
shape: read raw body AND parse it separately (raw for the forward, parsed
for the tenant-match + SQL-shape checks), then relay DataCore's response
verbatim. `assert_query_tenant_match`/`assert_sql_is_safe_read` come from
this service's own app.tenancy (Task 1 — see that module's docstring for
why /api/query, unlike app/api/entities.py's routes, has no {tenant_id}
path param to check against).

Final-review fix wave: this route used to call the SYNC `httpx.post()`
directly inside this `async def` handler with no `run_in_threadpool`
wrapper — the exact event-loop-blocking bug root-caused and fixed in
`app/api/entities.py`'s `_proxy_to_datacore` (commit `dd1ee6d`; see that
module's docstring and
`.superpowers/sdd/2026-08-06-apexflow-plan2-designer/gate-debug-report.md`
for the full narrative). Under concurrent browser load every such call
monopolizes Uvicorn's single asyncio event loop for the full DataCore
round-trip AND opens a brand-new unpooled TCP connection each time, which
together produced the Plan 2 defect: an intermittent, instant
`httpx.RequestError` a one-shot curl never reproduces. Fixed here with the
same awaited `httpx.AsyncClient` pattern entities.py uses, for consistency.
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
