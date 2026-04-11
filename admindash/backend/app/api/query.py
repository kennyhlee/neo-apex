"""Generic SQL query proxy route — forwards POST /api/query to DataCore."""
import httpx
from fastapi import APIRouter, Depends, HTTPException, Request, Response, status

from app.auth import require_authenticated_user
from app.config import settings

router = APIRouter()


@router.post("/query")
async def query(
    request: Request, user=Depends(require_authenticated_user)
) -> Response:
    """Read raw bytes, forward to DataCore /api/query, return verbatim."""
    body = await request.body()
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
