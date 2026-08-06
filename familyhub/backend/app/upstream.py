# familyhub/backend/app/upstream.py
"""Outbound HTTP to enrollx (internal API) and DataCore (blob API).

Every upstream call in this service goes through call_upstream so tests can
monkeypatch ONE seam: app.upstream.httpx.request.
"""
from typing import Optional

import httpx
from fastapi import HTTPException, status

from app.config import settings


def call_upstream(
    method: str,
    url: str,
    *,
    json_body: Optional[dict] = None,
    content: Optional[bytes] = None,
    headers: Optional[dict] = None,
) -> httpx.Response:
    try:
        return httpx.request(
            method,
            url,
            json=json_body,
            content=content,
            headers=headers or {},
            timeout=30.0,
        )
    except httpx.RequestError:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Upstream service unreachable",
        )


def internal_headers() -> dict:
    """enrollx's internal-key header -- kept ONLY for the one remaining
    enrollx call site (application.py's checkout proxy). Every other route
    module has moved to `apexflow_headers()`/`apexflow()` below (Task 10)."""
    return {"X-Internal-Key": settings.enrollx_internal_key}


def enrollx(path: str) -> str:
    """Kept ONLY for the checkout call site -- see `internal_headers()`."""
    return f"{settings.enrollx_url}{path}"


def apexflow_headers() -> dict:
    return {"X-Internal-Key": settings.apexflow_internal_key}


def apexflow(path: str) -> str:
    return f"{settings.apexflow_url}{path}"


def datacore(path: str) -> str:
    return f"{settings.datacore_url}{path}"
