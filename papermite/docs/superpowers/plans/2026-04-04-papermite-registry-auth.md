# papermite-registry-auth Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Papermite's `test_user.json` authentication with registry-table lookup — the same DataCore global "registry" table that LaunchPad writes to, with bcrypt password verification.

**Architecture:** Add a read-only `RegistryStore` class to Papermite (mirroring LaunchPad's pattern) that queries DataCore's global registry table. Update `auth.py` to use it for login and JWT verification. Remove all `TestUser` / `test_user.json` code. DataCore is already a declared dependency; only `bcrypt` needs to be added.

**Tech Stack:** Python/FastAPI, DataCore (LanceDB wrapper), bcrypt, PyJWT, pytest + FastAPI TestClient

---

### Task 0: Add bcrypt dependency

**Files:**
- Modify: `papermite/pyproject.toml`

- [ ] **Step 1: Add bcrypt to pyproject.toml**

In `papermite/pyproject.toml`, add `"bcrypt>=4.0"` to the `dependencies` list. The list should look like:

```toml
dependencies = [
    "fastapi>=0.115",
    "uvicorn[standard]>=0.30",
    "python-multipart>=0.0.9",
    "pydantic>=2.0",
    "pydantic-ai>=0.0.30",
    "docling>=2.70",
    "datacore @ file:///Users/kennylee/Development/NeoApex/datacore",
    "PyJWT>=2.8",
    "python-toon>=0.1",
    "bcrypt>=4.0",
]
```

- [ ] **Step 2: Install the dependency**

Run from `papermite/`:
```bash
pip install -e ".[dev]"
```
Expected: `Successfully installed bcrypt-...` (or `Requirement already satisfied` if already present)

- [ ] **Step 3: Verify bcrypt imports**

```bash
python -c "import bcrypt; print(bcrypt.__version__)"
```
Expected: prints a version string like `4.x.x`

- [ ] **Step 4: Commit**

```bash
git add papermite/pyproject.toml
git commit -m "chore(papermite): add bcrypt dependency for registry auth"
```

---

### Task 1: Add UserRecord model

**Files:**
- Create: `papermite/backend/app/models/registry.py`
- Create: `papermite/backend/tests/test_registry_store.py` (partial — just model import check)

- [ ] **Step 1: Write a failing import test**

Create `papermite/backend/tests/test_registry_store.py`:

```python
"""Tests for RegistryStore and UserRecord in papermite."""


def test_user_record_import():
    from app.models.registry import UserRecord
    user = UserRecord(
        user_id="u-abc123",
        name="Jane Admin",
        email="jane@acme.edu",
        password_hash="$2b$12$fakehash",
        tenant_id="acme",
        tenant_name="Acme School",
        role="admin",
        created_at="2026-01-01T00:00:00+00:00",
    )
    assert user.user_id == "u-abc123"
    assert user.email == "jane@acme.edu"
    assert user.role == "admin"
```

- [ ] **Step 2: Run test — verify it fails**

Run from `papermite/backend/`:
```bash
pytest tests/test_registry_store.py::test_user_record_import -v
```
Expected: FAIL with `ModuleNotFoundError: No module named 'app.models.registry'`

- [ ] **Step 3: Create `papermite/backend/app/models/registry.py`**

```python
"""Pydantic model for user records from the DataCore global registry table."""
from pydantic import BaseModel


class UserRecord(BaseModel):
    user_id: str
    name: str
    email: str
    password_hash: str
    tenant_id: str
    tenant_name: str
    role: str  # admin, staff, teacher, parent
    created_at: str
```

- [ ] **Step 4: Run test — verify it passes**

```bash
pytest tests/test_registry_store.py::test_user_record_import -v
```
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add papermite/backend/app/models/registry.py papermite/backend/tests/test_registry_store.py
git commit -m "feat(papermite): add UserRecord model for registry auth"
```

---

### Task 2: Add read-only RegistryStore

**Files:**
- Create: `papermite/backend/app/storage/registry_store.py`
- Modify: `papermite/backend/tests/test_registry_store.py`

- [ ] **Step 1: Write failing tests for RegistryStore**

Append to `papermite/backend/tests/test_registry_store.py`:

```python
from unittest.mock import MagicMock


def _make_store(rows=None, get_result=None):
    """Build a mock datacore.Store for RegistryStore tests."""
    store = MagicMock()
    store.query_global.return_value = rows or []
    store.get_global.return_value = get_result
    return store


def test_verify_password_correct():
    import bcrypt
    from app.storage.registry_store import RegistryStore

    hashed = bcrypt.hashpw(b"secret", bcrypt.gensalt(rounds=4)).decode()
    assert RegistryStore.verify_password("secret", hashed) is True


def test_verify_password_wrong():
    import bcrypt
    from app.storage.registry_store import RegistryStore

    hashed = bcrypt.hashpw(b"secret", bcrypt.gensalt(rounds=4)).decode()
    assert RegistryStore.verify_password("wrong", hashed) is False


def test_get_user_by_email_found():
    from app.storage.registry_store import RegistryStore

    rows = [
        {
            "record_key": "user:u-abc123",
            "data": {
                "user_id": "u-abc123",
                "name": "Jane Admin",
                "email": "jane@acme.edu",
                "password_hash": "$2b$04$fakehash",
                "tenant_id": "acme",
                "tenant_name": "Acme School",
                "role": "admin",
                "created_at": "2026-01-01T00:00:00+00:00",
            },
        }
    ]
    store = _make_store(rows=rows)
    registry = RegistryStore(store)

    user = registry.get_user_by_email("jane@acme.edu")
    assert user is not None
    assert user.user_id == "u-abc123"
    assert user.email == "jane@acme.edu"


def test_get_user_by_email_not_found():
    from app.storage.registry_store import RegistryStore

    store = _make_store(rows=[])
    registry = RegistryStore(store)

    user = registry.get_user_by_email("nobody@acme.edu")
    assert user is None


def test_get_user_by_email_case_insensitive():
    from app.storage.registry_store import RegistryStore

    rows = [
        {
            "record_key": "user:u-abc123",
            "data": {
                "user_id": "u-abc123",
                "name": "Jane",
                "email": "jane@acme.edu",
                "password_hash": "$2b$04$x",
                "tenant_id": "acme",
                "tenant_name": "Acme",
                "role": "admin",
                "created_at": "2026-01-01T00:00:00+00:00",
            },
        }
    ]
    store = _make_store(rows=rows)
    registry = RegistryStore(store)

    user = registry.get_user_by_email("JANE@ACME.EDU")
    assert user is not None
    assert user.user_id == "u-abc123"


def test_get_user_by_id_found():
    from app.storage.registry_store import RegistryStore

    get_result = {
        "record_key": "user:u-abc123",
        "data": {
            "user_id": "u-abc123",
            "name": "Jane",
            "email": "jane@acme.edu",
            "password_hash": "$2b$04$x",
            "tenant_id": "acme",
            "tenant_name": "Acme",
            "role": "admin",
            "created_at": "2026-01-01T00:00:00+00:00",
        },
    }
    store = _make_store(get_result=get_result)
    registry = RegistryStore(store)

    user = registry.get_user_by_id("u-abc123")
    assert user is not None
    assert user.user_id == "u-abc123"


def test_get_user_by_id_not_found():
    from app.storage.registry_store import RegistryStore

    store = _make_store(get_result=None)
    registry = RegistryStore(store)

    user = registry.get_user_by_id("u-missing")
    assert user is None


def test_get_user_by_email_skips_non_user_keys():
    """Onboarding records (key: onboarding:...) must not be returned as users."""
    from app.storage.registry_store import RegistryStore

    rows = [
        {"record_key": "onboarding:acme", "data": {"tenant_id": "acme"}},
    ]
    store = _make_store(rows=rows)
    registry = RegistryStore(store)

    user = registry.get_user_by_email("acme@acme.edu")
    assert user is None
```

- [ ] **Step 2: Run tests — verify they all fail**

```bash
pytest tests/test_registry_store.py -v -k "not test_user_record_import"
```
Expected: all FAIL with `ModuleNotFoundError: No module named 'app.storage.registry_store'`

- [ ] **Step 3: Create `papermite/backend/app/storage/registry_store.py`**

```python
"""Registry store — read-only user lookup via DataCore global registry table."""
import bcrypt
from datacore import Store

from app.models.registry import UserRecord

REGISTRY_TABLE = "registry"


class RegistryStore:
    def __init__(self, store: Store):
        self._store = store

    @staticmethod
    def verify_password(password: str, password_hash: str) -> bool:
        return bcrypt.checkpw(password.encode(), password_hash.encode())

    def get_user_by_email(self, email: str) -> UserRecord | None:
        results = self._store.query_global(REGISTRY_TABLE)
        for row in results:
            if not row["record_key"].startswith("user:"):
                continue
            if row["data"].get("email", "").lower() == email.lower():
                return UserRecord(**row["data"])
        return None

    def get_user_by_id(self, user_id: str) -> UserRecord | None:
        result = self._store.get_global(REGISTRY_TABLE, f"user:{user_id}")
        if not result:
            return None
        return UserRecord(**result["data"])
```

- [ ] **Step 4: Run tests — verify they pass**

```bash
pytest tests/test_registry_store.py -v
```
Expected: all PASS (8 tests)

- [ ] **Step 5: Commit**

```bash
git add papermite/backend/app/storage/registry_store.py papermite/backend/tests/test_registry_store.py
git commit -m "feat(papermite): add read-only RegistryStore backed by DataCore global registry"
```

---

### Task 3: Wire RegistryStore as a FastAPI dependency

**Files:**
- Modify: `papermite/backend/app/storage/__init__.py`

- [ ] **Step 1: Replace `storage/__init__.py`**

```python
"""Storage layer — dependency injection for FastAPI routes."""
from datacore import Store

from app.config import settings
from app.storage.registry_store import RegistryStore

_store: Store | None = None
_registry: RegistryStore | None = None


def _get_store() -> Store:
    global _store
    if _store is None:
        _store = Store(data_dir=settings.lancedb_dir)
    return _store


def get_registry_store() -> RegistryStore:
    global _registry
    if _registry is None:
        _registry = RegistryStore(_get_store())
    return _registry
```

- [ ] **Step 2: Verify the import resolves cleanly**

```bash
python -c "from app.storage import get_registry_store; print('ok')"
```
Expected: prints `ok`

- [ ] **Step 3: Commit**

```bash
git add papermite/backend/app/storage/__init__.py
git commit -m "feat(papermite): expose get_registry_store() FastAPI dependency"
```

---

### Task 4: Strip test user code from config.py

**Files:**
- Modify: `papermite/backend/app/config.py`

- [ ] **Step 1: Replace `config.py` with the cleaned version**

```python
import os
from pathlib import Path
from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    jwt_secret: str = "papermite-dev-secret-change-in-prod"
    launchpad_jwt_secret: str = "neoapex-dev-secret-change-in-prod"
    jwt_expiry_hours: int = 24
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

- [ ] **Step 2: Verify existing tests still import without error**

```bash
pytest tests/test_extract_api.py -v --co 2>&1 | head -30
```
Expected: test collection succeeds (no import errors). Note: `test_extract_api.py` currently imports `TestUser` from `app.config` — if it does, update that import in Step 3 below first. Check:
```bash
grep -n "TestUser" papermite/backend/tests/test_extract_api.py
```

- [ ] **Step 3: Update `test_extract_api.py` FAKE_USER if needed**

If the grep in Step 2 finds `from app.config import TestUser`, replace that import and the `FAKE_USER` definition. The `FAKE_USER` in `test_extract_api.py` is only used as a return value for `require_admin` — it just needs to be a valid object. Replace with:

```python
from app.models.registry import UserRecord

FAKE_USER = UserRecord(
    user_id="u1",
    name="Test Admin",
    email="admin@test.com",
    password_hash="",
    tenant_id="t1",
    tenant_name="Test Tenant",
    role="admin",
    created_at="",
)
```

- [ ] **Step 4: Run all existing tests to confirm nothing broke**

```bash
pytest tests/ -v --ignore=tests/test_registry_store.py
```
Expected: all previously passing tests still PASS

- [ ] **Step 5: Commit**

```bash
git add papermite/backend/app/config.py papermite/backend/tests/test_extract_api.py
git commit -m "refactor(papermite): remove TestUser and test_user.json config from Settings"
```

---

### Task 5: Rewrite auth.py to use registry

**Files:**
- Modify: `papermite/backend/app/api/auth.py`
- Create: `papermite/backend/tests/test_auth.py`

- [ ] **Step 1: Write failing auth endpoint tests**

Create `papermite/backend/tests/test_auth.py`:

```python
"""Tests for auth endpoints and get_current_user dependency."""
import bcrypt
from unittest.mock import MagicMock

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.models.registry import UserRecord
from app.storage import get_registry_store

client = TestClient(app)

_HASHED = bcrypt.hashpw(b"correct-pass", bcrypt.gensalt(rounds=4)).decode()

FAKE_USER = UserRecord(
    user_id="u-abc123",
    name="Jane Admin",
    email="jane@acme.edu",
    password_hash=_HASHED,
    tenant_id="acme",
    tenant_name="Acme School",
    role="admin",
    created_at="2026-01-01T00:00:00+00:00",
)


def _registry_returning(user):
    """Mock RegistryStore that returns `user` for all lookups."""
    mock = MagicMock()
    mock.get_user_by_email.return_value = user
    mock.get_user_by_id.return_value = user
    return mock


@pytest.fixture(autouse=True)
def clear_overrides():
    yield
    app.dependency_overrides.clear()


def test_login_success():
    app.dependency_overrides[get_registry_store] = lambda: _registry_returning(FAKE_USER)
    resp = client.post("/api/login", json={"email": "jane@acme.edu", "password": "correct-pass"})
    assert resp.status_code == 200
    data = resp.json()
    assert "token" in data
    assert data["user"]["email"] == "jane@acme.edu"
    assert "password_hash" not in data["user"]


def test_login_unknown_email():
    app.dependency_overrides[get_registry_store] = lambda: _registry_returning(None)
    resp = client.post("/api/login", json={"email": "nobody@acme.edu", "password": "pass"})
    assert resp.status_code == 401


def test_login_wrong_password():
    app.dependency_overrides[get_registry_store] = lambda: _registry_returning(FAKE_USER)
    resp = client.post("/api/login", json={"email": "jane@acme.edu", "password": "wrong-pass"})
    assert resp.status_code == 401


def test_get_me_returns_profile_without_password_hash():
    from app.api.auth import get_current_user
    app.dependency_overrides[get_current_user] = lambda: FAKE_USER
    resp = client.get("/api/me", headers={"Authorization": "Bearer dummy"})
    assert resp.status_code == 200
    data = resp.json()
    assert data["email"] == "jane@acme.edu"
    assert "password_hash" not in data
```

- [ ] **Step 2: Run tests — verify they fail**

```bash
pytest tests/test_auth.py -v
```
Expected: FAIL (imports from `app.models.registry` and `app.storage` may work, but `app.api.auth` still uses `TestUser` so login behavior is wrong)

- [ ] **Step 3: Replace `papermite/backend/app/api/auth.py`**

```python
"""Auth endpoints and dependencies — JWT-based login with registry-backed credentials."""
from datetime import datetime, timedelta, timezone

import jwt
from fastapi import APIRouter, Depends, Header, HTTPException
from pydantic import BaseModel

from app.config import settings
from app.models.registry import UserRecord
from app.storage import get_registry_store
from app.storage.registry_store import RegistryStore

router = APIRouter()

# ─── JWT helpers ───────────────────────────────────────────────

def _create_token(user: UserRecord) -> str:
    payload = {
        "user_id": user.user_id,
        "email": user.email,
        "tenant_id": user.tenant_id,
        "role": user.role,
        "exp": datetime.now(timezone.utc) + timedelta(hours=settings.jwt_expiry_hours),
    }
    return jwt.encode(payload, settings.jwt_secret, algorithm="HS256")


def _decode_token(token: str, secret: str) -> dict:
    try:
        return jwt.decode(token, secret, algorithms=["HS256"])
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Token expired")
    except jwt.InvalidTokenError as e:
        raise e  # Let caller handle fallback


# ─── FastAPI dependencies ──────────────────────────────────────

def get_current_user(
    authorization: str = Header(...),
    registry: RegistryStore = Depends(get_registry_store),
) -> UserRecord:
    """Decode JWT. Tries papermite secret first, then launchpad secret."""
    if not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Invalid authorization header")
    token = authorization[7:]

    # Try papermite's own secret first
    try:
        payload = _decode_token(token, settings.jwt_secret)
        user = registry.get_user_by_id(payload["user_id"])
        if not user:
            raise HTTPException(status_code=401, detail="User not found")
        return user
    except jwt.InvalidTokenError:
        pass

    # Try launchpad secret (cross-service SSO)
    try:
        payload = _decode_token(token, settings.launchpad_jwt_secret)
        return UserRecord(
            user_id=payload["user_id"],
            name=payload.get("name", payload["email"].split("@")[0]),
            email=payload["email"],
            password_hash="",
            tenant_id=payload["tenant_id"],
            tenant_name=payload.get("tenant_name", ""),
            role=payload["role"],
            created_at="",
        )
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Invalid token")


def require_admin(user: UserRecord = Depends(get_current_user)) -> UserRecord:
    """Verify the current user has admin role."""
    if user.role != "admin":
        raise HTTPException(status_code=403, detail="Requires admin role")
    return user


# ─── Request/Response models ────────────────────────────────────

class LoginRequest(BaseModel):
    email: str
    password: str


class LoginResponse(BaseModel):
    token: str
    user: dict


@router.post("/login")
def login(req: LoginRequest, registry: RegistryStore = Depends(get_registry_store)):
    """Authenticate with email + password against registry, return JWT."""
    user = registry.get_user_by_email(req.email)
    if not user or not RegistryStore.verify_password(req.password, user.password_hash):
        raise HTTPException(status_code=401, detail="Invalid credentials")
    token = _create_token(user)
    user_data = user.model_dump()
    del user_data["password_hash"]
    return {"token": token, "user": user_data}


@router.get("/me")
def get_me(user: UserRecord = Depends(get_current_user)):
    """Return the authenticated user's profile."""
    user_data = user.model_dump()
    del user_data["password_hash"]
    return user_data
```

- [ ] **Step 4: Run auth tests — verify they pass**

```bash
pytest tests/test_auth.py -v
```
Expected: all 4 PASS

- [ ] **Step 5: Run full test suite**

```bash
pytest tests/ -v
```
Expected: all tests PASS (including pre-existing tests)

- [ ] **Step 6: Commit**

```bash
git add papermite/backend/app/api/auth.py papermite/backend/tests/test_auth.py
git commit -m "feat(papermite): authenticate via DataCore registry table with bcrypt verification"
```

---

### Task 6: Delete test_user.json

**Files:**
- Delete: `papermite/test_user.json`

- [ ] **Step 1: Confirm no remaining references to test_user.json in code**

```bash
grep -r "test_user" papermite/backend/ --include="*.py"
```
Expected: no output (zero matches)

- [ ] **Step 2: Delete the file**

```bash
git rm papermite/test_user.json
```

- [ ] **Step 3: Run full test suite one last time**

```bash
pytest tests/ -v
```
Expected: all tests PASS

- [ ] **Step 4: Commit**

```bash
git commit -m "chore(papermite): remove test_user.json — auth now uses DataCore registry"
```
