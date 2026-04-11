"""Document extract proxy with multipart streaming.

This is the only async-streaming endpoint in admindash-backend. The body must
be streamed (not buffered) so large file uploads do not consume memory and the
multipart boundary is preserved byte-identically when forwarded to Papermite.
"""
import httpx
from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.responses import StreamingResponse

from app.auth import require_authenticated_user
from app.config import settings

router = APIRouter()


@router.post("/extract/{tenant_id}/student")
async def extract_student(
    tenant_id: str,
    request: Request,
    user=Depends(require_authenticated_user),
) -> StreamingResponse:
    """Stream a multipart file upload through to Papermite."""
    headers = {
        "Content-Type": request.headers["content-type"],
        "Authorization": user["_token"],
    }
    if "content-length" in request.headers:
        headers["Content-Length"] = request.headers["content-length"]

    client = httpx.AsyncClient(timeout=120.0)
    try:
        upstream_req = client.build_request(
            "POST",
            f"{settings.papermite_backend_url}/api/extract/{tenant_id}/student",
            content=request.stream(),
            headers=headers,
        )
        upstream_resp = await client.send(upstream_req, stream=True)
    except httpx.RequestError:
        await client.aclose()
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Papermite is unreachable",
        )

    async def iter_response():
        try:
            async for chunk in upstream_resp.aiter_raw():
                yield chunk
        finally:
            await upstream_resp.aclose()
            await client.aclose()

    return StreamingResponse(
        iter_response(),
        status_code=upstream_resp.status_code,
        media_type=upstream_resp.headers.get("content-type"),
    )
