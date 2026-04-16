# Admindash Backend API Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `admindash/backend/`, a thin FastAPI proxy service on port 5610 that sits between the admindash React SPA and DataCore/Papermite, validates JWTs against DataCore, and runs end-to-end locally via `start-services.sh`.

**Architecture:** Mirror the `launchpad/backend/` and `papermite/backend/` shape exactly: `pyproject.toml` at the service root (`admindash/`), FastAPI app at `admindash/backend/app/`, routes under `app/api/`. Sync route handlers calling `httpx` directly for the JSON proxies (matching launchpad's pattern). One async handler for the multipart upload to Papermite (forced because `request.stream()` is async). Auth validated by delegating every protected request to DataCore's `/auth/me` — admindash-backend never sees the JWT signing secret.

**Tech Stack:** Python 3.11+, FastAPI, Uvicorn, httpx, pydantic-settings, pytest + respx for tests, `uv` for dependency management.

---

## File Structure

**Files to CREATE:**

| Path | Responsibility |
|---|---|
| `admindash/pyproject.toml` | Python project root for `admindash-backend` package. Mirrors `launchpad/pyproject.toml`. |
| `admindash/backend/app/__init__.py` | Empty package marker |
| `admindash/backend/app/main.py` | FastAPI app construction, CORS middleware, router mounting, lifespan |
| `admindash/backend/app/config.py` | `pydantic-settings` `Settings` class with fail-closed CORS in production |
| `admindash/backend/app/auth.py` | `require_authenticated_user` dependency that validates JWT via DataCore |
| `admindash/backend/app/api/__init__.py` | Empty package marker |
| `admindash/backend/app/api/health.py` | `GET /api/health` |
| `admindash/backend/app/api/auth.py` | `POST /auth/login`, `GET /auth/me` proxies |
| `admindash/backend/app/api/query.py` | `POST /api/query` proxy |
| `admindash/backend/app/api/entities.py` | 5 entity CRUD proxies |
| `admindash/backend/app/api/extract.py` | `POST /api/extract/{tenant_id}/student` (multipart streaming, async) |
| `admindash/backend/tests/__init__.py` | Empty package marker |
| `admindash/backend/tests/conftest.py` | Pytest fixtures (TestClient) |
| `admindash/backend/tests/test_health.py` | Health endpoint test |
| `admindash/backend/tests/test_auth.py` | Auth proxy tests with mocked DataCore |
| `admindash/backend/tests/test_query.py` | Query proxy tests |
| `admindash/backend/tests/test_entities.py` | Entity CRUD proxy tests |
| `admindash/backend/tests/test_extract.py` | Multipart streaming proxy test |
| `admindash/backend/tests/test_cors.py` | CORS fail-closed production tests |
| `admindash/backend/README.md` | Brief usage doc |

**Files to MODIFY:**

| Path | Change |
|---|---|
| `services.json` | Add `"admindash-backend": { "host": "localhost", "port": 5610 }` |
| `start-services.sh` | Add admindash-backend to the SERVICES array, port read, and start case |
| `admindash/frontend/src/config.ts` | Replace 3 URL constants with single `ADMINDASH_API_URL` |
| `admindash/frontend/src/api/client.ts` | Change every fetch base from `DATACORE_URL` / `PAPERMITE_BACKEND_URL` to `ADMINDASH_API_URL` |
| `admindash/frontend/src/contexts/AuthContext.tsx` | Change `DATACORE_AUTH_URL` to `ADMINDASH_API_URL`, paths become `/auth/login` and `/auth/me` |
| `admindash/frontend/src/pages/StudentsPage.tsx` | Change error message reference from `DATACORE_URL` to `ADMINDASH_API_URL` |
| `admindash/CLAUDE.md` | Refresh stale port references; add Backend section; reframe overview as school operations product |
| `CLAUDE.md` (top-level) | Update admindash bullet to mention new backend; add admindash backend dev commands |

---

## Task 1: Project scaffolding

**Files:**
- Create: `admindash/pyproject.toml`
- Create: `admindash/backend/app/__init__.py`
- Create: `admindash/backend/app/api/__init__.py`
- Create: `admindash/backend/tests/__init__.py`

- [ ] **Step 1: Create `admindash/pyproject.toml`**

```toml
[project]
name = "admindash-backend"
version = "0.1.0"
description = "School operations backend powering the admindash product"
requires-python = ">=3.11"
dependencies = [
    "fastapi>=0.115",
    "uvicorn[standard]>=0.30",
    "pydantic>=2.0",
    "pydantic-settings>=2.0",
    "httpx>=0.28",
]

[project.optional-dependencies]
dev = [
    "pytest>=8.0",
    "pytest-asyncio>=0.23",
    "respx>=0.21",
    "httpx>=0.28",
]

[build-system]
requires = ["hatchling"]
build-backend = "hatchling.build"

[tool.hatch.metadata]
allow-direct-references = true

[tool.hatch.build.targets.wheel]
packages = ["backend/app"]
```

- [ ] **Step 2: Create empty package markers**

Create three empty files:
- `admindash/backend/app/__init__.py`
- `admindash/backend/app/api/__init__.py`
- `admindash/backend/tests/__init__.py`

Each file should be completely empty (zero bytes).

- [ ] **Step 3: Install dependencies**

Run: `cd /Users/kennylee/Development/NeoApex/admindash && uv sync --extra dev`

Expected: `uv` creates `admindash/.venv/`, installs FastAPI + httpx + pytest + respx, and writes `admindash/uv.lock`. No errors.

- [ ] **Step 4: Verify pytest is available**

Run: `cd /Users/kennylee/Development/NeoApex/admindash && uv run pytest --version`

Expected: `pytest 8.x.x` printed, exit code 0.

- [ ] **Step 5: Commit**

```bash
cd /Users/kennylee/Development/NeoApex
git add admindash/pyproject.toml admindash/uv.lock admindash/backend/app/__init__.py admindash/backend/app/api/__init__.py admindash/backend/tests/__init__.py
git commit -m "feat(admindash): scaffold backend Python project"
```

---

## Task 2: Configuration module

**Files:**
- Create: `admindash/backend/app/config.py`
- Create: `admindash/backend/tests/test_cors.py`

- [ ] **Step 1: Write the failing test for fail-closed production CORS**

Create `admindash/backend/tests/test_cors.py`:

```python
"""Tests for production fail-closed CORS configuration."""
import os
import pytest


def _reset_settings_module():
    """Force a re-import of app.config so env var changes take effect."""
    import importlib
    import app.config
    importlib.reload(app.config)
    return app.config.Settings


def test_dev_mode_allows_localhost_5600(monkeypatch):
    monkeypatch.delenv("ADMINDASH_ENVIRONMENT", raising=False)
    monkeypatch.delenv("ADMINDASH_CORS_ALLOWED_ORIGINS", raising=False)
    Settings = _reset_settings_module()
    s = Settings()
    assert s.cors_allowed_origins == ["http://localhost:5600"]


def test_production_without_cors_origins_raises(monkeypatch):
    monkeypatch.setenv("ADMINDASH_ENVIRONMENT", "production")
    monkeypatch.delenv("ADMINDASH_CORS_ALLOWED_ORIGINS", raising=False)
    Settings = _reset_settings_module()
    with pytest.raises(ValueError, match="CORS_ALLOWED_ORIGINS"):
        Settings()


def test_production_with_wildcard_raises(monkeypatch):
    monkeypatch.setenv("ADMINDASH_ENVIRONMENT", "production")
    monkeypatch.setenv("ADMINDASH_CORS_ALLOWED_ORIGINS", "*")
    Settings = _reset_settings_module()
    with pytest.raises(ValueError, match="wildcard"):
        Settings()


def test_production_with_explicit_origin_succeeds(monkeypatch):
    monkeypatch.setenv("ADMINDASH_ENVIRONMENT", "production")
    monkeypatch.setenv(
        "ADMINDASH_CORS_ALLOWED_ORIGINS", "https://admin.floatify.com"
    )
    Settings = _reset_settings_module()
    s = Settings()
    assert s.cors_allowed_origins == ["https://admin.floatify.com"]
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd /Users/kennylee/Development/NeoApex/admindash && uv run pytest backend/tests/test_cors.py -v`

Expected: All four tests FAIL with `ModuleNotFoundError: No module named 'app.config'`.

- [ ] **Step 3: Create `admindash/backend/app/config.py`**

```python
"""Configuration for admindash backend service."""
from typing import List
from pydantic import field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_prefix="ADMINDASH_",
        case_sensitive=False,
    )

    environment: str = "development"
    datacore_url: str = "http://localhost:5800"
    papermite_backend_url: str = "http://localhost:5710"
    cors_allowed_origins: List[str] = []
    port: int = 5610

    @field_validator("cors_allowed_origins", mode="before")
    @classmethod
    def parse_cors_origins(cls, v):
        if isinstance(v, str):
            return [origin.strip() for origin in v.split(",") if origin.strip()]
        return v

    @model_validator(mode="after")
    def validate_production_or_default_dev(self):
        if self.environment == "production":
            if not self.cors_allowed_origins:
                raise ValueError(
                    "ADMINDASH_CORS_ALLOWED_ORIGINS is required in production "
                    "and must not be empty"
                )
            if "*" in self.cors_allowed_origins:
                raise ValueError(
                    "wildcard '*' in ADMINDASH_CORS_ALLOWED_ORIGINS is not "
                    "permitted in production"
                )
        elif not self.cors_allowed_origins:
            # Dev default: admindash frontend on port 5600
            object.__setattr__(
                self, "cors_allowed_origins", ["http://localhost:5600"]
            )
        return self


settings = Settings()
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd /Users/kennylee/Development/NeoApex/admindash && uv run pytest backend/tests/test_cors.py -v`

Expected: All four tests PASS.

- [ ] **Step 5: Commit**

```bash
cd /Users/kennylee/Development/NeoApex
git add admindash/backend/app/config.py admindash/backend/tests/test_cors.py
git commit -m "feat(admindash/backend): config module with fail-closed production CORS"
```

---

## Task 3: Auth dependency

**Files:**
- Create: `admindash/backend/app/auth.py`
- Create: `admindash/backend/tests/conftest.py`
- Create: `admindash/backend/tests/test_auth_dep.py`

- [ ] **Step 1: Create the test fixture file**

Create `admindash/backend/tests/conftest.py`:

```python
"""Pytest fixtures for admindash backend tests."""
import pytest
from fastapi.testclient import TestClient


@pytest.fixture
def client():
    """Provides a TestClient against the FastAPI app.

    Imports inside the fixture so test_cors.py can manipulate env vars
    before the app is constructed.
    """
    from app.main import app
    with TestClient(app) as c:
        yield c
```

- [ ] **Step 2: Write failing tests for the auth dependency**

Create `admindash/backend/tests/test_auth_dep.py`:

```python
"""Tests for the require_authenticated_user dependency."""
import httpx
import pytest
import respx
from fastapi import Depends, FastAPI
from fastapi.testclient import TestClient


@pytest.fixture
def dep_app():
    """Build a tiny FastAPI app that exposes the dependency for testing."""
    from app.auth import require_authenticated_user

    app = FastAPI()

    @app.get("/protected")
    def protected(user=Depends(require_authenticated_user)):
        return {"user_id": user.get("id")}

    return TestClient(app)


def test_missing_authorization_header_returns_401(dep_app):
    resp = dep_app.get("/protected")
    assert resp.status_code == 401


def test_malformed_authorization_header_returns_401(dep_app):
    resp = dep_app.get("/protected", headers={"Authorization": "NotBearer xyz"})
    assert resp.status_code == 401


@respx.mock
def test_valid_token_passes_dependency(dep_app):
    respx.get("http://localhost:5800/auth/me").mock(
        return_value=httpx.Response(200, json={"id": "u1", "tenant_id": "t1"})
    )
    resp = dep_app.get("/protected", headers={"Authorization": "Bearer good"})
    assert resp.status_code == 200
    assert resp.json() == {"user_id": "u1"}


@respx.mock
def test_datacore_rejects_token_returns_401(dep_app):
    respx.get("http://localhost:5800/auth/me").mock(
        return_value=httpx.Response(401, json={"detail": "expired"})
    )
    resp = dep_app.get("/protected", headers={"Authorization": "Bearer bad"})
    assert resp.status_code == 401
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `cd /Users/kennylee/Development/NeoApex/admindash && uv run pytest backend/tests/test_auth_dep.py -v`

Expected: All four tests FAIL with `ModuleNotFoundError: No module named 'app.auth'`.

- [ ] **Step 4: Create `admindash/backend/app/auth.py`**

```python
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
    except httpx.RequestError as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Cannot reach DataCore: {exc}",
        )

    if resp.status_code != 200:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired token",
        )

    user = resp.json()
    user["_token"] = auth_header
    return user
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd /Users/kennylee/Development/NeoApex/admindash && uv run pytest backend/tests/test_auth_dep.py -v`

Expected: All four tests PASS.

- [ ] **Step 6: Commit**

```bash
cd /Users/kennylee/Development/NeoApex
git add admindash/backend/app/auth.py admindash/backend/tests/conftest.py admindash/backend/tests/test_auth_dep.py
git commit -m "feat(admindash/backend): JWT validation dependency via DataCore /auth/me"
```

---

## Task 4: Health endpoint

**Files:**
- Create: `admindash/backend/app/api/health.py`
- Create: `admindash/backend/tests/test_health.py`

- [ ] **Step 1: Write the failing test**

Create `admindash/backend/tests/test_health.py`:

```python
def test_health_returns_ok(client):
    resp = client.get("/api/health")
    assert resp.status_code == 200
    assert resp.json() == {"status": "ok"}
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd /Users/kennylee/Development/NeoApex/admindash && uv run pytest backend/tests/test_health.py -v`

Expected: FAIL with `ModuleNotFoundError: No module named 'app.main'` (the conftest fixture imports `app.main` which doesn't exist yet).

- [ ] **Step 3: Create the health router**

Create `admindash/backend/app/api/health.py`:

```python
"""Health check endpoint."""
from fastapi import APIRouter

router = APIRouter()


@router.get("/health")
def health():
    return {"status": "ok"}
```

Note: this task does not implement `app/main.py` yet. The test will still fail until Task 9 mounts everything into a FastAPI app. We'll come back to this test in Task 9.

- [ ] **Step 4: Commit (test still red — that's expected)**

```bash
cd /Users/kennylee/Development/NeoApex
git add admindash/backend/app/api/health.py admindash/backend/tests/test_health.py
git commit -m "feat(admindash/backend): health router (test red until app wired)"
```

---

## Task 5: Auth proxy routes

**Files:**
- Create: `admindash/backend/app/api/auth.py`
- Create: `admindash/backend/tests/test_auth.py`

- [ ] **Step 1: Write the failing tests**

Create `admindash/backend/tests/test_auth.py`:

```python
"""Tests for /auth/login and /auth/me proxy routes."""
import json
import httpx
import respx


@respx.mock
def test_login_forwards_body_to_datacore(client):
    route = respx.post("http://localhost:5800/auth/login").mock(
        return_value=httpx.Response(
            200, json={"token": "abc", "user": {"id": "u1"}}
        )
    )
    resp = client.post("/auth/login", json={"email": "a@b.com", "password": "x"})
    assert resp.status_code == 200
    assert resp.json() == {"token": "abc", "user": {"id": "u1"}}
    forwarded = route.calls[0].request
    assert json.loads(forwarded.content) == {"email": "a@b.com", "password": "x"}


@respx.mock
def test_login_passes_through_datacore_error(client):
    respx.post("http://localhost:5800/auth/login").mock(
        return_value=httpx.Response(401, json={"detail": "bad credentials"})
    )
    resp = client.post("/auth/login", json={"email": "a@b.com", "password": "x"})
    assert resp.status_code == 401
    assert resp.json() == {"detail": "bad credentials"}


@respx.mock
def test_me_with_valid_token_returns_user(client):
    respx.get("http://localhost:5800/auth/me").mock(
        return_value=httpx.Response(200, json={"id": "u1", "tenant_id": "t1"})
    )
    resp = client.get("/auth/me", headers={"Authorization": "Bearer good"})
    assert resp.status_code == 200
    assert resp.json() == {"id": "u1", "tenant_id": "t1"}


def test_me_without_header_returns_401(client):
    resp = client.get("/auth/me")
    assert resp.status_code == 401


@respx.mock
def test_me_when_datacore_rejects_returns_401(client):
    respx.get("http://localhost:5800/auth/me").mock(
        return_value=httpx.Response(401, json={"detail": "expired"})
    )
    resp = client.get("/auth/me", headers={"Authorization": "Bearer bad"})
    assert resp.status_code == 401
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd /Users/kennylee/Development/NeoApex/admindash && uv run pytest backend/tests/test_auth.py -v`

Expected: All five tests FAIL with `ModuleNotFoundError: No module named 'app.main'` (still no main.py).

- [ ] **Step 3: Create the auth proxy router**

Create `admindash/backend/app/api/auth.py`:

```python
"""Auth proxy routes — forward /auth/login and /auth/me to DataCore."""
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
    except httpx.RequestError as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Cannot reach DataCore: {exc}",
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
    except httpx.RequestError as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Cannot reach DataCore: {exc}",
        )
    return Response(
        content=resp.content,
        status_code=resp.status_code,
        media_type=resp.headers.get("content-type", "application/json"),
    )
```

- [ ] **Step 4: Commit (tests still red until Task 9)**

```bash
cd /Users/kennylee/Development/NeoApex
git add admindash/backend/app/api/auth.py admindash/backend/tests/test_auth.py
git commit -m "feat(admindash/backend): /auth/login and /auth/me proxy routes"
```

---

## Task 6: Query proxy route

**Files:**
- Create: `admindash/backend/app/api/query.py`
- Create: `admindash/backend/tests/test_query.py`

- [ ] **Step 1: Write the failing tests**

Create `admindash/backend/tests/test_query.py`:

```python
"""Tests for /api/query proxy route."""
import json
import httpx
import respx


@respx.mock
def test_authenticated_query_is_forwarded(client):
    respx.get("http://localhost:5800/auth/me").mock(
        return_value=httpx.Response(200, json={"id": "u1", "tenant_id": "t1"})
    )
    route = respx.post("http://localhost:5800/api/query").mock(
        return_value=httpx.Response(200, json={"data": [{"id": 1}], "total": 1})
    )
    body = {"tenant_id": "t1", "table": "entities", "sql": "SELECT 1"}
    resp = client.post(
        "/api/query", json=body, headers={"Authorization": "Bearer good"}
    )
    assert resp.status_code == 200
    assert resp.json() == {"data": [{"id": 1}], "total": 1}
    assert json.loads(route.calls[0].request.content) == body


def test_unauthenticated_query_returns_401(client):
    resp = client.post("/api/query", json={"sql": "SELECT 1"})
    assert resp.status_code == 401


@respx.mock
def test_query_surfaces_datacore_500_verbatim(client):
    respx.get("http://localhost:5800/auth/me").mock(
        return_value=httpx.Response(200, json={"id": "u1"})
    )
    respx.post("http://localhost:5800/api/query").mock(
        return_value=httpx.Response(500, json={"error": "boom"})
    )
    resp = client.post(
        "/api/query",
        json={"sql": "SELECT 1"},
        headers={"Authorization": "Bearer good"},
    )
    assert resp.status_code == 500
    assert resp.json() == {"error": "boom"}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /Users/kennylee/Development/NeoApex/admindash && uv run pytest backend/tests/test_query.py -v`

Expected: All three tests FAIL (`ModuleNotFoundError`).

- [ ] **Step 3: Create the query proxy route**

Create `admindash/backend/app/api/query.py`:

```python
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
    except httpx.RequestError as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Cannot reach DataCore: {exc}",
        )
    return Response(
        content=resp.content,
        status_code=resp.status_code,
        media_type=resp.headers.get("content-type", "application/json"),
    )
```

Note: this handler is `async def` because we need `await request.body()`. The dependency `require_authenticated_user` is sync, which is allowed inside an async route — FastAPI handles the sync/async mix.

- [ ] **Step 4: Commit**

```bash
cd /Users/kennylee/Development/NeoApex
git add admindash/backend/app/api/query.py admindash/backend/tests/test_query.py
git commit -m "feat(admindash/backend): /api/query proxy route"
```

---

## Task 7: Entity CRUD proxy routes

**Files:**
- Create: `admindash/backend/app/api/entities.py`
- Create: `admindash/backend/tests/test_entities.py`

- [ ] **Step 1: Write the failing tests**

Create `admindash/backend/tests/test_entities.py`:

```python
"""Tests for entity CRUD proxy routes."""
import httpx
import respx


def _stub_auth(mock):
    mock.get("http://localhost:5800/auth/me").mock(
        return_value=httpx.Response(200, json={"id": "u1", "tenant_id": "t1"})
    )


@respx.mock
def test_create_entity_forwards_with_path_params(client):
    _stub_auth(respx)
    route = respx.post(
        "http://localhost:5800/api/entities/t1/student"
    ).mock(return_value=httpx.Response(200, json={"id": "stu_1"}))
    resp = client.post(
        "/api/entities/t1/student",
        json={"base_data": {"first_name": "Ada"}, "custom_fields": {}},
        headers={"Authorization": "Bearer good"},
    )
    assert resp.status_code == 200
    assert resp.json() == {"id": "stu_1"}
    assert route.called


@respx.mock
def test_update_entity_preserves_entity_id(client):
    _stub_auth(respx)
    route = respx.put(
        "http://localhost:5800/api/entities/t1/student/stu_1"
    ).mock(return_value=httpx.Response(200, json={"id": "stu_1", "updated": True}))
    resp = client.put(
        "/api/entities/t1/student/stu_1",
        json={"base_data": {"first_name": "Ada"}, "custom_fields": {}},
        headers={"Authorization": "Bearer good"},
    )
    assert resp.status_code == 200
    assert route.called


@respx.mock
def test_archive_endpoint_forwards(client):
    _stub_auth(respx)
    route = respx.post(
        "http://localhost:5800/api/entities/t1/student/archive"
    ).mock(return_value=httpx.Response(200, json={"archived": 2}))
    resp = client.post(
        "/api/entities/t1/student/archive",
        json={"entity_ids": ["stu_1", "stu_2"]},
        headers={"Authorization": "Bearer good"},
    )
    assert resp.status_code == 200
    assert resp.json() == {"archived": 2}
    assert route.called


@respx.mock
def test_next_id_is_get(client):
    _stub_auth(respx)
    route = respx.get(
        "http://localhost:5800/api/entities/t1/student/next-id"
    ).mock(return_value=httpx.Response(200, json={"next_id": "stu_42"}))
    resp = client.get(
        "/api/entities/t1/student/next-id",
        headers={"Authorization": "Bearer good"},
    )
    assert resp.status_code == 200
    assert resp.json() == {"next_id": "stu_42"}
    assert route.called


@respx.mock
def test_duplicate_check_forwards(client):
    _stub_auth(respx)
    route = respx.post(
        "http://localhost:5800/api/entities/t1/student/duplicate-check"
    ).mock(return_value=httpx.Response(200, json={"duplicates": []}))
    resp = client.post(
        "/api/entities/t1/student/duplicate-check",
        json={"first_name": "Ada", "last_name": "Lovelace"},
        headers={"Authorization": "Bearer good"},
    )
    assert resp.status_code == 200
    assert route.called


def test_unauthenticated_create_returns_401(client):
    resp = client.post("/api/entities/t1/student", json={})
    assert resp.status_code == 401
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /Users/kennylee/Development/NeoApex/admindash && uv run pytest backend/tests/test_entities.py -v`

Expected: All six tests FAIL.

- [ ] **Step 3: Create the entities router**

Create `admindash/backend/app/api/entities.py`:

```python
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
    except httpx.RequestError as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Cannot reach DataCore: {exc}",
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
```

**IMPORTANT**: FastAPI matches routes in declaration order. The `next-id`, `archive`, and `duplicate-check` routes have more specific paths than `update_entity` (`{entity_id}`) — but they use different HTTP methods (`GET` for next-id, `POST` for the others) so there is no actual conflict. Verify by reading the FastAPI route table after Task 9.

- [ ] **Step 4: Commit**

```bash
cd /Users/kennylee/Development/NeoApex
git add admindash/backend/app/api/entities.py admindash/backend/tests/test_entities.py
git commit -m "feat(admindash/backend): entity CRUD proxy routes"
```

---

## Task 8: Document extract proxy with multipart streaming

**Files:**
- Create: `admindash/backend/app/api/extract.py`
- Create: `admindash/backend/tests/test_extract.py`

- [ ] **Step 1: Write the failing test**

Create `admindash/backend/tests/test_extract.py`:

```python
"""Tests for /api/extract/{tenant_id}/student multipart streaming proxy."""
import httpx
import respx


@respx.mock
def test_multipart_upload_is_proxied(client):
    respx.get("http://localhost:5800/auth/me").mock(
        return_value=httpx.Response(200, json={"id": "u1", "tenant_id": "t1"})
    )
    route = respx.post(
        "http://localhost:5710/api/extract/t1/student"
    ).mock(
        return_value=httpx.Response(
            200, json={"first_name": "Ada", "last_name": "Lovelace"}
        )
    )

    file_bytes = b"%PDF-1.4 fake pdf content for test"
    resp = client.post(
        "/api/extract/t1/student",
        files={"file": ("test.pdf", file_bytes, "application/pdf")},
        headers={"Authorization": "Bearer good"},
    )
    assert resp.status_code == 200
    assert resp.json() == {"first_name": "Ada", "last_name": "Lovelace"}
    assert route.called

    # Verify Papermite received a multipart body containing our file bytes
    forwarded = route.calls[0].request
    assert forwarded.headers["content-type"].startswith("multipart/form-data")
    assert file_bytes in forwarded.content


def test_unauthenticated_extract_returns_401(client):
    resp = client.post(
        "/api/extract/t1/student",
        files={"file": ("x.pdf", b"x", "application/pdf")},
    )
    assert resp.status_code == 401
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd /Users/kennylee/Development/NeoApex/admindash && uv run pytest backend/tests/test_extract.py -v`

Expected: Both tests FAIL.

- [ ] **Step 3: Create the extract router**

Create `admindash/backend/app/api/extract.py`:

```python
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
    except httpx.RequestError as exc:
        await client.aclose()
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Cannot reach Papermite: {exc}",
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
```

- [ ] **Step 4: Commit**

```bash
cd /Users/kennylee/Development/NeoApex
git add admindash/backend/app/api/extract.py admindash/backend/tests/test_extract.py
git commit -m "feat(admindash/backend): multipart extract proxy with streaming"
```

---

## Task 9: FastAPI app entry point

**Files:**
- Create: `admindash/backend/app/main.py`

- [ ] **Step 1: Create `admindash/backend/app/main.py`**

```python
"""FastAPI application entry point for admindash backend."""
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api import auth, entities, extract, health, query
from app.config import settings

app = FastAPI(
    title="Admindash Backend",
    description="School operations backend powering the admindash product",
    version="0.1.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_allowed_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Auth routes mounted at root → /auth/login, /auth/me
# (matches what admindash currently calls on DataCore directly)
app.include_router(auth.router, prefix="/auth", tags=["auth"])

# Other routes mounted under /api → /api/health, /api/query, /api/entities/...
app.include_router(health.router, prefix="/api", tags=["health"])
app.include_router(query.router, prefix="/api", tags=["query"])
app.include_router(entities.router, prefix="/api", tags=["entities"])
app.include_router(extract.router, prefix="/api", tags=["extract"])
```

- [ ] **Step 2: Run the entire backend test suite**

Run: `cd /Users/kennylee/Development/NeoApex/admindash && uv run pytest backend/tests/ -v`

Expected: ALL tests pass — `test_health.py` (1), `test_auth.py` (5), `test_query.py` (3), `test_entities.py` (6), `test_extract.py` (2), `test_auth_dep.py` (4), `test_cors.py` (4) = 25 tests passing.

If any test fails, read the failure output, fix the underlying issue (route registration order, header forwarding, content-type handling, etc.), and re-run until everything passes. Do not move on until all tests are green.

- [ ] **Step 3: Manually start the server and curl the health endpoint**

Run in one terminal: `cd /Users/kennylee/Development/NeoApex/admindash && uv run uvicorn app.main:app --port 5610 --reload`

Expected: server starts, listens on `http://localhost:5610`, no errors.

Run in another terminal: `curl -i http://localhost:5610/api/health`

Expected:
```
HTTP/1.1 200 OK
content-type: application/json
{"status":"ok"}
```

Stop the server with Ctrl-C.

- [ ] **Step 4: Commit**

```bash
cd /Users/kennylee/Development/NeoApex
git add admindash/backend/app/main.py
git commit -m "feat(admindash/backend): FastAPI app entry point with all routes mounted"
```

---

## Task 10: Wire admindash-backend into services.json and start-services.sh

**Files:**
- Modify: `services.json`
- Modify: `start-services.sh`

- [ ] **Step 1: Add admindash-backend entry to `services.json`**

Read the current `services.json`. It currently looks like:

```json
{
  "services": {
    "launchpad-frontend": { "host": "localhost", "port": 5500 },
    "launchpad-backend": { "host": "localhost", "port": 5510 },
    "admindash-frontend": { "host": "localhost", "port": 5600 },
    "papermite-frontend": { "host": "localhost", "port": 5700 },
    "papermite-backend": { "host": "localhost", "port": 5710 },
    "datacore": { "host": "localhost", "port": 5800 }
  }
}
```

Add the admindash-backend line so it becomes:

```json
{
  "services": {
    "launchpad-frontend": { "host": "localhost", "port": 5500 },
    "launchpad-backend": { "host": "localhost", "port": 5510 },
    "admindash-frontend": { "host": "localhost", "port": 5600 },
    "admindash-backend": { "host": "localhost", "port": 5610 },
    "papermite-frontend": { "host": "localhost", "port": 5700 },
    "papermite-backend": { "host": "localhost", "port": 5710 },
    "datacore": { "host": "localhost", "port": 5800 }
  }
}
```

- [ ] **Step 2: Add port read to `start-services.sh`**

In `start-services.sh`, find the block (around line 49–54):

```bash
DATACORE_PORT=$(read_port "datacore")
LAUNCHPAD_BE_PORT=$(read_port "launchpad-backend")
PAPERMITE_BE_PORT=$(read_port "papermite-backend")
LAUNCHPAD_FE_PORT=$(read_port "launchpad-frontend")
PAPERMITE_FE_PORT=$(read_port "papermite-frontend")
ADMINDASH_FE_PORT=$(read_port "admindash-frontend")
```

Add a line after `PAPERMITE_BE_PORT`:

```bash
DATACORE_PORT=$(read_port "datacore")
LAUNCHPAD_BE_PORT=$(read_port "launchpad-backend")
PAPERMITE_BE_PORT=$(read_port "papermite-backend")
ADMINDASH_BE_PORT=$(read_port "admindash-backend")
LAUNCHPAD_FE_PORT=$(read_port "launchpad-frontend")
PAPERMITE_FE_PORT=$(read_port "papermite-frontend")
ADMINDASH_FE_PORT=$(read_port "admindash-frontend")
```

- [ ] **Step 3: Add admindash-backend to the SERVICES array**

Find the SERVICES array (around line 57-64):

```bash
SERVICES=(
  "datacore:$DATACORE_PORT:backend"
  "launchpad-backend:$LAUNCHPAD_BE_PORT:backend"
  "papermite-backend:$PAPERMITE_BE_PORT:backend"
  "launchpad-frontend:$LAUNCHPAD_FE_PORT:frontend"
  "papermite-frontend:$PAPERMITE_FE_PORT:frontend"
  "admindash-frontend:$ADMINDASH_FE_PORT:frontend"
)
```

Add the admindash-backend entry, ordered before `admindash-frontend` so the backend boots before the frontend:

```bash
SERVICES=(
  "datacore:$DATACORE_PORT:backend"
  "launchpad-backend:$LAUNCHPAD_BE_PORT:backend"
  "papermite-backend:$PAPERMITE_BE_PORT:backend"
  "admindash-backend:$ADMINDASH_BE_PORT:backend"
  "launchpad-frontend:$LAUNCHPAD_FE_PORT:frontend"
  "papermite-frontend:$PAPERMITE_FE_PORT:frontend"
  "admindash-frontend:$ADMINDASH_FE_PORT:frontend"
)
```

- [ ] **Step 4: Add the start case for admindash-backend**

In the `start_service()` function (around line 192-243), find the existing `papermite-backend)` case and add a new case after it:

```bash
    admindash-backend)
      info "Starting $name on port $port..."
      cd "$SCRIPT_DIR/admindash"
      uv run uvicorn app.main:app --app-dir backend --port "$port" > "$log_file" 2>&1 &
      cd "$SCRIPT_DIR"
      ;;
```

Note: `--app-dir backend` tells uvicorn to look for `app.main` inside `admindash/backend/`, while the working directory `admindash/` is where the `pyproject.toml` and `.venv` live (mirrors how launchpad does it from `launchpad/backend` with the venv at `launchpad/.venv`).

- [ ] **Step 5: Run `./start-services.sh` from a clean state**

```bash
cd /Users/kennylee/Development/NeoApex
./start-services.sh
```

Expected: the status table at the end shows `admindash-backend` with status `running` on port 5610. No `[fail]` lines.

- [ ] **Step 6: Verify admindash-backend is reachable**

```bash
curl -s http://localhost:5610/api/health
```

Expected: `{"status":"ok"}`

- [ ] **Step 7: Stop services**

```bash
cd /Users/kennylee/Development/NeoApex
./start-services.sh
```

When prompted (or in non-interactive mode it auto-kills) — confirm services were killed and re-started cleanly.

- [ ] **Step 8: Commit**

```bash
cd /Users/kennylee/Development/NeoApex
git add services.json start-services.sh
git commit -m "feat: add admindash-backend to services.json and start-services.sh"
```

---

## Task 11: Frontend retargeting — config.ts

**Files:**
- Modify: `admindash/frontend/src/config.ts`

- [ ] **Step 1: Read the current `config.ts`**

The current contents are:

```typescript
import services from '../../../services.json';

function svcUrl(key: string): string {
  const svc = services.services[key as keyof typeof services.services];
  return `http://${svc.host}:${svc.port}`;
}

export const DATACORE_URL = import.meta.env.VITE_DATACORE_URL || svcUrl("datacore");
export const DATACORE_AUTH_URL = import.meta.env.VITE_DATACORE_AUTH_URL || `${DATACORE_URL}/auth`;
export const PAPERMITE_BACKEND_URL = import.meta.env.VITE_PAPERMITE_BACKEND_URL || svcUrl("papermite-backend");
```

- [ ] **Step 2: Replace its contents with a single `ADMINDASH_API_URL` export**

Overwrite `admindash/frontend/src/config.ts` with:

```typescript
import services from '../../../services.json';

function svcUrl(key: string): string {
  const svc = services.services[key as keyof typeof services.services];
  return `http://${svc.host}:${svc.port}`;
}

export const ADMINDASH_API_URL =
  import.meta.env.VITE_ADMINDASH_API_URL || svcUrl("admindash-backend");
```

- [ ] **Step 3: Verify TypeScript will fail in the dependent files**

Run: `cd /Users/kennylee/Development/NeoApex/admindash/frontend && npx tsc -b`

Expected: errors in `api/client.ts`, `contexts/AuthContext.tsx`, and `pages/StudentsPage.tsx` complaining that `DATACORE_URL`, `DATACORE_AUTH_URL`, and `PAPERMITE_BACKEND_URL` are no longer exported. This is expected — we'll fix each in subsequent tasks.

DO NOT commit yet — the build is broken. We'll commit at the end of Task 14 after all four files are updated.

---

## Task 12: Frontend retargeting — api/client.ts

**Files:**
- Modify: `admindash/frontend/src/api/client.ts`

- [ ] **Step 1: Update the import line**

In `admindash/frontend/src/api/client.ts`, find line 9:

```typescript
import { DATACORE_URL, PAPERMITE_BACKEND_URL } from '../config.ts';
```

Replace with:

```typescript
import { ADMINDASH_API_URL } from '../config.ts';
```

- [ ] **Step 2: Update the base URL constants (lines 11–12)**

Find:

```typescript
const DATACORE_API_BASE = DATACORE_URL;
const PAPERMITE_API_BASE = PAPERMITE_BACKEND_URL;
```

Replace with:

```typescript
const API_BASE = ADMINDASH_API_URL;
```

- [ ] **Step 3: Replace every `DATACORE_API_BASE` and `PAPERMITE_API_BASE` reference with `API_BASE`**

There are 7 references to update (one per fetch site). Each one looks like:

- Line 25: `${DATACORE_API_BASE}/api/query` → `${API_BASE}/api/query`
- Line 40: `${DATACORE_API_BASE}/api/entities/${tenantId}/${entityType}/archive` → `${API_BASE}/api/entities/${tenantId}/${entityType}/archive`
- Line 59: `${DATACORE_API_BASE}/api/entities/${tenantId}/${entityType}/${entityId}` → `${API_BASE}/api/entities/${tenantId}/${entityType}/${entityId}`
- Line 80: `${DATACORE_API_BASE}/api/entities/${tenantId}/${entityType}` → `${API_BASE}/api/entities/${tenantId}/${entityType}`
- Line 101: `${PAPERMITE_API_BASE}/api/extract/${tenantId}/student` → `${API_BASE}/api/extract/${tenantId}/student`
- Line 117: `${DATACORE_API_BASE}/api/entities/${tenantId}/${entityType}/next-id` → `${API_BASE}/api/entities/${tenantId}/${entityType}/next-id`
- Line 129: `${DATACORE_API_BASE}/api/entities/${tenantId}/student/duplicate-check` → `${API_BASE}/api/entities/${tenantId}/student/duplicate-check`

Verify zero remaining references to `DATACORE_API_BASE` or `PAPERMITE_API_BASE` in the file.

- [ ] **Step 4: Confirm the file still type-checks (other files may still have errors)**

Don't run a build yet — just visually scan the file to confirm no leftover references. Continue to the next task.

---

## Task 13: Frontend retargeting — AuthContext.tsx

**Files:**
- Modify: `admindash/frontend/src/contexts/AuthContext.tsx`

- [ ] **Step 1: Update the import**

In `admindash/frontend/src/contexts/AuthContext.tsx`, find line 3:

```typescript
import { DATACORE_AUTH_URL } from '../config.ts';
```

Replace with:

```typescript
import { ADMINDASH_API_URL } from '../config.ts';
```

- [ ] **Step 2: Update the `/me` fetch (line 30)**

Find:

```typescript
fetch(`${DATACORE_AUTH_URL}/me`, {
```

Replace with:

```typescript
fetch(`${ADMINDASH_API_URL}/auth/me`, {
```

Note: the path changes from `/me` (because `DATACORE_AUTH_URL` already had `/auth` appended) to `/auth/me` (because `ADMINDASH_API_URL` is the bare base URL without `/auth`).

- [ ] **Step 3: Update the `/login` fetch (line 44)**

Find:

```typescript
const resp = await fetch(`${DATACORE_AUTH_URL}/login`, {
```

Replace with:

```typescript
const resp = await fetch(`${ADMINDASH_API_URL}/auth/login`, {
```

- [ ] **Step 4: Verify zero remaining `DATACORE_AUTH_URL` references in this file**

---

## Task 14: Frontend retargeting — StudentsPage.tsx

**Files:**
- Modify: `admindash/frontend/src/pages/StudentsPage.tsx`

- [ ] **Step 1: Update the import (line 2)**

Find:

```typescript
import { DATACORE_URL } from '../config.ts';
```

Replace with:

```typescript
import { ADMINDASH_API_URL } from '../config.ts';
```

- [ ] **Step 2: Update the error message (around line 354)**

Find:

```typescript
`Failed to load students. Is the datacore API at ${DATACORE_URL} running? (${err})`
```

Replace with:

```typescript
`Failed to load students. Is the admindash backend at ${ADMINDASH_API_URL} running? (${err})`
```

- [ ] **Step 3: Run TypeScript build to verify no errors remain**

Run: `cd /Users/kennylee/Development/NeoApex/admindash/frontend && npx tsc -b`

Expected: no errors. If there are still errors, find and fix any remaining references — they should be limited to the four files we've modified.

- [ ] **Step 4: Run lint**

Run: `cd /Users/kennylee/Development/NeoApex/admindash/frontend && npm run lint`

Expected: no errors.

- [ ] **Step 5: Run the production build**

Run: `cd /Users/kennylee/Development/NeoApex/admindash/frontend && npm run build`

Expected: build succeeds, dist/ is generated.

- [ ] **Step 6: Grep for any leftover legacy references**

Run:

```bash
cd /Users/kennylee/Development/NeoApex
grep -rn "DATACORE_URL\|DATACORE_AUTH_URL\|PAPERMITE_BACKEND_URL\|:5800\|:5710" admindash/frontend/src
```

Expected: zero results in source files. (Comments documenting the migration would be acceptable but we have none.)

- [ ] **Step 7: Commit the frontend retargeting**

```bash
cd /Users/kennylee/Development/NeoApex
git add admindash/frontend/src/config.ts admindash/frontend/src/api/client.ts admindash/frontend/src/contexts/AuthContext.tsx admindash/frontend/src/pages/StudentsPage.tsx
git commit -m "feat(admindash/frontend): retarget all API calls to admindash-backend"
```

---

## Task 15: End-to-end smoke test

**Files:** none (manual verification)

- [ ] **Step 1: Kill all services and restart from clean state**

```bash
cd /Users/kennylee/Development/NeoApex
./start-services.sh
```

Expected status table: all 7 services (datacore, launchpad-backend, papermite-backend, admindash-backend, launchpad-frontend, papermite-frontend, admindash-frontend) show `running`.

- [ ] **Step 2: Open admindash in a browser**

Navigate to `http://localhost:5600`.

Expected: admindash login page loads.

- [ ] **Step 3: Log in with a test user**

Use a test user known to exist in the local DataCore instance. (Check `datacore/` setup docs if you don't know the test credentials.)

Expected: login succeeds, you land on the home page.

In a separate terminal, tail the admindash backend log to confirm requests are flowing through:

```bash
tail -f /Users/kennylee/Development/NeoApex/.logs/admindash-backend.log
```

You should see `POST /auth/login` and `GET /auth/me` requests appearing.

- [ ] **Step 4: Verify the home page loads the student count**

Expected: home page shows student count (no error).

- [ ] **Step 5: Navigate to Students page and verify the table loads**

Expected: students list appears. Errors in the browser console should be zero.

In the admindash-backend log you should see `POST /api/query` requests.

- [ ] **Step 6: Add a new student via the modal**

Click "Add Student". Fill in the form (first name, last name, etc.). Submit.

Expected: the student is created and appears in the list. The admindash-backend log should show:
- `GET /api/entities/{tenant_id}/student/next-id`
- `POST /api/entities/{tenant_id}/student/duplicate-check`
- `POST /api/entities/{tenant_id}/student`

- [ ] **Step 7: Edit the student**

Click the edit icon on the new student. Change a field. Save.

Expected: the update succeeds. Backend log shows `PUT /api/entities/{tenant_id}/student/{entity_id}`.

- [ ] **Step 8: Archive the student**

Select the student row, click the archive/delete action.

Expected: the student is archived. Backend log shows `POST /api/entities/{tenant_id}/student/archive`.

- [ ] **Step 9: Test document extract via AddStudentModal upload**

Open Add Student modal again. Use the document upload affordance to upload a sample PDF (any small PDF will do; the AI extraction may or may not produce useful fields, but the request should succeed).

Expected: the request lands on `POST /api/extract/{tenant_id}/student` in the backend log, Papermite responds with extracted fields, and the modal shows them.

- [ ] **Step 10: Verify nothing in the browser ever hit DataCore or Papermite directly**

Open browser DevTools → Network tab → reload the page → log in and navigate around. Filter for requests.

Expected: every API request goes to `http://localhost:5610` (admindash-backend). Zero requests to `http://localhost:5800` (DataCore) or `http://localhost:5710` (Papermite) from the browser.

- [ ] **Step 11: If any test in steps 2–10 failed, debug and fix**

Read both the browser console and `/Users/kennylee/Development/NeoApex/.logs/admindash-backend.log` to identify the failure. Common issues:
- Path mismatch (admindash-backend route doesn't match the path the frontend calls)
- Missing CORS header (check `CORS_ALLOWED_ORIGINS` in dev config defaults)
- JWT not being forwarded (check `_token` plumbing in `app/auth.py`)
- Multipart boundary mismatch (check `extract.py` Content-Type forwarding)

Fix the bug, re-run the failing scenario, and only continue when all 9 smoke-test steps pass cleanly.

- [ ] **Step 12: No commit needed for this task (verification only)**

---

## Task 16: Documentation updates

**Files:**
- Modify: `admindash/CLAUDE.md`
- Modify: `CLAUDE.md` (top-level)
- Create: `admindash/backend/README.md`

- [ ] **Step 1: Update `admindash/CLAUDE.md`**

The current file describes admindash as "React SPA only" with stale port references (`localhost:8080`, `localhost:8081`). Make these specific changes:

(a) **Project Overview section** — replace the first paragraph with:

```markdown
## Project Overview

AdminDash is the **school operations product** in the NeoApex / Floatify suite. School administrators use it to manage their schools — students, programs, and enrollment workflows. It is customer-facing software whose users are school staff at Floatify-customer schools.

The product has two halves:
- **Frontend** (`frontend/`): React SPA on port 5600
- **Backend** (`backend/`): Python FastAPI service on port 5610 that the SPA calls. The backend proxies authenticated requests to DataCore (entities, queries, auth) and Papermite (document extract).

Part of the NeoApex ecosystem alongside papermite, datacore, launchpad, and the placeholder modules apexflow, enrollx, familyhub.
```

(b) **Commands section** — add a Backend subsection (after the existing Frontend commands):

```markdown
### Backend (FastAPI on :5610)

```bash
# Install deps (from admindash/, where pyproject.toml lives)
cd /Users/kennylee/Development/NeoApex/admindash && uv sync --extra dev

# Run dev server
cd /Users/kennylee/Development/NeoApex/admindash && uv run uvicorn app.main:app --app-dir backend --port 5610 --reload

# Run tests
cd /Users/kennylee/Development/NeoApex/admindash && uv run pytest backend/tests/ -v
```
```

(c) **Architecture → Authentication section** — replace the stale `http://localhost:8081/auth` reference. Find:

```markdown
**Authentication**: AuthContext authenticates against DataCore auth API (`http://localhost:8081/auth`), stores JWT in localStorage under `neoapex_token`. Routes protected via AppRoutes component.
```

Replace with:

```markdown
**Authentication**: AuthContext authenticates against the admindash backend's `/auth/login` endpoint (which proxies to DataCore). JWT stored in localStorage under `neoapex_token`. Routes protected via AppRoutes component.
```

(d) **Architecture → API endpoints section** — replace:

```markdown
**API endpoints**: `GET /students?tenant=&limit=&offset=` and `GET /tenants`.
```

with:

```markdown
**API endpoints**: All API calls target the admindash backend at `http://localhost:5610`. The backend exposes `/auth/login`, `/auth/me`, `/api/query`, `/api/entities/{tenant_id}/{entity_type}` (POST/PUT/GET next-id/POST archive/POST duplicate-check), and `/api/extract/{tenant_id}/student` (multipart). All proxied to DataCore or Papermite after JWT validation.
```

(e) Search the file for any remaining `8080` or `8081` references and remove them.

- [ ] **Step 2: Update top-level `CLAUDE.md`**

In `/Users/kennylee/Development/NeoApex/CLAUDE.md`, find the admindash bullet in the "Project Overview" section:

```markdown
- **admindash** — Operations dashboard. React SPA only (no backend). Calls DataCore and Papermite APIs directly.
```

Replace with:

```markdown
- **admindash** — School operations product for school administrators. React frontend (port 5600) + Python FastAPI backend (port 5610). The backend proxies authenticated requests to DataCore and Papermite.
```

In the "Per-Service Commands" section, add an AdminDash backend subsection (after the existing AdminDash frontend block):

```markdown
**AdminDash Backend** (Python backend, added 2026-04):
```bash
cd admindash && uv sync --extra dev                        # Install deps
cd admindash && uv run uvicorn app.main:app --app-dir backend --port 5610 --reload  # Dev
cd admindash && uv run pytest backend/tests/ -v            # Tests
```
```

In the "Service Ports" table, add a row:

```markdown
| AdminDash backend | 5610 |
```

In the "Architecture → Data Flow" section, find:

```markdown
- AdminDash reads entities and models from DataCore API, extracts from Papermite API
```

Replace with:

```markdown
- AdminDash frontend talks only to its own backend (`admindash-backend`) on port 5610. The backend proxies entity/query operations to DataCore and document extract to Papermite, with JWT validation delegated to DataCore.
```

- [ ] **Step 3: Create `admindash/backend/README.md`**

Create a new file at `admindash/backend/README.md`:

```markdown
# admindash backend

FastAPI service that powers the admindash school operations product. Sits between the admindash React SPA and the DataCore and Papermite backends, validates JWTs, and proxies requests.

## Run locally

```bash
# From the admindash/ directory (where pyproject.toml lives)
cd /Users/kennylee/Development/NeoApex/admindash
uv sync --extra dev
uv run uvicorn app.main:app --app-dir backend --port 5610 --reload
```

Or use the repo-level `start-services.sh` to boot all NeoApex services together.

## Run tests

```bash
cd /Users/kennylee/Development/NeoApex/admindash
uv run pytest backend/tests/ -v
```

## Environment variables

| Variable | Default | Purpose |
|---|---|---|
| `ADMINDASH_ENVIRONMENT` | `development` | Set to `production` to enforce fail-closed CORS |
| `ADMINDASH_DATACORE_URL` | `http://localhost:5800` | Base URL for DataCore |
| `ADMINDASH_PAPERMITE_BACKEND_URL` | `http://localhost:5710` | Base URL for Papermite backend |
| `ADMINDASH_CORS_ALLOWED_ORIGINS` | `http://localhost:5600` (dev) | Comma-separated list. Required and non-wildcard in production. |
| `ADMINDASH_PORT` | `5610` | (Reserved; uvicorn `--port` is used in dev/CI) |

## Endpoints

| Method | Path | Forwards to |
|---|---|---|
| GET | `/api/health` | (none — local) |
| POST | `/auth/login` | DataCore `/auth/login` |
| GET | `/auth/me` | DataCore `/auth/me` |
| POST | `/api/query` | DataCore `/api/query` |
| POST | `/api/entities/{tenant_id}/{entity_type}` | DataCore (create) |
| PUT | `/api/entities/{tenant_id}/{entity_type}/{entity_id}` | DataCore (update) |
| POST | `/api/entities/{tenant_id}/{entity_type}/archive` | DataCore (archive) |
| GET | `/api/entities/{tenant_id}/{entity_type}/next-id` | DataCore |
| POST | `/api/entities/{tenant_id}/{entity_type}/duplicate-check` | DataCore |
| POST | `/api/extract/{tenant_id}/student` | Papermite (multipart streaming) |

Every endpoint except `/api/health` and `/auth/login` requires a valid bearer token validated against DataCore `/auth/me`.
```

- [ ] **Step 4: Commit documentation**

```bash
cd /Users/kennylee/Development/NeoApex
git add admindash/CLAUDE.md CLAUDE.md admindash/backend/README.md
git commit -m "docs: document admindash backend and refresh stale references"
```

---

## Task 17: Final verification

**Files:** none (verification only)

- [ ] **Step 1: Run all backend tests once more**

```bash
cd /Users/kennylee/Development/NeoApex/admindash && uv run pytest backend/tests/ -v
```

Expected: 25/25 passing.

- [ ] **Step 2: Run admindash frontend type-check, lint, and build**

```bash
cd /Users/kennylee/Development/NeoApex/admindash/frontend
npx tsc -b
npm run lint
npm run build
```

All three should succeed.

- [ ] **Step 3: Run start-services.sh and confirm seven services boot**

```bash
cd /Users/kennylee/Development/NeoApex
./start-services.sh
```

Expected status table:

```
┌────────────────────────┬──────┬─────────┐
│ Service                │ Port │ Status  │
├────────────────────────┼──────┼─────────┤
│ datacore               │ 5800 │ running │
│ launchpad-backend      │ 5510 │ running │
│ papermite-backend      │ 5710 │ running │
│ admindash-backend      │ 5610 │ running │
│ launchpad-frontend     │ 5500 │ running │
│ papermite-frontend     │ 5700 │ running │
│ admindash-frontend     │ 5600 │ running │
└────────────────────────┴──────┴─────────┘
```

- [ ] **Step 4: Walk through the smoke test from Task 15 one more time**

Same flow as Task 15 steps 2–10. Confirms nothing regressed between when the smoke test was run and the final state.

- [ ] **Step 5: Verify the git log shows the expected sequence of commits**

```bash
cd /Users/kennylee/Development/NeoApex
git log --oneline -20
```

Expected (most recent first):
1. `docs: document admindash backend and refresh stale references`
2. `feat(admindash/frontend): retarget all API calls to admindash-backend`
3. `feat: add admindash-backend to services.json and start-services.sh`
4. `feat(admindash/backend): FastAPI app entry point with all routes mounted`
5. `feat(admindash/backend): multipart extract proxy with streaming`
6. `feat(admindash/backend): entity CRUD proxy routes`
7. `feat(admindash/backend): /api/query proxy route`
8. `feat(admindash/backend): /auth/login and /auth/me proxy routes`
9. `feat(admindash/backend): health router (test red until app wired)`
10. `feat(admindash/backend): JWT validation dependency via DataCore /auth/me`
11. `feat(admindash/backend): config module with fail-closed production CORS`
12. `feat(admindash): scaffold backend Python project`

- [ ] **Step 6: Done — report completion**

The admindash-backend is working end-to-end locally. The next change (parked `deployment-pipeline`) can now treat it as a deployable Fly.io app.

---

## Self-Review Checklist

**Spec coverage** (against `openspec/changes/admindash-backend-api/specs/admindash-backend-api/spec.md`):

- ✅ Service runs on port 5610 — Task 1, 9, 10
- ✅ services.json + start-services.sh — Task 10
- ✅ Health endpoint — Task 4, 9
- ✅ Auth proxy endpoints (`/auth/login`, `/auth/me`) — Task 5
- ✅ JWT validation via DataCore for protected endpoints — Task 3
- ✅ Generic query proxy — Task 6
- ✅ Entity CRUD proxies (5 endpoints) — Task 7
- ✅ Document extract with multipart streaming — Task 8
- ✅ Configurable downstream URLs via env vars — Task 2 (config.py)
- ✅ CORS allowlist with fail-closed production — Task 2
- ✅ Downstream errors surfaced verbatim — Tasks 5, 6, 7 (verbatim Response pattern)
- ✅ Frontend calls only the new backend — Tasks 11–14
- ✅ Backend test suite — Tasks 2–8 (25 tests across 7 files)

**Placeholder scan:** No "TODO", "TBD", "implement later", "add error handling", "similar to Task N", or other placeholder phrases. Every code block contains complete code. Every command has expected output. Every commit has an exact message.

**Type consistency:**
- `require_authenticated_user` — defined in Task 3, used in Tasks 6, 7, 8 (consistent name)
- `ADMINDASH_API_URL` — exported from config.ts in Task 11, imported in Tasks 12, 13, 14 (consistent name)
- `_token` field on the user dict — set in Task 3 (`app/auth.py`), read in Tasks 6, 7, 8 (consistent key)
- `settings.datacore_url` and `settings.papermite_backend_url` — defined in Task 2, used in Tasks 3, 5, 6, 7, 8 (consistent attribute names)
- HTTP method strings in `_proxy_to_datacore` — `"POST"`, `"PUT"`, `"GET"` (matches `httpx.request(method, ...)` API)

No issues found.
