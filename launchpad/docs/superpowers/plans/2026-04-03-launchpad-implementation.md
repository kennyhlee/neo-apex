# Launchpad Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Launchpad module — NeoApex's centralized tenant lifecycle and identity service with signup, onboarding, tenant config, user management, and JWT auth.

**Architecture:** Standalone FastAPI backend + React/TypeScript/Vite frontend mirroring Papermite's structure. Data stored via datacore: global `registry` table (users, onboarding status) and per-tenant entity tables (tenant profile). Datacore must first be extended with global table support. Shared `@neoapex/ui-tokens` package provides design tokens.

**Tech Stack:** Python 3.11+, FastAPI, PyJWT, bcrypt, datacore (LanceDB), React 19, TypeScript, Vite 8, React Router v7

---

## Phase 0: Datacore Global Table Extension

### Task 1: Add global table schema and methods to datacore Store

**Files:**
- Modify: `/Users/kennylee/Development/NeoApex/datacore/src/datacore/store.py`
- Create: `/Users/kennylee/Development/NeoApex/datacore/tests/test_global_tables.py`

The datacore Store currently only supports tenant-scoped tables (`{tenant_id}_models`, `{tenant_id}_entities`). We need global tables for cross-tenant data like the `registry` table. Global tables use a simple key-value schema with JSON-encoded data.

- [ ] **Step 1: Write failing tests for global table CRUD**

Create `/Users/kennylee/Development/NeoApex/datacore/tests/test_global_tables.py`:

```python
"""Tests for global (non-tenant-scoped) table support."""
import pytest
import tempfile
from datacore import Store


@pytest.fixture
def store():
    with tempfile.TemporaryDirectory() as d:
        yield Store(data_dir=d)


class TestPutGlobal:
    def test_creates_record(self, store):
        result = store.put_global("registry", "user:u-001", {
            "email": "jane@acme.edu",
            "name": "Jane Admin",
            "tenant_id": "acme",
            "role": "admin",
        })
        assert result["record_key"] == "user:u-001"
        assert result["data"]["email"] == "jane@acme.edu"
        assert result["_created_at"] is not None

    def test_updates_existing_record(self, store):
        store.put_global("registry", "user:u-001", {"name": "Jane"})
        result = store.put_global("registry", "user:u-001", {"name": "Jane Updated"})
        assert result["data"]["name"] == "Jane Updated"
        assert result["_updated_at"] is not None


class TestGetGlobal:
    def test_returns_record(self, store):
        store.put_global("registry", "user:u-001", {"email": "jane@acme.edu"})
        result = store.get_global("registry", "user:u-001")
        assert result is not None
        assert result["data"]["email"] == "jane@acme.edu"

    def test_returns_none_for_missing(self, store):
        result = store.get_global("registry", "nonexistent")
        assert result is None


class TestQueryGlobal:
    def test_returns_all_records(self, store):
        store.put_global("registry", "user:u-001", {"email": "a@test.com", "tenant_id": "t1"})
        store.put_global("registry", "user:u-002", {"email": "b@test.com", "tenant_id": "t1"})
        store.put_global("registry", "user:u-003", {"email": "c@test.com", "tenant_id": "t2"})
        results = store.query_global("registry")
        assert len(results) == 3

    def test_filters_by_field(self, store):
        store.put_global("registry", "user:u-001", {"email": "a@test.com", "tenant_id": "t1"})
        store.put_global("registry", "user:u-002", {"email": "b@test.com", "tenant_id": "t2"})
        results = store.query_global("registry", filters={"tenant_id": "t1"})
        assert len(results) == 1
        assert results[0]["data"]["email"] == "a@test.com"

    def test_returns_empty_for_no_matches(self, store):
        store.put_global("registry", "user:u-001", {"email": "a@test.com", "tenant_id": "t1"})
        results = store.query_global("registry", filters={"tenant_id": "nonexistent"})
        assert len(results) == 0


class TestDeleteGlobal:
    def test_deletes_record(self, store):
        store.put_global("registry", "user:u-001", {"email": "a@test.com"})
        deleted = store.delete_global("registry", "user:u-001")
        assert deleted is True
        assert store.get_global("registry", "user:u-001") is None

    def test_returns_false_for_missing(self, store):
        deleted = store.delete_global("registry", "nonexistent")
        assert deleted is False
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /Users/kennylee/Development/NeoApex/datacore && python -m pytest tests/test_global_tables.py -v`
Expected: FAIL with `AttributeError: 'Store' object has no attribute 'put_global'`

- [ ] **Step 3: Add global table schema and methods to Store**

In `/Users/kennylee/Development/NeoApex/datacore/src/datacore/store.py`, add the schema constant after `SEQUENCES_SCHEMA` (around line 67):

```python
GLOBAL_SCHEMA = pa.schema([
    pa.field("record_key", pa.string()),
    pa.field("data", pa.string()),  # JSON-encoded
    pa.field("_created_at", pa.string()),
    pa.field("_updated_at", pa.string()),
])
```

Add these methods to the `Store` class, after the `get_table_as_arrow` method (end of class):

```python
    # ── Global (non-tenant-scoped) tables ──────────────────────

    def put_global(self, table_name: str, record_key: str, data: dict) -> dict:
        """Create or update a record in a global table."""
        table = self._open_or_create(table_name, GLOBAL_SCHEMA)
        now = self._now()

        # Check if record exists
        existing = table.search().where(
            f"record_key = '{record_key}'"
        ).to_list()

        if existing:
            # Delete old record, insert updated
            table.delete(f"record_key = '{record_key}'")
            record = {
                "record_key": record_key,
                "data": json.dumps(data),
                "_created_at": existing[0]["_created_at"],
                "_updated_at": now,
            }
        else:
            record = {
                "record_key": record_key,
                "data": json.dumps(data),
                "_created_at": now,
                "_updated_at": now,
            }

        table.add([record])
        return {
            "record_key": record_key,
            "data": data,
            "_created_at": record["_created_at"],
            "_updated_at": record["_updated_at"],
        }

    def get_global(self, table_name: str, record_key: str) -> dict | None:
        """Get a single record from a global table by key."""
        if table_name not in self._table_names():
            return None
        table = self._db.open_table(table_name)
        rows = table.search().where(
            f"record_key = '{record_key}'"
        ).to_list()
        if not rows:
            return None
        row = rows[0]
        return {
            "record_key": row["record_key"],
            "data": json.loads(row["data"]),
            "_created_at": row["_created_at"],
            "_updated_at": row["_updated_at"],
        }

    def query_global(
        self, table_name: str, filters: dict | None = None
    ) -> list[dict]:
        """Query all records from a global table, optionally filtering by data fields."""
        if table_name not in self._table_names():
            return []
        table = self._db.open_table(table_name)
        rows = table.search().to_list()
        results = []
        for row in rows:
            data = json.loads(row["data"])
            if filters:
                if not all(data.get(k) == v for k, v in filters.items()):
                    continue
            results.append({
                "record_key": row["record_key"],
                "data": data,
                "_created_at": row["_created_at"],
                "_updated_at": row["_updated_at"],
            })
        return results

    def delete_global(self, table_name: str, record_key: str) -> bool:
        """Delete a record from a global table. Returns True if deleted."""
        if table_name not in self._table_names():
            return False
        table = self._db.open_table(table_name)
        existing = table.search().where(
            f"record_key = '{record_key}'"
        ).to_list()
        if not existing:
            return False
        table.delete(f"record_key = '{record_key}'")
        return True
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /Users/kennylee/Development/NeoApex/datacore && python -m pytest tests/test_global_tables.py -v`
Expected: All 8 tests PASS

- [ ] **Step 5: Run full datacore test suite to verify no regressions**

Run: `cd /Users/kennylee/Development/NeoApex/datacore && python -m pytest -v`
Expected: All existing tests still PASS

- [ ] **Step 6: Commit**

```bash
cd /Users/kennylee/Development/NeoApex/datacore
git add src/datacore/store.py tests/test_global_tables.py
git commit -m "feat: add global table support to datacore Store

Add put_global, get_global, query_global, delete_global methods for
non-tenant-scoped tables. Used by Launchpad for the registry table."
```

---

## Phase 1: Project Scaffolding

### Task 2: Create Launchpad backend project structure

**Files:**
- Create: `/Users/kennylee/Development/NeoApex/launchpad/backend/app/__init__.py`
- Create: `/Users/kennylee/Development/NeoApex/launchpad/backend/app/main.py`
- Create: `/Users/kennylee/Development/NeoApex/launchpad/backend/app/config.py`
- Create: `/Users/kennylee/Development/NeoApex/launchpad/pyproject.toml`
- Create: `/Users/kennylee/Development/NeoApex/launchpad/test_user.json`

- [ ] **Step 1: Create directory structure**

```bash
mkdir -p /Users/kennylee/Development/NeoApex/launchpad/backend/app/{api,models,storage}
touch /Users/kennylee/Development/NeoApex/launchpad/backend/app/__init__.py
touch /Users/kennylee/Development/NeoApex/launchpad/backend/app/api/__init__.py
touch /Users/kennylee/Development/NeoApex/launchpad/backend/app/models/__init__.py
touch /Users/kennylee/Development/NeoApex/launchpad/backend/app/storage/__init__.py
```

- [ ] **Step 2: Create pyproject.toml**

Create `/Users/kennylee/Development/NeoApex/launchpad/pyproject.toml`:

```toml
[project]
name = "launchpad"
version = "0.1.0"
description = "Tenant lifecycle and identity service for the NeoApex platform"
requires-python = ">=3.11"
dependencies = [
    "fastapi>=0.115",
    "uvicorn[standard]>=0.30",
    "pydantic>=2.0",
    "pydantic-settings>=2.0",
    "datacore @ file:///Users/kennylee/Development/NeoApex/datacore",
    "PyJWT>=2.8",
    "bcrypt>=4.0",
]

[project.optional-dependencies]
dev = [
    "pytest>=8.0",
    "httpx>=0.27",
]

[build-system]
requires = ["hatchling"]
build-backend = "hatchling.build"

[tool.hatch.metadata]
allow-direct-references = true

[tool.hatch.build.targets.wheel]
packages = ["backend/app"]
```

- [ ] **Step 3: Create config.py**

Create `/Users/kennylee/Development/NeoApex/launchpad/backend/app/config.py`:

```python
"""Launchpad configuration — settings, JWT config, datacore path."""
import os
from pathlib import Path

from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    jwt_secret: str = "neoapex-dev-secret-change-in-prod"
    jwt_expiry_hours: int = 24
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

- [ ] **Step 4: Create main.py**

Create `/Users/kennylee/Development/NeoApex/launchpad/backend/app/main.py`:

```python
"""FastAPI application entry point for Launchpad."""
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI(
    title="Launchpad",
    description="Tenant lifecycle and identity service for the NeoApex platform",
    version="0.1.0",
)

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


@app.get("/api/health")
def health():
    return {"status": "ok"}
```

- [ ] **Step 5: Create test_user.json**

Create `/Users/kennylee/Development/NeoApex/launchpad/test_user.json`:

```json
{
  "users": [
    {
      "user_id": "u-001",
      "name": "Jane Admin",
      "email": "jane@acme.edu",
      "password": "admin123",
      "tenant_id": "acme",
      "tenant_name": "Acme Afterschool",
      "role": "admin"
    }
  ]
}
```

- [ ] **Step 6: Create venv and install**

```bash
cd /Users/kennylee/Development/NeoApex/launchpad
python3 -m venv .venv
source .venv/bin/activate
pip install -e ".[dev]"
```

- [ ] **Step 7: Verify backend starts**

```bash
cd /Users/kennylee/Development/NeoApex/launchpad
source .venv/bin/activate
uvicorn app.main:app --port 8001 &
sleep 2
curl -s http://localhost:8001/api/health
kill %1
```
Expected: `{"status":"ok"}`

- [ ] **Step 8: Commit**

```bash
cd /Users/kennylee/Development/NeoApex/launchpad
git add backend/ pyproject.toml test_user.json
git commit -m "feat: scaffold Launchpad backend — FastAPI + config + health endpoint"
```

---

### Task 3: Create shared UI tokens package

**Files:**
- Create: `/Users/kennylee/Development/NeoApex/ui-tokens/package.json`
- Create: `/Users/kennylee/Development/NeoApex/ui-tokens/tokens.css`

Design tokens are extracted from Papermite's `index.css` `:root` block. This is a CSS-only package — no build step.

- [ ] **Step 1: Create package structure**

```bash
mkdir -p /Users/kennylee/Development/NeoApex/ui-tokens
```

- [ ] **Step 2: Create package.json**

Create `/Users/kennylee/Development/NeoApex/ui-tokens/package.json`:

```json
{
  "name": "@neoapex/ui-tokens",
  "version": "0.1.0",
  "description": "Shared design tokens for NeoApex modules",
  "main": "tokens.css",
  "files": ["tokens.css"]
}
```

- [ ] **Step 3: Create tokens.css**

Create `/Users/kennylee/Development/NeoApex/ui-tokens/tokens.css`:

```css
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap');

:root {
  /* Backgrounds */
  --bg-primary: #F8FAFC;
  --bg-secondary: #FFFFFF;
  --bg-tertiary: #F1F5F9;
  --bg-card: #FFFFFF;
  --bg-elevated: #FFFFFF;
  --bg-input: #FFFFFF;

  /* Borders */
  --border-primary: #E2E8F0;
  --border-subtle: #EDF2F7;
  --border-accent: rgba(55, 138, 221, 0.4);

  /* Text */
  --text-primary: #1A202C;
  --text-secondary: #4A5568;
  --text-tertiary: #A0AEC0;
  --text-inverse: #FFFFFF;

  /* Accent */
  --accent: #378ADD;
  --accent-hover: #2B6FB5;
  --accent-muted: rgba(55, 138, 221, 0.1);
  --accent-glow: rgba(55, 138, 221, 0.06);

  /* Status */
  --success: #639922;
  --success-muted: rgba(99, 153, 34, 0.1);
  --danger: #D4537E;
  --danger-muted: rgba(212, 83, 126, 0.08);
  --info: #378ADD;
  --info-muted: rgba(55, 138, 221, 0.08);

  /* Tinted pairs */
  --tint-blue-bg: #E6F1FB;
  --tint-blue-text: #185FA5;
  --tint-pink-bg: #FBEAF0;
  --tint-pink-text: #993556;
  --tint-green-bg: #EAF3DE;
  --tint-green-text: #3B6D11;
  --tint-amber-bg: #FAEEDA;
  --tint-amber-text: #854F0B;

  /* Typography */
  --font-sans: 'Inter', system-ui, sans-serif;

  /* Sizing */
  --radius-sm: 8px;
  --radius-md: 12px;
  --radius-lg: 16px;

  /* Shadows */
  --shadow-card: 0 4px 16px rgba(0, 0, 0, 0.06);
  --shadow-elevated: 0 8px 24px rgba(0, 0, 0, 0.08);
}
```

- [ ] **Step 4: Commit**

```bash
cd /Users/kennylee/Development/NeoApex
git add ui-tokens/
git commit -m "feat: create @neoapex/ui-tokens shared design tokens package"
```

---

### Task 4: Create Launchpad frontend project

**Files:**
- Create: `/Users/kennylee/Development/NeoApex/launchpad/frontend/` (Vite scaffold + customization)

- [ ] **Step 1: Scaffold React + TypeScript + Vite project**

```bash
cd /Users/kennylee/Development/NeoApex/launchpad
npm create vite@latest frontend -- --template react-ts
cd frontend
npm install
npm install react-router-dom
npm install --save-dev @types/node
```

- [ ] **Step 2: Link ui-tokens package**

Add to `/Users/kennylee/Development/NeoApex/launchpad/frontend/package.json` in `dependencies`:

```json
"@neoapex/ui-tokens": "file:../../ui-tokens"
```

Then run:

```bash
cd /Users/kennylee/Development/NeoApex/launchpad/frontend
npm install
```

- [ ] **Step 3: Replace index.css with token import + base styles**

Replace `/Users/kennylee/Development/NeoApex/launchpad/frontend/src/index.css`:

```css
@import '@neoapex/ui-tokens/tokens.css';

*, *::before, *::after {
  box-sizing: border-box;
  margin: 0;
  padding: 0;
}

html {
  font-size: 16px;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}

body {
  font-family: var(--font-sans);
  background: var(--bg-primary);
  color: var(--text-primary);
  line-height: 1.6;
  min-height: 100vh;
}

#root {
  min-height: 100vh;
}

@keyframes fadeIn {
  from { opacity: 0; transform: translateY(8px); }
  to { opacity: 1; transform: translateY(0); }
}

@keyframes spin {
  to { transform: rotate(360deg); }
}
```

- [ ] **Step 4: Create TypeScript types**

Create `/Users/kennylee/Development/NeoApex/launchpad/frontend/src/types/models.ts`:

```typescript
export interface User {
  user_id: string;
  name: string;
  email: string;
  tenant_id: string;
  tenant_name: string;
  role: "admin" | "staff" | "teacher" | "parent";
}

export interface OnboardingStep {
  id: string;
  label: string;
  completed: boolean;
}

export interface OnboardingStatus {
  steps: OnboardingStep[];
  is_complete: boolean;
}

export interface TenantProfile {
  tenant_id: string;
  name: string;
  [key: string]: unknown;  // dynamic fields from model definition
}

export const FIELD_TYPES = ["str", "number", "bool", "date", "datetime", "email", "phone", "selection"] as const;
export type FieldType = typeof FIELD_TYPES[number];

export interface FieldDefinition {
  name: string;
  type: FieldType;
  required: boolean;
  options?: string[];
  multiple?: boolean;
}

export interface EntityModelDefinition {
  base_fields: FieldDefinition[];
  custom_fields: FieldDefinition[];
}
```

- [ ] **Step 5: Create API client stub**

Create `/Users/kennylee/Development/NeoApex/launchpad/frontend/src/api/client.ts`:

```typescript
import type { User } from "../types/models";

const BASE_URL = "http://localhost:8001/api";
const TOKEN_KEY = "launchpad_token";

export function getStoredToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function storeToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token);
}

export function clearToken(): void {
  localStorage.removeItem(TOKEN_KEY);
}

export async function authFetch(url: string, init?: RequestInit): Promise<Response> {
  const token = getStoredToken();
  const headers = new Headers(init?.headers);
  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }
  return fetch(url, { ...init, headers });
}

export async function getCurrentUser(): Promise<User> {
  const res = await authFetch(`${BASE_URL}/me`);
  if (!res.ok) throw new Error("Failed to fetch user");
  return res.json();
}
```

- [ ] **Step 6: Replace App.tsx with minimal shell**

Replace `/Users/kennylee/Development/NeoApex/launchpad/frontend/src/App.tsx`:

```typescript
import { useEffect, useState } from "react";
import type { User } from "./types/models";
import { getCurrentUser, getStoredToken, clearToken } from "./api/client";
import "./index.css";

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [authChecked, setAuthChecked] = useState(false);

  useEffect(() => {
    const token = getStoredToken();
    if (!token) {
      setAuthChecked(true);
      return;
    }
    getCurrentUser()
      .then(setUser)
      .catch(() => clearToken())
      .finally(() => setAuthChecked(true));
  }, []);

  if (!authChecked) {
    return <div style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: "100vh" }}>Loading...</div>;
  }

  if (!user) {
    return <div style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: "100vh" }}>Login page coming soon</div>;
  }

  return <div>Welcome, {user.name}</div>;
}
```

- [ ] **Step 7: Verify frontend starts**

```bash
cd /Users/kennylee/Development/NeoApex/launchpad/frontend
npm run dev &
sleep 3
curl -s http://localhost:5174 | head -5
kill %1
```
Expected: HTML response with Vite dev server

- [ ] **Step 8: Update vite.config.ts to use port 5174**

Replace `/Users/kennylee/Development/NeoApex/launchpad/frontend/vite.config.ts`:

```typescript
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5174,
  },
})
```

- [ ] **Step 9: Commit**

```bash
cd /Users/kennylee/Development/NeoApex/launchpad
git add frontend/
git commit -m "feat: scaffold Launchpad frontend — React + Vite + ui-tokens + types"
```

---

## Phase 2: Storage Layer

### Task 5: Create registry store (users + onboarding status)

**Files:**
- Create: `/Users/kennylee/Development/NeoApex/launchpad/backend/app/storage/registry_store.py`
- Create: `/Users/kennylee/Development/NeoApex/launchpad/backend/app/models/registry.py`
- Create: `/Users/kennylee/Development/NeoApex/launchpad/backend/tests/test_registry_store.py`

- [ ] **Step 1: Create Pydantic models**

Create `/Users/kennylee/Development/NeoApex/launchpad/backend/app/models/registry.py`:

```python
"""Pydantic models for registry records — users and onboarding status."""
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


class OnboardingStatus(BaseModel):
    tenant_id: str
    steps: list[dict]  # [{"id": "model_setup", "label": "...", "completed": bool}]
    is_complete: bool = False
```

- [ ] **Step 2: Write failing tests**

Create `/Users/kennylee/Development/NeoApex/launchpad/backend/tests/test_registry_store.py`:

```python
"""Tests for registry store — user and onboarding CRUD."""
import pytest
import tempfile
from datacore import Store
from app.storage.registry_store import RegistryStore


@pytest.fixture
def store():
    with tempfile.TemporaryDirectory() as d:
        yield RegistryStore(Store(data_dir=d))


class TestUserCRUD:
    def test_create_user(self, store):
        user = store.create_user(
            name="Jane Admin",
            email="jane@acme.edu",
            password="admin123",
            tenant_id="acme",
            tenant_name="Acme Afterschool",
            role="admin",
        )
        assert user.email == "jane@acme.edu"
        assert user.role == "admin"
        assert user.user_id.startswith("u-")
        assert user.password_hash != "admin123"  # bcrypt hashed

    def test_get_user_by_email(self, store):
        store.create_user(
            name="Jane", email="jane@acme.edu", password="pass",
            tenant_id="acme", tenant_name="Acme", role="admin",
        )
        user = store.get_user_by_email("jane@acme.edu")
        assert user is not None
        assert user.name == "Jane"

    def test_get_user_by_email_case_insensitive(self, store):
        store.create_user(
            name="Jane", email="Jane@Acme.edu", password="pass",
            tenant_id="acme", tenant_name="Acme", role="admin",
        )
        user = store.get_user_by_email("jane@acme.edu")
        assert user is not None

    def test_get_user_by_email_not_found(self, store):
        assert store.get_user_by_email("nobody@test.com") is None

    def test_list_users_by_tenant(self, store):
        store.create_user(
            name="A", email="a@t1.com", password="p",
            tenant_id="t1", tenant_name="T1", role="admin",
        )
        store.create_user(
            name="B", email="b@t1.com", password="p",
            tenant_id="t1", tenant_name="T1", role="staff",
        )
        store.create_user(
            name="C", email="c@t2.com", password="p",
            tenant_id="t2", tenant_name="T2", role="admin",
        )
        users = store.list_users_by_tenant("t1")
        assert len(users) == 2

    def test_update_user(self, store):
        user = store.create_user(
            name="Jane", email="jane@acme.edu", password="pass",
            tenant_id="acme", tenant_name="Acme", role="admin",
        )
        updated = store.update_user(user.user_id, role="staff")
        assert updated.role == "staff"

    def test_delete_user(self, store):
        user = store.create_user(
            name="Jane", email="jane@acme.edu", password="pass",
            tenant_id="acme", tenant_name="Acme", role="admin",
        )
        assert store.delete_user(user.user_id) is True
        assert store.get_user_by_email("jane@acme.edu") is None

    def test_verify_password(self, store):
        store.create_user(
            name="Jane", email="jane@acme.edu", password="secret123",
            tenant_id="acme", tenant_name="Acme", role="admin",
        )
        user = store.get_user_by_email("jane@acme.edu")
        assert store.verify_password("secret123", user.password_hash) is True
        assert store.verify_password("wrong", user.password_hash) is False


class TestOnboardingCRUD:
    def test_create_onboarding(self, store):
        status = store.create_onboarding("acme")
        assert status.tenant_id == "acme"
        assert status.is_complete is False
        assert len(status.steps) == 2

    def test_get_onboarding(self, store):
        store.create_onboarding("acme")
        status = store.get_onboarding("acme")
        assert status is not None
        assert status.steps[0]["id"] == "model_setup"

    def test_mark_step_complete(self, store):
        store.create_onboarding("acme")
        status = store.mark_step_complete("acme", "model_setup")
        assert status.steps[0]["completed"] is True
        assert status.is_complete is False

    def test_mark_all_steps_complete(self, store):
        store.create_onboarding("acme")
        store.mark_step_complete("acme", "model_setup")
        status = store.mark_step_complete("acme", "tenant_details")
        assert status.is_complete is True
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `cd /Users/kennylee/Development/NeoApex/launchpad && source .venv/bin/activate && python -m pytest backend/tests/test_registry_store.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'app.storage.registry_store'`

- [ ] **Step 4: Implement registry store**

Create `/Users/kennylee/Development/NeoApex/launchpad/backend/app/storage/registry_store.py`:

```python
"""Registry store — user and onboarding CRUD via datacore global tables."""
import uuid
from datetime import datetime, timezone

import bcrypt
from datacore import Store

from app.models.registry import UserRecord, OnboardingStatus

REGISTRY_TABLE = "registry"
ONBOARDING_STEPS = [
    {"id": "model_setup", "label": "Set Up Model", "completed": False},
    {"id": "tenant_details", "label": "Tenant Details", "completed": False},
]


class RegistryStore:
    def __init__(self, store: Store):
        self._store = store

    # ── Password helpers ───────────────────────────────────────

    @staticmethod
    def hash_password(password: str) -> str:
        return bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()

    @staticmethod
    def verify_password(password: str, password_hash: str) -> bool:
        return bcrypt.checkpw(password.encode(), password_hash.encode())

    # ── User CRUD ──────────────────────────────────────────────

    def create_user(
        self,
        name: str,
        email: str,
        password: str,
        tenant_id: str,
        tenant_name: str,
        role: str,
    ) -> UserRecord:
        user_id = f"u-{uuid.uuid4().hex[:8]}"
        now = datetime.now(timezone.utc).isoformat()
        record = UserRecord(
            user_id=user_id,
            name=name,
            email=email.lower(),
            password_hash=self.hash_password(password),
            tenant_id=tenant_id,
            tenant_name=tenant_name,
            role=role,
            created_at=now,
        )
        self._store.put_global(
            REGISTRY_TABLE,
            f"user:{user_id}",
            record.model_dump(),
        )
        return record

    def get_user_by_email(self, email: str) -> UserRecord | None:
        results = self._store.query_global(REGISTRY_TABLE)
        for row in results:
            data = row["data"]
            if not row["record_key"].startswith("user:"):
                continue
            if data.get("email", "").lower() == email.lower():
                return UserRecord(**data)
        return None

    def get_user_by_id(self, user_id: str) -> UserRecord | None:
        result = self._store.get_global(REGISTRY_TABLE, f"user:{user_id}")
        if not result:
            return None
        return UserRecord(**result["data"])

    def list_users_by_tenant(self, tenant_id: str) -> list[UserRecord]:
        results = self._store.query_global(
            REGISTRY_TABLE, filters={"tenant_id": tenant_id}
        )
        return [
            UserRecord(**row["data"])
            for row in results
            if row["record_key"].startswith("user:")
        ]

    def update_user(self, user_id: str, **fields) -> UserRecord:
        result = self._store.get_global(REGISTRY_TABLE, f"user:{user_id}")
        if not result:
            raise ValueError(f"User {user_id} not found")
        data = result["data"]
        data.update(fields)
        record = UserRecord(**data)
        self._store.put_global(REGISTRY_TABLE, f"user:{user_id}", record.model_dump())
        return record

    def delete_user(self, user_id: str) -> bool:
        return self._store.delete_global(REGISTRY_TABLE, f"user:{user_id}")

    def count_admins(self, tenant_id: str) -> int:
        users = self.list_users_by_tenant(tenant_id)
        return sum(1 for u in users if u.role == "admin")

    # ── Onboarding CRUD ───────────────────────────────────────

    def create_onboarding(self, tenant_id: str) -> OnboardingStatus:
        import copy
        status = OnboardingStatus(
            tenant_id=tenant_id,
            steps=copy.deepcopy(ONBOARDING_STEPS),
            is_complete=False,
        )
        self._store.put_global(
            REGISTRY_TABLE,
            f"onboarding:{tenant_id}",
            status.model_dump(),
        )
        return status

    def get_onboarding(self, tenant_id: str) -> OnboardingStatus | None:
        result = self._store.get_global(REGISTRY_TABLE, f"onboarding:{tenant_id}")
        if not result:
            return None
        return OnboardingStatus(**result["data"])

    def mark_step_complete(self, tenant_id: str, step_id: str) -> OnboardingStatus:
        status = self.get_onboarding(tenant_id)
        if not status:
            raise ValueError(f"No onboarding status for tenant {tenant_id}")
        for step in status.steps:
            if step["id"] == step_id:
                step["completed"] = True
        status.is_complete = all(s["completed"] for s in status.steps)
        self._store.put_global(
            REGISTRY_TABLE,
            f"onboarding:{tenant_id}",
            status.model_dump(),
        )
        return status
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd /Users/kennylee/Development/NeoApex/launchpad && source .venv/bin/activate && python -m pytest backend/tests/test_registry_store.py -v`
Expected: All 12 tests PASS

- [ ] **Step 6: Commit**

```bash
cd /Users/kennylee/Development/NeoApex/launchpad
git add backend/app/storage/registry_store.py backend/app/models/registry.py backend/tests/
git commit -m "feat: add registry store — user CRUD + onboarding status via datacore global tables"
```

---

### Task 6: Create model store (read Tenant model definition)

**Files:**
- Create: `/Users/kennylee/Development/NeoApex/launchpad/backend/app/storage/model_store.py`

- [ ] **Step 1: Create model store**

Create `/Users/kennylee/Development/NeoApex/launchpad/backend/app/storage/model_store.py`:

```python
"""Model store — reads Tenant model definition from datacore (written by Papermite)."""
from datacore import Store

from app.config import settings

_store: Store | None = None


def _get_store() -> Store:
    global _store
    if _store is None:
        _store = Store(data_dir=settings.datacore_store_path)
    return _store


def get_tenant_model(tenant_id: str) -> dict | None:
    """Get the active Tenant entity model definition.

    Returns the model definition dict with base_fields and custom_fields,
    or None if no model has been defined for this tenant.
    """
    store = _get_store()
    model = store.get_active_model(tenant_id, "tenant")
    if not model:
        return None
    return model["model_definition"]
```

- [ ] **Step 2: Commit**

```bash
cd /Users/kennylee/Development/NeoApex/launchpad
git add backend/app/storage/model_store.py
git commit -m "feat: add model store — reads Tenant model definition from datacore"
```

---

## Phase 3: Backend API

### Task 7: Auth API — login, register, me, dependencies

**Files:**
- Create: `/Users/kennylee/Development/NeoApex/launchpad/backend/app/api/auth.py`
- Modify: `/Users/kennylee/Development/NeoApex/launchpad/backend/app/main.py`

- [ ] **Step 1: Create auth.py**

Create `/Users/kennylee/Development/NeoApex/launchpad/backend/app/api/auth.py`:

```python
"""Auth endpoints and dependencies — JWT login, registration, role guards."""
import re
from datetime import datetime, timedelta, timezone

import jwt
from fastapi import APIRouter, Depends, Header, HTTPException
from pydantic import BaseModel

from app.config import settings
from app.storage.registry_store import RegistryStore
from app.storage import get_registry_store

router = APIRouter()

VALID_ROLES = {"admin", "staff", "teacher", "parent"}


# ─── JWT helpers ───────────────────────────────────────────────

def _create_token(user_id: str, email: str, tenant_id: str, role: str) -> str:
    payload = {
        "user_id": user_id,
        "email": email,
        "tenant_id": tenant_id,
        "role": role,
        "exp": datetime.now(timezone.utc) + timedelta(hours=settings.jwt_expiry_hours),
    }
    return jwt.encode(payload, settings.jwt_secret, algorithm="HS256")


def _decode_token(token: str) -> dict:
    try:
        return jwt.decode(token, settings.jwt_secret, algorithms=["HS256"])
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Token expired")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Invalid token")


# ─── FastAPI dependencies ──────────────────────────────────────

def get_current_user(
    authorization: str = Header(...),
    registry: RegistryStore = Depends(get_registry_store),
):
    """Decode JWT and return user record."""
    if not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Invalid authorization header")
    token = authorization[7:]
    payload = _decode_token(token)
    user = registry.get_user_by_id(payload["user_id"])
    if not user:
        raise HTTPException(status_code=401, detail="User not found")
    return user


def require_role(*roles: str):
    """Factory for role-checking dependencies."""
    def dependency(user=Depends(get_current_user)):
        if user.role not in roles:
            raise HTTPException(
                status_code=403,
                detail=f"Requires one of: {', '.join(roles)}",
            )
        return user
    return dependency


# ─── Request/Response models ──────────────────────────────────

class LoginRequest(BaseModel):
    email: str
    password: str


class RegisterRequest(BaseModel):
    name: str
    email: str
    password: str
    tenant_name: str


def _slugify(name: str) -> str:
    """Convert name to kebab-case tenant_id."""
    slug = re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")
    return slug or "tenant"


# ─── Routes ────────────────────────────────────────────────────

@router.post("/login")
def login(req: LoginRequest, registry: RegistryStore = Depends(get_registry_store)):
    user = registry.get_user_by_email(req.email)
    if not user or not registry.verify_password(req.password, user.password_hash):
        raise HTTPException(status_code=401, detail="Invalid credentials")
    token = _create_token(user.user_id, user.email, user.tenant_id, user.role)
    user_data = user.model_dump()
    del user_data["password_hash"]
    return {"token": token, "user": user_data}


@router.post("/register")
def register(req: RegisterRequest, registry: RegistryStore = Depends(get_registry_store)):
    # Check duplicate email
    if registry.get_user_by_email(req.email):
        raise HTTPException(status_code=409, detail="Email already registered")

    # Generate tenant_id with collision handling
    base_id = _slugify(req.tenant_name)
    tenant_id = base_id
    suffix = 2
    while registry.get_onboarding(tenant_id) is not None:
        tenant_id = f"{base_id}-{suffix}"
        suffix += 1

    # Create user + onboarding atomically
    user = registry.create_user(
        name=req.name,
        email=req.email,
        password=req.password,
        tenant_id=tenant_id,
        tenant_name=req.tenant_name,
        role="admin",
    )
    registry.create_onboarding(tenant_id)

    token = _create_token(user.user_id, user.email, user.tenant_id, user.role)
    user_data = user.model_dump()
    del user_data["password_hash"]
    return {"token": token, "user": user_data}


@router.get("/me")
def get_me(user=Depends(get_current_user)):
    user_data = user.model_dump()
    del user_data["password_hash"]
    return user_data
```

- [ ] **Step 2: Create storage dependency module**

Create `/Users/kennylee/Development/NeoApex/launchpad/backend/app/storage/__init__.py`:

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
        _store = Store(data_dir=settings.datacore_store_path)
    return _store


def get_registry_store() -> RegistryStore:
    global _registry
    if _registry is None:
        _registry = RegistryStore(_get_store())
    return _registry
```

- [ ] **Step 3: Register auth routes in main.py**

Replace `/Users/kennylee/Development/NeoApex/launchpad/backend/app/main.py`:

```python
"""FastAPI application entry point for Launchpad."""
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api import auth

app = FastAPI(
    title="Launchpad",
    description="Tenant lifecycle and identity service for the NeoApex platform",
    version="0.1.0",
)

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

app.include_router(auth.router, prefix="/api", tags=["auth"])


@app.get("/api/health")
def health():
    return {"status": "ok"}
```

- [ ] **Step 4: Commit**

```bash
cd /Users/kennylee/Development/NeoApex/launchpad
git add backend/app/api/auth.py backend/app/storage/__init__.py backend/app/main.py
git commit -m "feat: add auth API — login, register, /me, JWT, role dependencies"
```

---

### Task 8: Tenant Profile API

**Files:**
- Create: `/Users/kennylee/Development/NeoApex/launchpad/backend/app/api/tenants.py`
- Modify: `/Users/kennylee/Development/NeoApex/launchpad/backend/app/main.py`

- [ ] **Step 1: Create tenants.py**

Create `/Users/kennylee/Development/NeoApex/launchpad/backend/app/api/tenants.py`:

```python
"""Tenant profile and onboarding status endpoints."""
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from app.api.auth import get_current_user, require_role
from app.storage import get_registry_store
from app.storage.registry_store import RegistryStore
from app.storage.model_store import get_tenant_model

router = APIRouter()


# ─── Tenant Profile ───────────────────────────────────────────

@router.get("/tenants/{tenant_id}")
def get_tenant_profile(
    tenant_id: str,
    user=Depends(require_role("admin", "staff")),
    registry: RegistryStore = Depends(get_registry_store),
):
    if user.tenant_id != tenant_id:
        raise HTTPException(status_code=403, detail="Tenant mismatch")
    from datacore import Store
    from app.config import settings
    store = Store(data_dir=settings.datacore_store_path)
    entity = store.get_active_entity(tenant_id, "tenant", tenant_id)
    if not entity:
        return {"tenant_id": tenant_id, "name": user.tenant_name}
    data = {**entity.get("base_data", {}), **entity.get("custom_fields", {})}
    data["tenant_id"] = tenant_id
    return data


@router.put("/tenants/{tenant_id}")
def update_tenant_profile(
    tenant_id: str,
    body: dict,
    user=Depends(require_role("admin")),
    registry: RegistryStore = Depends(get_registry_store),
):
    if user.tenant_id != tenant_id:
        raise HTTPException(status_code=403, detail="Tenant mismatch")
    # Remove immutable name field
    body.pop("name", None)
    body.pop("tenant_id", None)

    from datacore import Store
    from app.config import settings
    store = Store(data_dir=settings.datacore_store_path)

    # Get existing entity to merge
    existing = store.get_active_entity(tenant_id, "tenant", tenant_id)
    if existing:
        base_data = {**existing.get("base_data", {}), **body}
    else:
        base_data = {"tenant_id": tenant_id, **body}

    store.put_entity(
        tenant_id=tenant_id,
        entity_type="tenant",
        entity_id=tenant_id,
        base_data=base_data,
    )
    return {**base_data, "tenant_id": tenant_id}


# ─── Tenant Model Definition ──────────────────────────────────

@router.get("/tenants/{tenant_id}/model")
def get_model(tenant_id: str, user=Depends(get_current_user)):
    if user.tenant_id != tenant_id:
        raise HTTPException(status_code=403, detail="Tenant mismatch")
    model = get_tenant_model(tenant_id)
    if not model:
        return None
    return model


# ─── Onboarding Status ────────────────────────────────────────

@router.get("/tenants/{tenant_id}/onboarding-status")
def get_onboarding_status(
    tenant_id: str,
    user=Depends(get_current_user),
    registry: RegistryStore = Depends(get_registry_store),
):
    if user.tenant_id != tenant_id:
        raise HTTPException(status_code=403, detail="Tenant mismatch")
    status = registry.get_onboarding(tenant_id)
    if not status:
        raise HTTPException(status_code=404, detail="Onboarding not found")
    return status.model_dump()


class MarkStepRequest(BaseModel):
    step_id: str
    completed: bool = True


@router.post("/tenants/{tenant_id}/onboarding-status")
def update_onboarding_status(
    tenant_id: str,
    body: MarkStepRequest,
    user=Depends(require_role("admin")),
    registry: RegistryStore = Depends(get_registry_store),
):
    if user.tenant_id != tenant_id:
        raise HTTPException(status_code=403, detail="Tenant mismatch")
    status = registry.mark_step_complete(tenant_id, body.step_id)
    return status.model_dump()
```

- [ ] **Step 2: Register tenant routes in main.py**

Add to `/Users/kennylee/Development/NeoApex/launchpad/backend/app/main.py`, after the auth import:

```python
from app.api import auth, tenants
```

And add after the auth router:

```python
app.include_router(tenants.router, prefix="/api", tags=["tenants"])
```

- [ ] **Step 3: Commit**

```bash
cd /Users/kennylee/Development/NeoApex/launchpad
git add backend/app/api/tenants.py backend/app/main.py
git commit -m "feat: add tenant profile, model, and onboarding status API endpoints"
```

---

### Task 9: User Management API

**Files:**
- Create: `/Users/kennylee/Development/NeoApex/launchpad/backend/app/api/users.py`
- Modify: `/Users/kennylee/Development/NeoApex/launchpad/backend/app/main.py`

- [ ] **Step 1: Create users.py**

Create `/Users/kennylee/Development/NeoApex/launchpad/backend/app/api/users.py`:

```python
"""User management endpoints — admin-only CRUD for tenant users."""
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from app.api.auth import require_role, VALID_ROLES
from app.storage import get_registry_store
from app.storage.registry_store import RegistryStore

router = APIRouter()


class CreateUserRequest(BaseModel):
    name: str
    email: str
    password: str
    role: str


class UpdateUserRequest(BaseModel):
    name: str | None = None
    role: str | None = None


@router.get("/tenants/{tenant_id}/users")
def list_users(
    tenant_id: str,
    user=Depends(require_role("admin")),
    registry: RegistryStore = Depends(get_registry_store),
):
    if user.tenant_id != tenant_id:
        raise HTTPException(status_code=403, detail="Tenant mismatch")
    users = registry.list_users_by_tenant(tenant_id)
    return [
        {k: v for k, v in u.model_dump().items() if k != "password_hash"}
        for u in users
    ]


@router.post("/tenants/{tenant_id}/users", status_code=201)
def create_user(
    tenant_id: str,
    body: CreateUserRequest,
    user=Depends(require_role("admin")),
    registry: RegistryStore = Depends(get_registry_store),
):
    if user.tenant_id != tenant_id:
        raise HTTPException(status_code=403, detail="Tenant mismatch")
    if body.role not in VALID_ROLES:
        raise HTTPException(status_code=422, detail=f"Invalid role. Must be one of: {', '.join(VALID_ROLES)}")
    if registry.get_user_by_email(body.email):
        raise HTTPException(status_code=409, detail="Email already registered")

    new_user = registry.create_user(
        name=body.name,
        email=body.email,
        password=body.password,
        tenant_id=tenant_id,
        tenant_name=user.tenant_name,
        role=body.role,
    )
    data = new_user.model_dump()
    del data["password_hash"]
    return data


@router.put("/tenants/{tenant_id}/users/{user_id}")
def update_user(
    tenant_id: str,
    user_id: str,
    body: UpdateUserRequest,
    user=Depends(require_role("admin")),
    registry: RegistryStore = Depends(get_registry_store),
):
    if user.tenant_id != tenant_id:
        raise HTTPException(status_code=403, detail="Tenant mismatch")
    if body.role and body.role not in VALID_ROLES:
        raise HTTPException(status_code=422, detail=f"Invalid role")

    # Last-admin guard
    if body.role and body.role != "admin" and user_id == user.user_id:
        if registry.count_admins(tenant_id) <= 1:
            raise HTTPException(status_code=400, detail="Cannot remove the last admin")

    fields = {k: v for k, v in body.model_dump().items() if v is not None}
    try:
        updated = registry.update_user(user_id, **fields)
    except ValueError:
        raise HTTPException(status_code=404, detail="User not found")
    data = updated.model_dump()
    del data["password_hash"]
    return data


@router.delete("/tenants/{tenant_id}/users/{user_id}", status_code=204)
def delete_user(
    tenant_id: str,
    user_id: str,
    user=Depends(require_role("admin")),
    registry: RegistryStore = Depends(get_registry_store),
):
    if user.tenant_id != tenant_id:
        raise HTTPException(status_code=403, detail="Tenant mismatch")

    # Last-admin guard
    target = registry.get_user_by_id(user_id)
    if target and target.role == "admin" and registry.count_admins(tenant_id) <= 1:
        raise HTTPException(status_code=400, detail="Cannot remove the last admin")

    if not registry.delete_user(user_id):
        raise HTTPException(status_code=404, detail="User not found")
```

- [ ] **Step 2: Register user routes in main.py**

Add to imports in `/Users/kennylee/Development/NeoApex/launchpad/backend/app/main.py`:

```python
from app.api import auth, tenants, users
```

Add router:

```python
app.include_router(users.router, prefix="/api", tags=["users"])
```

- [ ] **Step 3: Commit**

```bash
cd /Users/kennylee/Development/NeoApex/launchpad
git add backend/app/api/users.py backend/app/main.py
git commit -m "feat: add user management API — list, create, update, delete with last-admin guard"
```

---

## Phase 4: Frontend Pages

### Task 10: Login and Registration pages

**Files:**
- Create: `/Users/kennylee/Development/NeoApex/launchpad/frontend/src/pages/LoginPage.tsx`
- Create: `/Users/kennylee/Development/NeoApex/launchpad/frontend/src/pages/LoginPage.css`
- Create: `/Users/kennylee/Development/NeoApex/launchpad/frontend/src/pages/SignupPage.tsx`
- Create: `/Users/kennylee/Development/NeoApex/launchpad/frontend/src/pages/SignupPage.css`
- Modify: `/Users/kennylee/Development/NeoApex/launchpad/frontend/src/api/client.ts`
- Modify: `/Users/kennylee/Development/NeoApex/launchpad/frontend/src/App.tsx`

- [ ] **Step 1: Add login and register functions to api/client.ts**

Add to `/Users/kennylee/Development/NeoApex/launchpad/frontend/src/api/client.ts`:

```typescript
export async function login(
  email: string,
  password: string
): Promise<{ token: string; user: User }> {
  const res = await fetch(`${BASE_URL}/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.detail || "Login failed");
  }
  return res.json();
}

export async function register(
  name: string,
  email: string,
  password: string,
  tenant_name: string
): Promise<{ token: string; user: User }> {
  const res = await fetch(`${BASE_URL}/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, email, password, tenant_name }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.detail || "Registration failed");
  }
  return res.json();
}

export async function getOnboardingStatus(tenantId: string): Promise<import("../types/models").OnboardingStatus> {
  const res = await authFetch(`${BASE_URL}/tenants/${tenantId}/onboarding-status`);
  if (!res.ok) throw new Error("Failed to fetch onboarding status");
  return res.json();
}
```

- [ ] **Step 2: Create LoginPage.tsx**

Mirror Papermite's LoginPage pattern but with a "Sign up" link. Create `/Users/kennylee/Development/NeoApex/launchpad/frontend/src/pages/LoginPage.tsx`:

```typescript
import { useState } from "react";
import type { User } from "../types/models";
import { login } from "../api/client";
import "./LoginPage.css";

interface Props {
  onLogin: (token: string, user: User) => void;
  onSwitchToSignup: () => void;
}

export default function LoginPage({ onLogin, onSwitchToSignup }: Props) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() || !password.trim()) return;
    setLoading(true);
    setError("");
    try {
      const { token, user } = await login(email.trim(), password);
      onLogin(token, user);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-page">
      <div className="auth-card">
        <div className="auth-header">
          <h1 className="auth-brand">Launchpad</h1>
          <p className="auth-subtitle">Sign in to your account</p>
        </div>
        <form className="auth-form" onSubmit={handleSubmit}>
          <div className="auth-field">
            <label className="auth-label" htmlFor="email">Email</label>
            <input id="email" className="auth-input" type="email" value={email}
              onChange={e => setEmail(e.target.value)} placeholder="you@example.com" autoFocus />
          </div>
          <div className="auth-field">
            <label className="auth-label" htmlFor="password">Password</label>
            <input id="password" className="auth-input" type="password" value={password}
              onChange={e => setPassword(e.target.value)} placeholder="Enter password" />
          </div>
          {error && <div className="auth-error">{error}</div>}
          <button className="auth-submit" type="submit" disabled={loading}>
            {loading ? "Signing in..." : "Sign In"}
          </button>
        </form>
        <div className="auth-footer">
          <span>Don't have an account? </span>
          <button className="auth-link" onClick={onSwitchToSignup}>Sign up</button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Create SignupPage.tsx**

Create `/Users/kennylee/Development/NeoApex/launchpad/frontend/src/pages/SignupPage.tsx`:

```typescript
import { useState } from "react";
import type { User } from "../types/models";
import { register } from "../api/client";
import "./LoginPage.css";

interface Props {
  onLogin: (token: string, user: User) => void;
  onSwitchToLogin: () => void;
}

export default function SignupPage({ onLogin, onSwitchToLogin }: Props) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [tenantName, setTenantName] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !email.trim() || !password.trim() || !tenantName.trim()) return;
    setLoading(true);
    setError("");
    try {
      const { token, user } = await register(name.trim(), email.trim(), password, tenantName.trim());
      onLogin(token, user);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Registration failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-page">
      <div className="auth-card">
        <div className="auth-header">
          <h1 className="auth-brand">Launchpad</h1>
          <p className="auth-subtitle">Create your account</p>
        </div>
        <form className="auth-form" onSubmit={handleSubmit}>
          <div className="auth-field">
            <label className="auth-label" htmlFor="name">Your Name</label>
            <input id="name" className="auth-input" type="text" value={name}
              onChange={e => setName(e.target.value)} placeholder="Jane Smith" autoFocus />
          </div>
          <div className="auth-field">
            <label className="auth-label" htmlFor="email">Email</label>
            <input id="email" className="auth-input" type="email" value={email}
              onChange={e => setEmail(e.target.value)} placeholder="you@example.com" />
          </div>
          <div className="auth-field">
            <label className="auth-label" htmlFor="password">Password</label>
            <input id="password" className="auth-input" type="password" value={password}
              onChange={e => setPassword(e.target.value)} placeholder="Choose a password" />
          </div>
          <div className="auth-field">
            <label className="auth-label" htmlFor="tenant">Organization Name</label>
            <input id="tenant" className="auth-input" type="text" value={tenantName}
              onChange={e => setTenantName(e.target.value)} placeholder="Acme Afterschool" />
          </div>
          {error && <div className="auth-error">{error}</div>}
          <button className="auth-submit" type="submit" disabled={loading}>
            {loading ? "Creating account..." : "Create Account"}
          </button>
        </form>
        <div className="auth-footer">
          <span>Already have an account? </span>
          <button className="auth-link" onClick={onSwitchToLogin}>Sign in</button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Create shared auth page styles**

Create `/Users/kennylee/Development/NeoApex/launchpad/frontend/src/pages/LoginPage.css` (adapted from Papermite):

```css
.auth-page {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--bg-primary);
  font-family: var(--font-sans);
}

.auth-card {
  width: 100%;
  max-width: 420px;
  padding: 48px 40px 36px;
  background: var(--bg-secondary);
  border: 1px solid var(--border-primary);
  border-radius: 20px;
  box-shadow: 0 24px 48px rgba(0, 0, 0, 0.06);
}

.auth-header { text-align: center; margin-bottom: 36px; }
.auth-brand { font-size: 28px; font-weight: 800; color: var(--accent); margin-bottom: 6px; letter-spacing: -0.02em; }
.auth-subtitle { font-size: 15px; color: var(--text-tertiary); }
.auth-form { display: flex; flex-direction: column; gap: 20px; }
.auth-field { display: flex; flex-direction: column; gap: 6px; }
.auth-label { font-size: 13px; font-weight: 600; letter-spacing: 0.05em; text-transform: uppercase; color: var(--text-tertiary); }

.auth-input {
  font-family: var(--font-sans);
  font-size: 15px;
  padding: 12px 16px;
  background: var(--bg-input);
  border: 1px solid var(--border-primary);
  border-radius: var(--radius-md);
  color: var(--text-primary);
  outline: none;
  transition: border-color 0.2s, box-shadow 0.2s;
}
.auth-input:focus { border-color: var(--accent); box-shadow: 0 0 0 3px rgba(55, 138, 221, 0.15); }
.auth-input::placeholder { color: var(--text-tertiary); }

.auth-error {
  font-size: 14px;
  color: var(--tint-pink-text);
  padding: 10px 14px;
  background: var(--tint-pink-bg);
  border: 1px solid rgba(212, 83, 126, 0.2);
  border-radius: var(--radius-sm);
}

.auth-submit {
  margin-top: 4px;
  padding: 14px 28px;
  font-family: var(--font-sans);
  font-size: 15px;
  font-weight: 600;
  color: #FFFFFF;
  background: var(--accent);
  border: none;
  border-radius: var(--radius-md);
  cursor: pointer;
  transition: transform 0.2s, box-shadow 0.2s, background 0.2s;
}
.auth-submit:hover:not(:disabled) { transform: translateY(-2px); box-shadow: 0 8px 32px rgba(55, 138, 221, 0.3); background: var(--accent-hover); }
.auth-submit:disabled { opacity: 0.6; cursor: not-allowed; }

.auth-footer {
  text-align: center;
  margin-top: 24px;
  padding-top: 20px;
  border-top: 1px solid var(--border-subtle);
  font-size: 14px;
  color: var(--text-secondary);
}

.auth-link {
  background: none;
  border: none;
  color: var(--accent);
  font-weight: 600;
  cursor: pointer;
  font-size: 14px;
  font-family: var(--font-sans);
}
.auth-link:hover { text-decoration: underline; }
```

- [ ] **Step 5: Update App.tsx with login/signup routing and onboarding gate**

Replace `/Users/kennylee/Development/NeoApex/launchpad/frontend/src/App.tsx`:

```typescript
import { useEffect, useState } from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import type { User, OnboardingStatus } from "./types/models";
import { getCurrentUser, getStoredToken, storeToken, clearToken, getOnboardingStatus } from "./api/client";
import LoginPage from "./pages/LoginPage";
import SignupPage from "./pages/SignupPage";
import "./index.css";

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [onboarding, setOnboarding] = useState<OnboardingStatus | null>(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [authPage, setAuthPage] = useState<"login" | "signup">("login");

  useEffect(() => {
    const token = getStoredToken();
    if (!token) { setAuthChecked(true); return; }
    getCurrentUser()
      .then(async (u) => {
        setUser(u);
        const status = await getOnboardingStatus(u.tenant_id);
        setOnboarding(status);
      })
      .catch(() => clearToken())
      .finally(() => setAuthChecked(true));
  }, []);

  const handleLogin = async (token: string, loggedInUser: User) => {
    storeToken(token);
    setUser(loggedInUser);
    const status = await getOnboardingStatus(loggedInUser.tenant_id);
    setOnboarding(status);
  };

  const handleLogout = () => { clearToken(); setUser(null); setOnboarding(null); };

  if (!authChecked) {
    return <div style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: "100vh" }}>Loading...</div>;
  }

  // Not logged in
  if (!user) {
    return authPage === "login"
      ? <LoginPage onLogin={handleLogin} onSwitchToSignup={() => setAuthPage("signup")} />
      : <SignupPage onLogin={handleLogin} onSwitchToLogin={() => setAuthPage("login")} />;
  }

  // Onboarding gate — non-admin sees "setup pending"
  if (onboarding && !onboarding.is_complete && user.role !== "admin") {
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: "100vh", fontFamily: "var(--font-sans)" }}>
        <div style={{ textAlign: "center", maxWidth: 400 }}>
          <h2 style={{ fontSize: 20, fontWeight: 400, color: "var(--text-primary)", marginBottom: 8 }}>Setup in Progress</h2>
          <p style={{ fontSize: 14, color: "var(--text-secondary)", marginBottom: 24 }}>Your admin is setting things up. Please check back later.</p>
          <button onClick={handleLogout} style={{ padding: "10px 20px", background: "var(--bg-secondary)", border: "1px solid var(--border-primary)", borderRadius: "var(--radius-md)", cursor: "pointer", fontFamily: "var(--font-sans)" }}>Sign Out</button>
        </div>
      </div>
    );
  }

  // Onboarding gate — admin redirected to onboarding
  if (onboarding && !onboarding.is_complete && user.role === "admin") {
    return (
      <BrowserRouter>
        <div>Onboarding wizard coming in next task. <button onClick={handleLogout}>Sign Out</button></div>
      </BrowserRouter>
    );
  }

  // Onboarding complete — main app
  return (
    <BrowserRouter>
      <div style={{ fontFamily: "var(--font-sans)", padding: 32 }}>
        <p>Welcome, {user.name}! Onboarding complete.</p>
        <button onClick={handleLogout}>Sign Out</button>
      </div>
    </BrowserRouter>
  );
}
```

- [ ] **Step 6: Commit**

```bash
cd /Users/kennylee/Development/NeoApex/launchpad
git add frontend/src/
git commit -m "feat: add login, signup pages with onboarding gate and auth flow"
```

---

### Task 11: Onboarding Wizard page

**Files:**
- Create: `/Users/kennylee/Development/NeoApex/launchpad/frontend/src/pages/OnboardingPage.tsx`
- Create: `/Users/kennylee/Development/NeoApex/launchpad/frontend/src/pages/OnboardingPage.css`
- Create: `/Users/kennylee/Development/NeoApex/launchpad/frontend/src/components/DynamicEntityForm.tsx`
- Create: `/Users/kennylee/Development/NeoApex/launchpad/frontend/src/components/FieldInput.tsx`
- Modify: `/Users/kennylee/Development/NeoApex/launchpad/frontend/src/api/client.ts`
- Modify: `/Users/kennylee/Development/NeoApex/launchpad/frontend/src/App.tsx`

This is the largest frontend task. The onboarding wizard has two steps:
1. Model Setup — redirects to Papermite
2. Tenant Details — dynamic form from model definition

- [ ] **Step 1: Add API client functions for tenant profile and model**

Add to `/Users/kennylee/Development/NeoApex/launchpad/frontend/src/api/client.ts`:

```typescript
export async function getTenantModel(tenantId: string): Promise<import("../types/models").EntityModelDefinition | null> {
  const res = await authFetch(`${BASE_URL}/tenants/${tenantId}/model`);
  if (!res.ok) throw new Error("Failed to fetch model");
  const data = await res.json();
  return data?.tenant || data?.Tenant || null;
}

export async function getTenantProfile(tenantId: string): Promise<Record<string, unknown>> {
  const res = await authFetch(`${BASE_URL}/tenants/${tenantId}`);
  if (!res.ok) throw new Error("Failed to fetch tenant profile");
  return res.json();
}

export async function updateTenantProfile(tenantId: string, data: Record<string, unknown>): Promise<Record<string, unknown>> {
  const res = await authFetch(`${BASE_URL}/tenants/${tenantId}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error("Failed to update tenant profile");
  return res.json();
}

export async function markOnboardingStep(tenantId: string, stepId: string): Promise<import("../types/models").OnboardingStatus> {
  const res = await authFetch(`${BASE_URL}/tenants/${tenantId}/onboarding-status`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ step_id: stepId, completed: true }),
  });
  if (!res.ok) throw new Error("Failed to update onboarding status");
  return res.json();
}
```

- [ ] **Step 2: Create FieldInput component**

Create `/Users/kennylee/Development/NeoApex/launchpad/frontend/src/components/FieldInput.tsx`:

```typescript
import type { FieldDefinition } from "../types/models";

interface Props {
  field: FieldDefinition;
  value: unknown;
  onChange: (value: unknown) => void;
  readOnly?: boolean;
}

export default function FieldInput({ field, value, onChange, readOnly }: Props) {
  const strVal = value != null ? String(value) : "";

  switch (field.type) {
    case "bool":
      return (
        <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <input type="checkbox" checked={!!value} onChange={e => onChange(e.target.checked)} disabled={readOnly} />
          {field.name}
        </label>
      );
    case "selection":
      if (field.multiple) {
        const selected = Array.isArray(value) ? value as string[] : [];
        return (
          <select multiple value={selected} onChange={e => {
            const opts = Array.from(e.target.selectedOptions, o => o.value);
            onChange(opts);
          }} disabled={readOnly} className="auth-input" style={{ minHeight: 80 }}>
            {(field.options || []).map(opt => <option key={opt} value={opt}>{opt}</option>)}
          </select>
        );
      }
      return (
        <select value={strVal} onChange={e => onChange(e.target.value)} disabled={readOnly} className="auth-input">
          <option value="">Select...</option>
          {(field.options || []).map(opt => <option key={opt} value={opt}>{opt}</option>)}
        </select>
      );
    case "number":
      return <input type="number" value={strVal} onChange={e => onChange(e.target.value ? Number(e.target.value) : "")} readOnly={readOnly} className="auth-input" />;
    case "date":
    case "datetime":
      return <input type={field.type === "datetime" ? "datetime-local" : "date"} value={strVal} onChange={e => onChange(e.target.value)} readOnly={readOnly} className="auth-input" />;
    case "email":
      return <input type="email" value={strVal} onChange={e => onChange(e.target.value)} readOnly={readOnly} className="auth-input" placeholder={`Enter ${field.name}`} />;
    case "phone":
      return <input type="tel" value={strVal} onChange={e => onChange(e.target.value)} readOnly={readOnly} className="auth-input" placeholder={`Enter ${field.name}`} />;
    default:
      return <input type="text" value={strVal} onChange={e => onChange(e.target.value)} readOnly={readOnly} className="auth-input" placeholder={`Enter ${field.name}`} />;
  }
}
```

- [ ] **Step 3: Create DynamicEntityForm component**

Create `/Users/kennylee/Development/NeoApex/launchpad/frontend/src/components/DynamicEntityForm.tsx`:

```typescript
import { useState, useEffect } from "react";
import type { EntityModelDefinition, FieldDefinition } from "../types/models";
import FieldInput from "./FieldInput";

interface Props {
  model: EntityModelDefinition;
  initialData: Record<string, unknown>;
  readOnly?: boolean;
  immutableFields?: string[];
  onSave: (data: Record<string, unknown>) => Promise<void>;
}

export default function DynamicEntityForm({ model, initialData, readOnly, immutableFields = [], onSave }: Props) {
  const [data, setData] = useState<Record<string, unknown>>(initialData);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => { setData(initialData); }, [initialData]);

  const allFields: FieldDefinition[] = [
    ...(model.base_fields || []),
    ...(model.custom_fields || []),
  ];

  const handleChange = (fieldName: string, value: unknown) => {
    setData(prev => ({ ...prev, [fieldName]: value }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError("");
    try {
      await onSave(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      {allFields.map(field => (
        <div key={field.name} className="auth-field">
          <label className="auth-label">
            {field.name.replace(/_/g, " ")}
            {field.required && <span style={{ color: "var(--danger)" }}> *</span>}
          </label>
          {immutableFields.includes(field.name) ? (
            <div style={{ padding: "12px 16px", background: "var(--bg-tertiary)", borderRadius: "var(--radius-md)", color: "var(--text-secondary)", fontSize: 15 }}>
              {String(data[field.name] || "")}
            </div>
          ) : (
            <FieldInput
              field={field}
              value={data[field.name]}
              onChange={val => handleChange(field.name, val)}
              readOnly={readOnly}
            />
          )}
        </div>
      ))}
      {error && <div className="auth-error">{error}</div>}
      {!readOnly && (
        <button type="submit" className="auth-submit" disabled={saving}>
          {saving ? "Saving..." : "Save"}
        </button>
      )}
    </form>
  );
}
```

- [ ] **Step 4: Create OnboardingPage**

Create `/Users/kennylee/Development/NeoApex/launchpad/frontend/src/pages/OnboardingPage.tsx`:

```typescript
import { useState, useEffect } from "react";
import type { User, OnboardingStatus, EntityModelDefinition } from "../types/models";
import { getTenantModel, getTenantProfile, updateTenantProfile, markOnboardingStep, getOnboardingStatus } from "../api/client";
import DynamicEntityForm from "../components/DynamicEntityForm";
import "./OnboardingPage.css";

interface Props {
  user: User;
  onboarding: OnboardingStatus;
  papermiteUrl: string;
  onComplete: () => void;
  onLogout: () => void;
}

export default function OnboardingPage({ user, onboarding, papermiteUrl, onComplete, onLogout }: Props) {
  const [status, setStatus] = useState(onboarding);
  const [model, setModel] = useState<EntityModelDefinition | null>(null);
  const [tenantData, setTenantData] = useState<Record<string, unknown>>({});
  const [activeStep, setActiveStep] = useState(0);

  // Determine active step from status
  useEffect(() => {
    const firstIncomplete = status.steps.findIndex(s => !s.completed);
    setActiveStep(firstIncomplete >= 0 ? firstIncomplete : status.steps.length - 1);
  }, [status]);

  // Load model + tenant data when on step 2
  useEffect(() => {
    if (activeStep === 1 && status.steps[0].completed) {
      getTenantModel(user.tenant_id).then(setModel).catch(() => {});
      getTenantProfile(user.tenant_id).then(setTenantData).catch(() => {});
    }
  }, [activeStep, status, user.tenant_id]);

  // Listen for return from Papermite
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("model_setup") === "complete") {
      markOnboardingStep(user.tenant_id, "model_setup").then(async (s) => {
        setStatus(s);
        window.history.replaceState({}, "", window.location.pathname);
      });
    }
  }, [user.tenant_id]);

  const handleModelSetup = () => {
    const returnUrl = `${window.location.origin}?model_setup=complete`;
    window.location.href = `${papermiteUrl}/upload?return_url=${encodeURIComponent(returnUrl)}`;
  };

  const handleTenantSave = async (data: Record<string, unknown>) => {
    await updateTenantProfile(user.tenant_id, data);
    const updatedStatus = await markOnboardingStep(user.tenant_id, "tenant_details");
    setStatus(updatedStatus);
    if (updatedStatus.is_complete) {
      onComplete();
    }
  };

  return (
    <div className="onboard">
      <div className="onboard__header">
        <h1 className="onboard__brand">Launchpad</h1>
        <button className="onboard__logout" onClick={onLogout}>Sign Out</button>
      </div>
      <div className="onboard__content">
        <h2 className="onboard__title">Welcome! Let's get you set up.</h2>

        {/* Stepper */}
        <div className="onboard__stepper">
          {status.steps.map((step, i) => (
            <div key={step.id} className={`onboard__step ${i === activeStep ? "onboard__step--active" : ""} ${step.completed ? "onboard__step--done" : ""}`}>
              <div className="onboard__step-num">{step.completed ? "\u2713" : i + 1}</div>
              <span className="onboard__step-label">{step.label}</span>
            </div>
          ))}
        </div>

        {/* Step content */}
        {activeStep === 0 && (
          <div className="onboard__card">
            <h3>Set Up Your Data Model</h3>
            <p style={{ color: "var(--text-secondary)", margin: "8px 0 24px" }}>
              Upload a document to define the data model for your organization. This determines what fields are available for students, families, and your tenant profile.
            </p>
            {status.steps[0].completed ? (
              <div style={{ color: "var(--success)", fontWeight: 600 }}>Model setup complete! Click "Next" to continue.</div>
            ) : (
              <button className="auth-submit" onClick={handleModelSetup}>Open Papermite</button>
            )}
            {status.steps[0].completed && (
              <button className="auth-submit" style={{ marginTop: 16 }} onClick={() => setActiveStep(1)}>Next</button>
            )}
          </div>
        )}

        {activeStep === 1 && (
          <div className="onboard__card">
            <h3>Tenant Details</h3>
            <p style={{ color: "var(--text-secondary)", margin: "8px 0 24px" }}>
              Enter your organization's details. These fields come from the model you just defined.
            </p>
            {!status.steps[0].completed ? (
              <div>
                <p style={{ color: "var(--danger)" }}>Please complete model setup first.</p>
                <button className="auth-link" onClick={() => setActiveStep(0)}>Go back to model setup</button>
              </div>
            ) : model ? (
              <DynamicEntityForm
                model={model}
                initialData={tenantData}
                immutableFields={["name", "tenant_id"]}
                onSave={handleTenantSave}
              />
            ) : (
              <p>Loading model definition...</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Create OnboardingPage.css**

Create `/Users/kennylee/Development/NeoApex/launchpad/frontend/src/pages/OnboardingPage.css`:

```css
.onboard { min-height: 100vh; background: var(--bg-primary); font-family: var(--font-sans); }
.onboard__header { display: flex; justify-content: space-between; align-items: center; padding: 16px 32px; border-bottom: 1px solid var(--border-primary); background: var(--bg-secondary); }
.onboard__brand { font-size: 16px; font-weight: 700; color: var(--accent); }
.onboard__logout { background: none; border: 1px solid var(--border-primary); border-radius: var(--radius-sm); padding: 6px 14px; cursor: pointer; font-family: var(--font-sans); font-size: 13px; color: var(--text-secondary); }
.onboard__content { max-width: 640px; margin: 48px auto; padding: 0 24px; }
.onboard__title { font-size: 24px; font-weight: 700; color: var(--text-primary); margin-bottom: 32px; letter-spacing: -0.02em; }

.onboard__stepper { display: flex; gap: 24px; margin-bottom: 32px; }
.onboard__step { display: flex; align-items: center; gap: 8px; opacity: 0.4; }
.onboard__step--active { opacity: 1; }
.onboard__step--done { opacity: 0.8; }
.onboard__step-num { width: 28px; height: 28px; border-radius: 50%; background: var(--bg-tertiary); border: 2px solid var(--border-primary); display: flex; align-items: center; justify-content: center; font-size: 13px; font-weight: 600; color: var(--text-secondary); }
.onboard__step--active .onboard__step-num { background: var(--accent); border-color: var(--accent); color: white; }
.onboard__step--done .onboard__step-num { background: var(--success); border-color: var(--success); color: white; }
.onboard__step-label { font-size: 14px; font-weight: 500; color: var(--text-secondary); }

.onboard__card { background: var(--bg-card); border: 1px solid var(--border-primary); border-radius: var(--radius-lg); padding: 32px; box-shadow: var(--shadow-card); }
.onboard__card h3 { font-size: 18px; font-weight: 600; color: var(--text-primary); }
```

- [ ] **Step 6: Update App.tsx to render OnboardingPage**

In `/Users/kennylee/Development/NeoApex/launchpad/frontend/src/App.tsx`, replace the onboarding gate placeholder with:

```typescript
import OnboardingPage from "./pages/OnboardingPage";
```

And replace the admin onboarding block with:

```typescript
  if (onboarding && !onboarding.is_complete && user.role === "admin") {
    return (
      <OnboardingPage
        user={user}
        onboarding={onboarding}
        papermiteUrl="http://localhost:5173"
        onComplete={() => {
          getOnboardingStatus(user.tenant_id).then(setOnboarding);
        }}
        onLogout={handleLogout}
      />
    );
  }
```

- [ ] **Step 7: Commit**

```bash
cd /Users/kennylee/Development/NeoApex/launchpad
git add frontend/src/
git commit -m "feat: add onboarding wizard with stepper, Papermite redirect, and dynamic tenant details form"
```

---

### Task 12: Tenant Settings and User Management pages

**Files:**
- Create: `/Users/kennylee/Development/NeoApex/launchpad/frontend/src/pages/TenantSettingsPage.tsx`
- Create: `/Users/kennylee/Development/NeoApex/launchpad/frontend/src/pages/UserManagementPage.tsx`
- Create: `/Users/kennylee/Development/NeoApex/launchpad/frontend/src/pages/UserManagementPage.css`
- Modify: `/Users/kennylee/Development/NeoApex/launchpad/frontend/src/api/client.ts`
- Modify: `/Users/kennylee/Development/NeoApex/launchpad/frontend/src/App.tsx`

- [ ] **Step 1: Add user management API functions to client.ts**

Add to `/Users/kennylee/Development/NeoApex/launchpad/frontend/src/api/client.ts`:

```typescript
export async function listUsers(tenantId: string): Promise<Array<{ user_id: string; name: string; email: string; role: string; created_at: string }>> {
  const res = await authFetch(`${BASE_URL}/tenants/${tenantId}/users`);
  if (!res.ok) throw new Error("Failed to fetch users");
  return res.json();
}

export async function createUser(tenantId: string, data: { name: string; email: string; password: string; role: string }): Promise<unknown> {
  const res = await authFetch(`${BASE_URL}/tenants/${tenantId}/users`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const d = await res.json().catch(() => ({}));
    throw new Error(d.detail || "Failed to create user");
  }
  return res.json();
}

export async function updateUser(tenantId: string, userId: string, data: { name?: string; role?: string }): Promise<unknown> {
  const res = await authFetch(`${BASE_URL}/tenants/${tenantId}/users/${userId}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const d = await res.json().catch(() => ({}));
    throw new Error(d.detail || "Failed to update user");
  }
  return res.json();
}

export async function deleteUser(tenantId: string, userId: string): Promise<void> {
  const res = await authFetch(`${BASE_URL}/tenants/${tenantId}/users/${userId}`, { method: "DELETE" });
  if (!res.ok) {
    const d = await res.json().catch(() => ({}));
    throw new Error(d.detail || "Failed to delete user");
  }
}
```

- [ ] **Step 2: Create TenantSettingsPage.tsx**

Create `/Users/kennylee/Development/NeoApex/launchpad/frontend/src/pages/TenantSettingsPage.tsx`:

```typescript
import { useState, useEffect } from "react";
import type { User, EntityModelDefinition } from "../types/models";
import { getTenantModel, getTenantProfile, updateTenantProfile } from "../api/client";
import DynamicEntityForm from "../components/DynamicEntityForm";

interface Props { user: User; }

export default function TenantSettingsPage({ user }: Props) {
  const [model, setModel] = useState<EntityModelDefinition | null>(null);
  const [data, setData] = useState<Record<string, unknown>>({});
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    getTenantModel(user.tenant_id).then(setModel);
    getTenantProfile(user.tenant_id).then(setData);
  }, [user.tenant_id]);

  if (!model) return <p>Loading...</p>;

  const isAdmin = user.role === "admin";

  return (
    <div>
      <h2 style={{ fontSize: 24, fontWeight: 700, marginBottom: 24, color: "var(--text-primary)" }}>Tenant Settings</h2>
      <div style={{ background: "var(--bg-card)", border: "1px solid var(--border-primary)", borderRadius: "var(--radius-lg)", padding: 32, boxShadow: "var(--shadow-card)", maxWidth: 600 }}>
        <DynamicEntityForm
          model={model}
          initialData={data}
          readOnly={!isAdmin}
          immutableFields={["name", "tenant_id"]}
          onSave={async (updated) => {
            await updateTenantProfile(user.tenant_id, updated);
            setSaved(true);
            setTimeout(() => setSaved(false), 2000);
          }}
        />
        {saved && <p style={{ color: "var(--success)", marginTop: 12 }}>Saved!</p>}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Create UserManagementPage.tsx**

Create `/Users/kennylee/Development/NeoApex/launchpad/frontend/src/pages/UserManagementPage.tsx`:

```typescript
import { useState, useEffect } from "react";
import type { User } from "../types/models";
import { listUsers, createUser, updateUser, deleteUser } from "../api/client";
import "./UserManagementPage.css";

interface Props { user: User; }
type UserRow = { user_id: string; name: string; email: string; role: string; created_at: string };

export default function UserManagementPage({ user }: Props) {
  const [users, setUsers] = useState<UserRow[]>([]);
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({ name: "", email: "", password: "", role: "staff" });
  const [error, setError] = useState("");

  const reload = () => listUsers(user.tenant_id).then(setUsers);
  useEffect(() => { reload(); }, [user.tenant_id]);

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    try {
      await createUser(user.tenant_id, form);
      setForm({ name: "", email: "", password: "", role: "staff" });
      setShowAdd(false);
      reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed");
    }
  };

  const handleRoleChange = async (userId: string, role: string) => {
    try {
      await updateUser(user.tenant_id, userId, { role });
      reload();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed");
    }
  };

  const handleDelete = async (userId: string) => {
    if (!confirm("Remove this user?")) return;
    try {
      await deleteUser(user.tenant_id, userId);
      reload();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed");
    }
  };

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
        <h2 style={{ fontSize: 24, fontWeight: 700, color: "var(--text-primary)" }}>Users</h2>
        <button className="auth-submit" style={{ padding: "8px 16px", fontSize: 14 }} onClick={() => setShowAdd(!showAdd)}>
          {showAdd ? "Cancel" : "Add User"}
        </button>
      </div>

      {showAdd && (
        <form onSubmit={handleAdd} className="um-add-form">
          <input className="auth-input" placeholder="Name" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} required />
          <input className="auth-input" type="email" placeholder="Email" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} required />
          <input className="auth-input" type="password" placeholder="Password" value={form.password} onChange={e => setForm(f => ({ ...f, password: e.target.value }))} required />
          <select className="auth-input" value={form.role} onChange={e => setForm(f => ({ ...f, role: e.target.value }))}>
            <option value="admin">Admin</option>
            <option value="staff">Staff</option>
            <option value="teacher">Teacher</option>
            <option value="parent">Parent</option>
          </select>
          <button type="submit" className="auth-submit" style={{ padding: "8px 16px", fontSize: 14 }}>Create</button>
          {error && <span style={{ color: "var(--danger)", fontSize: 13 }}>{error}</span>}
        </form>
      )}

      <table className="um-table">
        <thead>
          <tr><th>Name</th><th>Email</th><th>Role</th><th>Actions</th></tr>
        </thead>
        <tbody>
          {users.map(u => (
            <tr key={u.user_id}>
              <td>{u.name}</td>
              <td>{u.email}</td>
              <td>
                <select value={u.role} onChange={e => handleRoleChange(u.user_id, e.target.value)} className="um-role-select">
                  <option value="admin">admin</option>
                  <option value="staff">staff</option>
                  <option value="teacher">teacher</option>
                  <option value="parent">parent</option>
                </select>
              </td>
              <td>
                <button className="um-delete" onClick={() => handleDelete(u.user_id)}>Remove</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
```

- [ ] **Step 4: Create UserManagementPage.css**

Create `/Users/kennylee/Development/NeoApex/launchpad/frontend/src/pages/UserManagementPage.css`:

```css
.um-add-form { display: flex; gap: 8px; margin-bottom: 24px; flex-wrap: wrap; align-items: center; padding: 16px; background: var(--bg-card); border: 1px solid var(--border-primary); border-radius: var(--radius-md); }
.um-add-form .auth-input { flex: 1; min-width: 140px; padding: 8px 12px; font-size: 14px; }
.um-table { width: 100%; border-collapse: collapse; background: var(--bg-card); border: 1px solid var(--border-primary); border-radius: var(--radius-lg); overflow: hidden; }
.um-table th { text-align: left; padding: 12px 16px; font-size: 13px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em; color: var(--text-tertiary); background: var(--bg-tertiary); border-bottom: 1px solid var(--border-primary); }
.um-table td { padding: 12px 16px; font-size: 14px; color: var(--text-primary); border-bottom: 1px solid var(--border-subtle); }
.um-role-select { font-family: var(--font-sans); font-size: 13px; padding: 4px 8px; border: 1px solid var(--border-primary); border-radius: var(--radius-sm); background: var(--bg-input); }
.um-delete { background: none; border: none; color: var(--danger); cursor: pointer; font-size: 13px; font-family: var(--font-sans); }
.um-delete:hover { text-decoration: underline; }
```

- [ ] **Step 5: Wire up App.tsx with full routing**

Replace `/Users/kennylee/Development/NeoApex/launchpad/frontend/src/App.tsx` with the complete version that includes BrowserRouter, navigation, and all routes:

```typescript
import { useEffect, useState } from "react";
import { BrowserRouter, Routes, Route, Link, Navigate } from "react-router-dom";
import type { User, OnboardingStatus } from "./types/models";
import { getCurrentUser, getStoredToken, storeToken, clearToken, getOnboardingStatus } from "./api/client";
import LoginPage from "./pages/LoginPage";
import SignupPage from "./pages/SignupPage";
import OnboardingPage from "./pages/OnboardingPage";
import TenantSettingsPage from "./pages/TenantSettingsPage";
import UserManagementPage from "./pages/UserManagementPage";
import "./index.css";

function AppShell({ user, onLogout }: { user: User; onLogout: () => void }) {
  return (
    <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column" }}>
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "0 32px", height: 60, background: "var(--bg-secondary)", borderBottom: "1px solid var(--border-primary)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <Link to="/" style={{ fontWeight: 700, fontSize: 16, color: "var(--accent)", textDecoration: "none" }}>Launchpad</Link>
          {(user.role === "admin" || user.role === "staff") && (
            <Link to="/settings/tenant" style={{ fontSize: 14, color: "var(--text-secondary)", textDecoration: "none" }}>Tenant Info</Link>
          )}
          {user.role === "admin" && (
            <Link to="/settings/users" style={{ fontSize: 14, color: "var(--text-secondary)", textDecoration: "none" }}>Users</Link>
          )}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 12, fontSize: 14, color: "var(--text-secondary)" }}>
          <span>{user.name}</span>
          <span style={{ fontSize: 12, padding: "2px 8px", background: "var(--tint-blue-bg)", color: "var(--tint-blue-text)", borderRadius: 12 }}>{user.role}</span>
          <button onClick={onLogout} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-tertiary)" }}>Sign out</button>
        </div>
      </header>
      <main style={{ flex: 1, padding: 32, maxWidth: 1000, width: "100%", margin: "0 auto" }}>
        <Routes>
          <Route path="/" element={<div><h2 style={{ fontSize: 24, fontWeight: 700, color: "var(--text-primary)" }}>Welcome to Launchpad</h2><p style={{ color: "var(--text-secondary)", marginTop: 8 }}>Manage your tenant, users, and settings.</p></div>} />
          <Route path="/settings/tenant" element={
            user.role === "admin" || user.role === "staff"
              ? <TenantSettingsPage user={user} />
              : <Navigate to="/" />
          } />
          <Route path="/settings/users" element={
            user.role === "admin"
              ? <UserManagementPage user={user} />
              : <Navigate to="/" />
          } />
          <Route path="*" element={<Navigate to="/" />} />
        </Routes>
      </main>
    </div>
  );
}

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [onboarding, setOnboarding] = useState<OnboardingStatus | null>(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [authPage, setAuthPage] = useState<"login" | "signup">("login");

  useEffect(() => {
    const token = getStoredToken();
    if (!token) { setAuthChecked(true); return; }
    getCurrentUser()
      .then(async (u) => {
        setUser(u);
        const status = await getOnboardingStatus(u.tenant_id);
        setOnboarding(status);
      })
      .catch(() => clearToken())
      .finally(() => setAuthChecked(true));
  }, []);

  const handleLogin = async (token: string, loggedInUser: User) => {
    storeToken(token);
    setUser(loggedInUser);
    const status = await getOnboardingStatus(loggedInUser.tenant_id);
    setOnboarding(status);
  };

  const handleLogout = () => { clearToken(); setUser(null); setOnboarding(null); };

  if (!authChecked) return <div style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: "100vh" }}>Loading...</div>;

  if (!user) {
    return authPage === "login"
      ? <LoginPage onLogin={handleLogin} onSwitchToSignup={() => setAuthPage("signup")} />
      : <SignupPage onLogin={handleLogin} onSwitchToLogin={() => setAuthPage("login")} />;
  }

  if (onboarding && !onboarding.is_complete && user.role !== "admin") {
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: "100vh", fontFamily: "var(--font-sans)" }}>
        <div style={{ textAlign: "center", maxWidth: 400 }}>
          <h2 style={{ fontSize: 20, fontWeight: 400, marginBottom: 8 }}>Setup in Progress</h2>
          <p style={{ fontSize: 14, color: "var(--text-secondary)", marginBottom: 24 }}>Your admin is setting things up.</p>
          <button onClick={handleLogout} style={{ padding: "10px 20px", background: "var(--bg-secondary)", border: "1px solid var(--border-primary)", borderRadius: "var(--radius-md)", cursor: "pointer" }}>Sign Out</button>
        </div>
      </div>
    );
  }

  if (onboarding && !onboarding.is_complete && user.role === "admin") {
    return <OnboardingPage user={user} onboarding={onboarding} papermiteUrl="http://localhost:5173"
      onComplete={() => getOnboardingStatus(user.tenant_id).then(setOnboarding)} onLogout={handleLogout} />;
  }

  return <BrowserRouter><AppShell user={user} onLogout={handleLogout} /></BrowserRouter>;
}
```

- [ ] **Step 6: Commit**

```bash
cd /Users/kennylee/Development/NeoApex/launchpad
git add frontend/src/
git commit -m "feat: add tenant settings, user management pages, and full app routing with role guards"
```

---

## Phase 5: Integration Verification

### Task 13: End-to-end smoke test

- [ ] **Step 1: Start both services**

```bash
cd /Users/kennylee/Development/NeoApex/launchpad
source .venv/bin/activate
uvicorn app.main:app --reload --port 8001 &
cd frontend && npm run dev &
```

- [ ] **Step 2: Test registration flow**

```bash
# Register a new tenant
curl -s -X POST http://localhost:8001/api/register \
  -H "Content-Type: application/json" \
  -d '{"name": "Test Admin", "email": "test@example.com", "password": "test123", "tenant_name": "Test School"}' | python3 -m json.tool
```
Expected: `{"token": "...", "user": {"user_id": "u-...", "name": "Test Admin", "email": "test@example.com", "tenant_id": "test-school", "tenant_name": "Test School", "role": "admin", "created_at": "..."}}`

- [ ] **Step 3: Test auth + onboarding status**

```bash
TOKEN=$(curl -s -X POST http://localhost:8001/api/register \
  -H "Content-Type: application/json" \
  -d '{"name": "Smoke Test", "email": "smoke@test.com", "password": "pass", "tenant_name": "Smoke School"}' | python3 -c "import sys,json; print(json.load(sys.stdin)['token'])")

# Check /me
curl -s http://localhost:8001/api/me -H "Authorization: Bearer $TOKEN" | python3 -m json.tool

# Check onboarding status
curl -s http://localhost:8001/api/tenants/smoke-school/onboarding-status -H "Authorization: Bearer $TOKEN" | python3 -m json.tool
```
Expected: User profile and onboarding status with `is_complete: false`

- [ ] **Step 4: Test user management**

```bash
# Add a staff user
curl -s -X POST http://localhost:8001/api/tenants/smoke-school/users \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name": "Staff Person", "email": "staff@test.com", "password": "pass", "role": "staff"}' | python3 -m json.tool

# List users
curl -s http://localhost:8001/api/tenants/smoke-school/users \
  -H "Authorization: Bearer $TOKEN" | python3 -m json.tool
```

- [ ] **Step 5: Commit any fixes**

```bash
cd /Users/kennylee/Development/NeoApex/launchpad
git add -A
git commit -m "fix: address integration test findings" --allow-empty
```
