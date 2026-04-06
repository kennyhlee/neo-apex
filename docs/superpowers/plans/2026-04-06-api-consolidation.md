# API Consolidation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a unified `POST /api/query` endpoint that replaces 5 read endpoints with DuckDB SQL queries over tenants, models, and entities.

**Architecture:** New `unified_routes.py` with one endpoint that accepts `{tenant_id, table, sql}`, loads the appropriate Arrow table, and delegates to the existing `QueryEngine.query()` method. The `tenants` table is a convenience alias that queries the entities table filtered to entity_type='tenant'.

**Tech Stack:** Python, FastAPI, DuckDB, Apache Arrow, LanceDB

**Spec:** `datacore/openspec/changes/api-consolidation/`

---

## File Structure

| File | Action | Responsibility |
|---|---|---|
| `datacore/src/datacore/api/unified_routes.py` | Create | `POST /api/query` endpoint |
| `datacore/src/datacore/api/__init__.py` | Modify | Register unified routes |
| `datacore/tests/test_unified_api.py` | Create | Tests for unified query endpoint |

---

### Task 1: Create unified query endpoint with tests

**Files:**
- Create: `datacore/src/datacore/api/unified_routes.py`
- Create: `datacore/tests/test_unified_api.py`
- Modify: `datacore/src/datacore/api/__init__.py`

- [ ] **Step 1: Write the failing tests**

Create `datacore/tests/test_unified_api.py`:

```python
"""Tests for the unified POST /api/query endpoint."""
import json
import tempfile

import pytest
from fastapi.testclient import TestClient
from unittest.mock import MagicMock

from datacore import Store
from datacore.api import create_app


@pytest.fixture
def uf_client():
    with tempfile.TemporaryDirectory() as tmp:
        mock_embedder = MagicMock()
        mock_embedder.embed.return_value = [0.0] * 1024
        store = Store(data_dir=tmp, embedder=mock_embedder)

        # Set up tenant
        store.put_entity(
            tenant_id="t1", entity_type="tenant", entity_id="t1",
            base_data={"tenant_id": "t1", "name": "Test School", "_abbrev": "TES"},
        )
        # Add students
        store.put_entity(
            tenant_id="t1", entity_type="student", entity_id="s1",
            base_data={"first_name": "Alice", "last_name": "Smith", "grade": "5"},
        )
        store.put_entity(
            tenant_id="t1", entity_type="student", entity_id="s2",
            base_data={"first_name": "Bob", "last_name": "Jones", "grade": "3"},
        )
        # Add model
        store.put_model(
            tenant_id="t1", entity_type="student",
            model_definition={
                "base_fields": [{"name": "first_name", "type": "str", "required": True}],
                "custom_fields": [],
            },
        )

        app = create_app(store)
        yield TestClient(app), store


# --- Entity queries ---

def test_query_entities(uf_client):
    client, _ = uf_client
    resp = client.post("/api/query", json={
        "tenant_id": "t1",
        "table": "entities",
        "sql": "SELECT * FROM data WHERE entity_type = 'student' AND _status = 'active' ORDER BY last_name",
    })
    assert resp.status_code == 200
    data = resp.json()
    assert data["total"] == 2
    assert len(data["data"]) == 2
    assert data["data"][0]["last_name"] == "Jones"


def test_query_entities_with_filter(uf_client):
    client, _ = uf_client
    resp = client.post("/api/query", json={
        "tenant_id": "t1",
        "table": "entities",
        "sql": "SELECT * FROM data WHERE entity_type = 'student' AND _status = 'active' AND first_name = 'Alice'",
    })
    assert resp.status_code == 200
    assert resp.json()["total"] == 1
    assert resp.json()["data"][0]["first_name"] == "Alice"


def test_query_entities_empty(uf_client):
    client, _ = uf_client
    resp = client.post("/api/query", json={
        "tenant_id": "t1",
        "table": "entities",
        "sql": "SELECT * FROM data WHERE entity_type = 'teacher'",
    })
    assert resp.status_code == 200
    assert resp.json() == {"data": [], "total": 0}


def test_query_entities_no_table(uf_client):
    client, _ = uf_client
    resp = client.post("/api/query", json={
        "tenant_id": "nonexistent",
        "table": "entities",
        "sql": "SELECT * FROM data",
    })
    assert resp.status_code == 200
    assert resp.json() == {"data": [], "total": 0}


# --- Tenant queries ---

def test_query_tenant(uf_client):
    client, _ = uf_client
    resp = client.post("/api/query", json={
        "tenant_id": "t1",
        "table": "tenants",
        "sql": "SELECT * FROM data WHERE entity_type = 'tenant' AND _status = 'active'",
    })
    assert resp.status_code == 200
    data = resp.json()
    assert data["total"] >= 1


# --- Model queries ---

def test_query_models(uf_client):
    client, _ = uf_client
    resp = client.post("/api/query", json={
        "tenant_id": "t1",
        "table": "models",
        "sql": "SELECT * FROM data WHERE _status = 'active'",
    })
    assert resp.status_code == 200
    data = resp.json()
    assert data["total"] >= 1


def test_query_models_by_entity_type(uf_client):
    client, _ = uf_client
    resp = client.post("/api/query", json={
        "tenant_id": "t1",
        "table": "models",
        "sql": "SELECT * FROM data WHERE entity_type = 'student' AND _status = 'active'",
    })
    assert resp.status_code == 200
    assert resp.json()["total"] == 1


# --- Validation ---

def test_query_invalid_table(uf_client):
    client, _ = uf_client
    resp = client.post("/api/query", json={
        "tenant_id": "t1",
        "table": "invalid",
        "sql": "SELECT * FROM data",
    })
    assert resp.status_code == 422


def test_query_missing_fields(uf_client):
    client, _ = uf_client
    resp = client.post("/api/query", json={"tenant_id": "t1"})
    assert resp.status_code == 422


def test_query_bad_sql(uf_client):
    client, _ = uf_client
    resp = client.post("/api/query", json={
        "tenant_id": "t1",
        "table": "entities",
        "sql": "THIS IS NOT SQL",
    })
    assert resp.status_code == 400
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd datacore && uv run python -m pytest tests/test_unified_api.py -v`
Expected: FAIL — endpoint doesn't exist

- [ ] **Step 3: Create unified_routes.py**

Create `datacore/src/datacore/api/unified_routes.py`:

```python
"""Unified query endpoint — DuckDB SQL over tenants, models, and entities."""
from enum import Enum

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from datacore.query import QueryEngine, TableNotFoundError
from datacore.store import Store

router = APIRouter(tags=["unified"])

_store: Store | None = None


class TableName(str, Enum):
    entities = "entities"
    models = "models"
    tenants = "tenants"


class QueryRequest(BaseModel):
    tenant_id: str
    table: TableName
    sql: str


def register_unified_routes(app, store: Store) -> None:
    global _store
    _store = store
    app.include_router(router)


@router.post("/api/query")
def unified_query(req: QueryRequest):
    """Execute a DuckDB SQL query against a tenant's data.

    The SQL runs against the table alias 'data'.
    Supported tables: entities, models, tenants.
    """
    qe = QueryEngine(_store)

    # Map table name to QueryEngine table_type
    # "tenants" is a convenience alias — tenants are stored as entities
    table_type = "entities" if req.table == TableName.tenants else req.table.value

    try:
        result = qe.query(
            tenant_id=req.tenant_id,
            table_type=table_type,
            sql=req.sql,
        )
    except TableNotFoundError:
        return {"data": [], "total": 0}
    except Exception as e:
        error_msg = str(e)
        if "Catalog Error" in error_msg or "Parser Error" in error_msg or "Binder Error" in error_msg:
            raise HTTPException(status_code=400, detail=f"SQL error: {error_msg}")
        raise HTTPException(status_code=500, detail=f"Query failed: {error_msg}")

    # Normalize response key from "rows" to "data"
    return {"data": result["rows"], "total": result["total"]}
```

- [ ] **Step 4: Register unified routes in create_app**

In `datacore/src/datacore/api/__init__.py`, add import:

```python
from datacore.api.unified_routes import register_unified_routes
```

Add after `register_auth_routes(app, store)`:

```python
    register_unified_routes(app, store)
```

- [ ] **Step 5: Run tests**

Run: `cd datacore && uv run python -m pytest tests/test_unified_api.py -v`
Expected: All 11 tests pass

- [ ] **Step 6: Run all DataCore tests**

Run: `cd datacore && uv run python -m pytest tests/ -q`
Expected: All tests pass (no regressions)

- [ ] **Step 7: Commit**

```bash
git add datacore/src/datacore/api/unified_routes.py datacore/src/datacore/api/__init__.py datacore/tests/test_unified_api.py
git commit -m "feat(datacore): add unified POST /api/query endpoint with DuckDB SQL"
```

---

### Task 2: End-to-end verification

- [ ] **Step 1: Run all DataCore tests**

Run: `cd datacore && uv run python -m pytest tests/ -q`
Expected: All tests pass

- [ ] **Step 2: Start DataCore and test with curl**

Start: `cd datacore && uv run uvicorn datacore.api.server:app --port 5800`

Test entity query:
```bash
curl -s -X POST http://localhost:5800/api/query \
  -H "Content-Type: application/json" \
  -d '{"tenant_id":"acme","table":"entities","sql":"SELECT * FROM data WHERE entity_type = '\''student'\'' AND _status = '\''active'\'' LIMIT 5"}' | python3 -m json.tool
```

Test model query:
```bash
curl -s -X POST http://localhost:5800/api/query \
  -H "Content-Type: application/json" \
  -d '{"tenant_id":"acme","table":"models","sql":"SELECT * FROM data WHERE _status = '\''active'\''"}' | python3 -m json.tool
```

Test tenant query:
```bash
curl -s -X POST http://localhost:5800/api/query \
  -H "Content-Type: application/json" \
  -d '{"tenant_id":"acme","table":"tenants","sql":"SELECT * FROM data WHERE entity_type = '\''tenant'\'' AND _status = '\''active'\''"}' | python3 -m json.tool
```

- [ ] **Step 3: Verify existing endpoints still work**

```bash
curl -s http://localhost:5800/api/models/acme/student | python3 -m json.tool
```

Expected: Same response as before — old endpoints unaffected.
