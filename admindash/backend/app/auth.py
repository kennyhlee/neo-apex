"""JWT validation dependency for admindash backend.

Delegates token validation to DataCore's /auth/me endpoint. Admindash-backend
never sees the JWT signing secret — DataCore is the single source of truth.
"""
import httpx
from fastapi import HTTPException, Request, status

from app.config import settings


def require_authenticated_user(request: Request) -> dict:
    """Validate the bearer token by calling DataCore /auth/me.

    Returns the parsed user dict from DataCore on success. The original
    Authorization header is attached as `_token` so route handlers can forward
    it to downstream calls.

    Raises HTTPException 401 on missing/malformed header or non-2xx from DataCore.
    Raises HTTPException 502 if DataCore is unreachable.
    """
    auth_header = request.headers.get("authorization")
    if not auth_header or not auth_header.lower().startswith("bearer "):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing or malformed Authorization header",
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

    if resp.status_code != 200:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired token",
        )

    try:
        user = resp.json()
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="DataCore returned an invalid response",
        )

    user["_token"] = auth_header
    return user
