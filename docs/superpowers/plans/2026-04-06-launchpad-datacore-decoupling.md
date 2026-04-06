# LaunchPad DataCore Decoupling Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove LaunchPad's direct DataCore library dependency by adding registry API endpoints to DataCore, refactoring auth_routes to use them, and replacing all LaunchPad storage access with HTTP calls.

**Architecture:** DataCore gets a new `registry_routes.py` with user CRUD and onboarding endpoints. Auth routes are refactored to call registry functions instead of duplicating Store access. LaunchPad's `users.py` and `tenants.py` replace `RegistryStore`/inline `Store` with `httpx` calls. The entire `storage/` layer is deleted and `datacore` removed from dependencies.

**Tech Stack:** Python, FastAPI, httpx, bcrypt, LanceDB (DataCore only)

**Spec:** `launchpad/openspec/changes/launchpad-datacore-decoupling/`

---

## File Structure

| File | Action | Responsibility |
|---|---|---|
| `datacore/src/datacore/api/registry_routes.py` | Create | User CRUD and onboarding endpoints on global registry table |
| `datacore/tests/test_registry_api.py` | Create | Tests for registry endpoints |
| `datacore/src/datacore/api/__init__.py` | Modify | Register registry routes |
| `datacore/src/datacore/api/auth_routes.py` | Modify | Call registry functions instead of inline Store access |
| `launchpad/backend/app/config.py` | Modify | Add `datacore_api_url`, remove `datacore_store_path` |
| `launchpad/backend/app/api/users.py` | Modify | Replace RegistryStore with httpx calls |
| `launchpad/backend/app/api/tenants.py` | Modify | Replace inline Store and RegistryStore with httpx calls |
| `launchpad/backend/app/storage/registry_store.py` | Delete | Replaced by DataCore HTTP API |
| `launchpad/backend/app/storage/model_store.py` | Delete | Replaced by DataCore HTTP API |
| `launchpad/backend/app/storage/__init__.py` | Delete | No longer needed |
| `launchpad/backend/tests/test_registry_store.py` | Delete | Tests for deleted code |
| `launchpad/pyproject.toml` | Modify | Remove `datacore` dependency |

---

### Task 1: Create DataCore registry routes — user CRUD

**Files:**
- Create: `datacore/src/datacore/api/registry_routes.py`
- Create: `datacore/tests/test_registry_api.py`
- Modify: `datacore/src/datacore/api/__init__.py`

- [ ] **Step 1: Write the failing tests**

Create `datacore/tests/test_registry_api.py`:

```python
"""Tests for DataCore registry API endpoints — user CRUD."""
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


def _seed_user(store, user_id="u-001", email="jane@acme.edu", tenant_id="acme", role="admin"):
    store.put_global("registry", f"user:{user_id}", {
        "user_id": user_id,
        "name": "Jane Admin",
        "email": email,
        "password_hash": hash_password("admin123"),
        "tenant_id": tenant_id,
        "tenant_name": "Acme Afterschool",
        "role": role,
        "created_at": "2026-01-01T00:00:00+00:00",
    })


# --- Query users ---

def test_query_users_by_tenant(reg_client):
    client, store = reg_client
    _seed_user(store, "u-001", "jane@acme.edu", "acme")
    _seed_user(store, "u-002", "bob@acme.edu", "acme")
    _seed_user(store, "u-003", "other@xyz.edu", "xyz")

    resp = client.get("/api/registry/users?tenant_id=acme")
    assert resp.status_code == 200
    data = resp.json()
    assert len(data) == 2
    assert all(u["tenant_id"] == "acme" for u in data)
    assert all("password_hash" not in u for u in data)


def test_query_users_by_email(reg_client):
    client, store = reg_client
    _seed_user(store, "u-001", "jane@acme.edu", "acme")

    resp = client.get("/api/registry/users?email=jane@acme.edu")
    assert resp.status_code == 200
    data = resp.json()
    assert len(data) == 1
    assert data[0]["email"] == "jane@acme.edu"


def test_query_users_empty(reg_client):
    client, _ = reg_client
    resp = client.get("/api/registry/users?tenant_id=nonexistent")
    assert resp.status_code == 200
    assert resp.json() == []


# --- Create user ---

def test_create_user(reg_client):
    client, _ = reg_client
    resp = client.post("/api/registry/users", json={
        "name": "Jane Admin",
        "email": "jane@acme.edu",
        "password": "admin123",
        "tenant_id": "acme",
        "tenant_name": "Acme Afterschool",
        "role": "admin",
    })
    assert resp.status_code == 201
    data = resp.json()
    assert data["email"] == "jane@acme.edu"
    assert data["user_id"].startswith("u-")
    assert "password_hash" not in data


def test_create_user_duplicate_email(reg_client):
    client, store = reg_client
    _seed_user(store)
    resp = client.post("/api/registry/users", json={
        "name": "Jane 2",
        "email": "jane@acme.edu",
        "password": "pw",
        "tenant_id": "acme",
        "tenant_name": "Acme",
        "role": "staff",
    })
    assert resp.status_code == 409


# --- Get user by ID ---

def test_get_user_by_id(reg_client):
    client, store = reg_client
    _seed_user(store)
    resp = client.get("/api/registry/users/u-001")
    assert resp.status_code == 200
    assert resp.json()["email"] == "jane@acme.edu"
    assert "password_hash" not in resp.json()


def test_get_user_not_found(reg_client):
    client, _ = reg_client
    resp = client.get("/api/registry/users/nonexistent")
    assert resp.status_code == 404


# --- Update user ---

def test_update_user(reg_client):
    client, store = reg_client
    _seed_user(store)
    resp = client.put("/api/registry/users/u-001", json={"name": "Jane Updated"})
    assert resp.status_code == 200
    assert resp.json()["name"] == "Jane Updated"
    assert "password_hash" not in resp.json()


def test_update_user_not_found(reg_client):
    client, _ = reg_client
    resp = client.put("/api/registry/users/nonexistent", json={"name": "X"})
    assert resp.status_code == 404


# --- Delete user ---

def test_delete_user(reg_client):
    client, store = reg_client
    _seed_user(store)
    resp = client.delete("/api/registry/users/u-001")
    assert resp.status_code == 200
    # Verify deleted
    resp2 = client.get("/api/registry/users/u-001")
    assert resp2.status_code == 404


def test_delete_user_not_found(reg_client):
    client, _ = reg_client
    resp = client.delete("/api/registry/users/nonexistent")
    assert resp.status_code == 404
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd datacore && uv run python -m pytest tests/test_registry_api.py -v`
Expected: FAIL — endpoints don't exist

- [ ] **Step 3: Create registry_routes.py**

Create `datacore/src/datacore/api/registry_routes.py`:

```python
"""Registry API routes — user CRUD and onboarding on global registry table."""
import copy
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from datacore.auth.passwords import hash_password, verify_password
from datacore.store import Store

router = APIRouter(prefix="/api/registry", tags=["registry"])

_store: Store | None = None

REGISTRY_TABLE = "registry"

ONBOARDING_STEPS = [
    {"id": "model_setup", "label": "Set Up Model", "completed": False},
    {"id": "tenant_details", "label": "Tenant Details", "completed": False},
]


def register_registry_routes(app, store: Store) -> None:
    global _store
    _store = store
    app.include_router(router)


def _sanitize_user(user_data: dict) -> dict:
    return {k: v for k, v in user_data.items() if k != "password_hash"}


# --- Shared functions (called by auth_routes too) ---

def get_user_by_email(email: str) -> dict | None:
    """Find a user by email in the registry table."""
    results = _store.query_global(REGISTRY_TABLE)
    for row in results:
        if not row["record_key"].startswith("user:"):
            continue
        if row["data"].get("email", "").lower() == email.lower():
            return row["data"]
    return None


def get_user_by_id(user_id: str) -> dict | None:
    """Get a user by ID from the registry table."""
    result = _store.get_global(REGISTRY_TABLE, f"user:{user_id}")
    if not result:
        return None
    return result["data"]


def create_user_record(
    name: str, email: str, password: str,
    tenant_id: str, tenant_name: str, role: str,
) -> dict:
    """Create a new user record in the registry table. Returns user data (with password_hash)."""
    user_id = f"u-{uuid.uuid4().hex[:8]}"
    now = datetime.now(timezone.utc).isoformat()
    user_data = {
        "user_id": user_id,
        "name": name,
        "email": email.lower(),
        "password_hash": hash_password(password),
        "tenant_id": tenant_id,
        "tenant_name": tenant_name,
        "role": role,
        "created_at": now,
    }
    _store.put_global(REGISTRY_TABLE, f"user:{user_id}", user_data)
    return user_data


def get_users_by_email_domain(domain: str) -> list[dict]:
    """Return all users whose email matches the given domain."""
    results = _store.query_global(REGISTRY_TABLE)
    users = []
    for row in results:
        if not row["record_key"].startswith("user:"):
            continue
        email = row["data"].get("email", "")
        if email.split("@")[-1].lower() == domain.lower():
            users.append(row["data"])
    return users


def get_onboarding(tenant_id: str) -> dict | None:
    """Get onboarding status for a tenant."""
    result = _store.get_global(REGISTRY_TABLE, f"onboarding:{tenant_id}")
    if not result:
        return None
    return result["data"]


def create_onboarding(tenant_id: str) -> dict:
    """Create a new onboarding record for a tenant."""
    onboarding = {
        "tenant_id": tenant_id,
        "steps": copy.deepcopy(ONBOARDING_STEPS),
        "is_complete": False,
    }
    _store.put_global(REGISTRY_TABLE, f"onboarding:{tenant_id}", onboarding)
    return onboarding


def mark_step_complete(tenant_id: str, step_id: str) -> dict:
    """Mark an onboarding step as complete. Returns updated status."""
    data = get_onboarding(tenant_id)
    if not data:
        raise ValueError(f"No onboarding for tenant {tenant_id}")
    for step in data["steps"]:
        if step["id"] == step_id:
            step["completed"] = True
    data["is_complete"] = all(s["completed"] for s in data["steps"])
    _store.put_global(REGISTRY_TABLE, f"onboarding:{tenant_id}", data)
    return data


# --- Request models ---

class CreateUserRequest(BaseModel):
    name: str
    email: str
    password: str
    tenant_id: str
    tenant_name: str
    role: str


class UpdateUserRequest(BaseModel):
    name: str | None = None
    role: str | None = None


class MarkStepRequest(BaseModel):
    step_id: str


# --- User endpoints ---

@router.get("/users")
def query_users(
    tenant_id: str | None = Query(None),
    email: str | None = Query(None),
):
    results = _store.query_global(REGISTRY_TABLE)
    users = []
    for row in results:
        if not row["record_key"].startswith("user:"):
            continue
        data = row["data"]
        if tenant_id and data.get("tenant_id") != tenant_id:
            continue
        if email and data.get("email", "").lower() != email.lower():
            continue
        users.append(_sanitize_user(data))
    return users


@router.post("/users", status_code=201)
def create_user(req: CreateUserRequest):
    if get_user_by_email(req.email):
        raise HTTPException(status_code=409, detail="Email already registered")
    user_data = create_user_record(
        name=req.name, email=req.email, password=req.password,
        tenant_id=req.tenant_id, tenant_name=req.tenant_name, role=req.role,
    )
    return JSONResponse(status_code=201, content=_sanitize_user(user_data))


@router.get("/users/{user_id}")
def get_user(user_id: str):
    user = get_user_by_id(user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    return _sanitize_user(user)


@router.put("/users/{user_id}")
def update_user(user_id: str, body: UpdateUserRequest):
    result = _store.get_global(REGISTRY_TABLE, f"user:{user_id}")
    if not result:
        raise HTTPException(status_code=404, detail="User not found")
    data = result["data"]
    fields = {k: v for k, v in body.model_dump().items() if v is not None}
    data.update(fields)
    _store.put_global(REGISTRY_TABLE, f"user:{user_id}", data)
    return _sanitize_user(data)


@router.delete("/users/{user_id}")
def delete_user(user_id: str):
    if not _store.delete_global(REGISTRY_TABLE, f"user:{user_id}"):
        raise HTTPException(status_code=404, detail="User not found")
    return {"status": "deleted"}


# --- Onboarding endpoints ---

@router.get("/onboarding/{tenant_id}")
def get_onboarding_status(tenant_id: str):
    data = get_onboarding(tenant_id)
    if not data:
        raise HTTPException(status_code=404, detail="Onboarding not found")
    return data


@router.post("/onboarding/{tenant_id}/complete-step")
def complete_onboarding_step(tenant_id: str, body: MarkStepRequest):
    try:
        data = mark_step_complete(tenant_id, body.step_id)
    except ValueError:
        raise HTTPException(status_code=404, detail="Onboarding not found")
    return data
```

- [ ] **Step 4: Register registry routes in create_app**

In `datacore/src/datacore/api/__init__.py`, add import and call:

```python
from datacore.api.registry_routes import register_registry_routes
```

Add after `register_auth_routes(app, store)`:

```python
    register_registry_routes(app, store)
```

- [ ] **Step 5: Run tests**

Run: `cd datacore && uv run python -m pytest tests/test_registry_api.py -v`
Expected: All tests pass

- [ ] **Step 6: Run all DataCore tests**

Run: `cd datacore && uv run python -m pytest tests/ -q`
Expected: All tests pass (no regressions)

- [ ] **Step 7: Commit**

```bash
git add datacore/src/datacore/api/registry_routes.py datacore/src/datacore/api/__init__.py datacore/tests/test_registry_api.py
git commit -m "feat(datacore): add registry API routes for user CRUD and onboarding"
```

---

### Task 2: Add onboarding tests to registry API

**Files:**
- Modify: `datacore/tests/test_registry_api.py`

- [ ] **Step 1: Add onboarding tests**

Append to `datacore/tests/test_registry_api.py`:

```python
# --- Onboarding ---

def _seed_onboarding(store, tenant_id="acme"):
    import copy
    store.put_global("registry", f"onboarding:{tenant_id}", {
        "tenant_id": tenant_id,
        "steps": copy.deepcopy([
            {"id": "model_setup", "label": "Set Up Model", "completed": False},
            {"id": "tenant_details", "label": "Tenant Details", "completed": False},
        ]),
        "is_complete": False,
    })


def test_get_onboarding(reg_client):
    client, store = reg_client
    _seed_onboarding(store)
    resp = client.get("/api/registry/onboarding/acme")
    assert resp.status_code == 200
    data = resp.json()
    assert data["tenant_id"] == "acme"
    assert len(data["steps"]) == 2
    assert data["is_complete"] is False


def test_get_onboarding_not_found(reg_client):
    client, _ = reg_client
    resp = client.get("/api/registry/onboarding/nonexistent")
    assert resp.status_code == 404


def test_complete_onboarding_step(reg_client):
    client, store = reg_client
    _seed_onboarding(store)
    resp = client.post("/api/registry/onboarding/acme/complete-step", json={"step_id": "model_setup"})
    assert resp.status_code == 200
    data = resp.json()
    model_step = next(s for s in data["steps"] if s["id"] == "model_setup")
    assert model_step["completed"] is True
    assert data["is_complete"] is False


def test_complete_all_steps_marks_complete(reg_client):
    client, store = reg_client
    _seed_onboarding(store)
    client.post("/api/registry/onboarding/acme/complete-step", json={"step_id": "model_setup"})
    resp = client.post("/api/registry/onboarding/acme/complete-step", json={"step_id": "tenant_details"})
    assert resp.status_code == 200
    assert resp.json()["is_complete"] is True


def test_complete_step_no_onboarding(reg_client):
    client, _ = reg_client
    resp = client.post("/api/registry/onboarding/nonexistent/complete-step", json={"step_id": "model_setup"})
    assert resp.status_code == 404
```

- [ ] **Step 2: Run tests**

Run: `cd datacore && uv run python -m pytest tests/test_registry_api.py -v`
Expected: All tests pass

- [ ] **Step 3: Commit**

```bash
git add datacore/tests/test_registry_api.py
git commit -m "test(datacore): add onboarding endpoint tests"
```

---

### Task 3: Refactor auth_routes.py to use registry functions

**Files:**
- Modify: `datacore/src/datacore/api/auth_routes.py`

Auth routes currently have inline `_get_user_by_email`, `_get_user_by_id`, `_get_onboarding`, `_get_users_by_email_domain`, and registration logic that duplicates Store access. Replace with calls to `registry_routes` shared functions.

- [ ] **Step 1: Rewrite auth_routes.py**

Replace `datacore/src/datacore/api/auth_routes.py`:

```python
"""Auth API routes — login, token validation, exchange codes."""
import re

from fastapi import APIRouter, HTTPException, Header
from pydantic import BaseModel

from datacore.auth.config import AuthConfig
from datacore.auth.exchange import ExchangeStore
from datacore.auth.passwords import verify_password
from datacore.auth.tokens import TokenError, create_token, decode_token
from datacore.store import Store

router = APIRouter(prefix="/auth", tags=["auth"])

_config: AuthConfig | None = None
_exchange: ExchangeStore | None = None

# Import registry functions — initialized after register_auth_routes is called
_registry = None


class LoginRequest(BaseModel):
    email: str
    password: str


class RedeemRequest(BaseModel):
    code: str


def register_auth_routes(app, store: Store, config: AuthConfig | None = None) -> None:
    global _config, _exchange, _registry
    _config = config or AuthConfig()
    _exchange = ExchangeStore(ttl_seconds=30)

    # Import here to avoid circular imports — registry_routes is registered on same app
    from datacore.api import registry_routes
    _registry = registry_routes

    app.include_router(router)


def _sanitize_user(user_data: dict) -> dict:
    return {k: v for k, v in user_data.items() if k != "password_hash"}


def _extract_bearer_token(authorization: str) -> str:
    if not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Invalid authorization header")
    return authorization[7:]


@router.post("/login")
def login(req: LoginRequest):
    user = _registry.get_user_by_email(req.email)
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
    user = _registry.get_user_by_id(payload["user_id"])
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


# ---------------------------------------------------------------------------
# Registration endpoints
# ---------------------------------------------------------------------------

TENANT_ID_PATTERN = re.compile(r"^[a-z][a-z0-9-]{2,39}$")
COMMON_EMAIL_PROVIDERS = frozenset({
    "gmail.com", "yahoo.com", "hotmail.com", "outlook.com",
    "icloud.com", "protonmail.com", "aol.com", "mail.com", "zoho.com",
    "live.com", "msn.com", "ymail.com",
})


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


@router.post("/register")
def register(req: RegisterRequest):
    if not TENANT_ID_PATTERN.match(req.tenant_id):
        raise HTTPException(
            status_code=422,
            detail="Invalid tenant ID format. Must be 3-40 lowercase alphanumeric characters and hyphens, starting with a letter.",
        )
    if _registry.get_onboarding(req.tenant_id) is not None:
        raise HTTPException(status_code=409, detail="Tenant ID already taken")
    if _registry.get_user_by_email(req.email):
        raise HTTPException(status_code=409, detail="Email already registered")

    user_data = _registry.create_user_record(
        name=req.name, email=req.email, password=req.password,
        tenant_id=req.tenant_id, tenant_name=req.tenant_name, role="admin",
    )
    _registry.create_onboarding(req.tenant_id)

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
    users = _registry.get_users_by_email_domain(domain)
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
    available = [c for c in candidates if _registry.get_onboarding(c) is None]
    return {"suggestions": available}
```

Key changes:
- Removed `_store` global, `_get_user_by_email`, `_get_user_by_id`, `_get_onboarding`, `_get_users_by_email_domain` — all replaced with `_registry.*` calls
- Removed `copy`, `uuid`, `datetime` imports (no longer needed)
- Removed `hash_password` import (user creation delegated to registry)
- Removed `REGISTRY_TABLE`, `ONBOARDING_STEPS`, `VALID_ROLES` constants (now in registry_routes)
- Registration calls `_registry.create_user_record()` and `_registry.create_onboarding()` instead of inline Store writes

- [ ] **Step 2: Handle initialization order**

The `register_auth_routes` must be called AFTER `register_registry_routes` so that registry_routes._store is initialized. Check `datacore/src/datacore/api/__init__.py` — the call order must be:

```python
    register_registry_routes(app, store)
    register_auth_routes(app, store)
```

`register_routes` (data endpoints) can be in any position.

- [ ] **Step 3: Run all DataCore tests**

Run: `cd datacore && uv run python -m pytest tests/ -q`
Expected: All tests pass — auth tests, registration tests, and registry tests all still work

- [ ] **Step 4: Commit**

```bash
git add datacore/src/datacore/api/auth_routes.py datacore/src/datacore/api/__init__.py
git commit -m "refactor(datacore): auth routes use registry functions instead of inline Store access"
```

---

### Task 4: Update LaunchPad config

**Files:**
- Modify: `launchpad/backend/app/config.py`

- [ ] **Step 1: Update config — add datacore_api_url, remove datacore_store_path**

Replace `launchpad/backend/app/config.py`:

```python
"""Launchpad configuration — settings and datacore path."""
import json
import os
from pathlib import Path
from pydantic_settings import BaseSettings


def _load_services() -> dict:
    config_path = Path(__file__).resolve().parent.parent.parent.parent / "services.json"
    if config_path.exists():
        with open(config_path) as f:
            return json.load(f)["services"]
    return {}


_services = _load_services()


def _svc_url(key: str) -> str:
    svc = _services.get(key, {})
    host = svc.get("host", "localhost")
    port = svc.get("port", 6010)
    return f"http://{host}:{port}"


def _cors_origins() -> list[str]:
    env_origins = os.environ.get("CORS_ALLOWED_ORIGINS")
    if env_origins:
        return [o.strip() for o in env_origins.split(",") if o.strip()]
    origins = []
    for k in _services:
        if k.endswith("-frontend"):
            port = _services[k].get("port", 0)
            origins.append(f"http://localhost:{port}")
            origins.append(f"http://127.0.0.1:{port}")
    return origins


class Settings(BaseSettings):
    datacore_auth_url: str = _svc_url("datacore") + "/auth"
    datacore_api_url: str = _svc_url("datacore") + "/api"
    papermite_frontend_url: str = _svc_url("papermite-frontend")
    port: int = _services.get("launchpad-backend", {}).get("port", 6010)
    cors_origins: list[str] = _cors_origins()
    model_config = {"env_prefix": "LAUNCHPAD_"}

settings = Settings()
```

- [ ] **Step 2: Verify import**

Run: `cd launchpad/backend && python -c "from app.config import settings; print(settings.datacore_api_url)"`
Expected: `http://localhost:6300/api`

- [ ] **Step 3: Commit**

```bash
git add launchpad/backend/app/config.py
git commit -m "refactor(launchpad): add datacore_api_url, remove datacore_store_path"
```

---

### Task 5: Rewrite LaunchPad users.py

**Files:**
- Modify: `launchpad/backend/app/api/users.py`

- [ ] **Step 1: Replace users.py**

```python
"""User management endpoints — admin-only CRUD for tenant users."""
import httpx
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from app.api.auth import require_role, VALID_ROLES
from app.config import settings

router = APIRouter()


class CreateUserRequest(BaseModel):
    name: str
    email: str
    password: str
    role: str


class UpdateUserRequest(BaseModel):
    name: str | None = None
    role: str | None = None


def _registry_url(path: str) -> str:
    return f"{settings.datacore_api_url}/registry{path}"


@router.get("/tenants/{tenant_id}/users")
def list_users(tenant_id: str, user=Depends(require_role("admin"))):
    if user["tenant_id"] != tenant_id:
        raise HTTPException(status_code=403, detail="Tenant mismatch")
    resp = httpx.get(_registry_url("/users"), params={"tenant_id": tenant_id})
    if resp.status_code != 200:
        raise HTTPException(status_code=502, detail="Failed to fetch users")
    return resp.json()


@router.post("/tenants/{tenant_id}/users", status_code=201)
def create_user(tenant_id: str, body: CreateUserRequest, user=Depends(require_role("admin"))):
    if user["tenant_id"] != tenant_id:
        raise HTTPException(status_code=403, detail="Tenant mismatch")
    if body.role not in VALID_ROLES:
        raise HTTPException(status_code=422, detail=f"Invalid role. Must be one of: {', '.join(VALID_ROLES)}")

    # Check duplicate email
    existing = httpx.get(_registry_url("/users"), params={"email": body.email})
    if existing.status_code == 200 and len(existing.json()) > 0:
        raise HTTPException(status_code=409, detail="Email already registered")

    resp = httpx.post(_registry_url("/users"), json={
        "name": body.name,
        "email": body.email,
        "password": body.password,
        "tenant_id": tenant_id,
        "tenant_name": user["tenant_name"],
        "role": body.role,
    })
    if resp.status_code == 409:
        raise HTTPException(status_code=409, detail="Email already registered")
    if resp.status_code != 201:
        raise HTTPException(status_code=502, detail="Failed to create user")
    return resp.json()


@router.put("/tenants/{tenant_id}/users/{user_id}")
def update_user(tenant_id: str, user_id: str, body: UpdateUserRequest, user=Depends(require_role("admin"))):
    if user["tenant_id"] != tenant_id:
        raise HTTPException(status_code=403, detail="Tenant mismatch")
    if body.role and body.role not in VALID_ROLES:
        raise HTTPException(status_code=422, detail="Invalid role")

    # Prevent removing last admin
    if body.role and body.role != "admin" and user_id == user["user_id"]:
        users_resp = httpx.get(_registry_url("/users"), params={"tenant_id": tenant_id})
        if users_resp.status_code == 200:
            admin_count = sum(1 for u in users_resp.json() if u["role"] == "admin")
            if admin_count <= 1:
                raise HTTPException(status_code=400, detail="Cannot remove the last admin")

    fields = {k: v for k, v in body.model_dump().items() if v is not None}
    resp = httpx.put(_registry_url(f"/users/{user_id}"), json=fields)
    if resp.status_code == 404:
        raise HTTPException(status_code=404, detail="User not found")
    if resp.status_code != 200:
        raise HTTPException(status_code=502, detail="Failed to update user")
    return resp.json()


@router.delete("/tenants/{tenant_id}/users/{user_id}", status_code=204)
def delete_user(tenant_id: str, user_id: str, user=Depends(require_role("admin"))):
    if user["tenant_id"] != tenant_id:
        raise HTTPException(status_code=403, detail="Tenant mismatch")

    # Prevent deleting last admin
    target_resp = httpx.get(_registry_url(f"/users/{user_id}"))
    if target_resp.status_code == 200:
        target = target_resp.json()
        if target.get("role") == "admin":
            users_resp = httpx.get(_registry_url("/users"), params={"tenant_id": tenant_id})
            if users_resp.status_code == 200:
                admin_count = sum(1 for u in users_resp.json() if u["role"] == "admin")
                if admin_count <= 1:
                    raise HTTPException(status_code=400, detail="Cannot remove the last admin")

    resp = httpx.delete(_registry_url(f"/users/{user_id}"))
    if resp.status_code == 404:
        raise HTTPException(status_code=404, detail="User not found")
```

- [ ] **Step 2: Commit**

```bash
git add launchpad/backend/app/api/users.py
git commit -m "refactor(launchpad): users.py delegates to DataCore registry API"
```

---

### Task 6: Rewrite LaunchPad tenants.py

**Files:**
- Modify: `launchpad/backend/app/api/tenants.py`

- [ ] **Step 1: Replace tenants.py**

```python
"""Tenant profile and onboarding status endpoints."""
import json
from pathlib import Path

import httpx
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from app.api.auth import get_current_user, require_role
from app.config import settings

router = APIRouter()


def _datacore_url(path: str) -> str:
    return f"{settings.datacore_api_url}{path}"


def _registry_url(path: str) -> str:
    return f"{settings.datacore_api_url}/registry{path}"


@router.get("/tenants/{tenant_id}")
def get_tenant_profile(tenant_id: str, user=Depends(require_role("admin", "staff"))):
    if user["tenant_id"] != tenant_id:
        raise HTTPException(status_code=403, detail="Tenant mismatch")
    resp = httpx.get(_datacore_url(f"/tenants/{tenant_id}"))
    if resp.status_code == 404:
        return {"tenant_id": tenant_id, "name": user["tenant_name"]}
    if resp.status_code != 200:
        raise HTTPException(status_code=502, detail="Failed to fetch tenant")
    entity = resp.json()
    data = {**entity.get("base_data", {}), **entity.get("custom_fields", {})}
    data["tenant_id"] = tenant_id
    return data


@router.put("/tenants/{tenant_id}")
def update_tenant_profile(tenant_id: str, body: dict, user=Depends(require_role("admin"))):
    if user["tenant_id"] != tenant_id:
        raise HTTPException(status_code=403, detail="Tenant mismatch")
    body.pop("name", None)
    body.pop("tenant_id", None)

    # Fetch existing to merge
    existing_resp = httpx.get(_datacore_url(f"/tenants/{tenant_id}"))
    if existing_resp.status_code == 200:
        existing = existing_resp.json()
        base_data = {**existing.get("base_data", {}), **body}
    else:
        base_data = {"tenant_id": tenant_id, **body}

    resp = httpx.put(
        _datacore_url(f"/tenants/{tenant_id}"),
        json={"base_data": base_data},
    )
    if resp.status_code not in (200, 201):
        raise HTTPException(status_code=502, detail="Failed to update tenant")
    return {**base_data, "tenant_id": tenant_id}


@router.get("/tenants/{tenant_id}/model")
def get_model(tenant_id: str, user=Depends(get_current_user)):
    if user["tenant_id"] != tenant_id:
        raise HTTPException(status_code=403, detail="Tenant mismatch")
    resp = httpx.get(_datacore_url(f"/models/{tenant_id}/tenant"))
    if resp.status_code == 404:
        return None
    if resp.status_code != 200:
        raise HTTPException(status_code=502, detail="Failed to fetch model")
    model = resp.json()
    return model.get("model_definition")


@router.get("/tenants/{tenant_id}/model/info")
def get_model_info(tenant_id: str, user=Depends(get_current_user)):
    if user["tenant_id"] != tenant_id:
        raise HTTPException(status_code=403, detail="Tenant mismatch")
    resp = httpx.get(_datacore_url(f"/models/{tenant_id}/tenant"))
    if resp.status_code == 404:
        return None
    if resp.status_code != 200:
        raise HTTPException(status_code=502, detail="Failed to fetch model")
    model = resp.json()
    return {
        "model_definition": model.get("model_definition"),
        "version": model.get("_version"),
        "change_id": model.get("_change_id"),
        "created_at": model.get("_created_at"),
        "updated_at": model.get("_updated_at"),
    }


BASE_MODEL_PATH = Path(__file__).parent.parent / "data" / "base_model.json"


@router.post("/tenants/{tenant_id}/model/use-default")
def use_default_model(tenant_id: str, user=Depends(require_role("admin"))):
    if user["tenant_id"] != tenant_id:
        raise HTTPException(status_code=403, detail="Tenant mismatch")
    base_model = json.loads(BASE_MODEL_PATH.read_text())

    # Store model via DataCore
    resp = httpx.put(
        _datacore_url(f"/models/{tenant_id}"),
        json={
            "model_definition": base_model,
            "source_filename": "base_model.json",
            "created_by": user["name"],
        },
        timeout=30.0,
    )
    if resp.status_code != 200:
        raise HTTPException(status_code=502, detail="Failed to store model")

    # Mark onboarding step complete
    httpx.post(
        _registry_url(f"/onboarding/{tenant_id}/complete-step"),
        json={"step_id": "model_setup"},
    )

    return base_model


@router.get("/tenants/{tenant_id}/onboarding-status")
def get_onboarding_status(tenant_id: str, user=Depends(get_current_user)):
    if user["tenant_id"] != tenant_id:
        raise HTTPException(status_code=403, detail="Tenant mismatch")
    resp = httpx.get(_registry_url(f"/onboarding/{tenant_id}"))
    if resp.status_code == 404:
        raise HTTPException(status_code=404, detail="Onboarding not found")
    if resp.status_code != 200:
        raise HTTPException(status_code=502, detail="Failed to fetch onboarding")
    return resp.json()


class MarkStepRequest(BaseModel):
    step_id: str
    completed: bool = True


@router.post("/tenants/{tenant_id}/onboarding-status")
def update_onboarding_status(tenant_id: str, body: MarkStepRequest, user=Depends(require_role("admin"))):
    if user["tenant_id"] != tenant_id:
        raise HTTPException(status_code=403, detail="Tenant mismatch")
    resp = httpx.post(
        _registry_url(f"/onboarding/{tenant_id}/complete-step"),
        json={"step_id": body.step_id},
    )
    if resp.status_code == 404:
        raise HTTPException(status_code=404, detail="Onboarding not found")
    if resp.status_code != 200:
        raise HTTPException(status_code=502, detail="Failed to update onboarding")
    return resp.json()
```

- [ ] **Step 2: Verify LaunchPad starts**

Run: `cd launchpad/backend && python -c "from app.main import app; print('OK')"`

This may fail because `main.py` or other modules still import from `app.storage`. Check and fix.

- [ ] **Step 3: Commit**

```bash
git add launchpad/backend/app/api/tenants.py
git commit -m "refactor(launchpad): tenants.py delegates to DataCore HTTP API"
```

---

### Task 7: Delete storage layer and clean up dependencies

**Files:**
- Delete: `launchpad/backend/app/storage/registry_store.py`
- Delete: `launchpad/backend/app/storage/model_store.py`
- Delete: `launchpad/backend/app/storage/__init__.py`
- Delete: `launchpad/backend/tests/test_registry_store.py`
- Modify: `launchpad/pyproject.toml`

- [ ] **Step 1: Delete storage files and tests**

```bash
rm launchpad/backend/app/storage/registry_store.py
rm launchpad/backend/app/storage/model_store.py
rm launchpad/backend/app/storage/__init__.py
rmdir launchpad/backend/app/storage 2>/dev/null || true
rm launchpad/backend/tests/test_registry_store.py
```

- [ ] **Step 2: Remove datacore from pyproject.toml**

In `launchpad/pyproject.toml`, remove:
```
    "datacore @ file:///Users/kennylee/Development/NeoApex/datacore",
```

- [ ] **Step 3: Verify LaunchPad starts**

Run: `cd launchpad/backend && python -c "from app.main import app; print('OK')"`
Expected: `OK`

- [ ] **Step 4: Verify no remaining datacore imports**

Run: `grep -r "from datacore\|import datacore\|from app.storage\|import app.storage" launchpad/ --include="*.py" | grep -v __pycache__ | grep -v .venv`
Expected: No matches

- [ ] **Step 5: Commit**

```bash
git rm launchpad/backend/app/storage/registry_store.py launchpad/backend/app/storage/model_store.py launchpad/backend/app/storage/__init__.py launchpad/backend/tests/test_registry_store.py
git add launchpad/pyproject.toml
git commit -m "refactor(launchpad): remove storage layer and datacore dependency"
```

---

### Task 8: End-to-end verification

- [ ] **Step 1: Run all DataCore tests**

Run: `cd datacore && uv run python -m pytest tests/ -q`
Expected: All tests pass

- [ ] **Step 2: Verify LaunchPad starts**

Run: `cd launchpad/backend && python -c "from app.main import app; print('OK')"`
Expected: `OK`

- [ ] **Step 3: Verify no remaining datacore imports**

Run: `grep -r "from datacore\|import datacore" launchpad/ --include="*.py" | grep -v __pycache__ | grep -v .venv`
Expected: No matches

- [ ] **Step 4: Start all services and test**

```bash
./start-services.sh
```

Verify:
1. DataCore auth: `curl -s -X POST http://localhost:6300/auth/login -H "Content-Type: application/json" -d '{"email":"jane@acme.edu","password":"admin123"}'`
2. LaunchPad login works via frontend
3. LaunchPad user management (list, create, update, delete users) works
4. LaunchPad onboarding status works
5. LaunchPad tenant profile works
