# apexflow/backend/app/api/auth_proxy.py
"""Auth proxy routes — forward /auth/login and /auth/me to DataCore.

Ported verbatim from admindash/backend/app/api/auth.py (interface map §1a/
§2g's own note that no login proxy previously existed here — this file
closes that gap). This is the ONLY router in this service that requires no
auth dependency of its own: `login` has nothing to authenticate yet (it's
what MINTS the token), and `me` simply relays whatever bearer token the
caller sent, exactly as `app.auth.require_authenticated_user` does when
validating a token for every OTHER route in this service — the difference
is this route hands the raw DataCore response back to the browser instead of
parsing it into a `dict` for a FastAPI dependency to return.

Coordinator-noted gap (Task 4 follow-up): apexflow-frontend's AuthContext
was scaffolded to call `${APEXFLOW_API_URL}/auth/login` /
`${APEXFLOW_API_URL}/auth/me`, matching admindash's own frontend pattern —
but apexflow-backend never had this proxy, so login 404d. This file is that
missing proxy.
"""
import httpx
from fastapi import APIRouter, HTTPException, Request, Response, status

from app.config import settings

router = APIRouter()


@router.post("/login")
def login(request_body: dict, request: Request) -> Response:
    """Forward POST /auth/login to DataCore unchanged.

    Note: we accept the body as a parsed dict (FastAPI handles the JSON parse)
    and re-serialize it. This is fine because the login body is small JSON.
    For larger or non-JSON bodies use the byte-passthrough pattern from
    api/query.py.
    """
    try:
        resp = httpx.post(
            f"{settings.datacore_url}/auth/login",
            json=request_body,
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


@router.get("/me")
def me(request: Request) -> Response:
    """Forward GET /auth/me to DataCore with the caller's bearer token."""
    auth_header = request.headers.get("authorization")
    if not auth_header:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing Authorization header",
        )

    try:
        resp = httpx.get(
            f"{settings.datacore_url}/auth/me",
            headers={"Authorization": auth_header},
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
