# Auth Consolidation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Consolidate authentication from LaunchPad, Papermite, and AdminDash into DataCore as the single auth server and token issuer.

**Architecture:** DataCore gains an `auth/` module and `/auth/*` API routes. All apps delegate login and token validation to DataCore. Cross-service navigation (LaunchPad ↔ Papermite) uses short-lived exchange codes instead of passing JWTs in URLs. Auth has a one-way dependency on storage (reads registry users); storage has zero awareness of auth.

**Tech Stack:** Python, FastAPI, PyJWT, bcrypt, React/TypeScript

**Spec:** `docs/superpowers/specs/2026-04-04-auth-consolidation-design.md`

---

### Task 1: Add auth dependencies to DataCore

**Files:**
- Modify: `datacore/pyproject.toml`

- [ ] **Step 1: Add PyJWT and bcrypt to dependencies**

```toml
dependencies = [
    "lancedb>=0.6",
    "pyarrow>=14.0",
    "duckdb>=0.10",
    "python-toon>=0.1",
    "fastapi>=0.115",
    "uvicorn>=0.34",
    "voyageai>=0.3",
    "pyjwt>=2.8",
    "bcrypt>=4.0",
]
```

- [ ] **Step 2: Install updated dependencies**

Run: `cd datacore && uv sync`
Expected: Dependencies install successfully

- [ ] **Step 3: Commit**

```bash
git add datacore/pyproject.toml datacore/uv.lock
git commit -m "chore(datacore): add pyjwt and bcrypt dependencies for auth"
```

---

### Task 2: Create DataCore auth config

**Files:**
- Create: `datacore/src/datacore/auth/__init__.py`
- Create: `datacore/src/datacore/auth/config.py`

- [ ] **Step 1: Create auth package init**

```python
"""Auth module — JWT token issuance, validation, and password hashing."""
```

- [ ] **Step 2: Create auth config**

```python
"""Auth configuration — JWT secret, expiry, loaded from environment."""
import os


class AuthConfig:
    def __init__(
        self,
        jwt_secret: str | None = None,
        jwt_expiry_hours: int | None = None,
    ):
        self.jwt_secret = jwt_secret or os.environ.get(
            "DATACORE_JWT_SECRET", "neoapex-dev-secret-change-in-prod"
        )
        self.jwt_expiry_hours = jwt_expiry_hours or int(
            os.environ.get("DATACORE_JWT_EXPIRY_HOURS", "24")
        )
```

- [ ] **Step 3: Commit**

```bash
git add datacore/src/datacore/auth/
git commit -m "feat(datacore): add auth config module"
```

---

### Task 3: Create password utilities

**Files:**
- Create: `datacore/src/datacore/auth/passwords.py`
- Create: `datacore/tests/test_auth_passwords.py`

- [ ] **Step 1: Write the failing test**

```python
"""Tests for auth password hashing and verification."""
from datacore.auth.passwords import hash_password, verify_password


def test_hash_and_verify():
    hashed = hash_password("secret123")
    assert hashed != "secret123"
    assert verify_password("secret123", hashed)


def test_wrong_password():
    hashed = hash_password("secret123")
    assert not verify_password("wrong", hashed)


def test_different_hashes_for_same_password():
    h1 = hash_password("secret123")
    h2 = hash_password("secret123")
    assert h1 != h2  # bcrypt uses random salt
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd datacore && python -m pytest tests/test_auth_passwords.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'datacore.auth.passwords'`

- [ ] **Step 3: Write implementation**

```python
"""Password hashing and verification using bcrypt."""
import bcrypt


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()


def verify_password(password: str, password_hash: str) -> bool:
    try:
        return bcrypt.checkpw(password.encode(), password_hash.encode())
    except ValueError:
        return False
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd datacore && python -m pytest tests/test_auth_passwords.py -v`
Expected: 3 passed

- [ ] **Step 5: Commit**

```bash
git add datacore/src/datacore/auth/passwords.py datacore/tests/test_auth_passwords.py
git commit -m "feat(datacore): add password hash/verify utilities"
```

---

### Task 4: Create token utilities

**Files:**
- Create: `datacore/src/datacore/auth/tokens.py`
- Create: `datacore/tests/test_auth_tokens.py`

- [ ] **Step 1: Write the failing test**

```python
"""Tests for JWT token creation and validation."""
import time

from datacore.auth.config import AuthConfig
from datacore.auth.tokens import create_token, decode_token, TokenError


def _config():
    return AuthConfig(jwt_secret="test-secret", jwt_expiry_hours=1)


def test_create_and_decode():
    cfg = _config()
    token = create_token(
        cfg,
        user_id="u-001",
        email="jane@acme.edu",
        tenant_id="acme",
        role="admin",
    )
    payload = decode_token(cfg, token)
    assert payload["user_id"] == "u-001"
    assert payload["email"] == "jane@acme.edu"
    assert payload["tenant_id"] == "acme"
    assert payload["role"] == "admin"
    assert "exp" in payload


def test_invalid_token_raises():
    cfg = _config()
    try:
        decode_token(cfg, "not-a-token")
        assert False, "Should have raised"
    except TokenError as e:
        assert "Invalid token" in str(e)


def test_wrong_secret_raises():
    cfg = _config()
    token = create_token(cfg, user_id="u-001", email="a@b.com", tenant_id="t", role="admin")
    other_cfg = AuthConfig(jwt_secret="other-secret")
    try:
        decode_token(other_cfg, token)
        assert False, "Should have raised"
    except TokenError as e:
        assert "Invalid token" in str(e)


def test_expired_token_raises():
    cfg = AuthConfig(jwt_secret="test-secret", jwt_expiry_hours=0)
    token = create_token(cfg, user_id="u-001", email="a@b.com", tenant_id="t", role="admin")
    # Token with 0-hour expiry is already expired
    try:
        decode_token(cfg, token)
        assert False, "Should have raised"
    except TokenError as e:
        assert "expired" in str(e).lower()
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd datacore && python -m pytest tests/test_auth_tokens.py -v`
Expected: FAIL with `ModuleNotFoundError`

- [ ] **Step 3: Write implementation**

```python
"""JWT token creation and validation."""
from datetime import datetime, timedelta, timezone

import jwt

from datacore.auth.config import AuthConfig


class TokenError(Exception):
    """Raised when a token is invalid or expired."""


def create_token(
    config: AuthConfig,
    user_id: str,
    email: str,
    tenant_id: str,
    role: str,
) -> str:
    payload = {
        "user_id": user_id,
        "email": email,
        "tenant_id": tenant_id,
        "role": role,
        "exp": datetime.now(timezone.utc) + timedelta(hours=config.jwt_expiry_hours),
    }
    return jwt.encode(payload, config.jwt_secret, algorithm="HS256")


def decode_token(config: AuthConfig, token: str) -> dict:
    try:
        return jwt.decode(token, config.jwt_secret, algorithms=["HS256"])
    except jwt.ExpiredSignatureError:
        raise TokenError("Token expired")
    except jwt.InvalidTokenError:
        raise TokenError("Invalid token")
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd datacore && python -m pytest tests/test_auth_tokens.py -v`
Expected: 4 passed

- [ ] **Step 5: Commit**

```bash
git add datacore/src/datacore/auth/tokens.py datacore/tests/test_auth_tokens.py
git commit -m "feat(datacore): add JWT token create/decode utilities"
```

---

### Task 5: Create exchange code store

**Files:**
- Create: `datacore/src/datacore/auth/exchange.py`
- Create: `datacore/tests/test_auth_exchange.py`

- [ ] **Step 1: Write the failing test**

```python
"""Tests for exchange code creation and redemption."""
import time

from datacore.auth.exchange import ExchangeStore


def test_create_and_redeem():
    store = ExchangeStore(ttl_seconds=30)
    code = store.create("token-abc")
    assert isinstance(code, str)
    assert len(code) > 0
    token = store.redeem(code)
    assert token == "token-abc"


def test_redeem_is_single_use():
    store = ExchangeStore(ttl_seconds=30)
    code = store.create("token-abc")
    store.redeem(code)
    assert store.redeem(code) is None


def test_invalid_code_returns_none():
    store = ExchangeStore(ttl_seconds=30)
    assert store.redeem("nonexistent") is None


def test_expired_code_returns_none():
    store = ExchangeStore(ttl_seconds=0)
    code = store.create("token-abc")
    # TTL=0 means immediately expired
    time.sleep(0.01)
    assert store.redeem(code) is None


def test_cleanup_removes_expired():
    store = ExchangeStore(ttl_seconds=0)
    store.create("token-a")
    store.create("token-b")
    time.sleep(0.01)
    store.cleanup()
    assert len(store._codes) == 0
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd datacore && python -m pytest tests/test_auth_exchange.py -v`
Expected: FAIL with `ModuleNotFoundError`

- [ ] **Step 3: Write implementation**

```python
"""In-memory exchange code store for cross-service token handoff."""
import secrets
import time


class ExchangeStore:
    def __init__(self, ttl_seconds: int = 30):
        self.ttl_seconds = ttl_seconds
        self._codes: dict[str, tuple[str, float]] = {}  # code -> (token, expires_at)

    def create(self, token: str) -> str:
        code = secrets.token_urlsafe(32)
        expires_at = time.monotonic() + self.ttl_seconds
        self._codes[code] = (token, expires_at)
        return code

    def redeem(self, code: str) -> str | None:
        entry = self._codes.pop(code, None)
        if entry is None:
            return None
        token, expires_at = entry
        if time.monotonic() > expires_at:
            return None
        return token

    def cleanup(self) -> None:
        now = time.monotonic()
        expired = [k for k, (_, exp) in self._codes.items() if now > exp]
        for k in expired:
            del self._codes[k]
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd datacore && python -m pytest tests/test_auth_exchange.py -v`
Expected: 5 passed

- [ ] **Step 5: Commit**

```bash
git add datacore/src/datacore/auth/exchange.py datacore/tests/test_auth_exchange.py
git commit -m "feat(datacore): add exchange code store for cross-service auth"
```

---

### Task 6: Create DataCore auth API routes

**Files:**
- Create: `datacore/src/datacore/api/auth_routes.py`
- Create: `datacore/tests/test_auth_api.py`

This task creates the `/auth/*` endpoints on DataCore. The routes read users from the global registry table via `Store.get_global` / `Store.query_global` — the same methods LaunchPad's `RegistryStore` uses internally.

- [ ] **Step 1: Write the failing tests**

```python
"""Tests for DataCore auth API endpoints."""
import tempfile

import pytest
from fastapi.testclient import TestClient
from unittest.mock import MagicMock

from datacore import Store
from datacore.api import create_app
from datacore.auth.passwords import hash_password


@pytest.fixture
def auth_client():
    with tempfile.TemporaryDirectory() as tmp:
        mock_embedder = MagicMock()
        mock_embedder.embed.return_value = [0.0] * 1024
        store = Store(data_dir=tmp, embedder=mock_embedder)

        # Seed a test user in the global registry table
        store.put_global("registry", "user:u-001", {
            "user_id": "u-001",
            "name": "Jane Admin",
            "email": "jane@acme.edu",
            "password_hash": hash_password("admin123"),
            "tenant_id": "acme",
            "tenant_name": "Acme Afterschool",
            "role": "admin",
            "created_at": "2026-01-01T00:00:00+00:00",
        })
        app = create_app(store)
        yield TestClient(app), store


def test_login_success(auth_client):
    client, _ = auth_client
    resp = client.post("/auth/login", json={"email": "jane@acme.edu", "password": "admin123"})
    assert resp.status_code == 200
    data = resp.json()
    assert "token" in data
    assert data["user"]["email"] == "jane@acme.edu"
    assert "password_hash" not in data["user"]


def test_login_wrong_password(auth_client):
    client, _ = auth_client
    resp = client.post("/auth/login", json={"email": "jane@acme.edu", "password": "wrong"})
    assert resp.status_code == 401


def test_login_unknown_email(auth_client):
    client, _ = auth_client
    resp = client.post("/auth/login", json={"email": "nobody@acme.edu", "password": "admin123"})
    assert resp.status_code == 401


def test_me_with_valid_token(auth_client):
    client, _ = auth_client
    login_resp = client.post("/auth/login", json={"email": "jane@acme.edu", "password": "admin123"})
    token = login_resp.json()["token"]
    resp = client.get("/auth/me", headers={"Authorization": f"Bearer {token}"})
    assert resp.status_code == 200
    assert resp.json()["email"] == "jane@acme.edu"
    assert "password_hash" not in resp.json()


def test_me_without_token(auth_client):
    client, _ = auth_client
    resp = client.get("/auth/me")
    assert resp.status_code == 401


def test_me_with_invalid_token(auth_client):
    client, _ = auth_client
    resp = client.get("/auth/me", headers={"Authorization": "Bearer bad-token"})
    assert resp.status_code == 401


def test_exchange_and_redeem(auth_client):
    client, _ = auth_client
    # Login first
    login_resp = client.post("/auth/login", json={"email": "jane@acme.edu", "password": "admin123"})
    token = login_resp.json()["token"]

    # Exchange token for code
    exchange_resp = client.post(
        "/auth/exchange-code",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert exchange_resp.status_code == 200
    code = exchange_resp.json()["code"]

    # Redeem code for token
    redeem_resp = client.post("/auth/redeem-code", json={"code": code})
    assert redeem_resp.status_code == 200
    assert "token" in redeem_resp.json()

    # Verify redeemed token works
    me_resp = client.get(
        "/auth/me",
        headers={"Authorization": f"Bearer {redeem_resp.json()['token']}"},
    )
    assert me_resp.status_code == 200
    assert me_resp.json()["email"] == "jane@acme.edu"


def test_redeem_code_single_use(auth_client):
    client, _ = auth_client
    login_resp = client.post("/auth/login", json={"email": "jane@acme.edu", "password": "admin123"})
    token = login_resp.json()["token"]
    exchange_resp = client.post(
        "/auth/exchange-code",
        headers={"Authorization": f"Bearer {token}"},
    )
    code = exchange_resp.json()["code"]

    # First redeem succeeds
    client.post("/auth/redeem-code", json={"code": code})
    # Second redeem fails
    resp = client.post("/auth/redeem-code", json={"code": code})
    assert resp.status_code == 401


def test_redeem_invalid_code(auth_client):
    client, _ = auth_client
    resp = client.post("/auth/redeem-code", json={"code": "nonexistent"})
    assert resp.status_code == 401
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd datacore && python -m pytest tests/test_auth_api.py -v`
Expected: FAIL with `ImportError` (auth_routes not registered yet)

- [ ] **Step 3: Write auth routes implementation**

```python
"""Auth API routes — login, token validation, exchange codes."""
from fastapi import APIRouter, HTTPException, Header
from pydantic import BaseModel

from datacore.auth.config import AuthConfig
from datacore.auth.exchange import ExchangeStore
from datacore.auth.passwords import verify_password
from datacore.auth.tokens import TokenError, create_token, decode_token
from datacore.store import Store

router = APIRouter(prefix="/auth", tags=["auth"])

# Module-level state, initialized by register_auth_routes()
_store: Store | None = None
_config: AuthConfig | None = None
_exchange: ExchangeStore | None = None

REGISTRY_TABLE = "registry"


class LoginRequest(BaseModel):
    email: str
    password: str


class RedeemRequest(BaseModel):
    code: str


def register_auth_routes(app, store: Store, config: AuthConfig | None = None) -> None:
    """Register auth routes and bind to the given store."""
    global _store, _config, _exchange
    _store = store
    _config = config or AuthConfig()
    _exchange = ExchangeStore(ttl_seconds=30)
    app.include_router(router)


def _get_user_by_email(email: str) -> dict | None:
    results = _store.query_global(REGISTRY_TABLE)
    for row in results:
        if not row["record_key"].startswith("user:"):
            continue
        if row["data"].get("email", "").lower() == email.lower():
            return row["data"]
    return None


def _get_user_by_id(user_id: str) -> dict | None:
    result = _store.get_global(REGISTRY_TABLE, f"user:{user_id}")
    if not result:
        return None
    return result["data"]


def _sanitize_user(user_data: dict) -> dict:
    """Return user data without password_hash."""
    return {k: v for k, v in user_data.items() if k != "password_hash"}


def _extract_bearer_token(authorization: str) -> str:
    if not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Invalid authorization header")
    return authorization[7:]


@router.post("/login")
def login(req: LoginRequest):
    user = _get_user_by_email(req.email)
    if not user or not verify_password(req.password, user["password_hash"]):
        raise HTTPException(status_code=401, detail="Invalid credentials")
    token = create_token(
        _config,
        user_id=user["user_id"],
        email=user["email"],
        tenant_id=user["tenant_id"],
        role=user["role"],
    )
    return {"token": token, "user": _sanitize_user(user)}


@router.get("/me")
def get_me(authorization: str = Header(None)):
    if not authorization:
        raise HTTPException(status_code=401, detail="Missing authorization header")
    token = _extract_bearer_token(authorization)
    try:
        payload = decode_token(_config, token)
    except TokenError as e:
        raise HTTPException(status_code=401, detail=str(e))
    user = _get_user_by_id(payload["user_id"])
    if not user:
        raise HTTPException(status_code=401, detail="User not found")
    return _sanitize_user(user)


@router.post("/exchange-code")
def exchange_code(authorization: str = Header(None)):
    if not authorization:
        raise HTTPException(status_code=401, detail="Missing authorization header")
    token = _extract_bearer_token(authorization)
    try:
        decode_token(_config, token)
    except TokenError as e:
        raise HTTPException(status_code=401, detail=str(e))
    code = _exchange.create(token)
    return {"code": code}


@router.post("/redeem-code")
def redeem_code(req: RedeemRequest):
    token = _exchange.redeem(req.code)
    if token is None:
        raise HTTPException(status_code=401, detail="Invalid or expired code")
    return {"token": token}
```

- [ ] **Step 4: Register auth routes in create_app**

Modify `datacore/src/datacore/api/__init__.py`:

```python
"""FastAPI REST API layer for datacore."""

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from datacore.store import Store
from datacore.api.routes import register_routes
from datacore.api.auth_routes import register_auth_routes


def create_app(store: Store) -> FastAPI:
    """Create and configure the FastAPI application."""
    app = FastAPI(title="datacore")

    app.add_middleware(
        CORSMiddleware,
        allow_origins=[
            "http://localhost:5173",
            "http://localhost:5174",
        ],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    register_routes(app, store)
    register_auth_routes(app, store)

    return app
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd datacore && python -m pytest tests/test_auth_api.py -v`
Expected: 9 passed

- [ ] **Step 6: Run all existing DataCore tests to verify no regressions**

Run: `cd datacore && python -m pytest tests/ -v`
Expected: All tests pass

- [ ] **Step 7: Commit**

```bash
git add datacore/src/datacore/api/auth_routes.py datacore/src/datacore/api/__init__.py datacore/tests/test_auth_api.py
git commit -m "feat(datacore): add auth API routes — login, me, exchange-code, redeem-code"
```

---

### Task 7: Add registration endpoints to DataCore auth

**Files:**
- Modify: `datacore/src/datacore/api/auth_routes.py`
- Create: `datacore/tests/test_auth_registration.py`

These endpoints move the registration flow from LaunchPad into DataCore.

- [ ] **Step 1: Write the failing tests**

```python
"""Tests for DataCore auth registration endpoints."""
import tempfile

import pytest
from fastapi.testclient import TestClient
from unittest.mock import MagicMock

from datacore import Store
from datacore.api import create_app
from datacore.auth.passwords import hash_password


@pytest.fixture
def reg_client():
    with tempfile.TemporaryDirectory() as tmp:
        mock_embedder = MagicMock()
        mock_embedder.embed.return_value = [0.0] * 1024
        store = Store(data_dir=tmp, embedder=mock_embedder)
        app = create_app(store)
        yield TestClient(app), store


def test_register_creates_user(reg_client):
    client, _ = reg_client
    resp = client.post("/auth/register", json={
        "name": "Jane Admin",
        "email": "jane@acme.edu",
        "password": "admin123",
        "tenant_name": "Acme Afterschool",
        "tenant_id": "acme",
    })
    assert resp.status_code == 200
    data = resp.json()
    assert "token" in data
    assert data["user"]["email"] == "jane@acme.edu"
    assert data["user"]["role"] == "admin"
    assert "password_hash" not in data["user"]


def test_register_duplicate_email(reg_client):
    client, store = reg_client
    store.put_global("registry", "user:u-001", {
        "user_id": "u-001",
        "name": "Jane",
        "email": "jane@acme.edu",
        "password_hash": hash_password("pw"),
        "tenant_id": "acme",
        "tenant_name": "Acme",
        "role": "admin",
        "created_at": "2026-01-01T00:00:00+00:00",
    })
    resp = client.post("/auth/register", json={
        "name": "Jane 2",
        "email": "jane@acme.edu",
        "password": "pw2",
        "tenant_name": "Other",
        "tenant_id": "other",
    })
    assert resp.status_code == 409


def test_register_duplicate_tenant_id(reg_client):
    client, store = reg_client
    # Create onboarding record to mark tenant ID as taken
    store.put_global("registry", "onboarding:acme", {
        "tenant_id": "acme",
        "steps": [],
        "is_complete": False,
    })
    resp = client.post("/auth/register", json={
        "name": "Jane",
        "email": "jane@acme.edu",
        "password": "pw",
        "tenant_name": "Acme",
        "tenant_id": "acme",
    })
    assert resp.status_code == 409


def test_register_invalid_tenant_id(reg_client):
    client, _ = reg_client
    resp = client.post("/auth/register", json={
        "name": "Jane",
        "email": "jane@acme.edu",
        "password": "pw",
        "tenant_name": "Acme",
        "tenant_id": "AB",  # too short, uppercase
    })
    assert resp.status_code == 422


def test_check_email_new_tenant(reg_client):
    client, _ = reg_client
    resp = client.post("/auth/register/check-email", json={"email": "jane@acme.edu"})
    assert resp.status_code == 200
    assert resp.json()["status"] == "new_tenant"


def test_check_email_common_provider(reg_client):
    client, _ = reg_client
    resp = client.post("/auth/register/check-email", json={"email": "jane@gmail.com"})
    assert resp.status_code == 200
    assert resp.json()["status"] == "new_tenant"


def test_check_email_org_exists(reg_client):
    client, store = reg_client
    store.put_global("registry", "user:u-001", {
        "user_id": "u-001",
        "name": "Jane",
        "email": "jane@acme.edu",
        "password_hash": hash_password("pw"),
        "tenant_id": "acme",
        "tenant_name": "Acme",
        "role": "admin",
        "created_at": "2026-01-01T00:00:00+00:00",
    })
    resp = client.post("/auth/register/check-email", json={"email": "bob@acme.edu"})
    assert resp.status_code == 200
    assert resp.json()["status"] == "org_exists"
    assert resp.json()["admin_email_hint"] is not None


def test_suggest_ids(reg_client):
    client, _ = reg_client
    resp = client.post("/auth/register/suggest-ids", json={
        "email": "jane@acme.edu",
        "tenant_name": "Acme Afterschool",
    })
    assert resp.status_code == 200
    assert len(resp.json()["suggestions"]) > 0
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd datacore && python -m pytest tests/test_auth_registration.py -v`
Expected: FAIL — endpoints don't exist yet

- [ ] **Step 3: Add registration models and helpers to auth_routes.py**

Add the following to the end of `datacore/src/datacore/api/auth_routes.py`:

```python
import re
import uuid
from datetime import datetime, timezone

from datacore.auth.passwords import hash_password as _hash_password

VALID_ROLES = {"admin", "staff", "teacher", "parent"}
TENANT_ID_PATTERN = re.compile(r"^[a-z][a-z0-9-]{2,39}$")
COMMON_EMAIL_PROVIDERS = frozenset({
    "gmail.com", "yahoo.com", "hotmail.com", "outlook.com",
    "icloud.com", "protonmail.com", "aol.com", "mail.com", "zoho.com",
    "live.com", "msn.com", "ymail.com",
})

ONBOARDING_STEPS = [
    {"id": "model_setup", "label": "Set Up Model", "completed": False},
    {"id": "tenant_details", "label": "Tenant Details", "completed": False},
]


class RegisterRequest(BaseModel):
    name: str
    email: str
    password: str
    tenant_name: str
    tenant_id: str


class CheckEmailRequest(BaseModel):
    email: str


class SuggestIdsRequest(BaseModel):
    email: str
    tenant_name: str


def _mask_email(email: str) -> str:
    local, domain = email.split("@")
    return f"{local[0]}***@{domain}"


def _generate_slug_candidates(email: str, tenant_name: str) -> list[str]:
    domain = email.split("@")[-1].lower()
    is_common = domain in COMMON_EMAIL_PROVIDERS
    words = re.sub(r"[^a-z0-9]+", " ", tenant_name.lower()).split()
    candidates = []

    if not is_common:
        stem = domain.split(".")[0]
        if stem and TENANT_ID_PATTERN.match(stem):
            candidates.append(stem)

    if len(words) >= 2:
        slug = f"{words[0]}-{words[1]}"
        if TENANT_ID_PATTERN.match(slug):
            candidates.append(slug)

    if len(words) >= 2:
        initials = "-".join([words[0], "".join(w[0] for w in words[1:])])
        if TENANT_ID_PATTERN.match(initials):
            candidates.append(initials)

    if len(words) >= 2:
        rev = f"{words[1]}-{words[0]}"
        if TENANT_ID_PATTERN.match(rev):
            candidates.append(rev)

    full = "-".join(words)
    if TENANT_ID_PATTERN.match(full) and full not in candidates:
        candidates.append(full)

    seen = set()
    unique = []
    for c in candidates:
        if c not in seen:
            seen.add(c)
            unique.append(c)
    return unique


def _get_onboarding(tenant_id: str) -> dict | None:
    result = _store.get_global(REGISTRY_TABLE, f"onboarding:{tenant_id}")
    if not result:
        return None
    return result["data"]


def _get_users_by_email_domain(domain: str) -> list[dict]:
    results = _store.query_global(REGISTRY_TABLE)
    users = []
    for row in results:
        if not row["record_key"].startswith("user:"):
            continue
        email = row["data"].get("email", "")
        if email.split("@")[-1].lower() == domain.lower():
            users.append(row["data"])
    return users


@router.post("/register")
def register(req: RegisterRequest):
    if not TENANT_ID_PATTERN.match(req.tenant_id):
        raise HTTPException(
            status_code=422,
            detail="Invalid tenant ID format. Must be 3-40 lowercase alphanumeric characters and hyphens, starting with a letter.",
        )
    if _get_onboarding(req.tenant_id) is not None:
        raise HTTPException(status_code=409, detail="Tenant ID already taken")
    if _get_user_by_email(req.email):
        raise HTTPException(status_code=409, detail="Email already registered")

    user_id = f"u-{uuid.uuid4().hex[:8]}"
    now = datetime.now(timezone.utc).isoformat()
    user_data = {
        "user_id": user_id,
        "name": req.name,
        "email": req.email.lower(),
        "password_hash": _hash_password(req.password),
        "tenant_id": req.tenant_id,
        "tenant_name": req.tenant_name,
        "role": "admin",
        "created_at": now,
    }
    _store.put_global(REGISTRY_TABLE, f"user:{user_id}", user_data)

    # Create onboarding record
    import copy
    onboarding = {
        "tenant_id": req.tenant_id,
        "steps": copy.deepcopy(ONBOARDING_STEPS),
        "is_complete": False,
    }
    _store.put_global(REGISTRY_TABLE, f"onboarding:{req.tenant_id}", onboarding)

    token = create_token(
        _config,
        user_id=user_data["user_id"],
        email=user_data["email"],
        tenant_id=user_data["tenant_id"],
        role=user_data["role"],
    )
    return {"token": token, "user": _sanitize_user(user_data)}


@router.post("/register/check-email")
def check_email(req: CheckEmailRequest):
    domain = req.email.split("@")[-1].lower()
    if domain in COMMON_EMAIL_PROVIDERS:
        return {"status": "new_tenant", "admin_email_hint": None}
    users = _get_users_by_email_domain(domain)
    admins = [u for u in users if u.get("role") == "admin"]
    if admins:
        return {
            "status": "org_exists",
            "admin_email_hint": _mask_email(admins[0]["email"]),
        }
    return {"status": "new_tenant", "admin_email_hint": None}


@router.post("/register/suggest-ids")
def suggest_ids(req: SuggestIdsRequest):
    candidates = _generate_slug_candidates(req.email, req.tenant_name)
    available = [c for c in candidates if _get_onboarding(c) is None]
    return {"suggestions": available}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd datacore && python -m pytest tests/test_auth_registration.py -v`
Expected: 8 passed

- [ ] **Step 5: Run all DataCore tests**

Run: `cd datacore && python -m pytest tests/ -v`
Expected: All tests pass

- [ ] **Step 6: Commit**

```bash
git add datacore/src/datacore/api/auth_routes.py datacore/tests/test_auth_registration.py
git commit -m "feat(datacore): add registration endpoints to auth API"
```

---

### Task 8: Add seed script to DataCore

**Files:**
- Create: `datacore/src/datacore/auth/seed.py`
- Create: `datacore/tests/test_auth_seed.py`

- [ ] **Step 1: Write the failing test**

```python
"""Tests for auth seed data."""
import tempfile
from unittest.mock import MagicMock

from datacore import Store
from datacore.auth.seed import seed_test_user
from datacore.auth.passwords import verify_password


def test_seed_creates_user():
    with tempfile.TemporaryDirectory() as tmp:
        mock_embedder = MagicMock()
        mock_embedder.embed.return_value = [0.0] * 1024
        store = Store(data_dir=tmp, embedder=mock_embedder)
        seed_test_user(store)

        result = store.get_global("registry", "user:u-001")
        assert result is not None
        assert result["data"]["email"] == "jane@acme.edu"
        assert result["data"]["role"] == "admin"
        assert verify_password("admin123", result["data"]["password_hash"])


def test_seed_is_idempotent():
    with tempfile.TemporaryDirectory() as tmp:
        mock_embedder = MagicMock()
        mock_embedder.embed.return_value = [0.0] * 1024
        store = Store(data_dir=tmp, embedder=mock_embedder)
        seed_test_user(store)
        seed_test_user(store)  # Should not raise

        result = store.get_global("registry", "user:u-001")
        assert result is not None
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd datacore && python -m pytest tests/test_auth_seed.py -v`
Expected: FAIL with `ModuleNotFoundError`

- [ ] **Step 3: Write implementation**

```python
"""Seed test user into the DataCore registry for development."""
from datacore.auth.passwords import hash_password
from datacore.store import Store

REGISTRY_TABLE = "registry"


def seed_test_user(store: Store) -> None:
    """Create the default test user if not already present."""
    existing = store.get_global(REGISTRY_TABLE, "user:u-001")
    if existing is not None:
        return

    store.put_global(REGISTRY_TABLE, "user:u-001", {
        "user_id": "u-001",
        "name": "Jane Admin",
        "email": "jane@acme.edu",
        "password_hash": hash_password("admin123"),
        "tenant_id": "acme",
        "tenant_name": "Acme Afterschool",
        "role": "admin",
        "created_at": "2026-01-01T00:00:00+00:00",
    })
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd datacore && python -m pytest tests/test_auth_seed.py -v`
Expected: 2 passed

- [ ] **Step 5: Commit**

```bash
git add datacore/src/datacore/auth/seed.py datacore/tests/test_auth_seed.py
git commit -m "feat(datacore): add seed script for test user"
```

---

### Task 9: Update LaunchPad backend to delegate auth to DataCore

**Files:**
- Modify: `launchpad/backend/app/api/auth.py`
- Modify: `launchpad/backend/app/config.py`

LaunchPad's auth.py keeps `require_role()` but replaces all token logic with HTTP calls to DataCore. Login/register/check-email/suggest-ids routes become thin proxies to DataCore. `get_current_user()` calls DataCore's `GET /auth/me`.

- [ ] **Step 1: Update LaunchPad config — remove JWT secret, add DataCore auth URL**

Replace `launchpad/backend/app/config.py`:

```python
"""Launchpad configuration — settings and datacore path."""
import os
from pathlib import Path
from pydantic_settings import BaseSettings

class Settings(BaseSettings):
    datacore_auth_url: str = "http://localhost:8081/auth"
    datacore_store_path: Path = Path(os.environ.get(
        "NEOAPEX_LANCEDB_DIR",
        str(Path(__file__).resolve().parent.parent.parent.parent
            / "datacore" / "data" / "lancedb"),
    ))
    papermite_url: str = "http://localhost:5173"
    port: int = 8001
    model_config = {"env_prefix": "LAUNCHPAD_"}

settings = Settings()
```

- [ ] **Step 2: Rewrite LaunchPad auth.py**

Replace `launchpad/backend/app/api/auth.py`:

```python
"""Auth endpoints and dependencies — delegates to DataCore auth service."""
import httpx
from fastapi import APIRouter, Depends, Header, HTTPException
from pydantic import BaseModel

from app.config import settings

router = APIRouter()


# ─── FastAPI dependencies ──────────────────────────────────────

def get_current_user(authorization: str = Header(...)):
    """Validate token by calling DataCore auth service."""
    if not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Invalid authorization header")
    resp = httpx.get(
        f"{settings.datacore_auth_url}/me",
        headers={"Authorization": authorization},
    )
    if resp.status_code != 200:
        raise HTTPException(status_code=401, detail="Invalid or expired token")
    return resp.json()


def require_role(*roles: str):
    """Factory for role-checking dependencies."""
    def dependency(user=Depends(get_current_user)):
        if user["role"] not in roles:
            raise HTTPException(status_code=403, detail=f"Requires one of: {', '.join(roles)}")
        return user
    return dependency


# ─── Request models ──────────────────────────────────────────

class LoginRequest(BaseModel):
    email: str
    password: str

class RegisterRequest(BaseModel):
    name: str
    email: str
    password: str
    tenant_name: str
    tenant_id: str

class CheckEmailRequest(BaseModel):
    email: str

class SuggestIdsRequest(BaseModel):
    email: str
    tenant_name: str


# ─── Routes (proxy to DataCore) ──────────────────────────────

@router.post("/login")
def login(req: LoginRequest):
    resp = httpx.post(
        f"{settings.datacore_auth_url}/login",
        json=req.model_dump(),
    )
    if resp.status_code != 200:
        raise HTTPException(status_code=resp.status_code, detail=resp.json().get("detail", "Login failed"))
    return resp.json()


@router.post("/register")
def register(req: RegisterRequest):
    resp = httpx.post(
        f"{settings.datacore_auth_url}/register",
        json=req.model_dump(),
    )
    if resp.status_code != 200:
        raise HTTPException(status_code=resp.status_code, detail=resp.json().get("detail", "Registration failed"))
    return resp.json()


@router.post("/register/check-email")
def check_email(req: CheckEmailRequest):
    resp = httpx.post(
        f"{settings.datacore_auth_url}/register/check-email",
        json=req.model_dump(),
    )
    if resp.status_code != 200:
        raise HTTPException(status_code=resp.status_code, detail=resp.json().get("detail", "Check failed"))
    return resp.json()


@router.post("/register/suggest-ids")
def suggest_ids(req: SuggestIdsRequest):
    resp = httpx.post(
        f"{settings.datacore_auth_url}/register/suggest-ids",
        json=req.model_dump(),
    )
    if resp.status_code != 200:
        raise HTTPException(status_code=resp.status_code, detail=resp.json().get("detail", "Suggest failed"))
    return resp.json()


@router.get("/me")
def get_me(user=Depends(get_current_user)):
    return user


@router.post("/exchange-code")
def exchange_code(authorization: str = Header(...)):
    """Get an exchange code for cross-service navigation."""
    resp = httpx.post(
        f"{settings.datacore_auth_url}/exchange-code",
        headers={"Authorization": authorization},
    )
    if resp.status_code != 200:
        raise HTTPException(status_code=resp.status_code, detail=resp.json().get("detail", "Exchange failed"))
    return resp.json()
```

- [ ] **Step 3: Add httpx dependency to LaunchPad**

Check `launchpad/backend/pyproject.toml` (or `requirements.txt`) and add `httpx>=0.28` to dependencies. Install with `pip install httpx`.

- [ ] **Step 4: Verify LaunchPad backend starts**

Run: `cd launchpad/backend && python -c "from app.main import app; print('OK')"`
Expected: `OK`

- [ ] **Step 5: Commit**

```bash
git add launchpad/backend/app/api/auth.py launchpad/backend/app/config.py
git commit -m "refactor(launchpad): delegate auth to DataCore auth service"
```

---

### Task 10: Update LaunchPad frontend to use standardized token key

**Files:**
- Modify: `launchpad/frontend/src/api/client.ts`

- [ ] **Step 1: Update token key and verify login/register still point to LaunchPad backend**

In `launchpad/frontend/src/api/client.ts`, change:

```typescript
const TOKEN_KEY = "launchpad_token";
```

to:

```typescript
const TOKEN_KEY = "neoapex_token";
```

- [ ] **Step 2: Commit**

```bash
git add launchpad/frontend/src/api/client.ts
git commit -m "refactor(launchpad): standardize token key to neoapex_token"
```

---

### Task 11: Update Papermite backend to delegate auth to DataCore

**Files:**
- Modify: `papermite/backend/app/api/auth.py`
- Modify: `papermite/backend/app/config.py`

- [ ] **Step 1: Update Papermite config — remove JWT secrets, add DataCore auth URL**

Replace `papermite/backend/app/config.py`:

```python
import os
from pathlib import Path
from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    datacore_auth_url: str = "http://localhost:8081/auth"
    default_model: str = "anthropic:claude-haiku-4-5-20251001"
    available_models: list[str] = [
        "anthropic:claude-haiku-4-5-20251001",
        "anthropic:claude-sonnet-4-6",
        "openai:gpt-4.1",
        "openai:gpt-5",
        "ollama:llama3.2",
    ]
    upload_dir: Path = Path(__file__).parent.parent / "uploads"
    lancedb_dir: Path = Path(os.environ.get(
        "NEOAPEX_LANCEDB_DIR",
        str(Path(__file__).resolve().parent.parent.parent.parent / "datacore" / "data" / "lancedb"),
    ))

    model_config = {"env_prefix": "PAPERMITE_"}


settings = Settings()
```

- [ ] **Step 2: Rewrite Papermite auth.py**

Replace `papermite/backend/app/api/auth.py`:

```python
"""Auth dependencies — delegates token validation to DataCore auth service."""
import httpx
from fastapi import APIRouter, Depends, Header, HTTPException
from pydantic import BaseModel

from app.config import settings
from app.models.registry import UserRecord

router = APIRouter()


# ─── FastAPI dependencies ──────────────────────────────────────

def get_current_user(authorization: str = Header(...)) -> UserRecord:
    """Validate token by calling DataCore auth service."""
    if not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Invalid authorization header")
    resp = httpx.get(
        f"{settings.datacore_auth_url}/me",
        headers={"Authorization": authorization},
    )
    if resp.status_code != 200:
        raise HTTPException(status_code=401, detail="Invalid or expired token")
    data = resp.json()
    return UserRecord(
        user_id=data["user_id"],
        name=data["name"],
        email=data["email"],
        password_hash="",
        tenant_id=data["tenant_id"],
        tenant_name=data["tenant_name"],
        role=data["role"],
        created_at=data.get("created_at", ""),
    )


def require_admin(user: UserRecord = Depends(get_current_user)) -> UserRecord:
    """Verify the current user has admin role."""
    if user.role != "admin":
        raise HTTPException(status_code=403, detail="Requires admin role")
    return user


# ─── Routes ────────────────────────────────────────────────────

class LoginRequest(BaseModel):
    email: str
    password: str


@router.post("/login")
def login(req: LoginRequest):
    """Proxy login to DataCore auth service."""
    resp = httpx.post(
        f"{settings.datacore_auth_url}/login",
        json=req.model_dump(),
    )
    if resp.status_code != 200:
        raise HTTPException(status_code=resp.status_code, detail=resp.json().get("detail", "Login failed"))
    return resp.json()


@router.post("/redeem-code")
def redeem_code(code: str):
    """Redeem an exchange code from LaunchPad for a token."""
    resp = httpx.post(
        f"{settings.datacore_auth_url}/redeem-code",
        json={"code": code},
    )
    if resp.status_code != 200:
        raise HTTPException(status_code=resp.status_code, detail=resp.json().get("detail", "Invalid code"))
    return resp.json()


@router.get("/me")
def get_me(user: UserRecord = Depends(get_current_user)):
    """Return the authenticated user's profile."""
    user_data = user.model_dump()
    del user_data["password_hash"]
    return user_data
```

- [ ] **Step 3: Add httpx dependency to Papermite**

Check Papermite's dependencies and add `httpx>=0.28`. Install with `pip install httpx`.

- [ ] **Step 4: Verify Papermite backend starts**

Run: `cd papermite/backend && python -c "from app.main import app; print('OK')"`
Expected: `OK`

- [ ] **Step 5: Commit**

```bash
git add papermite/backend/app/api/auth.py papermite/backend/app/config.py
git commit -m "refactor(papermite): delegate auth to DataCore auth service"
```

---

### Task 12: Update Papermite frontend — standardize token key, use exchange codes

**Files:**
- Modify: `papermite/frontend/src/api/client.ts`

- [ ] **Step 1: Update token key and replace external token handler with exchange code handler**

In `papermite/frontend/src/api/client.ts`, make these changes:

Change token key:
```typescript
const TOKEN_KEY = "neoapex_token";
```

Replace `setExternalToken`:
```typescript
/**
 * Redeem an exchange code received via URL param for a real token.
 */
export async function redeemExchangeCode(code: string): Promise<string> {
  const res = await fetch(`${BASE_URL}/redeem-code`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code }),
  });
  if (!res.ok) throw new Error("Failed to redeem code");
  const data = await res.json();
  storeToken(data.token);
  return data.token;
}
```

- [ ] **Step 2: Update App.tsx to handle `?code=` instead of `?token=`**

In `papermite/frontend/src/App.tsx`, find the code that reads `?token=` from the URL and replace it to read `?code=` and call `redeemExchangeCode(code)` instead of `setExternalToken(token)`. Clean the URL param after redemption.

- [ ] **Step 3: Commit**

```bash
git add papermite/frontend/src/api/client.ts papermite/frontend/src/App.tsx
git commit -m "refactor(papermite): use exchange codes and standardize token key"
```

---

### Task 13: Rewrite AdminDash AuthContext for real auth

**Files:**
- Modify: `admindash/frontend/src/contexts/AuthContext.tsx`
- Modify: `admindash/frontend/src/types/models.ts`
- Modify: `admindash/frontend/src/pages/LoginPage.tsx`
- Modify: `admindash/frontend/src/i18n/translations.ts`

- [ ] **Step 1: Update TestUser type — remove username/password, it's now a server-side user**

In `admindash/frontend/src/types/models.ts`, replace the `TestUser` interface:

```typescript
export interface TestUser {
  user_id: string;
  name: string;
  email: string;
  tenant_id: string;
  tenant_name: string;
  role: string;
}
```

- [ ] **Step 2: Rewrite AuthContext to use DataCore auth**

Replace `admindash/frontend/src/contexts/AuthContext.tsx`:

```typescript
import { createContext, useContext, useState, useCallback, useEffect, type ReactNode } from 'react';
import type { TestUser } from '../types/models.ts';

const DATACORE_AUTH_URL = 'http://localhost:8081/auth';
const TOKEN_KEY = 'neoapex_token';

interface AuthState {
  user: TestUser | null;
  login: (email: string, password: string) => Promise<boolean>;
  logout: () => void;
  ready: boolean;
}

const AuthContext = createContext<AuthState>({
  user: null,
  login: async () => false,
  logout: () => {},
  ready: false,
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<TestUser | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const token = localStorage.getItem(TOKEN_KEY);
    if (!token) {
      setReady(true);
      return;
    }
    fetch(`${DATACORE_AUTH_URL}/me`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((r) => {
        if (!r.ok) throw new Error('Invalid token');
        return r.json();
      })
      .then((data: TestUser) => setUser(data))
      .catch(() => localStorage.removeItem(TOKEN_KEY))
      .finally(() => setReady(true));
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    try {
      const resp = await fetch(`${DATACORE_AUTH_URL}/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      if (!resp.ok) return false;
      const data = await resp.json();
      localStorage.setItem(TOKEN_KEY, data.token);
      setUser(data.user);
      return true;
    } catch {
      return false;
    }
  }, []);

  const logout = useCallback(() => {
    setUser(null);
    localStorage.removeItem(TOKEN_KEY);
  }, []);

  return (
    <AuthContext.Provider value={{ user, login, logout, ready }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
```

- [ ] **Step 3: Update LoginPage to use email instead of username**

Replace `admindash/frontend/src/pages/LoginPage.tsx`:

```typescript
import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from '../hooks/useTranslation.ts';
import { useAuth } from '../contexts/AuthContext.tsx';
import './LoginPage.css';

export default function LoginPage() {
  const { t } = useTranslation();
  const { login } = useAuth();
  const navigate = useNavigate();
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    const form = e.target as HTMLFormElement;
    const email = (form.elements.namedItem('email') as HTMLInputElement).value;
    const password = (form.elements.namedItem('password') as HTMLInputElement).value;
    const success = await login(email, password);
    setLoading(false);
    if (success) {
      navigate('/home');
    } else {
      setError('Invalid credentials');
    }
  }

  return (
    <div className="login-page">
      <div className="login-card">
        <div className="login-card-body">
          <div className="login-logo">
            <img
              src="https://www.acmeschool.com/uploads/2/7/1/4/27147223/1418317113.png"
              alt="Logo"
            />
          </div>
          <h1 className="login-title">{t('login.title')}</h1>
          {error && (
            <div style={{ color: 'var(--danger)', textAlign: 'center', marginBottom: '1rem', fontSize: '0.85rem' }}>
              {error}
            </div>
          )}
          <form onSubmit={handleSubmit}>
            <div className="login-field">
              <label htmlFor="email">{t('login.email')}</label>
              <input
                id="email"
                type="email"
                placeholder={t('login.emailPlaceholder')}
                required
              />
            </div>
            <div className="login-field">
              <label htmlFor="password">{t('login.password')}</label>
              <input
                id="password"
                type="password"
                placeholder={t('login.passwordPlaceholder')}
                required
              />
            </div>
            <button type="submit" className="login-submit" disabled={loading}>
              {loading ? '...' : t('login.submit')}
            </button>
          </form>
        </div>
        <div className="login-footer">
          {t('login.noAccount')}{' '}
          <a href="#">{t('login.register')}</a>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Update i18n translations — replace username with email**

In `admindash/frontend/src/i18n/translations.ts`:

For `en-US`, replace:
```
'login.username': 'Username',
'login.usernamePlaceholder': 'Enter username',
```
with:
```
'login.email': 'Email',
'login.emailPlaceholder': 'Enter email',
```

Remove:
```
'login.googleLogin': 'Sign in with Google',
'login.otherMethods': 'Other sign-in methods',
```

For `zh-CN`, replace:
```
'login.username': '用户名',
'login.usernamePlaceholder': '请输入用户名',
```
with:
```
'login.email': '邮箱',
'login.emailPlaceholder': '请输入邮箱',
```

Remove:
```
'login.googleLogin': '使用 Google 登录',
'login.otherMethods': '其他登录方式',
```

- [ ] **Step 5: Commit**

```bash
git add admindash/frontend/src/contexts/AuthContext.tsx admindash/frontend/src/types/models.ts admindash/frontend/src/pages/LoginPage.tsx admindash/frontend/src/i18n/translations.ts
git commit -m "refactor(admindash): switch to DataCore auth with email login"
```

---

### Task 14: Delete test_user.json files

**Files:**
- Delete: `launchpad/test_user.json`
- Delete: `admindash/test_user.json`

- [ ] **Step 1: Delete both files**

```bash
rm launchpad/test_user.json admindash/test_user.json
```

- [ ] **Step 2: Remove the test_user.json fetch from any AdminDash code**

Verify no other files reference `test_user.json`. The AuthContext rewrite in Task 13 already removed the fetch. Check if any HTML or config files serve it:

Run: `grep -r "test_user" admindash/ launchpad/ --include="*.ts" --include="*.tsx" --include="*.html" --include="*.json" -l`

Remove any remaining references found.

- [ ] **Step 3: Commit**

```bash
git rm launchpad/test_user.json admindash/test_user.json
git commit -m "chore: delete test_user.json files — auth now uses DataCore"
```

---

### Task 15: Clean up unused Papermite storage layer

**Files:**
- Delete: `papermite/backend/app/storage/registry_store.py`
- Delete: `papermite/backend/app/models/registry.py`
- Modify: `papermite/backend/app/storage/__init__.py`

Papermite no longer needs its own RegistryStore or direct DataCore Store access for auth (it calls DataCore's HTTP API now). However, check if other Papermite code (upload, finalize, etc.) still imports from `app.storage`.

- [ ] **Step 1: Check for remaining imports of registry_store and storage init**

Run: `grep -r "registry_store\|get_registry_store\|RegistryStore" papermite/backend/app/ --include="*.py" -l`

If only `auth.py` and `storage/__init__.py` reference them, they can be removed. If other modules use `_get_store()` from `storage/__init__.py`, keep the Store dependency but remove only the registry parts.

- [ ] **Step 2: Check if Papermite auth.py still imports UserRecord**

The rewritten `auth.py` in Task 11 still imports `UserRecord` from `app.models.registry` to wrap DataCore's response. Keep `models/registry.py` but note it's now only used as a local data class — it no longer connects to DataCore directly.

- [ ] **Step 3: Remove registry_store.py if safe**

```bash
rm papermite/backend/app/storage/registry_store.py
```

Update `papermite/backend/app/storage/__init__.py` — remove `RegistryStore` import and `get_registry_store()`. Keep `_get_store()` if other modules need it:

```python
"""Storage layer — dependency injection for FastAPI routes."""
from datacore import Store

from app.config import settings

_store: Store | None = None


def _get_store() -> Store:
    global _store
    if _store is None:
        _store = Store(data_dir=settings.lancedb_dir)
    return _store
```

- [ ] **Step 4: Verify Papermite starts**

Run: `cd papermite/backend && python -c "from app.main import app; print('OK')"`
Expected: `OK`

- [ ] **Step 5: Commit**

```bash
git add papermite/backend/app/storage/
git rm papermite/backend/app/storage/registry_store.py
git commit -m "refactor(papermite): remove registry_store — auth delegated to DataCore"
```

---

### Task 16: Clean up unused LaunchPad storage layer

**Files:**
- Modify: `launchpad/backend/app/storage/__init__.py`

LaunchPad's auth.py no longer imports RegistryStore or Store. Check if other LaunchPad modules (tenants.py, users.py) still need them.

- [ ] **Step 1: Check remaining imports**

Run: `grep -r "get_registry_store\|RegistryStore\|_get_store" launchpad/backend/app/ --include="*.py" -l`

- [ ] **Step 2: Update accordingly**

If `tenants.py` and `users.py` still use `get_registry_store()`, keep it as-is. The RegistryStore stays for non-auth operations (listing users, managing onboarding). Only the JWT-related code was removed.

If nothing else imports the registry store, clean up similarly to Task 15.

- [ ] **Step 3: Remove PyJWT from LaunchPad dependencies**

LaunchPad no longer uses `jwt` directly. Remove `pyjwt` from its dependencies if present, and remove `import jwt` from any remaining files.

- [ ] **Step 4: Commit**

```bash
git add launchpad/backend/
git commit -m "refactor(launchpad): clean up unused JWT imports"
```

---

### Task 17: End-to-end verification

- [ ] **Step 1: Start DataCore**

Run: `cd datacore && uvicorn datacore.api.server:app --port 8081`

- [ ] **Step 2: Seed test user**

Run: `cd datacore && python -c "from datacore import Store; from datacore.auth.seed import seed_test_user; seed_test_user(Store())"`

- [ ] **Step 3: Verify DataCore auth endpoints**

```bash
# Login
curl -s -X POST http://localhost:8081/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"jane@acme.edu","password":"admin123"}' | python -m json.tool

# Me (use token from login response)
curl -s http://localhost:8081/auth/me \
  -H "Authorization: Bearer <token>" | python -m json.tool

# Exchange code
curl -s -X POST http://localhost:8081/auth/exchange-code \
  -H "Authorization: Bearer <token>" | python -m json.tool

# Redeem code
curl -s -X POST http://localhost:8081/auth/redeem-code \
  -H "Content-Type: application/json" \
  -d '{"code":"<code>"}' | python -m json.tool
```

- [ ] **Step 4: Start LaunchPad and verify login**

Run: `cd launchpad/backend && uvicorn app.main:app --port 8001`

```bash
curl -s -X POST http://localhost:8001/api/login \
  -H "Content-Type: application/json" \
  -d '{"email":"jane@acme.edu","password":"admin123"}' | python -m json.tool
```

- [ ] **Step 5: Start Papermite and verify login**

Run: `cd papermite/backend && uvicorn app.main:app --port 8000`

```bash
curl -s -X POST http://localhost:8000/api/login \
  -H "Content-Type: application/json" \
  -d '{"email":"jane@acme.edu","password":"admin123"}' | python -m json.tool
```

- [ ] **Step 6: Run all DataCore tests**

Run: `cd datacore && python -m pytest tests/ -v`
Expected: All tests pass

- [ ] **Step 7: Verify all three frontends can login**

Start all three frontend dev servers and verify:
1. LaunchPad frontend at `:5175` — login with `jane@acme.edu` / `admin123`
2. Papermite frontend at `:5173` — login with `jane@acme.edu` / `admin123`
3. AdminDash frontend at `:5174` — login with `jane@acme.edu` / `admin123`

All should store token under `neoapex_token` in localStorage.
