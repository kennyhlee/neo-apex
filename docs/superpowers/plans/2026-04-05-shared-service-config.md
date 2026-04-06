# Shared Service Config Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace all hardcoded hostnames, ports, and service URLs with a centralized `services.json` config, with env var overrides for production.

**Architecture:** A root-level `services.json` defines all service endpoints. Python backends read it at startup via a shared helper; frontends read it at build time via Vite JSON import. Environment variables override for production. CORS origins are built dynamically from the frontend entries.

**Tech Stack:** Python, FastAPI, Vite, TypeScript, JSON

**Spec:** `docs/superpowers/specs/2026-04-05-shared-service-config-design.md`

---

## File Structure

| File | Responsibility |
|---|---|
| `services.json` (repo root) | Single source of truth for all service host/port mappings |
| `README.md` (repo root) | Documents port mapping, config, env vars, deployment |
| `datacore/src/datacore/api/__init__.py` | Read services.json for CORS origins |
| `launchpad/backend/app/config.py` | Read services.json for DataCore URL, Papermite URL, CORS |
| `launchpad/backend/app/main.py` | CORS from config instead of hardcoded regex |
| `papermite/backend/app/config.py` | Read services.json for DataCore URL, CORS |
| `papermite/backend/app/main.py` | CORS from config instead of hardcoded origins |
| `launchpad/frontend/vite.config.ts` | Port from services.json |
| `launchpad/frontend/src/api/client.ts` | API URL from env/config |
| `launchpad/frontend/src/App.tsx` | Papermite URL from env/config |
| `launchpad/frontend/src/pages/TenantSettingsPage.tsx` | Papermite URL from env/config |
| `papermite/frontend/vite.config.ts` | Port from services.json |
| `papermite/frontend/src/api/client.ts` | API URL from env/config |
| `papermite/frontend/src/pages/LoginPage.tsx` | Use client.ts BASE_URL instead of hardcoded |
| `admindash/frontend/vite.config.ts` | Port from services.json |
| `admindash/frontend/src/api/client.ts` | API URLs from env/config |
| `admindash/frontend/src/contexts/AuthContext.tsx` | Auth URL from env/config |
| `admindash/frontend/src/pages/StudentsPage.tsx` | Remove hardcoded URL from error message |

---

### Task 1: Create services.json

**Files:**
- Create: `services.json`

- [ ] **Step 1: Create the config file**

Create `services.json` at the repo root:

```json
{
  "services": {
    "launchpad-frontend": { "host": "localhost", "port": 6000 },
    "launchpad-backend": { "host": "localhost", "port": 6010 },
    "admindash-frontend": { "host": "localhost", "port": 6100 },
    "papermite-frontend": { "host": "localhost", "port": 6200 },
    "papermite-backend": { "host": "localhost", "port": 6210 },
    "datacore": { "host": "localhost", "port": 6300 }
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add services.json
git commit -m "chore: add services.json with centralized port config"
```

---

### Task 2: Update DataCore backend to read services.json for CORS

**Files:**
- Modify: `datacore/src/datacore/api/__init__.py`

- [ ] **Step 1: Update create_app to accept optional CORS origins**

Replace `datacore/src/datacore/api/__init__.py`:

```python
"""FastAPI REST API layer for datacore."""

import json
import os
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from datacore.store import Store
from datacore.api.routes import register_routes
from datacore.api.auth_routes import register_auth_routes


def _load_cors_origins() -> list[str]:
    """Build CORS allowed origins from services.json or env var override."""
    env_origins = os.environ.get("CORS_ALLOWED_ORIGINS")
    if env_origins:
        return [o.strip() for o in env_origins.split(",") if o.strip()]

    config_path = Path(__file__).resolve().parent.parent.parent.parent.parent / "services.json"
    if not config_path.exists():
        return []

    with open(config_path) as f:
        config = json.load(f)

    frontend_keys = [k for k in config["services"] if k.endswith("-frontend")]
    origins = []
    for key in frontend_keys:
        svc = config["services"][key]
        origins.append(f"http://{svc['host']}:{svc['port']}")
    return origins


def create_app(store: Store) -> FastAPI:
    """Create and configure the FastAPI application."""
    app = FastAPI(title="datacore")

    app.add_middleware(
        CORSMiddleware,
        allow_origins=_load_cors_origins(),
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    register_routes(app, store)
    register_auth_routes(app, store)

    return app
```

- [ ] **Step 2: Run existing DataCore tests**

Run: `cd datacore && uv run python -m pytest tests/ -q`
Expected: All tests pass. The CORS tests in `test_api.py` will need updating in a later step since they check old ports.

- [ ] **Step 3: Update CORS tests for new ports**

In `datacore/tests/test_api.py`, update the CORS test assertions. The tests currently check ports 5173 and 5174. Update them to check ports 6200 (papermite-frontend) and 6100 (admindash-frontend):

Find the test `test_cors_allows_admindash_origin` and change:
- `"Origin": "http://localhost:5174"` → `"Origin": "http://localhost:6100"`
- `assert response.headers.get("access-control-allow-origin") == "http://localhost:5174"` → `assert response.headers.get("access-control-allow-origin") == "http://localhost:6100"`

Find the test `test_cors_allows_papermite_origin` and change:
- `"Origin": "http://localhost:5173"` → `"Origin": "http://localhost:6200"`
- `assert response.headers.get("access-control-allow-origin") == "http://localhost:5173"` → `assert response.headers.get("access-control-allow-origin") == "http://localhost:6200"`

- [ ] **Step 4: Run tests again**

Run: `cd datacore && uv run python -m pytest tests/ -q`
Expected: All tests pass

- [ ] **Step 5: Commit**

```bash
git add datacore/src/datacore/api/__init__.py datacore/tests/test_api.py
git commit -m "refactor(datacore): read CORS origins from services.json"
```

---

### Task 3: Update LaunchPad backend config and CORS

**Files:**
- Modify: `launchpad/backend/app/config.py`
- Modify: `launchpad/backend/app/main.py`

- [ ] **Step 1: Update LaunchPad config to read services.json**

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
    return [_svc_url(k) for k in _services if k.endswith("-frontend")]


class Settings(BaseSettings):
    datacore_auth_url: str = _svc_url("datacore") + "/auth"
    datacore_store_path: Path = Path(os.environ.get(
        "NEOAPEX_LANCEDB_DIR",
        str(Path(__file__).resolve().parent.parent.parent.parent
            / "datacore" / "data" / "lancedb"),
    ))
    papermite_frontend_url: str = _svc_url("papermite-frontend")
    port: int = _services.get("launchpad-backend", {}).get("port", 6010)
    cors_origins: list[str] = _cors_origins()
    model_config = {"env_prefix": "LAUNCHPAD_"}

settings = Settings()
```

- [ ] **Step 2: Update LaunchPad main.py to use config CORS**

Replace the CORS middleware section in `launchpad/backend/app/main.py`:

```python
"""FastAPI application entry point for Launchpad."""
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api import auth, tenants, users
from app.config import settings

app = FastAPI(
    title="Launchpad",
    description="Tenant lifecycle and identity service for the NeoApex platform",
    version="0.1.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router, prefix="/api", tags=["auth"])
app.include_router(tenants.router, prefix="/api", tags=["tenants"])
app.include_router(users.router, prefix="/api", tags=["users"])

@app.get("/api/health")
def health():
    return {"status": "ok"}
```

- [ ] **Step 3: Update any references to `papermite_url` → `papermite_frontend_url`**

Search LaunchPad backend for references to the old `settings.papermite_url` and update to `settings.papermite_frontend_url`. Check `app/api/tenants.py` and other files.

Run: `grep -r "papermite_url" launchpad/backend/app/ --include="*.py"`

Update any matches.

- [ ] **Step 4: Verify LaunchPad starts**

Run: `cd launchpad/backend && python -c "from app.main import app; print('OK')"`
Expected: `OK`

- [ ] **Step 5: Commit**

```bash
git add launchpad/backend/app/config.py launchpad/backend/app/main.py
git commit -m "refactor(launchpad): read config and CORS from services.json"
```

---

### Task 4: Update Papermite backend config and CORS

**Files:**
- Modify: `papermite/backend/app/config.py`
- Modify: `papermite/backend/app/main.py`

- [ ] **Step 1: Update Papermite config to read services.json**

Replace `papermite/backend/app/config.py`:

```python
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
    port = svc.get("port", 6210)
    return f"http://{host}:{port}"


def _cors_origins() -> list[str]:
    env_origins = os.environ.get("CORS_ALLOWED_ORIGINS")
    if env_origins:
        return [o.strip() for o in env_origins.split(",") if o.strip()]
    return [_svc_url(k) for k in _services if k.endswith("-frontend")]


class Settings(BaseSettings):
    datacore_auth_url: str = _svc_url("datacore") + "/auth"
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
    port: int = _services.get("papermite-backend", {}).get("port", 6210)
    cors_origins: list[str] = _cors_origins()

    model_config = {"env_prefix": "PAPERMITE_"}


settings = Settings()
```

- [ ] **Step 2: Update Papermite main.py to use config CORS**

Replace the CORS middleware section in `papermite/backend/app/main.py`:

```python
"""FastAPI application entry point for Papermite."""
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api import auth, upload, extraction, finalize, extract
from app.config import settings

app = FastAPI(
    title="Papermite",
    description="Document ingestion gateway for the NeoApex platform",
    version="0.1.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router, prefix="/api", tags=["auth"])
app.include_router(upload.router, prefix="/api", tags=["upload"])
app.include_router(extraction.router, prefix="/api", tags=["schema"])
app.include_router(finalize.router, prefix="/api", tags=["finalize"])
app.include_router(extract.router, prefix="/api", tags=["extract"])
```

- [ ] **Step 3: Verify Papermite starts**

Run: `cd papermite/backend && python -c "from app.main import app; print('OK')"`
Expected: `OK`

- [ ] **Step 4: Commit**

```bash
git add papermite/backend/app/config.py papermite/backend/app/main.py
git commit -m "refactor(papermite): read config and CORS from services.json"
```

---

### Task 5: Update LaunchPad frontend

**Files:**
- Modify: `launchpad/frontend/vite.config.ts`
- Modify: `launchpad/frontend/src/api/client.ts`
- Modify: `launchpad/frontend/src/App.tsx`
- Modify: `launchpad/frontend/src/pages/TenantSettingsPage.tsx`

- [ ] **Step 1: Update vite.config.ts to read port from services.json**

Replace `launchpad/frontend/vite.config.ts`:

```typescript
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import services from '../../services.json'

export default defineConfig({
  plugins: [react()],
  server: { port: services.services["launchpad-frontend"].port },
})
```

- [ ] **Step 2: Update client.ts to use env var with services.json fallback**

In `launchpad/frontend/src/api/client.ts`, replace the `BASE_URL` constant:

```typescript
import services from '../../../../services.json';

const BASE_URL = import.meta.env.VITE_LAUNCHPAD_BACKEND_URL
  || `http://${services.services["launchpad-backend"].host}:${services.services["launchpad-backend"].port}/api`;
```

- [ ] **Step 3: Create a config helper for service URLs**

Create `launchpad/frontend/src/config.ts`:

```typescript
import services from '../../../services.json';

function svcUrl(key: string): string {
  const svc = services.services[key as keyof typeof services.services];
  return `http://${svc.host}:${svc.port}`;
}

export const LAUNCHPAD_BACKEND_URL = import.meta.env.VITE_LAUNCHPAD_BACKEND_URL || svcUrl("launchpad-backend");
export const LAUNCHPAD_API_URL = `${LAUNCHPAD_BACKEND_URL}/api`;
export const PAPERMITE_FRONTEND_URL = import.meta.env.VITE_PAPERMITE_FRONTEND_URL || svcUrl("papermite-frontend");
```

- [ ] **Step 4: Update client.ts to use config**

In `launchpad/frontend/src/api/client.ts`, replace the import and BASE_URL:

```typescript
import { LAUNCHPAD_API_URL } from "../config";

const BASE_URL = LAUNCHPAD_API_URL;
```

Remove the `services.json` import added in step 2 (the config module handles it now).

- [ ] **Step 5: Update App.tsx**

In `launchpad/frontend/src/App.tsx`, find the hardcoded `papermiteUrl="http://localhost:5173"` and replace:

```typescript
import { PAPERMITE_FRONTEND_URL } from "./config";
```

Then change:
```typescript
papermiteUrl="http://localhost:5173"
```
to:
```typescript
papermiteUrl={PAPERMITE_FRONTEND_URL}
```

- [ ] **Step 6: Update TenantSettingsPage.tsx**

In `launchpad/frontend/src/pages/TenantSettingsPage.tsx`, find the hardcoded redirect URL and replace:

```typescript
import { PAPERMITE_FRONTEND_URL } from "../config";
```

Then change:
```typescript
window.location.href = `http://localhost:5173/?tenant_id=${user.tenant_id}&token=${encodeURIComponent(token || "")}&return_url=${encodeURIComponent(returnUrl)}`;
```
to:
```typescript
window.location.href = `${PAPERMITE_FRONTEND_URL}/?tenant_id=${user.tenant_id}&token=${encodeURIComponent(token || "")}&return_url=${encodeURIComponent(returnUrl)}`;
```

- [ ] **Step 7: Verify TypeScript compiles**

Run: `cd launchpad/frontend && npx tsc -b`
Expected: No errors

- [ ] **Step 8: Commit**

```bash
git add launchpad/frontend/vite.config.ts launchpad/frontend/src/config.ts launchpad/frontend/src/api/client.ts launchpad/frontend/src/App.tsx launchpad/frontend/src/pages/TenantSettingsPage.tsx
git commit -m "refactor(launchpad): read service URLs from services.json"
```

---

### Task 6: Update Papermite frontend

**Files:**
- Modify: `papermite/frontend/vite.config.ts`
- Create: `papermite/frontend/src/config.ts`
- Modify: `papermite/frontend/src/api/client.ts`
- Modify: `papermite/frontend/src/pages/LoginPage.tsx`

- [ ] **Step 1: Update vite.config.ts**

Replace `papermite/frontend/vite.config.ts`:

```typescript
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import services from '../../services.json'

export default defineConfig({
  plugins: [react()],
  server: { port: services.services["papermite-frontend"].port },
})
```

- [ ] **Step 2: Create config.ts**

Create `papermite/frontend/src/config.ts`:

```typescript
import services from '../../../services.json';

function svcUrl(key: string): string {
  const svc = services.services[key as keyof typeof services.services];
  return `http://${svc.host}:${svc.port}`;
}

export const PAPERMITE_BACKEND_URL = import.meta.env.VITE_PAPERMITE_BACKEND_URL || svcUrl("papermite-backend");
export const PAPERMITE_API_URL = `${PAPERMITE_BACKEND_URL}/api`;
```

- [ ] **Step 3: Update client.ts**

In `papermite/frontend/src/api/client.ts`, replace the BASE_URL:

```typescript
import { PAPERMITE_API_URL } from "../config";

const BASE_URL = PAPERMITE_API_URL;
```

Remove the old `const BASE_URL = "http://localhost:8000/api";` line.

- [ ] **Step 4: Update LoginPage.tsx**

In `papermite/frontend/src/pages/LoginPage.tsx`, find the hardcoded fetch URL:

```typescript
const res = await fetch("http://localhost:8000/api/login", {
```

Replace with an import from client.ts. The `login` function in `client.ts` already handles this call, so check if LoginPage uses the client function or duplicates it. If it duplicates, refactor to use the `login` function from `client.ts`. If it must stay inline, import `PAPERMITE_API_URL` from config:

```typescript
import { PAPERMITE_API_URL } from "../config";
```

Then change:
```typescript
const res = await fetch("http://localhost:8000/api/login", {
```
to:
```typescript
const res = await fetch(`${PAPERMITE_API_URL}/login`, {
```

- [ ] **Step 5: Verify TypeScript compiles**

Run: `cd papermite/frontend && npx tsc -b`
Expected: No errors

- [ ] **Step 6: Commit**

```bash
git add papermite/frontend/vite.config.ts papermite/frontend/src/config.ts papermite/frontend/src/api/client.ts papermite/frontend/src/pages/LoginPage.tsx
git commit -m "refactor(papermite): read service URLs from services.json"
```

---

### Task 7: Update AdminDash frontend

**Files:**
- Modify: `admindash/frontend/vite.config.ts`
- Create: `admindash/frontend/src/config.ts`
- Modify: `admindash/frontend/src/api/client.ts`
- Modify: `admindash/frontend/src/contexts/AuthContext.tsx`
- Modify: `admindash/frontend/src/pages/StudentsPage.tsx`

- [ ] **Step 1: Update vite.config.ts**

Replace `admindash/frontend/vite.config.ts`:

```typescript
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import services from '../../services.json'

export default defineConfig({
  plugins: [react()],
  server: {
    port: services.services["admindash-frontend"].port,
  },
})
```

- [ ] **Step 2: Create config.ts**

Create `admindash/frontend/src/config.ts`:

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

- [ ] **Step 3: Update client.ts**

In `admindash/frontend/src/api/client.ts`, replace the hardcoded constants:

```typescript
import { DATACORE_URL, PAPERMITE_BACKEND_URL } from '../config.ts';

const API_BASE = 'http://localhost:8080';
const DATACORE_API_BASE = DATACORE_URL;
const PAPERMITE_API_BASE = PAPERMITE_BACKEND_URL;
```

Note: `API_BASE` at `localhost:8080` is a legacy reference with no actual backend. Leave it for now or replace with a TODO comment — this is a pre-existing issue unrelated to this task.

- [ ] **Step 4: Update AuthContext.tsx**

In `admindash/frontend/src/contexts/AuthContext.tsx`, replace the hardcoded URL:

```typescript
import { DATACORE_AUTH_URL } from '../config.ts';
```

Remove the old constant:
```typescript
const DATACORE_AUTH_URL = 'http://localhost:8081/auth';
```

The rest of the file stays the same since it already uses `DATACORE_AUTH_URL`.

- [ ] **Step 5: Update StudentsPage.tsx**

In `admindash/frontend/src/pages/StudentsPage.tsx`, find the hardcoded URL in the error message at line 290:

```typescript
`Failed to load students. Is the datacore API at http://localhost:8081 running? (${err})`
```

Replace with:

```typescript
import { DATACORE_URL } from '../config.ts';
```

```typescript
`Failed to load students. Is the datacore API at ${DATACORE_URL} running? (${err})`
```

- [ ] **Step 6: Verify TypeScript compiles**

Run: `cd admindash/frontend && npx tsc -b`
Expected: No errors

- [ ] **Step 7: Commit**

```bash
git add admindash/frontend/vite.config.ts admindash/frontend/src/config.ts admindash/frontend/src/api/client.ts admindash/frontend/src/contexts/AuthContext.tsx admindash/frontend/src/pages/StudentsPage.tsx
git commit -m "refactor(admindash): read service URLs from services.json"
```

---

### Task 8: Write README

**Files:**
- Create: `README.md`

- [ ] **Step 1: Create README.md at repo root**

Create `README.md`:

```markdown
# NeoApex

Multi-service education/enrollment management platform.

## Services

| Service | Description | Port | Block |
|---|---|---|---|
| LaunchPad frontend | Tenant onboarding & admin UI | 6000 | 60xx |
| LaunchPad backend | Tenant lifecycle & identity API | 6010 | 60xx |
| AdminDash frontend | Operations dashboard UI | 6100 | 61xx |
| Papermite frontend | Document ingestion UI | 6200 | 62xx |
| Papermite backend | Document ingestion API | 6210 | 62xx |
| DataCore backend | Storage, query engine & auth server | 6300 | 63xx |

**Port convention:** Each service owns a 100-port block. Frontend = `X00`, backend = `X10`.

## Configuration

### services.json

All service hostnames and ports are defined in `services.json` at the repo root:

```json
{
  "services": {
    "launchpad-frontend": { "host": "localhost", "port": 6000 },
    "launchpad-backend": { "host": "localhost", "port": 6010 },
    "admindash-frontend": { "host": "localhost", "port": 6100 },
    "papermite-frontend": { "host": "localhost", "port": 6200 },
    "papermite-backend": { "host": "localhost", "port": 6210 },
    "datacore": { "host": "localhost", "port": 6300 }
  }
}
```

**To change a port for local development**, edit `services.json` and restart the affected services. All services read from this file — no need to update multiple config files.

### Backend Configuration

Python backends read `services.json` at startup. Environment variables override for production deployment.

#### DataCore

| Variable | Description | Default |
|---|---|---|
| `DATACORE_JWT_SECRET` | JWT signing secret | `neoapex-dev-secret-change-in-prod` |
| `DATACORE_JWT_EXPIRY_HOURS` | JWT token expiry in hours | `24` |
| `NEOAPEX_LANCEDB_DIR` | LanceDB data directory | `datacore/data/lancedb` |
| `CORS_ALLOWED_ORIGINS` | Comma-separated CORS origins (overrides services.json) | Built from frontend entries |

#### LaunchPad Backend

| Variable | Description | Default |
|---|---|---|
| `LAUNCHPAD_DATACORE_AUTH_URL` | DataCore auth endpoint | `http://localhost:6300/auth` |
| `LAUNCHPAD_PAPERMITE_FRONTEND_URL` | Papermite frontend URL (for redirects) | `http://localhost:6200` |
| `LAUNCHPAD_PORT` | LaunchPad backend port | `6010` |
| `NEOAPEX_LANCEDB_DIR` | LanceDB data directory | `datacore/data/lancedb` |
| `CORS_ALLOWED_ORIGINS` | Comma-separated CORS origins (overrides services.json) | Built from frontend entries |

#### Papermite Backend

| Variable | Description | Default |
|---|---|---|
| `PAPERMITE_DATACORE_AUTH_URL` | DataCore auth endpoint | `http://localhost:6300/auth` |
| `PAPERMITE_PORT` | Papermite backend port | `6210` |
| `NEOAPEX_LANCEDB_DIR` | LanceDB data directory | `datacore/data/lancedb` |
| `CORS_ALLOWED_ORIGINS` | Comma-separated CORS origins (overrides services.json) | Built from frontend entries |

### Frontend Configuration

React frontends read `services.json` at build time via Vite's JSON import. For production builds, use `VITE_` prefixed environment variables to override.

#### LaunchPad Frontend

| Variable | Description | Default |
|---|---|---|
| `VITE_LAUNCHPAD_BACKEND_URL` | LaunchPad backend base URL | `http://localhost:6010` |
| `VITE_PAPERMITE_FRONTEND_URL` | Papermite frontend URL (for cross-app navigation) | `http://localhost:6200` |

#### Papermite Frontend

| Variable | Description | Default |
|---|---|---|
| `VITE_PAPERMITE_BACKEND_URL` | Papermite backend base URL | `http://localhost:6210` |

#### AdminDash Frontend

| Variable | Description | Default |
|---|---|---|
| `VITE_DATACORE_URL` | DataCore API base URL | `http://localhost:6300` |
| `VITE_DATACORE_AUTH_URL` | DataCore auth endpoint | `http://localhost:6300/auth` |
| `VITE_PAPERMITE_BACKEND_URL` | Papermite backend base URL | `http://localhost:6210` |

### CORS

All backends build their CORS allowed origins dynamically from the frontend entries in `services.json`. In production, set `CORS_ALLOWED_ORIGINS` as a comma-separated list to override:

```bash
CORS_ALLOWED_ORIGINS=https://app.neoapex.com,https://admin.neoapex.com
```

## Production Deployment

In production (AWS ECS, Lambda, EKS, etc.), `services.json` is not used. Instead:

1. **Backend services** read configuration from environment variables set in the deployment configuration (ECS task definitions, Kubernetes ConfigMaps, etc.)
2. **Frontend apps** are built with `VITE_` env vars injected at build time in CI/CD
3. **CORS origins** are set via `CORS_ALLOWED_ORIGINS` env var on each backend

All services sit behind a reverse proxy/load balancer on port 443 in production.

## Quick Start

```bash
# Start all services (from repo root)

# 1. DataCore (port 6300)
cd datacore && uv run python3 -c "
from datacore import Store, create_app
from datacore.auth.seed import seed_test_user
import uvicorn
store = Store()
seed_test_user(store)
app = create_app(store)
uvicorn.run(app, host='127.0.0.1', port=6300)
"

# 2. LaunchPad backend (port 6010)
cd launchpad/backend && uvicorn app.main:app --port 6010

# 3. Papermite backend (port 6210)
cd papermite/backend && uvicorn app.main:app --port 6210

# 4. LaunchPad frontend (port 6000)
cd launchpad/frontend && npm run dev

# 5. Papermite frontend (port 6200)
cd papermite/frontend && npm run dev

# 6. AdminDash frontend (port 6100)
cd admindash/frontend && npm run dev
```

Test login: `jane@acme.edu` / `admin123`
```

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: add README with service config, ports, and deployment guide"
```

---

### Task 9: Verify all services start on new ports

- [ ] **Step 1: Start DataCore on port 6300**

Run: `cd datacore && uv run python3 -c "from datacore import Store, create_app; from datacore.auth.seed import seed_test_user; import uvicorn; store = Store(); seed_test_user(store); app = create_app(store); uvicorn.run(app, host='127.0.0.1', port=6300)"`

- [ ] **Step 2: Verify DataCore auth works**

```bash
curl -s -X POST http://localhost:6300/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"jane@acme.edu","password":"admin123"}' | python3 -m json.tool
```

Expected: Returns token and user

- [ ] **Step 3: Start LaunchPad backend on port 6010**

Run: `cd launchpad/backend && uvicorn app.main:app --port 6010`

- [ ] **Step 4: Start Papermite backend on port 6210**

Run: `cd papermite/backend && uvicorn app.main:app --port 6210`

- [ ] **Step 5: Start all frontends**

```bash
cd launchpad/frontend && npm run dev   # Should start on 6000
cd papermite/frontend && npm run dev   # Should start on 6200
cd admindash/frontend && npm run dev   # Should start on 6100
```

- [ ] **Step 6: Verify login on each frontend**

Open each in browser and login with `jane@acme.edu` / `admin123`:
- LaunchPad: `http://localhost:6000`
- AdminDash: `http://localhost:6100`
- Papermite: `http://localhost:6200`

- [ ] **Step 7: Run all DataCore tests**

Run: `cd datacore && uv run python -m pytest tests/ -q`
Expected: All tests pass
