# familyhub/backend/app/upstream.py
"""Outbound HTTP to apexflow (internal API) and DataCore (blob API).

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


def apexflow_headers() -> dict:
    return {"X-Internal-Key": settings.apexflow_internal_key}


def apexflow(path: str) -> str:
    return f"{settings.apexflow_url}{path}"


def datacore(path: str) -> str:
    return f"{settings.datacore_url}{path}"
