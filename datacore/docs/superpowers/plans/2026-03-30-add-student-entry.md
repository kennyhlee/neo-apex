# Add Student Entry Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add serialization cleanup (rename `_custom_fields` → `custom_fields`, unify TOON encoding for `base_data`) and a FastAPI REST API layer for model retrieval and entity creation.

**Architecture:** Two independent workstreams — (1) schema/serialization cleanup in Store and QueryEngine, then (2) FastAPI thin wrapper over Store. Serialization changes land first since the API layer depends on them. Pre-production with no external consumers, so breaking changes are safe — wipe test data.

**Tech Stack:** Python, LanceDB, PyArrow, TOON, DuckDB, FastAPI, uvicorn, pytest, httpx (test client)

---

## File Structure

| Action | File | Responsibility |
|--------|------|---------------|
| Modify | `src/datacore/store.py` | Rename `_custom_fields` → `custom_fields` in schema; switch `base_data` from JSON to TOON |
| Modify | `src/datacore/query.py` | Rename `_flatten_json_column` → `_flatten_toon_column`; decode TOON for `base_data` |
| Modify | `src/datacore/__init__.py` | Re-export `create_app` from api |
| Modify | `pyproject.toml` | Add fastapi, uvicorn, httpx dependencies |
| Modify | `tests/conftest.py` | Update `_custom_fields` refs to `custom_fields` |
| Modify | `tests/test_store_entities.py` | Update all `_custom_fields` refs to `custom_fields` |
| Modify | `tests/test_query_custom_fields.py` | Update column name refs |
| Create | `src/datacore/api/__init__.py` | App factory `create_app()` with CORS middleware |
| Create | `src/datacore/api/routes.py` | GET model + POST entity endpoint handlers |
| Create | `tests/test_api.py` | API endpoint tests using FastAPI TestClient |

---

### Task 1: Rename `_custom_fields` to `custom_fields` in Store

**Files:**
- Modify: `src/datacore/store.py:35-40` (ENTITIES_SCHEMA)
- Modify: `src/datacore/store.py:243-309` (put_entity)
- Modify: `src/datacore/store.py:311-336` (get_active_entity)
- Modify: `src/datacore/store.py:338-359` (get_entity_history)
- Modify: `tests/test_store_entities.py` (all `_custom_fields` refs)
- Modify: `tests/conftest.py` (no changes needed — uses `custom_fields` kwarg already)

- [ ] **Step 1: Update tests to expect `custom_fields` instead of `_custom_fields`**

In `tests/test_store_entities.py`, replace every `_custom_fields` key access with `custom_fields`:

```python
# test_create_entity_first_version (line 20-22)
assert isinstance(result["custom_fields"], dict)
assert result["custom_fields"]["city"] == "Springfield"

# test_entity_custom_fields_stored_as_toon (line 197)
raw_custom = rows[0]["custom_fields"]

# test_entity_custom_fields_empty_dict_ok (line 214-218)
assert result["custom_fields"] == {}
assert active["custom_fields"] == {}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `uv run pytest tests/test_store_entities.py -v -k "custom_fields" --tb=short`
Expected: FAIL — `KeyError: 'custom_fields'` (code still uses `_custom_fields`)

- [ ] **Step 3: Update ENTITIES_SCHEMA and Store methods**

In `src/datacore/store.py`:

Schema change (line 39):
```python
pa.field("custom_fields", pa.string()),    # TOON-encoded document
```

`put_entity()` — line 295 and 308:
```python
"custom_fields": toon.encode(custom_fields or {}),
```
```python
record["custom_fields"] = custom_fields or {}
```

`get_active_entity()` — line 335:
```python
row["custom_fields"] = toon.decode(row["custom_fields"]) if row["custom_fields"] else {}
```

`get_entity_history()` — line 357:
```python
row["custom_fields"] = toon.decode(row["custom_fields"]) if row["custom_fields"] else {}
```

Also update the docstring at line 255-256:
```python
"""Store an entity record.

Archives the current active version and inserts a new one.
Custom fields are stored as a TOON document in custom_fields.
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `uv run pytest tests/test_store_entities.py -v --tb=short`
Expected: ALL PASS

- [ ] **Step 5: Commit**

```bash
git add src/datacore/store.py tests/test_store_entities.py
git commit -m "refactor: rename _custom_fields to custom_fields in Store and entity tests"
```

---

### Task 2: Update QueryEngine for column rename

**Files:**
- Modify: `src/datacore/query.py:90-132` (_flatten_custom_fields)
- Modify: `tests/test_query_custom_fields.py`

- [ ] **Step 1: Run query tests to check current state**

Run: `uv run pytest tests/test_query_custom_fields.py -v --tb=short`
Expected: FAIL — QueryEngine references `_custom_fields` column which no longer exists after Task 1

- [ ] **Step 2: Update `_flatten_custom_fields` to use `custom_fields`**

In `src/datacore/query.py`, line 97:
```python
custom_col = arrow_table.column("custom_fields")
```

- [ ] **Step 3: Run query tests to verify they pass**

Run: `uv run pytest tests/test_query_custom_fields.py -v --tb=short`
Expected: ALL PASS

- [ ] **Step 4: Run full test suite**

Run: `uv run pytest --tb=short -q`
Expected: 62 passed

- [ ] **Step 5: Commit**

```bash
git add src/datacore/query.py
git commit -m "refactor: update QueryEngine to use renamed custom_fields column"
```

---

### Task 3: Switch `base_data` serialization from JSON to TOON

**Files:**
- Modify: `src/datacore/store.py:294` (put_entity — encode)
- Modify: `src/datacore/store.py:334` (get_active_entity — decode)
- Modify: `src/datacore/store.py:356` (get_entity_history — decode)
- Modify: `tests/test_store_entities.py` (add TOON verification test)

- [ ] **Step 1: Add test verifying base_data is stored as TOON**

Add to `tests/test_store_entities.py`:

```python
# ── 18. base_data is TOON-encoded (no braces in raw storage) ────────────────

def test_entity_base_data_stored_as_toon(store):
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
    # Should be TOON format: "key: value"
    assert "first_name: Alice" in raw_base
```

- [ ] **Step 2: Run new test to verify it fails**

Run: `uv run pytest tests/test_store_entities.py::test_entity_base_data_stored_as_toon -v --tb=short`
Expected: FAIL — `base_data` still stored as JSON with braces

- [ ] **Step 3: Switch `base_data` to TOON in Store**

In `src/datacore/store.py`:

`put_entity()` line 294 — change:
```python
"base_data": toon.encode(base_data),
```

`get_active_entity()` line 334 — change:
```python
row["base_data"] = toon.decode(row["base_data"]) if row["base_data"] else {}
```

`get_entity_history()` line 356 — change:
```python
row["base_data"] = toon.decode(row["base_data"]) if row["base_data"] else {}
```

Also update the schema comment in `ENTITIES_SCHEMA` line 38:
```python
pa.field("base_data", pa.string()),         # TOON-encoded document
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `uv run pytest tests/test_store_entities.py -v --tb=short`
Expected: ALL PASS

- [ ] **Step 5: Commit**

```bash
git add src/datacore/store.py tests/test_store_entities.py
git commit -m "refactor: switch base_data serialization from JSON to TOON"
```

---

### Task 4: Update QueryEngine to decode TOON for `base_data`

**Files:**
- Modify: `src/datacore/query.py:90-132` (_flatten_custom_fields — base_data flattening)
- Modify: `src/datacore/query.py:134-167` (rename _flatten_json_column → _flatten_toon_column)

- [ ] **Step 1: Run query tests to check current state**

Run: `uv run pytest tests/test_query_custom_fields.py -v --tb=short`
Expected: FAIL — `_flatten_json_column` tries `json.loads()` on TOON-encoded `base_data`

- [ ] **Step 2: Rename `_flatten_json_column` to `_flatten_toon_column` and decode TOON**

In `src/datacore/query.py`, replace `_flatten_json_column` (lines 134-167) with:

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
        if val:
            d = toon.decode(val) if isinstance(val, str) else val
            parsed.append(d)
            for k in d:
                all_keys[k] = None
        else:
            parsed.append({})

    for key in all_keys:
        # Skip if column already exists (e.g., from custom fields)
        if key in arrow_table.column_names:
            continue
        values = []
        for row in parsed:
            v = row.get(key)
            # Serialize non-scalar values (lists, dicts) as JSON strings
            if isinstance(v, (dict, list)):
                v = json.dumps(v)
            values.append(v)
        arrow_table = arrow_table.append_column(
            key, pa.array(values, type=pa.string())
        )

    return arrow_table
```

Update the call site in `_flatten_custom_fields` (line 130):
```python
arrow_table = self._flatten_toon_column(arrow_table, "base_data")
```

Update `_parse_json_column` (line 177) to call the renamed method:
```python
return self._flatten_toon_column(arrow_table, column_name)
```

Wait — `_parse_json_column` is used for `model_definition` which is still JSON-encoded. That method should stay as JSON. Only `base_data` flattening should switch to TOON. So keep `_flatten_json_column` as-is for `model_definition`, and create `_flatten_toon_column` for `base_data`.

Actually, re-reading the code: `_parse_json_column` calls `_flatten_json_column` for `model_definition`. Model definitions are still JSON. So we need:
- Rename `_flatten_json_column` → `_flatten_toon_column` (decode TOON)
- Keep `_parse_json_column` using a JSON-based flatten for `model_definition`

The cleanest approach: rename `_flatten_json_column` → `_flatten_toon_column` with TOON decoding for entity columns. For `_parse_json_column` (models), inline the JSON flatten or keep a separate `_flatten_json_column`.

Let me revise. Replace the full query.py changes:

In `_flatten_custom_fields`, change line 130:
```python
arrow_table = self._flatten_toon_column(arrow_table, "base_data")
```

Rename `_flatten_json_column` to `_flatten_toon_column` and switch from `json.loads` to `toon.decode` (lines 134-167):
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
        if val:
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

Update `_parse_json_column` (line 177) — `model_definition` is still JSON, so keep JSON parsing inline:
```python
def _parse_json_column(
    self, arrow_table: pa.Table, column_name: str
) -> pa.Table:
    """Parse a JSON string column into flattened columns."""
    col = arrow_table.column(column_name)
    all_values = col.to_pylist()

    parsed = []
    all_keys: dict[str, None] = {}
    for val in all_values:
        if val:
            d = json.loads(val) if isinstance(val, str) else val
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

- [ ] **Step 3: Run query tests to verify they pass**

Run: `uv run pytest tests/test_query_custom_fields.py -v --tb=short`
Expected: ALL PASS

- [ ] **Step 4: Run full test suite**

Run: `uv run pytest --tb=short -q`
Expected: 62 passed (or 63 with the new test from Task 3)

- [ ] **Step 5: Commit**

```bash
git add src/datacore/query.py
git commit -m "refactor: rename _flatten_json_column to _flatten_toon_column, decode TOON for base_data"
```

---

### Task 5: Add FastAPI and test dependencies

**Files:**
- Modify: `pyproject.toml`

- [ ] **Step 1: Add dependencies to `pyproject.toml`**

Add `fastapi` and `uvicorn` to `dependencies`:
```toml
dependencies = [
    "lancedb>=0.6",
    "pyarrow>=14.0",
    "duckdb>=0.10",
    "python-toon>=0.1",
    "fastapi>=0.115",
    "uvicorn>=0.34",
]
```

Add `httpx` to `dev` dependencies (needed for FastAPI TestClient):
```toml
[project.optional-dependencies]
dev = [
    "pytest>=8.0",
    "httpx>=0.28",
]
```

- [ ] **Step 2: Install dependencies**

Run: `uv sync --all-extras`
Expected: All dependencies installed successfully

- [ ] **Step 3: Verify imports work**

Run: `uv run python3 -c "import fastapi; import uvicorn; import httpx; print('OK')"`
Expected: `OK`

- [ ] **Step 4: Commit**

```bash
git add pyproject.toml uv.lock
git commit -m "build: add fastapi, uvicorn, httpx dependencies"
```

---

### Task 6: Create FastAPI app with CORS

**Files:**
- Create: `src/datacore/api/__init__.py`
- Test: `tests/test_api.py`

- [ ] **Step 1: Write test for CORS headers**

Create `tests/test_api.py`:

```python
"""Tests for the datacore REST API."""

import tempfile

import pytest
from fastapi.testclient import TestClient

from datacore import Store
from datacore.api import create_app


@pytest.fixture
def app_client():
    with tempfile.TemporaryDirectory() as tmp:
        store = Store(data_dir=tmp)
        app = create_app(store)
        yield TestClient(app), store


def test_cors_allows_admindash_origin(app_client):
    client, _ = app_client
    response = client.options(
        "/api/models/t1/student",
        headers={
            "Origin": "http://localhost:5174",
            "Access-Control-Request-Method": "GET",
        },
    )
    assert response.headers.get("access-control-allow-origin") == "http://localhost:5174"


def test_cors_allows_papermite_origin(app_client):
    client, _ = app_client
    response = client.options(
        "/api/models/t1/student",
        headers={
            "Origin": "http://localhost:5173",
            "Access-Control-Request-Method": "GET",
        },
    )
    assert response.headers.get("access-control-allow-origin") == "http://localhost:5173"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `uv run pytest tests/test_api.py -v --tb=short`
Expected: FAIL — `ModuleNotFoundError: No module named 'datacore.api'`

- [ ] **Step 3: Create app factory**

Create `src/datacore/api/__init__.py`:

```python
"""FastAPI REST API layer for datacore."""

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from datacore.store import Store
from datacore.api.routes import register_routes


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

    return app
```

Create `src/datacore/api/routes.py` (empty for now — just enough to not crash):

```python
"""API route handlers."""

from fastapi import FastAPI

from datacore.store import Store


def register_routes(app: FastAPI, store: Store) -> None:
    """Register API routes."""
    pass
```

- [ ] **Step 4: Run CORS tests to verify they pass**

Run: `uv run pytest tests/test_api.py -v --tb=short`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/datacore/api/__init__.py src/datacore/api/routes.py tests/test_api.py
git commit -m "feat: add FastAPI app factory with CORS middleware"
```

---

### Task 7: GET model definition endpoint

**Files:**
- Modify: `src/datacore/api/routes.py`
- Modify: `tests/test_api.py`

- [ ] **Step 1: Write tests for GET model endpoint**

Add to `tests/test_api.py`:

```python
def test_get_model_returns_active_definition(app_client):
    client, store = app_client
    store.put_model(
        tenant_id="t1",
        entity_type="student",
        model_definition={
            "base_fields": [
                {"name": "first_name", "type": "str", "required": True},
            ],
            "custom_fields": [],
        },
    )

    response = client.get("/api/models/t1/student")
    assert response.status_code == 200
    data = response.json()
    assert data["entity_type"] == "student"
    assert isinstance(data["model_definition"], dict)
    assert data["model_definition"]["base_fields"][0]["name"] == "first_name"


def test_get_model_not_found(app_client):
    client, _ = app_client
    response = client.get("/api/models/t1/nonexistent")
    assert response.status_code == 404
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `uv run pytest tests/test_api.py::test_get_model_returns_active_definition tests/test_api.py::test_get_model_not_found -v --tb=short`
Expected: FAIL — 404 (no routes registered)

- [ ] **Step 3: Implement GET model route**

Update `src/datacore/api/routes.py`:

```python
"""API route handlers."""

from fastapi import FastAPI, HTTPException

from datacore.store import Store


def register_routes(app: FastAPI, store: Store) -> None:
    """Register API routes."""

    @app.get("/api/models/{tenant_id}/{entity_type}")
    def get_model(tenant_id: str, entity_type: str):
        result = store.get_active_model(tenant_id, entity_type)
        if result is None:
            raise HTTPException(status_code=404, detail="Model not found")
        return result
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `uv run pytest tests/test_api.py -v --tb=short`
Expected: ALL PASS

- [ ] **Step 5: Commit**

```bash
git add src/datacore/api/routes.py tests/test_api.py
git commit -m "feat: add GET /api/models/{tenant_id}/{entity_type} endpoint"
```

---

### Task 8: POST entity creation endpoint

**Files:**
- Modify: `src/datacore/api/routes.py`
- Modify: `tests/test_api.py`

- [ ] **Step 1: Write tests for POST entity endpoint**

Add to `tests/test_api.py`:

```python
def test_create_entity_returns_201(app_client):
    client, store = app_client
    response = client.post(
        "/api/entities/t1/student",
        json={
            "base_data": {"first_name": "Alice", "last_name": "Smith"},
            "custom_fields": {"city": "Springfield"},
        },
    )
    assert response.status_code == 201
    data = response.json()
    assert data["entity_type"] == "student"
    assert "entity_id" in data
    assert len(data["entity_id"]) > 0
    assert data["base_data"]["first_name"] == "Alice"
    assert data["custom_fields"]["city"] == "Springfield"
    assert data["_version"] == 1
    assert data["_status"] == "active"


def test_create_entity_generates_uuid(app_client):
    client, _ = app_client
    r1 = client.post(
        "/api/entities/t1/student",
        json={"base_data": {"first_name": "Alice", "last_name": "Smith"}},
    )
    r2 = client.post(
        "/api/entities/t1/student",
        json={"base_data": {"first_name": "Bob", "last_name": "Jones"}},
    )
    assert r1.status_code == 201
    assert r2.status_code == 201
    assert r1.json()["entity_id"] != r2.json()["entity_id"]


def test_create_entity_without_custom_fields(app_client):
    client, _ = app_client
    response = client.post(
        "/api/entities/t1/student",
        json={"base_data": {"first_name": "Alice", "last_name": "Smith"}},
    )
    assert response.status_code == 201
    data = response.json()
    assert data["custom_fields"] == {}


def test_create_entity_persists_to_store(app_client):
    client, store = app_client
    response = client.post(
        "/api/entities/t1/student",
        json={
            "base_data": {"first_name": "Alice", "last_name": "Smith"},
            "custom_fields": {"city": "Springfield"},
        },
    )
    entity_id = response.json()["entity_id"]

    # Verify it's retrievable from the store
    active = store.get_active_entity("t1", "student", entity_id)
    assert active is not None
    assert active["base_data"]["first_name"] == "Alice"
    assert active["custom_fields"]["city"] == "Springfield"
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `uv run pytest tests/test_api.py -k "create_entity" -v --tb=short`
Expected: FAIL — 404 or 405 (route not registered)

- [ ] **Step 3: Implement POST entity route**

Update `src/datacore/api/routes.py`:

```python
"""API route handlers."""

import uuid

from fastapi import FastAPI, HTTPException
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from datacore.store import Store


class CreateEntityRequest(BaseModel):
    base_data: dict
    custom_fields: dict | None = None


def register_routes(app: FastAPI, store: Store) -> None:
    """Register API routes."""

    @app.get("/api/models/{tenant_id}/{entity_type}")
    def get_model(tenant_id: str, entity_type: str):
        result = store.get_active_model(tenant_id, entity_type)
        if result is None:
            raise HTTPException(status_code=404, detail="Model not found")
        return result

    @app.post("/api/entities/{tenant_id}/{entity_type}")
    def create_entity(
        tenant_id: str, entity_type: str, body: CreateEntityRequest
    ):
        entity_id = uuid.uuid4().hex[:12]
        result = store.put_entity(
            tenant_id=tenant_id,
            entity_type=entity_type,
            entity_id=entity_id,
            base_data=body.base_data,
            custom_fields=body.custom_fields,
        )
        return JSONResponse(status_code=201, content=result)
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `uv run pytest tests/test_api.py -v --tb=short`
Expected: ALL PASS

Note: If `JSONResponse` fails to serialize datetime strings or dicts, the `result` dict from `Store.put_entity()` returns Python dicts for `base_data` and `custom_fields`. FastAPI's `JSONResponse` will serialize these fine. If there's a serialization issue with any field, use `jsonable_encoder` from `fastapi.encoders`.

- [ ] **Step 5: Run full test suite**

Run: `uv run pytest --tb=short -q`
Expected: ALL PASS

- [ ] **Step 6: Commit**

```bash
git add src/datacore/api/routes.py tests/test_api.py
git commit -m "feat: add POST /api/entities/{tenant_id}/{entity_type} endpoint"
```

---

### Task 9: Update `__init__.py` exports and final verification

**Files:**
- Modify: `src/datacore/__init__.py`

- [ ] **Step 1: Update package exports**

In `src/datacore/__init__.py`:

```python
"""Datacore — centralized storage and query engine for NeoApex."""

from datacore.store import Store
from datacore.query import QueryEngine
from datacore.api import create_app

__all__ = ["Store", "QueryEngine", "create_app"]
```

- [ ] **Step 2: Run full test suite**

Run: `uv run pytest --tb=short -q`
Expected: ALL PASS

- [ ] **Step 3: Verify API can start**

Run: `uv run python3 -c "from datacore import create_app, Store; app = create_app(Store()); print('App created:', app.title)"`
Expected: `App created: datacore`

- [ ] **Step 4: Commit**

```bash
git add src/datacore/__init__.py
git commit -m "feat: export create_app from datacore package"
```
