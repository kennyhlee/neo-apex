# Add Student Entry — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enable adding students via a dynamic web form or document upload, with data stored in datacore's vector DB.

**Architecture:** Three repos, clear separation — datacore (storage API), papermite (document extraction), admindash (frontend UI). Each subagent targets one repo. Implementation order: datacore → papermite → admindash. The frontend dynamically generates forms from model definitions stored in the vector DB and submits student data back to datacore.

**Tech Stack:** Python/FastAPI (datacore API, papermite endpoint), React 19/TypeScript (admindash), LanceDB + TOON + DuckDB/Arrow (storage), Native Fetch API (HTTP client)

---

## Phase 1: Datacore — Serialization & REST API

> **Repo:** `/Users/kennylee/Development/NeoApex/datacore`
> **Run tests:** `cd /Users/kennylee/Development/NeoApex/datacore && python -m pytest tests/ -v`

### Task 1: Rename `_custom_fields` to `custom_fields`

**Files:**
- Modify: `src/datacore/store.py:35-40` (ENTITIES_SCHEMA)
- Modify: `src/datacore/store.py:243-309` (put_entity, get_active_entity, get_entity_history)
- Modify: `src/datacore/query.py:90-132` (_flatten_custom_fields)
- Modify: `tests/test_store_entities.py` (all `_custom_fields` references)
- Modify: `tests/conftest.py` (seeded_store fixture)

- [ ] **Step 1: Update ENTITIES_SCHEMA**

In `src/datacore/store.py`, change line 39:

```python
# Before
pa.field("_custom_fields", pa.string()),    # TOON-encoded document

# After
pa.field("custom_fields", pa.string()),     # TOON-encoded document
```

- [ ] **Step 2: Update Store.put_entity()**

In `src/datacore/store.py`, in the `put_entity` method, change the record dict (around line 291):

```python
# Before
"_custom_fields": toon.encode(custom_fields or {}),

# After
"custom_fields": toon.encode(custom_fields or {}),
```

And the return value deserialization (around line 308):

```python
# Before
record["_custom_fields"] = custom_fields or {}

# After
record["custom_fields"] = custom_fields or {}
```

- [ ] **Step 3: Update Store.get_active_entity()**

In `src/datacore/store.py`, around line 335:

```python
# Before
row["_custom_fields"] = toon.decode(row["_custom_fields"]) if row["_custom_fields"] else {}

# After
row["custom_fields"] = toon.decode(row["custom_fields"]) if row["custom_fields"] else {}
```

- [ ] **Step 4: Update Store.get_entity_history()**

In `src/datacore/store.py`, around line 357:

```python
# Before
row["_custom_fields"] = toon.decode(row["_custom_fields"]) if row["_custom_fields"] else {}

# After
row["custom_fields"] = toon.decode(row["custom_fields"]) if row["custom_fields"] else {}
```

- [ ] **Step 5: Update QueryEngine._flatten_custom_fields()**

In `src/datacore/query.py`, around line 97:

```python
# Before
custom_col = arrow_table.column("_custom_fields")

# After
custom_col = arrow_table.column("custom_fields")
```

- [ ] **Step 6: Update all tests**

In `tests/test_store_entities.py`, replace all `_custom_fields` with `custom_fields`:

```python
# test_create_entity_first_version (line 21-22)
assert isinstance(result["custom_fields"], dict)
assert result["custom_fields"]["city"] == "Springfield"

# test_entity_custom_fields_stored_as_toon (line 197)
raw_custom = rows[0]["custom_fields"]

# test_entity_custom_fields_empty_dict_ok (line 214-218)
assert result["custom_fields"] == {}
assert active["custom_fields"] == {}
```

- [ ] **Step 7: Run tests to verify rename**

Run: `cd /Users/kennylee/Development/NeoApex/datacore && python -m pytest tests/ -v`
Expected: All tests PASS

- [ ] **Step 8: Commit**

```bash
cd /Users/kennylee/Development/NeoApex/datacore
git add src/datacore/store.py src/datacore/query.py tests/
git commit -m "refactor: rename _custom_fields to custom_fields — user data not system metadata"
```

### Task 2: Unify serialization — TOON for `base_data`

**Files:**
- Modify: `src/datacore/store.py:294` (put_entity — json.dumps → toon.encode)
- Modify: `src/datacore/store.py:334` (get_active_entity — json.loads → toon.decode)
- Modify: `src/datacore/store.py:357` (get_entity_history — json.loads → toon.decode)
- Modify: `src/datacore/query.py:134-167` (_flatten_json_column → _flatten_toon_column)
- Modify: `tests/test_store_entities.py` (add TOON verification test)

- [ ] **Step 1: Write a failing test for TOON-encoded base_data**

Add to `tests/test_store_entities.py`:

```python
def test_entity_base_data_stored_as_toon(store):
    """base_data should be TOON-encoded, not JSON."""
    store.put_entity(
        tenant_id="t1",
        entity_type="student",
        entity_id="S001",
        base_data={"first_name": "Alice", "last_name": "Smith"},
    )

    # Read raw from LanceDB
    table = store._db.open_table(store._entities_table_name("t1"))
    rows = table.search().where("entity_id = 'S001'").to_list()
    assert len(rows) == 1

    raw_base = rows[0]["base_data"]
    # Should NOT be JSON (no braces)
    assert "{" not in raw_base
    # Should be TOON format
    assert "first_name: Alice" in raw_base
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/kennylee/Development/NeoApex/datacore && python -m pytest tests/test_store_entities.py::test_entity_base_data_stored_as_toon -v`
Expected: FAIL — `base_data` is currently JSON-encoded so `{` will be present

- [ ] **Step 3: Update Store.put_entity() to use toon.encode for base_data**

In `src/datacore/store.py`, around line 294:

```python
# Before
"base_data": json.dumps(base_data),

# After
"base_data": toon.encode(base_data),
```

- [ ] **Step 4: Update Store.get_active_entity() to use toon.decode for base_data**

In `src/datacore/store.py`, around line 334:

```python
# Before
row["base_data"] = json.loads(row["base_data"])

# After
row["base_data"] = toon.decode(row["base_data"])
```

- [ ] **Step 5: Update Store.get_entity_history() to use toon.decode for base_data**

In `src/datacore/store.py`, around line 357:

```python
# Before
row["base_data"] = json.loads(row["base_data"])

# After
row["base_data"] = toon.decode(row["base_data"])
```

- [ ] **Step 6: Rename _flatten_json_column to _flatten_toon_column in QueryEngine**

In `src/datacore/query.py`, rename the method and switch from `json.loads` to `toon.decode`:

```python
def _flatten_toon_column(
    self, arrow_table: pa.Table, column_name: str
) -> pa.Table:
    """Flatten a TOON-encoded string column into individual columns."""
    col = arrow_table.column(column_name)
    all_values = col.to_pylist()

    parsed = []
    all_keys: dict[str, None] = {}
    for val in all_values:
        if val and val.strip():
            d = toon.decode(val) if isinstance(val, str) else val
            parsed.append(d)
            for k in d:
                all_keys[k] = None
        else:
            parsed.append({})

    for key in all_keys:
        if key in arrow_table.column_names:
            continue
        values = []
        for row in parsed:
            v = row.get(key)
            if isinstance(v, (dict, list)):
                v = json.dumps(v)
            values.append(v)
        arrow_table = arrow_table.append_column(
            key, pa.array(values, type=pa.string())
        )

    return arrow_table
```

Update the call site in `_flatten_custom_fields` (around line 130):

```python
# Before
arrow_table = self._flatten_json_column(arrow_table, "base_data")

# After
arrow_table = self._flatten_toon_column(arrow_table, "base_data")
```

**Important:** Do NOT change `_parse_json_column` or `_flatten_json_column` — those are still used for `model_definition` in the models table, which remains JSON-encoded. Only rename the call site in `_flatten_custom_fields` for the entities path. The two methods coexist:
- `_flatten_toon_column()` — new, for TOON-encoded entity columns (`base_data`, `custom_fields`)
- `_flatten_json_column()` — existing, kept for JSON-encoded model columns (`model_definition`)

- [ ] **Step 7: Remove unused json import from store.py if no longer needed**

Check if `json` is still used in `store.py`. It's still used for `model_definition` in `put_model()` and `get_active_model()`, so keep it.

- [ ] **Step 8: Run all tests**

Run: `cd /Users/kennylee/Development/NeoApex/datacore && python -m pytest tests/ -v`
Expected: All tests PASS

- [ ] **Step 9: Commit**

```bash
cd /Users/kennylee/Development/NeoApex/datacore
git add src/datacore/store.py src/datacore/query.py tests/test_store_entities.py
git commit -m "feat: unify entity serialization — TOON for both base_data and custom_fields"
```

### Task 3: Datacore REST API layer

**Files:**
- Create: `src/datacore/api/__init__.py`
- Create: `src/datacore/api/routes.py`
- Modify: `pyproject.toml` (add FastAPI, uvicorn deps)
- Create: `tests/test_api.py`

- [ ] **Step 1: Add FastAPI and uvicorn to pyproject.toml**

In `pyproject.toml`, add to the dependencies list:

```toml
dependencies = [
    "lancedb>=0.6",
    "pyarrow>=14.0",
    "duckdb>=0.10",
    "python-toon>=0.1",
    "fastapi>=0.115",
    "uvicorn>=0.30",
]
```

- [ ] **Step 2: Install updated dependencies**

Run: `cd /Users/kennylee/Development/NeoApex/datacore && pip install -e ".[dev]"`

- [ ] **Step 3: Write failing API tests**

Create `tests/test_api.py`:

```python
"""Tests for datacore REST API endpoints."""

import tempfile

import pytest
from fastapi.testclient import TestClient

from datacore import Store
from datacore.api import create_app


@pytest.fixture
def app():
    with tempfile.TemporaryDirectory() as tmp_dir:
        store = Store(data_dir=tmp_dir, max_model_versions=5)
        app = create_app(store=store)
        yield app, store


@pytest.fixture
def client(app):
    app_instance, _ = app
    return TestClient(app_instance)


@pytest.fixture
def seeded_client(app):
    app_instance, store = app
    store.put_model(
        tenant_id="t1",
        entity_type="student",
        model_definition={
            "base_fields": [
                {"name": "first_name", "type": "str", "required": True},
                {"name": "last_name", "type": "str", "required": True},
            ],
            "custom_fields": [
                {"name": "bus_route", "type": "str", "required": False},
            ],
        },
    )
    return TestClient(app_instance)


# ── GET /api/models/{tenant_id}/{entity_type} ──────────────────────────


def test_get_model_found(seeded_client):
    resp = seeded_client.get("/api/models/t1/student")
    assert resp.status_code == 200
    data = resp.json()
    assert "model_definition" in data
    assert data["model_definition"]["base_fields"][0]["name"] == "first_name"


def test_get_model_not_found(client):
    resp = client.get("/api/models/t1/student")
    assert resp.status_code == 404


# ── POST /api/entities/{tenant_id}/{entity_type} ───────────────────────


def test_create_entity_success(seeded_client):
    resp = seeded_client.post(
        "/api/entities/t1/student",
        json={
            "base_data": {"first_name": "Jane", "last_name": "Doe"},
            "custom_fields": {"bus_route": "Route 5"},
        },
    )
    assert resp.status_code == 201
    data = resp.json()
    assert "entity_id" in data
    assert data["entity_type"] == "student"
    assert data["base_data"]["first_name"] == "Jane"
    assert data["custom_fields"]["bus_route"] == "Route 5"


def test_create_entity_minimal(client):
    """Create entity with only base_data, no custom_fields."""
    resp = client.post(
        "/api/entities/t1/student",
        json={"base_data": {"first_name": "Bob", "last_name": "Smith"}},
    )
    assert resp.status_code == 201
    data = resp.json()
    assert "entity_id" in data
    assert data["custom_fields"] == {}


def test_create_entity_auto_creates_tenant_table(client):
    """First entity for a tenant auto-creates the table."""
    resp = client.post(
        "/api/entities/new_tenant/student",
        json={"base_data": {"name": "Test"}},
    )
    assert resp.status_code == 201
```

- [ ] **Step 4: Run tests to verify they fail**

Run: `cd /Users/kennylee/Development/NeoApex/datacore && python -m pytest tests/test_api.py -v`
Expected: FAIL — `datacore.api` module doesn't exist yet

- [ ] **Step 5: Create `src/datacore/api/__init__.py`**

```python
"""Datacore REST API — thin FastAPI wrapper over Store."""

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from datacore.store import Store
from datacore.api.routes import create_router


def create_app(store: Store | None = None) -> FastAPI:
    """Create the FastAPI application.

    Args:
        store: Optional Store instance. If None, creates a default one.
    """
    if store is None:
        store = Store()

    app = FastAPI(
        title="Datacore",
        description="Storage API for the NeoApex platform",
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

    app.include_router(create_router(store), prefix="/api")

    return app
```

- [ ] **Step 6: Create `src/datacore/api/routes.py`**

```python
"""API route handlers for datacore."""

import uuid

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from datacore.store import Store


class CreateEntityRequest(BaseModel):
    base_data: dict
    custom_fields: dict | None = None


def create_router(store: Store) -> APIRouter:
    router = APIRouter()

    @router.get("/models/{tenant_id}/{entity_type}")
    def get_model(tenant_id: str, entity_type: str):
        result = store.get_active_model(tenant_id, entity_type)
        if result is None:
            raise HTTPException(status_code=404, detail="Model not found")
        return result

    @router.post("/entities/{tenant_id}/{entity_type}", status_code=201)
    def create_entity(
        tenant_id: str,
        entity_type: str,
        body: CreateEntityRequest,
    ):
        entity_id = uuid.uuid4().hex[:12]
        result = store.put_entity(
            tenant_id=tenant_id,
            entity_type=entity_type,
            entity_id=entity_id,
            base_data=body.base_data,
            custom_fields=body.custom_fields,
        )
        return result

    return router
```

- [ ] **Step 7: Run API tests**

Run: `cd /Users/kennylee/Development/NeoApex/datacore && python -m pytest tests/test_api.py -v`
Expected: All PASS

- [ ] **Step 8: Run full test suite**

Run: `cd /Users/kennylee/Development/NeoApex/datacore && python -m pytest tests/ -v`
Expected: All PASS

- [ ] **Step 9: Commit**

```bash
cd /Users/kennylee/Development/NeoApex/datacore
git add pyproject.toml src/datacore/api/ tests/test_api.py
git commit -m "feat: add REST API layer — FastAPI wrapper for model retrieval and entity CRUD"
```

---

## Phase 2: Papermite — Document Extraction Endpoint

> **Repo:** `/Users/kennylee/Development/NeoApex/papermite`
> **Depends on:** Phase 1 (datacore) complete
> **Run tests:** `cd /Users/kennylee/Development/NeoApex/papermite && python -m pytest tests/ -v`

### Task 4: Add extraction endpoint and update CORS

**Files:**
- Create: `backend/app/api/field_extraction.py`
- Modify: `backend/app/main.py:13-16` (CORS origins), `backend/app/main.py:24` (include new router)
- Create: `tests/test_field_extraction.py`

- [ ] **Step 1: Write failing test for extraction endpoint**

Create `tests/test_field_extraction.py`:

```python
"""Tests for field extraction endpoint."""

import io
from unittest.mock import patch, MagicMock

import pytest
from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def _mock_auth():
    """Skip auth for tests."""
    from app.config import TestUser
    return TestUser(
        user_id="test", username="test", password="test",
        name="Test", email="test@test.com",
        tenant_id="t1", tenant_name="Test Tenant", role="admin",
    )


@pytest.fixture(autouse=True)
def override_auth():
    from app.api.auth import require_admin
    app.dependency_overrides[require_admin] = _mock_auth
    yield
    app.dependency_overrides.clear()


def test_extract_unsupported_format():
    """422 for unsupported file type."""
    file = io.BytesIO(b"not a pdf")
    resp = client.post(
        "/api/extract/t1/student",
        files={"file": ("test.txt", file, "text/plain")},
    )
    assert resp.status_code == 422


def test_extract_endpoint_exists():
    """Endpoint exists and accepts PDF files."""
    file = io.BytesIO(b"%PDF-1.4 fake pdf content")
    with patch("app.api.field_extraction.extract_fields_from_file") as mock_extract:
        mock_extract.return_value = {"first_name": "Jane", "last_name": "Doe"}
        resp = client.post(
            "/api/extract/t1/student",
            files={"file": ("application.pdf", file, "application/pdf")},
        )
    assert resp.status_code == 200
    data = resp.json()
    assert data["fields"]["first_name"] == "Jane"


def test_extract_partial_result():
    """Partial extraction returns 200 with available fields only."""
    file = io.BytesIO(b"%PDF-1.4 fake pdf content")
    with patch("app.api.field_extraction.extract_fields_from_file") as mock_extract:
        mock_extract.return_value = {"first_name": "Jane"}
        resp = client.post(
            "/api/extract/t1/student",
            files={"file": ("application.pdf", file, "application/pdf")},
        )
    assert resp.status_code == 200
    assert "first_name" in resp.json()["fields"]
    assert "last_name" not in resp.json()["fields"]
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/kennylee/Development/NeoApex/papermite && python -m pytest tests/test_field_extraction.py -v`
Expected: FAIL — module `app.api.field_extraction` does not exist

- [ ] **Step 3: Create `backend/app/api/field_extraction.py`**

```python
"""Field extraction endpoint — extracts values from uploaded documents."""

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File

from app.api.auth import require_admin
from app.config import TestUser

router = APIRouter()

SUPPORTED_EXTENSIONS = {".pdf", ".png", ".jpg", ".jpeg"}
SUPPORTED_MIMETYPES = {
    "application/pdf",
    "image/png",
    "image/jpeg",
}


def extract_fields_from_file(
    file_bytes: bytes,
    filename: str,
    tenant_id: str,
    entity_type: str,
) -> dict:
    """Extract field values from a document.

    This is a stub — replace with actual extraction pipeline integration.
    Returns a dict mapping field names to extracted values.
    """
    return {}


@router.post("/extract/{tenant_id}/{entity_type}")
async def extract_fields(
    tenant_id: str,
    entity_type: str,
    file: UploadFile = File(...),
    user: TestUser = Depends(require_admin),
):
    """Upload a document and extract field values.

    Returns extracted fields as {"fields": {field_name: value, ...}}.
    Partial extraction is a success (200) — missing fields are simply absent.
    """
    # Validate file type
    filename = file.filename or ""
    ext = "." + filename.rsplit(".", 1)[-1].lower() if "." in filename else ""
    content_type = file.content_type or ""

    if ext not in SUPPORTED_EXTENSIONS and content_type not in SUPPORTED_MIMETYPES:
        raise HTTPException(
            status_code=422,
            detail=f"Unsupported file format: {filename}. Supported: PDF, PNG, JPG, JPEG",
        )

    file_bytes = await file.read()

    try:
        fields = extract_fields_from_file(
            file_bytes=file_bytes,
            filename=filename,
            tenant_id=tenant_id,
            entity_type=entity_type,
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

    return {"fields": fields}
```

- [ ] **Step 4: Register the new router in main.py**

In `backend/app/main.py`, add the import and router registration:

```python
from app.api import auth, upload, extraction, finalize, field_extraction

# ... existing router registrations ...
app.include_router(field_extraction.router, prefix="/api", tags=["field-extraction"])
```

- [ ] **Step 5: Update CORS to include admindash origin**

In `backend/app/main.py`, update the CORS origins:

```python
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://localhost:5174"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
```

- [ ] **Step 6: Run extraction tests**

Run: `cd /Users/kennylee/Development/NeoApex/papermite && python -m pytest tests/test_field_extraction.py -v`
Expected: All PASS

- [ ] **Step 7: Commit**

```bash
cd /Users/kennylee/Development/NeoApex/papermite
git add backend/app/api/field_extraction.py backend/app/main.py tests/test_field_extraction.py
git commit -m "feat: add document field extraction endpoint for add-student flow"
```

---

## Phase 3: AdminDash — Frontend

> **Repo:** `/Users/kennylee/Development/NeoApex/admindash`
> **Depends on:** Phase 1 (datacore) and Phase 2 (papermite) complete
> **Run dev server:** `cd /Users/kennylee/Development/NeoApex/admindash/frontend && npm run dev`
> **Type check:** `cd /Users/kennylee/Development/NeoApex/admindash/frontend && npx tsc -b`

### Task 5: API client functions for datacore and papermite

**Files:**
- Modify: `frontend/src/api/client.ts` (add new functions and base URLs)
- Create: `frontend/src/types/models.ts` additions (ModelDefinition types)

- [ ] **Step 1: Add model definition types**

Add to `frontend/src/types/models.ts`:

```typescript
export interface ModelFieldDefinition {
  name: string;
  type: 'str' | 'number' | 'bool' | 'date' | 'datetime' | 'email' | 'phone' | 'selection';
  required: boolean;
  options?: string[];
  multiple?: boolean;
}

export interface ModelDefinition {
  base_fields: ModelFieldDefinition[];
  custom_fields: ModelFieldDefinition[];
}

export interface ModelResponse {
  entity_type: string;
  model_definition: ModelDefinition;
}

export interface CreateEntityResponse {
  entity_type: string;
  entity_id: string;
  base_data: Record<string, unknown>;
  custom_fields: Record<string, unknown>;
  _version: number;
  _status: string;
}

export interface ExtractResponse {
  fields: Record<string, string>;
}
```

- [ ] **Step 2: Add API client functions**

Add to `frontend/src/api/client.ts`:

```typescript
import type {
  StudentsResponse,
  TenantsResponse,
  ModelResponse,
  CreateEntityResponse,
  ExtractResponse,
} from '../types/models.ts';

const API_BASE = 'http://localhost:8080';
const DATACORE_API_BASE = 'http://localhost:8081';
const PAPERMITE_API_BASE = 'http://localhost:8000';

// ... existing fetchStudents and fetchTenants ...

export async function fetchStudentModel(
  tenantId: string,
): Promise<ModelResponse> {
  const resp = await fetch(
    `${DATACORE_API_BASE}/api/models/${tenantId}/student`,
  );
  if (resp.status === 404) throw new Error('Student model not configured');
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  return resp.json();
}

export async function createStudent(
  tenantId: string,
  baseData: Record<string, unknown>,
  customFields: Record<string, unknown>,
): Promise<CreateEntityResponse> {
  const resp = await fetch(
    `${DATACORE_API_BASE}/api/entities/${tenantId}/student`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        base_data: baseData,
        custom_fields: customFields,
      }),
    },
  );
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  return resp.json();
}

export async function extractStudentFromDocument(
  tenantId: string,
  file: File,
): Promise<ExtractResponse> {
  const formData = new FormData();
  formData.append('file', file);
  const resp = await fetch(
    `${PAPERMITE_API_BASE}/api/extract/${tenantId}/student`,
    {
      method: 'POST',
      body: formData,
    },
  );
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  return resp.json();
}
```

- [ ] **Step 3: Type check**

Run: `cd /Users/kennylee/Development/NeoApex/admindash/frontend && npx tsc -b`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
cd /Users/kennylee/Development/NeoApex/admindash
git add frontend/src/api/client.ts frontend/src/types/models.ts
git commit -m "feat: add API client functions for datacore and papermite"
```

### Task 6: DynamicForm component

**Files:**
- Create: `frontend/src/components/DynamicForm.tsx`
- Create: `frontend/src/components/DynamicForm.css`

- [ ] **Step 1: Create DynamicForm component**

Create `frontend/src/components/DynamicForm.tsx`:

```tsx
import { useState, useEffect } from 'react';
import type { ModelFieldDefinition, ModelDefinition } from '../types/models.ts';
import { useTranslation } from '../hooks/useTranslation.ts';
import './DynamicForm.css';

interface DynamicFormProps {
  modelDefinition: ModelDefinition;
  initialValues?: Record<string, unknown>;
  onSubmit: (baseData: Record<string, unknown>, customFields: Record<string, unknown>) => void;
  onCancel: () => void;
  submitting?: boolean;
  error?: string | null;
}

function renderField(
  field: ModelFieldDefinition,
  value: unknown,
  onChange: (name: string, value: unknown) => void,
) {
  const strValue = value != null ? String(value) : '';

  switch (field.type) {
    case 'str':
      return (
        <input
          type="text"
          value={strValue}
          onChange={(e) => onChange(field.name, e.target.value)}
          required={field.required}
        />
      );

    case 'number':
      return (
        <input
          type="number"
          value={strValue}
          onChange={(e) => onChange(field.name, e.target.value ? Number(e.target.value) : '')}
          required={field.required}
        />
      );

    case 'bool':
      return (
        <input
          type="checkbox"
          checked={Boolean(value)}
          onChange={(e) => onChange(field.name, e.target.checked)}
        />
      );

    case 'date':
      return (
        <input
          type="date"
          value={strValue}
          onChange={(e) => onChange(field.name, e.target.value)}
          required={field.required}
        />
      );

    case 'datetime':
      return (
        <input
          type="datetime-local"
          value={strValue}
          onChange={(e) => onChange(field.name, e.target.value)}
          required={field.required}
        />
      );

    case 'email':
      return (
        <input
          type="email"
          value={strValue}
          onChange={(e) => onChange(field.name, e.target.value)}
          required={field.required}
        />
      );

    case 'phone':
      return (
        <input
          type="tel"
          value={strValue}
          onChange={(e) => onChange(field.name, e.target.value)}
          required={field.required}
        />
      );

    case 'selection':
      if (field.multiple) {
        const selected = Array.isArray(value) ? (value as string[]) : [];
        return (
          <div className="dynamic-form-multi-select">
            {(field.options || []).map((opt) => (
              <label key={opt} className="dynamic-form-checkbox-label">
                <input
                  type="checkbox"
                  checked={selected.includes(opt)}
                  onChange={(e) => {
                    const next = e.target.checked
                      ? [...selected, opt]
                      : selected.filter((s) => s !== opt);
                    onChange(field.name, next);
                  }}
                />
                {opt}
              </label>
            ))}
          </div>
        );
      }
      return (
        <select
          value={strValue}
          onChange={(e) => onChange(field.name, e.target.value)}
          required={field.required}
        >
          <option value="">--</option>
          {(field.options || []).map((opt) => (
            <option key={opt} value={opt}>
              {opt}
            </option>
          ))}
        </select>
      );

    default:
      return (
        <input
          type="text"
          value={strValue}
          onChange={(e) => onChange(field.name, e.target.value)}
        />
      );
  }
}

function formatFieldLabel(name: string): string {
  return name
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

export default function DynamicForm({
  modelDefinition,
  initialValues,
  onSubmit,
  onCancel,
  submitting = false,
  error,
}: DynamicFormProps) {
  const { t } = useTranslation();
  const allFields = [
    ...modelDefinition.base_fields.map((f) => ({ ...f, group: 'base' as const })),
    ...modelDefinition.custom_fields.map((f) => ({ ...f, group: 'custom' as const })),
  ];

  const buildValues = (overrides?: Record<string, unknown>) => {
    const result: Record<string, unknown> = {};
    for (const field of allFields) {
      result[field.name] = overrides?.[field.name] ?? (field.type === 'bool' ? false : '');
    }
    return result;
  };

  const [values, setValues] = useState<Record<string, unknown>>(() => buildValues(initialValues));

  // Re-populate when initialValues change (e.g., after document extraction)
  useEffect(() => {
    if (initialValues && Object.keys(initialValues).length > 0) {
      setValues((prev) => {
        const next = { ...prev };
        for (const [key, val] of Object.entries(initialValues)) {
          if (val != null && val !== '') next[key] = val;
        }
        return next;
      });
    }
  }, [initialValues]);

  const handleChange = (name: string, value: unknown) => {
    setValues((prev) => ({ ...prev, [name]: value }));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const baseData: Record<string, unknown> = {};
    const customFields: Record<string, unknown> = {};

    for (const field of allFields) {
      const val = values[field.name];
      if (field.group === 'base') {
        baseData[field.name] = val;
      } else {
        customFields[field.name] = val;
      }
    }

    onSubmit(baseData, customFields);
  };

  return (
    <form className="dynamic-form" onSubmit={handleSubmit}>
      {error && <div className="dynamic-form-error">{error}</div>}

      <div className="dynamic-form-fields">
        {allFields.map((field) => (
          <div
            key={field.name}
            className={`dynamic-form-field ${field.type === 'bool' ? 'dynamic-form-field-checkbox' : ''}`}
          >
            <label>
              {formatFieldLabel(field.name)}
              {field.required && <span className="dynamic-form-required">*</span>}
            </label>
            {renderField(field, values[field.name], handleChange)}
          </div>
        ))}
      </div>

      <div className="dynamic-form-actions">
        <button
          type="button"
          className="dynamic-form-btn-secondary"
          onClick={onCancel}
        >
          {t('common.cancel')}
        </button>
        <button
          type="submit"
          className="dynamic-form-btn-primary"
          disabled={submitting}
        >
          {submitting ? t('common.loading') : t('common.save')}
        </button>
      </div>
    </form>
  );
}
```

- [ ] **Step 2: Create DynamicForm CSS**

Create `frontend/src/components/DynamicForm.css`:

```css
.dynamic-form-fields {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 1rem;
  margin-bottom: 1.5rem;
}

.dynamic-form-field {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
}

.dynamic-form-field label {
  font-size: 0.8rem;
  font-weight: 600;
  color: var(--text-secondary);
}

.dynamic-form-required {
  color: var(--color-danger);
  margin-left: 0.2rem;
}

.dynamic-form-field input,
.dynamic-form-field select {
  font-size: 0.85rem;
  padding: 0.45rem 0.6rem;
  border: 1px solid var(--border-primary);
  border-radius: 8px;
  background: var(--bg-secondary);
  color: var(--text-primary);
  transition: border-color 0.2s, box-shadow 0.2s;
}

.dynamic-form-field input:focus,
.dynamic-form-field select:focus {
  outline: none;
  border-color: var(--color-accent);
  box-shadow: 0 0 0 3px rgba(55, 138, 221, 0.15);
}

.dynamic-form-field-checkbox {
  flex-direction: row;
  align-items: center;
  gap: 0.5rem;
}

.dynamic-form-field-checkbox input[type="checkbox"] {
  width: 1rem;
  height: 1rem;
}

.dynamic-form-multi-select {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
}

.dynamic-form-checkbox-label {
  display: flex;
  align-items: center;
  gap: 0.3rem;
  font-size: 0.85rem;
  color: var(--text-primary);
}

.dynamic-form-error {
  background: rgba(212, 83, 126, 0.1);
  color: var(--color-danger);
  padding: 0.75rem 1rem;
  border-radius: 8px;
  margin-bottom: 1rem;
  font-size: 0.85rem;
}

.dynamic-form-actions {
  display: flex;
  justify-content: flex-end;
  gap: 0.75rem;
  padding-top: 1rem;
  border-top: 1px solid var(--border-subtle);
}

.dynamic-form-btn-primary,
.dynamic-form-btn-secondary {
  font-size: 0.85rem;
  font-weight: 500;
  padding: 0.5rem 1.25rem;
  border-radius: 8px;
  border: none;
  cursor: pointer;
  transition: transform 0.15s, box-shadow 0.15s;
}

.dynamic-form-btn-primary {
  background: var(--color-accent);
  color: var(--text-inverse);
}

.dynamic-form-btn-primary:hover:not(:disabled) {
  transform: translateY(-2px);
  box-shadow: 0 4px 12px rgba(55, 138, 221, 0.3);
}

.dynamic-form-btn-primary:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.dynamic-form-btn-secondary {
  background: var(--bg-tertiary);
  color: var(--text-primary);
}

.dynamic-form-btn-secondary:hover {
  transform: translateY(-2px);
}
```

- [ ] **Step 3: Type check**

Run: `cd /Users/kennylee/Development/NeoApex/admindash/frontend && npx tsc -b`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
cd /Users/kennylee/Development/NeoApex/admindash
git add frontend/src/components/DynamicForm.tsx frontend/src/components/DynamicForm.css
git commit -m "feat: add DynamicForm component — renders fields from model definition"
```

### Task 7: Document upload component

**Files:**
- Create: `frontend/src/components/DocumentUpload.tsx`
- Create: `frontend/src/components/DocumentUpload.css`

- [ ] **Step 1: Create DocumentUpload component**

Create `frontend/src/components/DocumentUpload.tsx`:

```tsx
import { useState, useRef } from 'react';
import { useTranslation } from '../hooks/useTranslation.ts';
import './DocumentUpload.css';

const ACCEPTED_FORMATS = ['.pdf', '.png', '.jpg', '.jpeg'];
const ACCEPTED_MIME = ['application/pdf', 'image/png', 'image/jpeg'];

interface DocumentUploadProps {
  onExtracted: (fields: Record<string, string>) => void;
  onUpload: (file: File) => Promise<Record<string, string>>;
}

export default function DocumentUpload({ onExtracted, onUpload }: DocumentUploadProps) {
  const { t } = useTranslation();
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const validateFile = (file: File): boolean => {
    const ext = '.' + file.name.split('.').pop()?.toLowerCase();
    if (!ACCEPTED_FORMATS.includes(ext) && !ACCEPTED_MIME.includes(file.type)) {
      setError(t('addStudent.unsupportedFormat'));
      return false;
    }
    return true;
  };

  const handleFile = async (file: File) => {
    setError(null);
    if (!validateFile(file)) return;

    setFileName(file.name);
    setUploading(true);
    try {
      const fields = await onUpload(file);
      onExtracted(fields);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setUploading(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  };

  const handleSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
  };

  return (
    <div className="document-upload">
      <div
        className={`document-upload-dropzone ${dragging ? 'dragging' : ''} ${uploading ? 'uploading' : ''}`}
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={handleDrop}
        onClick={() => inputRef.current?.click()}
      >
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPTED_FORMATS.join(',')}
          onChange={handleSelect}
          style={{ display: 'none' }}
        />
        {uploading ? (
          <div className="document-upload-status">
            <div className="document-upload-spinner" />
            <p>{t('addStudent.extracting')}</p>
            {fileName && <p className="document-upload-filename">{fileName}</p>}
          </div>
        ) : (
          <div className="document-upload-prompt">
            <p className="document-upload-title">{t('addStudent.dropOrClick')}</p>
            <p className="document-upload-hint">{t('addStudent.supportedFormats')}</p>
          </div>
        )}
      </div>
      {error && <div className="document-upload-error">{error}</div>}
    </div>
  );
}
```

- [ ] **Step 2: Create DocumentUpload CSS**

Create `frontend/src/components/DocumentUpload.css`:

```css
.document-upload-dropzone {
  border: 2px dashed var(--border-primary);
  border-radius: 12px;
  padding: 3rem 2rem;
  text-align: center;
  cursor: pointer;
  transition: border-color 0.2s, background 0.2s;
}

.document-upload-dropzone:hover,
.document-upload-dropzone.dragging {
  border-color: var(--color-accent);
  background: rgba(55, 138, 221, 0.05);
}

.document-upload-dropzone.uploading {
  cursor: wait;
  border-color: var(--color-accent);
}

.document-upload-title {
  font-size: 1rem;
  font-weight: 600;
  color: var(--text-primary);
  margin-bottom: 0.5rem;
}

.document-upload-hint {
  font-size: 0.8rem;
  color: var(--text-tertiary);
}

.document-upload-status p {
  margin: 0.5rem 0;
  color: var(--text-secondary);
  font-size: 0.9rem;
}

.document-upload-filename {
  font-size: 0.8rem;
  color: var(--text-tertiary);
}

.document-upload-spinner {
  width: 2rem;
  height: 2rem;
  border: 3px solid var(--border-primary);
  border-top-color: var(--color-accent);
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
  margin: 0 auto;
}

.document-upload-error {
  background: rgba(212, 83, 126, 0.1);
  color: var(--color-danger);
  padding: 0.75rem 1rem;
  border-radius: 8px;
  margin-top: 1rem;
  font-size: 0.85rem;
}
```

- [ ] **Step 3: Type check**

Run: `cd /Users/kennylee/Development/NeoApex/admindash/frontend && npx tsc -b`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
cd /Users/kennylee/Development/NeoApex/admindash
git add frontend/src/components/DocumentUpload.tsx frontend/src/components/DocumentUpload.css
git commit -m "feat: add DocumentUpload component — drag-and-drop with extraction"
```

### Task 8: AddStudentPage, routing, and i18n

**Files:**
- Create: `frontend/src/pages/AddStudentPage.tsx`
- Create: `frontend/src/pages/AddStudentPage.css`
- Modify: `frontend/src/App.tsx:8,39-42` (import + route)
- Modify: `frontend/src/pages/StudentsPage.tsx:263` (wire button)
- Modify: `frontend/src/i18n/translations.ts` (add keys)

- [ ] **Step 1: Add i18n keys**

In `frontend/src/i18n/translations.ts`, add to the `en-US` section (after `students.status.dropped`):

```typescript
// Add Student
'addStudent.title': 'Add Student',
'addStudent.webForm': 'Web Form',
'addStudent.uploadDocument': 'Upload Document',
'addStudent.dropOrClick': 'Drop a file here or click to browse',
'addStudent.supportedFormats': 'Supported formats: PDF, PNG, JPG, JPEG',
'addStudent.extracting': 'Extracting information...',
'addStudent.unsupportedFormat': 'Unsupported file format. Use PDF, PNG, JPG, or JPEG.',
'addStudent.modelNotFound': 'Student model not configured. Please set up the student model in Papermite first.',
'addStudent.success': 'Student added successfully.',
'addStudent.submitError': 'Failed to add student. Please try again.',
```

Add to the `zh-CN` section (after `students.status.dropped`):

```typescript
// Add Student
'addStudent.title': '\u6dfb\u52a0\u5b66\u751f',
'addStudent.webForm': '\u8868\u5355\u5f55\u5165',
'addStudent.uploadDocument': '\u4e0a\u4f20\u6587\u4ef6',
'addStudent.dropOrClick': '\u62d6\u653e\u6587\u4ef6\u6216\u70b9\u51fb\u6d4f\u89c8',
'addStudent.supportedFormats': '\u652f\u6301\u683c\u5f0f\uff1aPDF\u3001PNG\u3001JPG\u3001JPEG',
'addStudent.extracting': '\u6b63\u5728\u63d0\u53d6\u4fe1\u606f...',
'addStudent.unsupportedFormat': '\u4e0d\u652f\u6301\u7684\u6587\u4ef6\u683c\u5f0f\u3002\u8bf7\u4f7f\u7528 PDF\u3001PNG\u3001JPG \u6216 JPEG\u3002',
'addStudent.modelNotFound': '\u5b66\u751f\u6a21\u578b\u672a\u914d\u7f6e\u3002\u8bf7\u5148\u5728 Papermite \u4e2d\u8bbe\u7f6e\u5b66\u751f\u6a21\u578b\u3002',
'addStudent.success': '\u5b66\u751f\u6dfb\u52a0\u6210\u529f\u3002',
'addStudent.submitError': '\u6dfb\u52a0\u5b66\u751f\u5931\u8d25\uff0c\u8bf7\u91cd\u8bd5\u3002',
```

- [ ] **Step 2: Create AddStudentPage**

Create `frontend/src/pages/AddStudentPage.tsx`:

```tsx
import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from '../hooks/useTranslation.ts';
import { fetchStudentModel, createStudent, extractStudentFromDocument } from '../api/client.ts';
import DynamicForm from '../components/DynamicForm.tsx';
import DocumentUpload from '../components/DocumentUpload.tsx';
import type { ModelDefinition } from '../types/models.ts';
import './AddStudentPage.css';

interface AddStudentPageProps {
  tenant: string;
}

export default function AddStudentPage({ tenant }: AddStudentPageProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();

  const [activeTab, setActiveTab] = useState<'form' | 'upload'>('form');
  const [modelDef, setModelDef] = useState<ModelDefinition | null>(null);
  const [modelError, setModelError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [extractedValues, setExtractedValues] = useState<Record<string, unknown>>({});
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setModelError(null);
    fetchStudentModel(tenant)
      .then((resp) => setModelDef(resp.model_definition))
      .catch(() => setModelError(t('addStudent.modelNotFound')))
      .finally(() => setLoading(false));
  }, [tenant, t]);

  const handleExtracted = (fields: Record<string, string>) => {
    setExtractedValues((prev) => ({ ...prev, ...fields }));
    setActiveTab('form');
  };

  const handleUpload = async (file: File): Promise<Record<string, string>> => {
    const resp = await extractStudentFromDocument(tenant, file);
    return resp.fields;
  };

  const handleSubmit = async (
    baseData: Record<string, unknown>,
    customFields: Record<string, unknown>,
  ) => {
    setSubmitting(true);
    setSubmitError(null);
    try {
      await createStudent(tenant, baseData, customFields);
      setSuccessMessage(t('addStudent.success'));
      setTimeout(() => navigate('/students'), 1500);
    } catch (e) {
      setSubmitError(e instanceof Error ? e.message : t('addStudent.submitError'));
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="add-student-page">
        <p>{t('common.loading')}</p>
      </div>
    );
  }

  if (modelError) {
    return (
      <div className="add-student-page">
        <div className="add-student-header">
          <h2>{t('addStudent.title')}</h2>
        </div>
        <div className="add-student-model-error">{modelError}</div>
        <button
          className="add-student-back-btn"
          onClick={() => navigate('/students')}
        >
          {t('common.cancel')}
        </button>
      </div>
    );
  }

  return (
    <div className="add-student-page">
      <div className="add-student-header">
        <h2>{t('addStudent.title')}</h2>
      </div>

      {successMessage && (
        <div className="add-student-success">{successMessage}</div>
      )}

      <div className="add-student-tabs">
        <button
          className={`add-student-tab ${activeTab === 'form' ? 'active' : ''}`}
          onClick={() => setActiveTab('form')}
        >
          {t('addStudent.webForm')}
        </button>
        <button
          className={`add-student-tab ${activeTab === 'upload' ? 'active' : ''}`}
          onClick={() => setActiveTab('upload')}
        >
          {t('addStudent.uploadDocument')}
        </button>
      </div>

      <div className="add-student-content">
        {activeTab === 'form' && modelDef && (
          <DynamicForm
            modelDefinition={modelDef}
            initialValues={extractedValues}
            onSubmit={handleSubmit}
            onCancel={() => navigate('/students')}
            submitting={submitting}
            error={submitError}
          />
        )}
        {activeTab === 'upload' && (
          <DocumentUpload
            onExtracted={handleExtracted}
            onUpload={handleUpload}
          />
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Create AddStudentPage CSS**

Create `frontend/src/pages/AddStudentPage.css`:

```css
.add-student-page {
  padding: 1.5rem;
  max-width: 900px;
  margin: 0 auto;
  animation: fadeIn 0.3s ease;
}

.add-student-header h2 {
  font-size: 1.25rem;
  font-weight: 700;
  color: var(--text-primary);
  margin: 0 0 1.25rem 0;
}

.add-student-tabs {
  display: flex;
  gap: 0;
  border-bottom: 2px solid var(--border-primary);
  margin-bottom: 1.5rem;
}

.add-student-tab {
  padding: 0.6rem 1.25rem;
  font-size: 0.85rem;
  font-weight: 500;
  background: none;
  border: none;
  border-bottom: 2px solid transparent;
  margin-bottom: -2px;
  cursor: pointer;
  color: var(--text-secondary);
  transition: color 0.2s, border-color 0.2s;
}

.add-student-tab:hover {
  color: var(--text-primary);
}

.add-student-tab.active {
  color: var(--color-accent);
  border-bottom-color: var(--color-accent);
}

.add-student-content {
  background: var(--bg-card);
  border-radius: 12px;
  padding: 1.5rem;
  box-shadow: var(--shadow-card);
}

.add-student-model-error {
  background: rgba(212, 83, 126, 0.1);
  color: var(--color-danger);
  padding: 1rem 1.25rem;
  border-radius: 8px;
  margin-bottom: 1rem;
  font-size: 0.9rem;
}

.add-student-success {
  background: rgba(99, 153, 34, 0.1);
  color: var(--color-success);
  padding: 0.75rem 1rem;
  border-radius: 8px;
  margin-bottom: 1rem;
  font-size: 0.85rem;
}

.add-student-back-btn {
  font-size: 0.85rem;
  font-weight: 500;
  padding: 0.5rem 1.25rem;
  border-radius: 8px;
  border: none;
  background: var(--bg-tertiary);
  color: var(--text-primary);
  cursor: pointer;
}
```

- [ ] **Step 4: Add route in App.tsx**

In `frontend/src/App.tsx`, add the import:

```typescript
import AddStudentPage from './pages/AddStudentPage.tsx';
```

Add the route inside the inner `<Routes>`, before the students route:

```tsx
<Route
  path="/students/add"
  element={<AddStudentPage tenant={tenant} />}
/>
<Route
  path="/students"
  element={<StudentsPage tenant={tenant} />}
/>
```

The `/students/add` route must come before `/students` so it matches first.

- [ ] **Step 5: Wire Add Student button in StudentsPage**

In `frontend/src/pages/StudentsPage.tsx`, add the import at the top:

```typescript
import { useNavigate } from 'react-router-dom';
```

Inside the `StudentsPage` component function, add:

```typescript
const navigate = useNavigate();
```

Then update the Add Student button (around line 263):

```tsx
{/* Before */}
<button>{t('students.addStudent')}</button>

{/* After */}
<button onClick={() => navigate('/students/add')}>{t('students.addStudent')}</button>
```

- [ ] **Step 6: Type check**

Run: `cd /Users/kennylee/Development/NeoApex/admindash/frontend && npx tsc -b`
Expected: No errors

- [ ] **Step 7: Build check**

Run: `cd /Users/kennylee/Development/NeoApex/admindash/frontend && npm run build`
Expected: Build succeeds

- [ ] **Step 8: Commit**

```bash
cd /Users/kennylee/Development/NeoApex/admindash
git add frontend/src/pages/AddStudentPage.tsx frontend/src/pages/AddStudentPage.css frontend/src/App.tsx frontend/src/pages/StudentsPage.tsx frontend/src/i18n/translations.ts
git commit -m "feat: add student entry flow — dynamic form, document upload, two-tab page"
```
