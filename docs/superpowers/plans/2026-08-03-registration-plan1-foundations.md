# Registration Phase 1 — Plan 1: Foundations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Harden tenant isolation in AdminDash, scaffold the enrollx and familyhub modules plus the shared `flow-runtime` package, seed the new registration entity definitions and ID abbreviations, and add an R2-backed document blob API to DataCore.

**Architecture:** enrollx and familyhub are new NeoApex modules following the admindash shape exactly (React 19 + Vite frontend, FastAPI backend that persists nothing and proxies to DataCore). DataCore remains the only persistence layer and gains a small blob API with R2 behind it. `flow-runtime` is a shared frontend package (sibling of `ui-tokens`) holding the flow types now and the FlowRenderer later.

**Tech Stack:** Python 3.12 + FastAPI + pydantic_settings + httpx + pytest (backends); React 19 + TypeScript + Vite (frontends); boto3 for R2 presigning (DataCore); uv for Python deps.

## Global Constraints

- DataCore is the ONLY service that persists anything. enrollx/familyhub backends hold no state, no DB, no files.
- familyhub-backend must NEVER expose generic query/entity endpoints or any staff route.
- Every authenticated enrollx route enforces tenant match (`user.tenant_id == path tenant_id`) AND role in `{admin, staff}`.
- JWT is validated by calling DataCore `GET /auth/me` — services never see the signing secret. Token localStorage key: `neoapex_token`.
- Frontends: native Fetch (no axios), CSS variables (no CSS-in-JS), no global state library.
- Ports: enrollx 5900/5910, familyhub 6000/6010 (frontend/backend). Registered in `services.json`.
- Git remotes use SSH. Base branch: `docs/registration-flow-design` (contains the spec) — if already merged, use `main`. Work on branch `feat/registration-plan1-foundations`.
- Interface contract definitions live in `docs/superpowers/plans/2026-08-03-registration-phase1-roadmap.md` — read it before starting.

---

### Task 0: Branch setup

- [ ] **Step 1:** `git fetch && git checkout docs/registration-flow-design 2>/dev/null || git checkout main` then `git checkout -b feat/registration-plan1-foundations`

---

### Task 1: AdminDash tenant-match hardening

Fixes a live gap: admindash proxy routes validate the JWT but not that the caller belongs to the tenant in the path, so any authenticated user can read/write another tenant's data.

Deliberate scope note: this task adds tenant-match only. Role-gating AdminDash's existing routes (spec §3 "same treatment") is deferred — it could lock out current `teacher`-role users and needs a product decision on which roles keep which AdminDash routes. enrollx enforces roles from day one (Task 3); AdminDash role-gating gets its own follow-up task once role usage is confirmed.

**Files:**
- Create: `admindash/backend/app/tenancy.py`
- Create: `admindash/backend/tests/test_tenancy.py`
- Modify: `admindash/backend/app/api/entities.py` (every route: swap `user=Depends(require_authenticated_user)` → `user=Depends(require_tenant_match)`)
- Modify: `admindash/backend/app/api/leads.py` (same swap on every route that has a `tenant_id` path param EXCEPT the two public routes `GET /public/leads/{tenant_id}/model` and `POST /public/leads/{tenant_id}`)
- Modify: `admindash/backend/app/api/query.py` (add SQL tenant-scope guard)
- Modify: `admindash/backend/app/api/extract.py` (same swap)

**Interfaces:**
- Produces: `require_tenant_match(tenant_id: str, user=Depends(require_authenticated_user)) -> dict` — FastAPI dependency; 403 if `user["tenant_id"] != tenant_id`, else returns the user dict (with `_token`). `assert_tenant_scoped_sql(sql: str, tenant_id: str) -> None` — raises HTTPException 403 if the SQL references a table not prefixed `{tenant_id}_`.

- [ ] **Step 1: Write failing tests**

```python
# admindash/backend/tests/test_tenancy.py
"""Tenant-match enforcement on proxy routes."""
import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.auth import require_authenticated_user
from app.tenancy import assert_tenant_scoped_sql
from fastapi import HTTPException


def fake_user_acme():
    return {"user_id": "u1", "tenant_id": "acme", "role": "admin", "_token": "Bearer x"}


@pytest.fixture
def client():
    app.dependency_overrides[require_authenticated_user] = fake_user_acme
    yield TestClient(app)
    app.dependency_overrides.clear()


def test_cross_tenant_entity_write_is_403(client):
    resp = client.post("/api/entities/othertenant/student", json={"base_data": {}})
    assert resp.status_code == 403


def test_cross_tenant_leads_read_is_403(client):
    resp = client.get("/api/leads/othertenant")
    assert resp.status_code == 403


def test_query_referencing_other_tenant_table_is_403(client):
    resp = client.post("/api/query", json={"sql": "SELECT * FROM othertenant_entities"})
    assert resp.status_code == 403


def test_sql_guard_allows_own_tenant_tables():
    assert_tenant_scoped_sql("SELECT * FROM acme_entities e JOIN acme_models m ON 1=1", "acme")


def test_sql_guard_rejects_foreign_table():
    with pytest.raises(HTTPException) as exc:
        assert_tenant_scoped_sql("SELECT * FROM globex_entities", "acme")
    assert exc.value.status_code == 403


def test_sql_guard_rejects_global_table():
    with pytest.raises(HTTPException):
        assert_tenant_scoped_sql("SELECT * FROM global", "acme")
```

Note: the same-tenant success paths proxy to DataCore, which isn't running in unit tests — asserting 403 (not 401/404) on cross-tenant is sufficient here. Do NOT assert 200s that need a live DataCore.

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /Users/kennylee/Development/NeoApex/admindash && uv run pytest backend/tests/test_tenancy.py -v`
Expected: FAIL — `ModuleNotFoundError: app.tenancy` (or import error).

- [ ] **Step 3: Implement `app/tenancy.py`**

```python
# admindash/backend/app/tenancy.py
"""Tenant-scope enforcement dependencies.

Every route with a {tenant_id} path parameter must require that the
authenticated user belongs to that tenant. The SQL guard is defense in
depth for the raw query passthrough.
"""
import re

from fastapi import Depends, HTTPException, status

from app.auth import require_authenticated_user

# Table references after FROM/JOIN/INTO/UPDATE. LanceDB table names are
# {tenant}_entities / {tenant}_models / {tenant}_sequences plus `global`.
_TABLE_REF = re.compile(r"\b(?:from|join|into|update)\s+([a-zA-Z_][\w]*)", re.IGNORECASE)


def require_tenant_match(tenant_id: str, user=Depends(require_authenticated_user)) -> dict:
    if user.get("tenant_id") != tenant_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Token tenant does not match requested tenant",
        )
    return user


def assert_tenant_scoped_sql(sql: str, tenant_id: str) -> None:
    for table in _TABLE_REF.findall(sql):
        if not table.lower().startswith(f"{tenant_id.lower()}_"):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Query references non-tenant table '{table}'",
            )
```

- [ ] **Step 4: Apply to routes**

In `entities.py`, `extract.py`, and `leads.py` (non-public routes only): change the import to `from app.tenancy import require_tenant_match` and replace `Depends(require_authenticated_user)` with `Depends(require_tenant_match)` — FastAPI injects the route's `tenant_id` path param into the dependency automatically. Leave `require_authenticated_user` in place on any route WITHOUT a `tenant_id` path param.

In `query.py`: the route has no tenant path param. Keep `require_authenticated_user`, parse the JSON body's `sql` field, and call `assert_tenant_scoped_sql(sql, user["tenant_id"])` before proxying. Read the body once (`payload = await request.json()`), then forward the original body as before.

- [ ] **Step 5: Run the new tests AND the full admindash suite**

Run: `cd /Users/kennylee/Development/NeoApex/admindash && uv run pytest backend/tests/ -v`
Expected: all PASS. If existing tests hit the modified routes with a mismatched fake tenant, update those fixtures to use a matching tenant_id — do not weaken the dependency.

- [ ] **Step 6: Commit**

```bash
git add admindash/backend
git commit -m "fix(admindash): enforce tenant match on proxy routes and tenant-scope raw SQL"
```

---

### Task 2: Register new services (ports + startup)

**Files:**
- Modify: `services.json` (repo root)
- Modify: `start-services.sh` (repo root)
- Modify: `CLAUDE.md` (repo root — Service Ports table)

**Interfaces:**
- Produces: `services.json` keys `enrollx-frontend` (5900), `enrollx-backend` (5910), `familyhub-frontend` (6000), `familyhub-backend` (6010) — consumed by every later task's config.

- [ ] **Step 1:** Add to the `services` object in `services.json`:

```json
"enrollx-frontend": { "host": "localhost", "port": 5900 },
"enrollx-backend": { "host": "localhost", "port": 5910 },
"familyhub-frontend": { "host": "localhost", "port": 6000 },
"familyhub-backend": { "host": "localhost", "port": 6010 }
```

- [ ] **Step 2:** Open `start-services.sh`, find how the four existing service pairs are started/killed, and add enrollx + familyhub entries mirroring the admindash pattern exactly. Start commands:
  - enrollx backend: `(cd enrollx && uv run uvicorn app.main:app --app-dir backend --port 5910 --reload)`
  - enrollx frontend: `(cd enrollx/frontend && npm run dev)`
  - familyhub backend: `(cd familyhub && uv run uvicorn app.main:app --app-dir backend --port 6010 --reload)`
  - familyhub frontend: `(cd familyhub/frontend && npm run dev)`

- [ ] **Step 3:** In root `CLAUDE.md`, add the four rows to the Service Ports table and move `enrollx`/`familyhub` out of the "Placeholder directories" line (leaving `apexflow`, `sampledoc`).

- [ ] **Step 4:** Validate JSON: `python3 -c "import json; json.load(open('services.json'))"` — expect no output.

- [ ] **Step 5: Commit**

```bash
git add services.json start-services.sh CLAUDE.md
git commit -m "chore: register enrollx and familyhub service ports"
```

---

### Task 3: enrollx backend scaffold

**Files:**
- Create: `enrollx/pyproject.toml`
- Create: `enrollx/backend/app/__init__.py`, `enrollx/backend/app/main.py`, `enrollx/backend/app/config.py`, `enrollx/backend/app/auth.py`, `enrollx/backend/app/tenancy.py`
- Create: `enrollx/backend/app/api/__init__.py`, `enrollx/backend/app/api/health.py`, `enrollx/backend/app/api/auth.py`, `enrollx/backend/app/api/entities.py`, `enrollx/backend/app/api/query.py`
- Create: `enrollx/backend/tests/__init__.py`, `enrollx/backend/tests/test_health.py`, `enrollx/backend/tests/test_auth_guards.py`

**Interfaces:**
- Consumes: `services.json` ports (Task 2).
- Produces: `require_staff_tenant(tenant_id, user)` dependency — 401 unauthenticated, 403 wrong tenant OR role not in `{admin, staff}`; used by every future enrollx route (Plans 2–4). Generic proxy routes `POST /api/query`, `POST /api/entities/{tenant_id}/{entity_type}`, `PUT /api/entities/{tenant_id}/{entity_type}/{entity_id}`, `GET /api/entities/{tenant_id}/{entity_type}/next-id`. Auth proxy `POST /auth/login`, `GET /auth/me`.

- [ ] **Step 1: `pyproject.toml`** — copy `admindash/pyproject.toml` to `enrollx/pyproject.toml`, then change the project `name` to `enrollx-backend` and keep the same dependency set (fastapi, uvicorn, httpx, pydantic-settings; dev extra with pytest). Drop admindash-only dependencies (anything anthropic/chat related) if present.

- [ ] **Step 2: `config.py`**

```python
# enrollx/backend/app/config.py
"""Configuration for enrollx backend service."""
from typing import List, Optional, Union

from pydantic import model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="ENROLLX_", case_sensitive=False)

    environment: str = "development"
    datacore_url: str = "http://localhost:5800"
    papermite_backend_url: str = "http://localhost:5710"
    cors_allowed_origins: Union[Optional[str], List[str]] = None
    port: int = 5910

    @model_validator(mode="after")
    def parse_and_validate_cors(self):
        raw = self.cors_allowed_origins
        if isinstance(raw, str):
            origins = [o.strip() for o in raw.split(",") if o.strip()]
        elif raw is None:
            origins = []
        else:
            origins = list(raw)

        if self.environment == "production":
            if not origins:
                raise ValueError(
                    "ENROLLX_CORS_ALLOWED_ORIGINS is required in production and must not be empty"
                )
            if "*" in origins:
                raise ValueError(
                    "wildcard '*' in ENROLLX_CORS_ALLOWED_ORIGINS is not permitted in production"
                )
        elif not origins:
            origins = ["http://localhost:5900"]

        object.__setattr__(self, "cors_allowed_origins", origins)
        return self


settings = Settings()
```

- [ ] **Step 3: `app/auth.py`** — copy `admindash/backend/app/auth.py` verbatim, changing only the import comment header ("enrollx backend") and `from app.config import settings` stays identical. Then append the role factory:

```python
def require_role(*roles: str):
    """Factory for role-checking dependencies (mirrors launchpad)."""
    from fastapi import Depends

    def dependency(user=Depends(require_authenticated_user)) -> dict:
        if user.get("role") not in roles:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Requires one of: {', '.join(roles)}",
            )
        return user

    return dependency
```

- [ ] **Step 4: `app/tenancy.py`**

```python
# enrollx/backend/app/tenancy.py
"""Tenant + role enforcement. Every authenticated enrollx route uses this."""
import re

from fastapi import Depends, HTTPException, status

from app.auth import require_authenticated_user

STAFF_ROLES = {"admin", "staff"}

_TABLE_REF = re.compile(r"\b(?:from|join|into|update)\s+([a-zA-Z_][\w]*)", re.IGNORECASE)


def require_staff_tenant(tenant_id: str, user=Depends(require_authenticated_user)) -> dict:
    if user.get("role") not in STAFF_ROLES:
        raise HTTPException(status.HTTP_403_FORBIDDEN, detail="Requires admin or staff role")
    if user.get("tenant_id") != tenant_id:
        raise HTTPException(
            status.HTTP_403_FORBIDDEN, detail="Token tenant does not match requested tenant"
        )
    return user


def require_staff(user=Depends(require_authenticated_user)) -> dict:
    """For routes without a tenant path param (e.g. /api/query)."""
    if user.get("role") not in STAFF_ROLES:
        raise HTTPException(status.HTTP_403_FORBIDDEN, detail="Requires admin or staff role")
    return user


def assert_tenant_scoped_sql(sql: str, tenant_id: str) -> None:
    for table in _TABLE_REF.findall(sql):
        if not table.lower().startswith(f"{tenant_id.lower()}_"):
            raise HTTPException(
                status.HTTP_403_FORBIDDEN,
                detail=f"Query references non-tenant table '{table}'",
            )
```

- [ ] **Step 5: API routes.**
  - `api/health.py`: router with `GET /health` returning `{"status": "ok", "service": "enrollx-backend"}`.
  - `api/auth.py`: copy `admindash/backend/app/api/auth.py` verbatim (it proxies `/auth/login` and `/auth/me` to DataCore; only the module docstring changes).
  - `api/entities.py`: copy `admindash/backend/app/api/entities.py`, then replace every `Depends(require_authenticated_user)` with `Depends(require_staff_tenant)` and the import with `from app.tenancy import require_staff_tenant`. Keep only these routes: create, update, next-id (drop archive/restore/duplicate-check — YAGNI until a plan needs them).
  - `api/query.py`: copy `admindash/backend/app/api/query.py`, add `from app.tenancy import require_staff, assert_tenant_scoped_sql`, guard with `require_staff`, and before proxying: `payload = await request.json()` then `assert_tenant_scoped_sql(payload.get("sql", ""), user["tenant_id"])`.

- [ ] **Step 6: `app/main.py`**

```python
# enrollx/backend/app/main.py
"""FastAPI application entry point for enrollx backend."""
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api import auth, entities, health, query
from app.config import settings

app = FastAPI(
    title="EnrollX Backend",
    description="Enrollment system of action: flow builder, application lifecycle, tracking",
    version="0.1.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_allowed_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router, prefix="/auth", tags=["auth"])
app.include_router(health.router, prefix="/api", tags=["health"])
app.include_router(query.router, prefix="/api", tags=["query"])
app.include_router(entities.router, prefix="/api", tags=["entities"])
```

(No CloudflareIPMiddleware yet — that's a deploy-time concern added when the Fly app is provisioned.)

- [ ] **Step 7: Write tests**

```python
# enrollx/backend/tests/test_health.py
from fastapi.testclient import TestClient

from app.main import app


def test_health():
    resp = TestClient(app).get("/api/health")
    assert resp.status_code == 200
    assert resp.json()["service"] == "enrollx-backend"
```

```python
# enrollx/backend/tests/test_auth_guards.py
import pytest
from fastapi.testclient import TestClient

from app.auth import require_authenticated_user
from app.main import app


def override_user(tenant="acme", role="admin"):
    def f():
        return {"user_id": "u1", "tenant_id": tenant, "role": role, "_token": "Bearer x"}
    return f


@pytest.fixture
def as_user():
    def _as(tenant="acme", role="admin"):
        app.dependency_overrides[require_authenticated_user] = override_user(tenant, role)
        return TestClient(app)
    yield _as
    app.dependency_overrides.clear()


def test_entities_requires_auth():
    resp = TestClient(app).post("/api/entities/acme/student", json={"base_data": {}})
    assert resp.status_code == 401


def test_entities_cross_tenant_403(as_user):
    resp = as_user(tenant="acme").post("/api/entities/globex/student", json={"base_data": {}})
    assert resp.status_code == 403


def test_entities_parent_role_403(as_user):
    resp = as_user(role="parent").post("/api/entities/acme/student", json={"base_data": {}})
    assert resp.status_code == 403


def test_query_cross_tenant_sql_403(as_user):
    resp = as_user(tenant="acme").post("/api/query", json={"sql": "SELECT * FROM globex_entities"})
    assert resp.status_code == 403
```

- [ ] **Step 8: Install + run**

Run: `cd /Users/kennylee/Development/NeoApex/enrollx && uv sync --extra dev && uv run pytest backend/tests/ -v`
Expected: all PASS.

- [ ] **Step 9: Commit**

```bash
git add enrollx/pyproject.toml enrollx/backend enrollx/uv.lock
git commit -m "feat(enrollx): scaffold backend with tenant+role-guarded generic proxies"
```

---

### Task 4: familyhub backend scaffold

**Files:**
- Create: `familyhub/pyproject.toml` (same recipe as Task 3 Step 1; project name `familyhub-backend`)
- Create: `familyhub/backend/app/__init__.py`, `familyhub/backend/app/main.py`, `familyhub/backend/app/config.py`
- Create: `familyhub/backend/app/api/__init__.py`, `familyhub/backend/app/api/health.py`
- Create: `familyhub/backend/tests/__init__.py`, `familyhub/backend/tests/test_health.py`

**Interfaces:**
- Produces: running FastAPI shell on 6010 with `GET /api/health` only. `settings.enrollx_url` (default `http://localhost:5910`) and `settings.datacore_url` for Plan 5. **Deliberately NO auth module, NO entity/query routes** — Plan 5 adds only the token-scoped facade.

- [ ] **Step 1:** `config.py` — same shape as Task 3 Step 2 with: `env_prefix="FAMILYHUB_"`, `port: int = 6010`, `enrollx_url: str = "http://localhost:5910"`, `datacore_url: str = "http://localhost:5800"`, dev CORS fallback `["http://localhost:6000"]`, error message prefixes `FAMILYHUB_CORS_ALLOWED_ORIGINS`.

- [ ] **Step 2:** `api/health.py` — `GET /health` returning `{"status": "ok", "service": "familyhub-backend"}`. `main.py` — same shape as Task 3 Step 6 with title "FamilyHub Backend", description "Family-facing channel: registration runtime and parent hub", and ONLY the health router mounted under `/api`.

- [ ] **Step 3:** Test (same as Task 3's `test_health.py` with `familyhub-backend` expected).

- [ ] **Step 4:** Run: `cd /Users/kennylee/Development/NeoApex/familyhub && uv sync --extra dev && uv run pytest backend/tests/ -v` — expect PASS.

- [ ] **Step 5: Commit**

```bash
git add familyhub/pyproject.toml familyhub/backend familyhub/uv.lock
git commit -m "feat(familyhub): scaffold backend shell (health only, no staff surface)"
```

---

### Task 5: flow-runtime shared package

**Files:**
- Create: `flow-runtime/package.json`, `flow-runtime/tsconfig.json`, `flow-runtime/src/index.ts`, `flow-runtime/src/types.ts`, `flow-runtime/src/FlowRenderer.tsx`

**Interfaces:**
- Produces: npm package `@neoapex/flow-runtime` exporting `FlowRenderer` (placeholder), and the types `BlockType`, `FlowBlock`, `RegistrationConfigDef`, `FlowMode` exactly as in the roadmap's interface contracts. Plans 4–5 replace the placeholder body but MUST keep these exports.

- [ ] **Step 1:** Look at how `ui-tokens/package.json` is set up and how `admindash/frontend/package.json` consumes it (`@neoapex/ui-tokens` — note whether it's a `file:` dependency). Mirror that consumption mechanism.

- [ ] **Step 2:** Package files:

```json
// flow-runtime/package.json
{
  "name": "@neoapex/flow-runtime",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "main": "src/index.ts",
  "types": "src/index.ts",
  "peerDependencies": {
    "react": "^19.0.0"
  },
  "devDependencies": {
    "typescript": "~5.9.0",
    "@types/react": "^19.0.0"
  },
  "scripts": {
    "typecheck": "tsc --noEmit"
  }
}
```

```json
// flow-runtime/tsconfig.json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "jsx": "react-jsx",
    "strict": true,
    "skipLibCheck": true,
    "noEmit": true
  },
  "include": ["src"]
}
```

```ts
// flow-runtime/src/types.ts
export type BlockType = 'form' | 'documents' | 'payment_plan' | 'payment' | 'message' | 'review';

export interface FlowBlock {
  block_id: string;
  type: BlockType;
  title: string;
  required: boolean;
  blocking: boolean;
  due_days_after_approval?: number;
  config: Record<string, unknown>;
}

export interface RegistrationConfigDef {
  config_id: string;
  program_id: string;
  version: number;
  status: 'draft' | 'published' | 'archived';
  blocks: FlowBlock[];
}

export type FlowMode = 'parent' | 'staff' | 'preview';
```

```tsx
// flow-runtime/src/FlowRenderer.tsx
import type { FlowMode, RegistrationConfigDef } from './types';

export interface FlowRendererProps {
  config: RegistrationConfigDef;
  mode: FlowMode;
}

/** Placeholder — Plan 4 implements the real block-walking renderer. */
export function FlowRenderer({ config, mode }: FlowRendererProps) {
  return (
    <div data-flow-mode={mode}>
      <ol>
        {config.blocks.map((b) => (
          <li key={b.block_id}>{b.title}</li>
        ))}
      </ol>
    </div>
  );
}
```

```ts
// flow-runtime/src/index.ts
export * from './types';
export { FlowRenderer, type FlowRendererProps } from './FlowRenderer';
```

- [ ] **Step 3:** Run: `cd /Users/kennylee/Development/NeoApex/flow-runtime && npm install && npm run typecheck` — expect clean exit.

- [ ] **Step 4: Commit**

```bash
git add flow-runtime
git commit -m "feat(flow-runtime): shared package with flow types and placeholder renderer"
```

---

### Task 6: enrollx frontend scaffold

**Files:**
- Create: `enrollx/frontend/` — Vite React TS app (structure mirrors `admindash/frontend/`)

**Interfaces:**
- Consumes: `@neoapex/ui-tokens`, `@neoapex/flow-runtime` (Task 5), enrollx-backend `/auth/login` (Task 3).
- Produces: authenticated shell at localhost:5900 — login page, AuthContext, an empty `HomePage` ("EnrollX") — the mount point for Plan 4's builder/tracking pages.

- [ ] **Step 1:** Copy these files/directories from `admindash/frontend/` into `enrollx/frontend/`, unchanged unless noted: `package.json` (rename to `enrollx-frontend`; add `"@neoapex/flow-runtime"` dependency using the same mechanism as `@neoapex/ui-tokens`; remove admindash-only deps if any beyond react/react-dom/react-router-dom/typescript/vite tooling), `vite.config.ts` (change dev server port to **5900**), `tsconfig*.json`, `index.html` (title "EnrollX"), `src/main.tsx`, `src/index.css`, `src/styles/` (keep theme.css as-is for now), `src/config.ts` (change service lookups from `admindash-*` keys to `enrollx-frontend` / `enrollx-backend`), `src/contexts/AuthContext.tsx`, `src/pages/LoginPage.tsx`, `src/api/auth.ts` (or wherever login fetch lives — follow imports from LoginPage), `src/hooks/useTranslation` + `src/i18n/` (trim `translations` to only keys the copied pages use; keep both locales), `src/components/ui/Button.tsx` and `Modal.tsx` plus any CSS they import.

- [ ] **Step 2:** Create `src/App.tsx` with a minimal router: unauthenticated → LoginPage; authenticated → `src/pages/HomePage.tsx` rendering `<h1>EnrollX</h1>` inside the app shell. Follow admindash's `App.tsx` route-guard pattern but with only these two routes.

- [ ] **Step 3:** Smoke-import the shared package in `HomePage.tsx` to lock the dependency in CI:

```tsx
import type { RegistrationConfigDef } from '@neoapex/flow-runtime';
// (a type-only import is enough; renders nothing yet)
```

- [ ] **Step 4:** Run: `cd /Users/kennylee/Development/NeoApex/enrollx/frontend && npm install && npm run build` — expect TypeScript check + Vite build to succeed. Then `npm run lint` if an eslint config was copied.

- [ ] **Step 5: Commit**

```bash
git add enrollx/frontend
git commit -m "feat(enrollx): scaffold frontend shell with auth and flow-runtime wiring"
```

---

### Task 7: familyhub frontend scaffold

**Files:**
- Create: `familyhub/frontend/` — Vite React TS app

**Interfaces:**
- Consumes: `@neoapex/ui-tokens`, `@neoapex/flow-runtime`.
- Produces: public (no-auth) shell at localhost:6000 with a placeholder landing page — Plan 5 adds `/register/:tenantId/:programId` and `/application/:token` routes.

- [ ] **Step 1:** Same copy recipe as Task 6 but: port **6000**, title "FamilyHub", package name `familyhub-frontend`, and **no AuthContext / LoginPage / auth api** — this app never sees staff JWTs. `src/App.tsx` has one route `/` rendering `src/pages/LandingPage.tsx` (`<h1>FamilyHub</h1>` + a paragraph explaining registration links are program-specific). Include the flow-runtime type-only smoke import in LandingPage.

- [ ] **Step 2:** Run: `cd /Users/kennylee/Development/NeoApex/familyhub/frontend && npm install && npm run build` — expect success.

- [ ] **Step 3: Commit**

```bash
git add familyhub/frontend
git commit -m "feat(familyhub): scaffold public frontend shell (no staff auth surface)"
```

---

### Task 8: Seed registration entity definitions

**Files:**
- Modify: `launchpad/backend/app/data/base_model.json`

**Interfaces:**
- Produces: entity definitions consumed by Plans 2–5 via DataCore model storage. Field shape follows the existing convention: `{name, type, required}` (+ `options` for selections, `default` where noted). Types available: `str|number|bool|date|datetime|email|phone|selection`.

- [ ] **Step 1:** Open `base_model.json` and study the existing `student` entry's exact structure (`base_fields` vs `custom_fields` arrays, key names). Add the following entity types with these base_fields (all as `custom_fields: []` unless the file's convention differs):

  - `registration_config`: `config_id (str, required)`, `program_id (str, required)`, `version (number, required)`, `status (selection: draft/published/archived, required, default draft)`, `blocks (str, required)` — blocks is the JSON-serialized block array (entities store strings; the block schema is enforced by enrollx at `publish_config`, not by the model).
  - `registration_application`: `application_id (str, required)`, `program_id (str, required)`, `school_year (str, required)`, `status (selection: draft/submitted/in_review/pending_items/approved/enrolled/waitlisted/declined/withdrawn, required, default draft)`, `family_id (str)`, `student_id (str)`, `config_version (number, required)`, `channel_started (selection: parent/admin, required)`, `applicant_email (email)`, `token_version (number, default 1)`, `draft_data (str)`, `submitted_at (datetime)`, `decided_at (datetime)`.
  - `application_item`: `item_id (str, required)`, `application_id (str, required)`, `block_id (str, required)`, `kind (selection: form/document/esign/payment, required)`, `title (str, required)`, `status (selection: not_started/in_progress/submitted/verified/rejected/waived, required, default not_started)`, `blocking (bool, required)`, `due_at (datetime)`, `completed_by (str)`, `payload_ref (str)`.
  - `application_activity`: `activity_id (str, required)`, `application_id (str, required)`, `type (selection: status_change/item_change/note/email_sent, required)`, `from_value (str)`, `to_value (str)`, `actor (str, required)`, `at (datetime, required)`.
  - `document`: `document_id (str, required)`, `application_id (str, required)`, `item_id (str)`, `filename (str, required)`, `content_type (str, required)`, `size (number, required)`, `storage_key (str, required)`, `sensitive (bool, required, default false)`, `uploaded_by (str, required)`, `uploaded_at (datetime, required)`.
  - `payment`: `payment_id (str, required)`, `application_id (str, required)`, `item_id (str)`, `kind (selection: deposit/balance/full/offline, required)`, `amount (number, required)`, `currency (str, required, default USD)`, `status (selection: pending/paid/failed/refunded, required, default pending)`, `provider (selection: stripe/offline, required)`, `provider_ref (str)`, `recorded_by (str)`, `paid_at (datetime)`.
  - In the existing `program` entry, add base_field `capacity (number)` (not required).

- [ ] **Step 2:** Validate: `python3 -c "import json; d=json.load(open('launchpad/backend/app/data/base_model.json')); assert 'registration_application' in d; print(sorted(d.keys()))"` — expect the new types listed.

- [ ] **Step 3:** Run launchpad's backend test suite if one exists (`ls launchpad/backend/tests` first; if present: `cd launchpad/backend && uv run pytest tests/ -v` or the project's documented command). Expect PASS (sync-defaults is additive by design).

- [ ] **Step 4: Commit**

```bash
git add launchpad/backend/app/data/base_model.json
git commit -m "feat(launchpad): seed registration entity definitions in base model"
```

---

### Task 9: DataCore ID abbreviations

**Files:**
- Modify: `datacore/src/datacore/api/routes.py:20-25` (`DEFAULT_ABBREVS`)
- Test: `datacore/tests/` (add to the existing test module covering next-id/abbrevs — find it with `grep -rl "DEFAULT_ABBREVS\|next-id" datacore/tests/`)

**Interfaces:**
- Produces: auto-ID prefixes — `registration_config: RC`, `registration_application: RA`, `application_item: AI`, `application_activity: AA`, `document: DC`, `payment: PY`, `enrollment: EN`.

- [ ] **Step 1: Write failing test** (in the discovered test module, following its fixtures):

```python
def test_registration_abbrevs_present():
    from datacore.api.routes import DEFAULT_ABBREVS
    assert DEFAULT_ABBREVS["registration_application"] == "RA"
    assert DEFAULT_ABBREVS["registration_config"] == "RC"
    assert DEFAULT_ABBREVS["application_item"] == "AI"
    assert DEFAULT_ABBREVS["application_activity"] == "AA"
    assert DEFAULT_ABBREVS["document"] == "DC"
    assert DEFAULT_ABBREVS["payment"] == "PY"
    assert DEFAULT_ABBREVS["enrollment"] == "EN"
```

- [ ] **Step 2:** Run: `cd /Users/kennylee/Development/NeoApex/datacore && uv run python -m pytest tests/ -v -k registration_abbrevs` — expect FAIL (KeyError).

- [ ] **Step 3:** Add the seven entries to `DEFAULT_ABBREVS` in `routes.py`.

- [ ] **Step 4:** Run the FULL datacore suite: `uv run python -m pytest tests/ -v` — expect PASS.

- [ ] **Step 5: Commit**

```bash
git add datacore
git commit -m "feat(datacore): auto-ID abbreviations for registration entity types"
```

---

### Task 10: DataCore document blob API

**Files:**
- Modify: `datacore/pyproject.toml` (add `boto3`)
- Create: `datacore/src/datacore/documents.py`
- Create: `datacore/src/datacore/api/document_routes.py` (mount into the FastAPI app the same way existing route modules are mounted — find the app construction with `grep -rn "include_router\|FastAPI(" datacore/src/datacore/api/`)
- Create: `datacore/tests/test_documents_api.py`

**Interfaces:**
- Consumes: `document` entity definition (Task 8), `DC` abbrev (Task 9), the existing `Store` entity-write path (find via `grep -n "def create_entity\|def insert" datacore/src/datacore/store.py` and reuse — do NOT write LanceDB rows by hand).
- Produces (the roadmap contract): `POST /api/documents/{tenant_id}` body `{application_id, item_id?, filename, content_type, size, sensitive}` → `201 {"document_id": ..., "upload_url": ..., "storage_key": ...}`; `GET /api/documents/{tenant_id}/{document_id}/url` → `200 {"download_url": ...}`, 404 if no such document entity. Storage key format: `{tenant_id}/{application_id}/{document_id}/{filename}`.

Settings (env, no prefix change — DataCore reads plain env vars like `DATACORE_DUPLICATE_CHECK_THRESHOLD` does): `DATACORE_R2_ENDPOINT`, `DATACORE_R2_BUCKET`, `DATACORE_R2_ACCESS_KEY_ID`, `DATACORE_R2_SECRET_ACCESS_KEY`, `DATACORE_R2_URL_TTL_SECONDS` (default 900).

- [ ] **Step 1: Write failing tests.** Presigning is pure local crypto — no network — so tests run against fake credentials:

```python
# datacore/tests/test_documents_api.py
"""Document blob API: presigned R2 URLs + document entity records."""
import os

import pytest

# Fake R2 config BEFORE importing the app/module under test
os.environ.setdefault("DATACORE_R2_ENDPOINT", "https://test.r2.cloudflarestorage.com")
os.environ.setdefault("DATACORE_R2_BUCKET", "neoapex-test")
os.environ.setdefault("DATACORE_R2_ACCESS_KEY_ID", "testkey")
os.environ.setdefault("DATACORE_R2_SECRET_ACCESS_KEY", "testsecret")

from datacore.documents import build_storage_key, presign_upload, presign_download


def test_storage_key_is_tenant_prefixed():
    key = build_storage_key("acme", "RA260001", "DOC1", "immunization.pdf")
    assert key == "acme/RA260001/DOC1/immunization.pdf"


def test_presign_upload_returns_scoped_url():
    url = presign_upload("acme/RA260001/DOC1/immunization.pdf", "application/pdf")
    assert "acme/RA260001/DOC1/immunization.pdf" in url
    assert "X-Amz-Signature" in url


def test_presign_download_returns_scoped_url():
    url = presign_download("acme/RA260001/DOC1/immunization.pdf")
    assert "acme/RA260001/DOC1/immunization.pdf" in url
    assert "X-Amz-Signature" in url
```

Then endpoint tests in the same file, using the SAME test-app/store fixture pattern as the existing `datacore/tests/test_*_api.py` modules (read one first and mirror its setup — temp store dir, TestClient, auth handling). Cover: POST returns 201 with `document_id` prefixed by the tenant abbrev format and an `upload_url`; a subsequent GET `/url` returns 200; GET for an unknown id returns 404.

- [ ] **Step 2:** Run: `cd /Users/kennylee/Development/NeoApex/datacore && uv run python -m pytest tests/test_documents_api.py -v` — expect FAIL (module missing).

- [ ] **Step 3: Implement `documents.py`**

```python
# datacore/src/datacore/documents.py
"""R2-backed blob presigning. R2 is DataCore's blob backend the way LanceDB
is its table backend — no other service talks to R2 directly."""
import os
from functools import lru_cache

import boto3
from botocore.config import Config


def _ttl() -> int:
    return int(os.environ.get("DATACORE_R2_URL_TTL_SECONDS", "900"))


@lru_cache(maxsize=1)
def _client():
    return boto3.client(
        "s3",
        endpoint_url=os.environ["DATACORE_R2_ENDPOINT"],
        aws_access_key_id=os.environ["DATACORE_R2_ACCESS_KEY_ID"],
        aws_secret_access_key=os.environ["DATACORE_R2_SECRET_ACCESS_KEY"],
        config=Config(signature_version="s3v4", region_name="auto"),
    )


def build_storage_key(tenant_id: str, application_id: str, document_id: str, filename: str) -> str:
    return f"{tenant_id}/{application_id}/{document_id}/{filename}"


def presign_upload(storage_key: str, content_type: str) -> str:
    return _client().generate_presigned_url(
        "put_object",
        Params={
            "Bucket": os.environ["DATACORE_R2_BUCKET"],
            "Key": storage_key,
            "ContentType": content_type,
        },
        ExpiresIn=_ttl(),
    )


def presign_download(storage_key: str) -> str:
    return _client().generate_presigned_url(
        "get_object",
        Params={"Bucket": os.environ["DATACORE_R2_BUCKET"], "Key": storage_key},
        ExpiresIn=_ttl(),
    )
```

- [ ] **Step 4: Implement `document_routes.py`.** Follow the existing route modules' conventions exactly (auth dependency, Store access, entity-creation helper incl. next-id sequence for `document_id`, error shapes). The POST handler: validate body fields; reject `content_type` not in `{application/pdf, image/jpeg, image/png, image/heic, application/vnd.openxmlformats-officedocument.wordprocessingml.document}`; reject `size` > 20 MB (413); allocate `document_id` via the sequence mechanism; `build_storage_key`; write the `document` entity through the same code path the generic entity POST uses; return 201 with `{document_id, upload_url, storage_key}`. The GET handler: look up the active `document` entity by id (same query path other routes use); 404 if absent; return `{"download_url": presign_download(storage_key)}`.

- [ ] **Step 5:** `uv add boto3` (from `datacore/`), then run the new tests, then the FULL datacore suite. Expected: all PASS.

- [ ] **Step 6: Commit**

```bash
git add datacore
git commit -m "feat(datacore): R2-backed document blob API with presigned URLs"
```

---

### Task 11: Full-suite verification

- [ ] **Step 1:** Run every affected suite:

```bash
cd /Users/kennylee/Development/NeoApex/admindash && uv run pytest backend/tests/ -v
cd /Users/kennylee/Development/NeoApex/enrollx && uv run pytest backend/tests/ -v
cd /Users/kennylee/Development/NeoApex/familyhub && uv run pytest backend/tests/ -v
cd /Users/kennylee/Development/NeoApex/datacore && uv run python -m pytest tests/ -v
cd /Users/kennylee/Development/NeoApex/enrollx/frontend && npm run build
cd /Users/kennylee/Development/NeoApex/familyhub/frontend && npm run build
cd /Users/kennylee/Development/NeoApex/flow-runtime && npm run typecheck
```

Expected: everything green. Fix regressions before proceeding; do not skip.

- [ ] **Step 2:** Boot smoke test: `./start-services.sh`, then `curl -s localhost:5910/api/health` and `curl -s localhost:6010/api/health` both return `{"status":"ok",...}`. Kill services after.

- [ ] **Step 3: Final commit** of any stragglers, then report completion with the list of commits.
