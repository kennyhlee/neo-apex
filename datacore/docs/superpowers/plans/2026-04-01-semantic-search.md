# Semantic Search Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add vector embeddings to entity records and semantic search capability using Voyage AI `voyage-3`, enabling natural language queries over structured entity data.

**Architecture:** New `Embedder` module handles text flattening and Voyage AI API calls. Store gets an `Embedder` dependency and auto-embeds on every `put_entity()` call. QueryEngine gets a `semantic_search()` method. New REST endpoint exposes search over HTTP. Existing entity data is deleted (pre-production) so all records start with vectors.

**Tech Stack:** Python, LanceDB (vector search), Voyage AI `voyage-3` (1024-dim embeddings), `voyageai` SDK, FastAPI, pytest

---

## File Structure

| Action | File | Responsibility |
|--------|------|---------------|
| Create | `src/datacore/embedder.py` | Text flattening + Voyage AI embedding generation |
| Modify | `src/datacore/store.py` | Add vector column to schema, Embedder dependency, auto-embed on put_entity |
| Modify | `src/datacore/query.py` | Add semantic_search() method |
| Modify | `src/datacore/api/routes.py` | Add GET /api/search/{tenant_id} endpoint |
| Modify | `src/datacore/api/__init__.py` | Pass embedder to Store in create_app |
| Modify | `src/datacore/api/server.py` | Instantiate Embedder for server entry point |
| Modify | `src/datacore/__init__.py` | Export Embedder |
| Modify | `pyproject.toml` | Add voyageai dependency |
| Modify | `tests/conftest.py` | Update store fixture to include mock embedder |
| Create | `tests/test_embedder.py` | Unit tests for Embedder |
| Create | `tests/test_semantic_search.py` | Tests for semantic_search() and search endpoint |
| Modify | `tests/test_api.py` | Update app_client fixture for Embedder |
| Modify | `tests/test_store_entities.py` | Update for Embedder dependency |

---

### Task 1: Add voyageai dependency and create Embedder module

**Files:**
- Modify: `pyproject.toml`
- Create: `src/datacore/embedder.py`
- Create: `tests/test_embedder.py`

- [ ] **Step 1: Add voyageai to pyproject.toml**

In `pyproject.toml`, add `voyageai` to dependencies:

```toml
dependencies = [
    "lancedb>=0.6",
    "pyarrow>=14.0",
    "duckdb>=0.10",
    "python-toon>=0.1",
    "fastapi>=0.115",
    "uvicorn>=0.34",
    "voyageai>=0.3",
]
```

- [ ] **Step 2: Install dependencies**

Run: `uv sync --all-extras`
Expected: voyageai installed successfully

- [ ] **Step 3: Write tests for Embedder**

Create `tests/test_embedder.py`:

```python
"""Unit tests for Embedder text flattening and embedding generation."""

from unittest.mock import MagicMock, patch

import pytest

from datacore.embedder import Embedder


def test_flatten_fields_combines_all_keys():
    embedder = Embedder.__new__(Embedder)
    text = embedder._flatten_fields({
        "first_name": "Wei",
        "last_name": "Chen",
        "grade_level": "2nd",
    })
    assert "first_name: Wei" in text
    assert "last_name: Chen" in text
    assert "grade_level: 2nd" in text


def test_flatten_fields_empty_dict():
    embedder = Embedder.__new__(Embedder)
    text = embedder._flatten_fields({})
    assert text == ""


def test_flatten_fields_skips_none_values():
    embedder = Embedder.__new__(Embedder)
    text = embedder._flatten_fields({"name": "Alice", "phone": None})
    assert "name: Alice" in text
    assert "phone" not in text


@patch("datacore.embedder.voyageai")
def test_embed_calls_voyage_api(mock_voyageai):
    mock_client = MagicMock()
    mock_result = MagicMock()
    mock_result.embeddings = [[0.1] * 1024]
    mock_client.embed.return_value = mock_result
    mock_voyageai.Client.return_value = mock_client

    embedder = Embedder()
    vector = embedder.embed({"first_name": "Wei", "last_name": "Chen"})

    assert len(vector) == 1024
    mock_client.embed.assert_called_once()
    call_args = mock_client.embed.call_args
    assert call_args[0][0] == [embedder._flatten_fields({"first_name": "Wei", "last_name": "Chen"})]
    assert call_args[1]["model"] == "voyage-3"
    assert call_args[1]["input_type"] == "document"


@patch("datacore.embedder.voyageai")
def test_embed_batch(mock_voyageai):
    mock_client = MagicMock()
    mock_result = MagicMock()
    mock_result.embeddings = [[0.1] * 1024, [0.2] * 1024]
    mock_client.embed.return_value = mock_result
    mock_voyageai.Client.return_value = mock_client

    embedder = Embedder()
    vectors = embedder.embed_batch([
        {"first_name": "Wei"},
        {"first_name": "Kenny"},
    ])

    assert len(vectors) == 2
    assert len(vectors[0]) == 1024


@patch("datacore.embedder.voyageai")
def test_embed_query_uses_query_input_type(mock_voyageai):
    mock_client = MagicMock()
    mock_result = MagicMock()
    mock_result.embeddings = [[0.1] * 1024]
    mock_client.embed.return_value = mock_result
    mock_voyageai.Client.return_value = mock_client

    embedder = Embedder()
    embedder.embed_query("students with allergies")

    call_args = mock_client.embed.call_args
    assert call_args[1]["input_type"] == "query"


def test_embedder_raises_without_api_key():
    with patch.dict("os.environ", {}, clear=True):
        with patch("datacore.embedder.voyageai") as mock_voyageai:
            mock_voyageai.Client.side_effect = Exception("API key required")
            with pytest.raises(Exception):
                Embedder()
```

- [ ] **Step 4: Run tests to verify they fail**

Run: `uv run pytest tests/test_embedder.py -v --tb=short`
Expected: FAIL — `ModuleNotFoundError: No module named 'datacore.embedder'`

- [ ] **Step 5: Create Embedder module**

Create `src/datacore/embedder.py`:

```python
"""Voyage AI embedding generation for entity data."""

import voyageai

MODEL = "voyage-3"
DIMENSIONS = 1024


class Embedder:
    """Generates vector embeddings from entity field data using Voyage AI.

    Reads VOYAGE_API_KEY from environment automatically.
    """

    def __init__(self):
        self._client = voyageai.Client()

    def _flatten_fields(self, fields: dict) -> str:
        """Flatten a dict of fields into a single text string for embedding."""
        parts = []
        for key, value in fields.items():
            if value is not None:
                parts.append(f"{key}: {value}")
        return ", ".join(parts)

    def embed(self, fields: dict) -> list[float]:
        """Embed a single entity's fields.

        Args:
            fields: merged base_data + custom_fields dict

        Returns:
            1024-dimension float vector
        """
        text = self._flatten_fields(fields)
        result = self._client.embed(
            [text], model=MODEL, input_type="document"
        )
        return result.embeddings[0]

    def embed_batch(self, fields_list: list[dict]) -> list[list[float]]:
        """Embed multiple entities' fields in one API call.

        Args:
            fields_list: list of merged field dicts

        Returns:
            list of 1024-dimension float vectors
        """
        texts = [self._flatten_fields(f) for f in fields_list]
        result = self._client.embed(
            texts, model=MODEL, input_type="document"
        )
        return result.embeddings

    def embed_query(self, query: str) -> list[float]:
        """Embed a search query string.

        Uses input_type="query" for optimal retrieval performance.

        Args:
            query: natural language search query

        Returns:
            1024-dimension float vector
        """
        result = self._client.embed(
            [query], model=MODEL, input_type="query"
        )
        return result.embeddings[0]
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `uv run pytest tests/test_embedder.py -v --tb=short`
Expected: ALL PASS

- [ ] **Step 7: Commit**

```bash
git add pyproject.toml src/datacore/embedder.py tests/test_embedder.py
git commit -m "feat: add Embedder module with Voyage AI voyage-3 integration"
```

---

### Task 2: Add vector column to schema and Embedder to Store

**Files:**
- Modify: `src/datacore/store.py:35-40` (ENTITIES_SCHEMA)
- Modify: `src/datacore/store.py:55-67` (Store.__init__)
- Modify: `src/datacore/store.py:243-309` (put_entity)
- Modify: `tests/conftest.py` (store fixture)
- Modify: `tests/test_store_entities.py` (update for embedder)

- [ ] **Step 1: Update tests to pass a mock embedder to Store**

In `tests/conftest.py`, add a mock embedder and pass it to Store:

```python
import tempfile
from unittest.mock import MagicMock

import pytest
from datacore import Store, QueryEngine


@pytest.fixture
def mock_embedder():
    embedder = MagicMock()
    embedder.embed.return_value = [0.0] * 1024
    embedder.embed_batch.return_value = []
    return embedder


@pytest.fixture
def tmp_dir():
    with tempfile.TemporaryDirectory() as d:
        yield d


@pytest.fixture
def store(tmp_dir, mock_embedder):
    return Store(
        data_dir=tmp_dir,
        embedder=mock_embedder,
        max_model_versions=5,
        default_max_entity_versions=3,
        entity_version_limits={"student": 3, "staff": 2},
    )


@pytest.fixture
def engine(store):
    return QueryEngine(store)


@pytest.fixture
def seeded_store(store):
    """Store with pre-loaded model definitions and entity records."""
    cid = "seed-change"
    store.put_model(
        tenant_id="t1",
        entity_type="student",
        model_definition={
            "base_fields": [
                {"name": "first_name", "type": "str", "required": True},
                {"name": "last_name", "type": "str", "required": True},
                {"name": "grade", "type": "str", "required": False},
            ],
            "custom_fields": [],
        },
        change_id=cid,
    )
    store.put_model(
        tenant_id="t1",
        entity_type="staff",
        model_definition={
            "base_fields": [
                {"name": "name", "type": "str", "required": True},
                {"name": "role", "type": "str", "required": True},
            ],
            "custom_fields": [],
        },
        change_id=cid,
    )
    store.put_entity(
        tenant_id="t1", entity_type="student", entity_id="S001",
        base_data={"first_name": "Alice", "last_name": "Smith", "grade": "5"},
        custom_fields={"city": "Springfield", "bus_day": "tuesday"},
    )
    store.put_entity(
        tenant_id="t1", entity_type="student", entity_id="S002",
        base_data={"first_name": "Bob", "last_name": "Jones", "grade": "3"},
        custom_fields={"city": "Shelbyville", "bus_day": "monday"},
    )
    store.put_entity(
        tenant_id="t1", entity_type="student", entity_id="S003",
        base_data={"first_name": "Charlie", "last_name": "Brown", "grade": "5"},
        custom_fields={"city": "Springfield", "bus_day": "tuesday"},
    )
    return store


@pytest.fixture
def seeded_engine(seeded_store):
    return QueryEngine(seeded_store)
```

- [ ] **Step 2: Update test_store_entities.py for tests that create Store directly**

In `tests/test_store_entities.py`, update `test_entity_version_trimming_default_limit` which creates its own Store:

```python
def test_entity_version_trimming_default_limit(tmp_dir):
    from unittest.mock import MagicMock
    mock_embedder = MagicMock()
    mock_embedder.embed.return_value = [0.0] * 1024
    # Create a Store with no entity_version_limits — default is 5
    s = Store(data_dir=tmp_dir, embedder=mock_embedder)
    for i in range(8):
        s.put_entity(
            tenant_id="t1",
            entity_type="course",
            entity_id="C001",
            base_data={"name": f"Course-v{i+1}"},
        )

    history = s.get_entity_history("t1", "course", "C001")
    assert len(history) <= 5
```

- [ ] **Step 3: Run entity tests to verify they fail**

Run: `uv run pytest tests/test_store_entities.py -v --tb=short -x`
Expected: FAIL — Store.__init__ does not accept `embedder` parameter yet

- [ ] **Step 4: Update ENTITIES_SCHEMA and Store**

In `src/datacore/store.py`:

Update ENTITIES_SCHEMA (lines 35-40):
```python
# Default schema for entities table
ENTITIES_SCHEMA = pa.schema([
    pa.field("entity_type", pa.string()),
    pa.field("entity_id", pa.string()),
    pa.field("base_data", pa.string()),         # TOON-encoded document
    pa.field("custom_fields", pa.string()),    # TOON-encoded document
    pa.field("vector", pa.list_(pa.float32(), 1024)),
] + _META_FIELDS)
```

Update Store.__init__ (lines 55-67) — add embedder parameter:
```python
def __init__(
    self,
    data_dir: str | Path = DEFAULT_DATA_DIR,
    embedder=None,
    max_model_versions: int = 100,
    default_max_entity_versions: int = 5,
    entity_version_limits: dict[str, int] | None = None,
):
    self.data_dir = Path(data_dir)
    self.data_dir.mkdir(parents=True, exist_ok=True)
    self._db = lancedb.connect(str(self.data_dir))
    self.embedder = embedder
    self.max_model_versions = max_model_versions
    self.default_max_entity_versions = default_max_entity_versions
    self.entity_version_limits = entity_version_limits or {}
```

Update put_entity (lines 290-302) — add auto-embed before insert:
```python
        # Generate embedding from entity fields
        all_fields = dict(base_data)
        all_fields.update(custom_fields or {})
        vector = self.embedder.embed(all_fields) if self.embedder else [0.0] * 1024

        # Insert new active — custom fields stored as TOON format
        record = {
            "entity_type": entity_type,
            "entity_id": entity_id,
            "base_data": toon.encode(base_data),
            "custom_fields": toon.encode(custom_fields or {}),
            "vector": vector,
            "_version": next_version,
            "_status": "active",
            "_change_id": change_id,
            "_created_at": now,
            "_updated_at": now,
        }
        table.add([record])
```

Also update the return section — exclude vector from the returned dict (it's large and not useful to callers):
```python
        record["base_data"] = base_data
        record["custom_fields"] = custom_fields or {}
        del record["vector"]
        return record
```

- [ ] **Step 5: Run entity tests to verify they pass**

Run: `uv run pytest tests/test_store_entities.py -v --tb=short`
Expected: ALL PASS

- [ ] **Step 6: Run full test suite**

Run: `uv run pytest --tb=short -q`
Expected: Some tests may fail in test_api.py and test_smoke.py (they create Store without embedder). Fix those in the next step.

- [ ] **Step 7: Update test_api.py app_client fixture**

In `tests/test_api.py`, update the fixture:
```python
@pytest.fixture
def app_client():
    from unittest.mock import MagicMock
    with tempfile.TemporaryDirectory() as tmp:
        mock_embedder = MagicMock()
        mock_embedder.embed.return_value = [0.0] * 1024
        store = Store(data_dir=tmp, embedder=mock_embedder)
        app = create_app(store)
        yield TestClient(app), store
```

- [ ] **Step 8: Update test_smoke.py**

Read `tests/test_smoke.py` and update the Store() construction to include a mock embedder. Add `from unittest.mock import MagicMock` and pass `embedder=mock_embedder` where Store is instantiated.

- [ ] **Step 9: Run full test suite**

Run: `uv run pytest --tb=short -q`
Expected: ALL PASS

- [ ] **Step 10: Commit**

```bash
git add src/datacore/store.py tests/conftest.py tests/test_store_entities.py tests/test_api.py tests/test_smoke.py
git commit -m "feat: add vector column to entities schema, Embedder dependency on Store"
```

---

### Task 3: Add semantic_search() to QueryEngine

**Files:**
- Modify: `src/datacore/query.py`
- Create: `tests/test_semantic_search.py`

- [ ] **Step 1: Write tests for semantic_search**

Create `tests/test_semantic_search.py`:

```python
"""Tests for semantic search via QueryEngine."""

import tempfile
from unittest.mock import MagicMock

import pytest

from datacore import Store, QueryEngine


def _make_embedder(vectors_map=None):
    """Create a mock embedder that returns predictable vectors.

    vectors_map: dict mapping text substrings to vectors.
    Default: returns different vectors per call to simulate real embeddings.
    """
    embedder = MagicMock()
    call_count = [0]

    def mock_embed(fields):
        call_count[0] += 1
        # Return slightly different vectors for each entity
        vec = [0.0] * 1024
        vec[0] = float(call_count[0])
        return vec

    def mock_embed_query(query):
        # Return a vector close to entity 1 by default
        vec = [0.0] * 1024
        vec[0] = 1.0
        return vec

    embedder.embed.side_effect = mock_embed
    embedder.embed_query.side_effect = mock_embed_query
    return embedder


@pytest.fixture
def search_setup():
    with tempfile.TemporaryDirectory() as tmp:
        embedder = _make_embedder()
        store = Store(data_dir=tmp, embedder=embedder)
        engine = QueryEngine(store)

        store.put_entity("t1", "student", "S001",
            base_data={"first_name": "Alice", "last_name": "Smith"},
            custom_fields={"city": "Springfield"})
        store.put_entity("t1", "student", "S002",
            base_data={"first_name": "Bob", "last_name": "Jones"},
            custom_fields={"city": "Portland"})
        store.put_entity("t1", "teacher", "T001",
            base_data={"first_name": "Carol", "last_name": "White"},
            custom_fields={})

        yield engine, store, embedder


def test_semantic_search_returns_results(search_setup):
    engine, store, embedder = search_setup
    result = engine.semantic_search(
        tenant_id="t1",
        query="students in Springfield",
    )
    assert "results" in result
    assert "total" in result
    assert result["total"] > 0
    assert "_distance" in result["results"][0]


def test_semantic_search_respects_limit(search_setup):
    engine, store, embedder = search_setup
    result = engine.semantic_search(
        tenant_id="t1",
        query="students",
        limit=1,
    )
    assert len(result["results"]) == 1


def test_semantic_search_filters_by_entity_type(search_setup):
    engine, store, embedder = search_setup
    result = engine.semantic_search(
        tenant_id="t1",
        query="people",
        entity_type="student",
    )
    for r in result["results"]:
        assert r["entity_type"] == "student"


def test_semantic_search_returns_decoded_data(search_setup):
    engine, store, embedder = search_setup
    result = engine.semantic_search(
        tenant_id="t1",
        query="Alice",
        limit=10,
    )
    # base_data and custom_fields should be decoded dicts, not TOON strings
    for r in result["results"]:
        assert isinstance(r["base_data"], dict)
        assert isinstance(r["custom_fields"], dict)


def test_semantic_search_excludes_vector_from_results(search_setup):
    engine, store, embedder = search_setup
    result = engine.semantic_search(
        tenant_id="t1",
        query="Alice",
    )
    for r in result["results"]:
        assert "vector" not in r


def test_semantic_search_only_active_records(search_setup):
    engine, store, embedder = search_setup
    # Update Alice to create an archived version
    store.put_entity("t1", "student", "S001",
        base_data={"first_name": "Alice", "last_name": "Smith-Updated"},
        custom_fields={"city": "Springfield"})

    result = engine.semantic_search(
        tenant_id="t1",
        query="Alice",
        limit=10,
    )
    for r in result["results"]:
        assert r["_status"] == "active"


def test_semantic_search_empty_table(search_setup):
    engine, store, embedder = search_setup
    result = engine.semantic_search(
        tenant_id="t99",
        query="anything",
    )
    assert result["results"] == []
    assert result["total"] == 0


def test_semantic_search_calls_embed_query(search_setup):
    engine, store, embedder = search_setup
    engine.semantic_search(tenant_id="t1", query="find students")
    embedder.embed_query.assert_called_with("find students")
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `uv run pytest tests/test_semantic_search.py -v --tb=short -x`
Expected: FAIL — QueryEngine has no `semantic_search` method

- [ ] **Step 3: Implement semantic_search on QueryEngine**

In `src/datacore/query.py`, add import and update `__init__`:

```python
"""DuckDB + Arrow SQL query engine over LanceDB tables."""

import json

import duckdb
import pyarrow as pa
import toon

from datacore.store import Store


class TableNotFoundError(Exception):
    """Raised when a query targets a table that doesn't exist."""


class QueryEngine:
    """SQL query engine over LanceDB tables using DuckDB + Apache Arrow."""

    def __init__(self, store: Store):
        self.store = store
```

Add `semantic_search` method after the `query` method:

```python
    def semantic_search(
        self,
        tenant_id: str,
        query: str,
        entity_type: str | None = None,
        limit: int = 10,
        distance_threshold: float | None = None,
    ) -> dict:
        """Search entities by semantic similarity to a natural language query.

        Args:
            tenant_id: tenant scope
            query: natural language search text
            entity_type: optional filter to scope by entity type
            limit: max results to return (default 10)
            distance_threshold: optional max distance to include

        Returns:
            {"results": [...], "total": int} with _distance per result
        """
        table_name = self.store._entities_table_name(tenant_id)
        if table_name not in self.store._table_names():
            return {"results": [], "total": 0}

        # Embed the query
        query_vector = self.store.embedder.embed_query(query)

        # Run vector search
        table = self.store._db.open_table(table_name)
        search = table.search(query_vector).limit(limit)

        # Apply entity_type filter
        where_clauses = ["_status = 'active'"]
        if entity_type:
            where_clauses.append(f"entity_type = '{entity_type}'")
        search = search.where(" AND ".join(where_clauses))

        rows = search.to_list()

        # Apply distance threshold if specified
        if distance_threshold is not None:
            rows = [r for r in rows if r.get("_distance", 0) <= distance_threshold]

        # Decode TOON fields and clean up results
        results = []
        for row in rows:
            row["base_data"] = toon.decode(row["base_data"]) if row["base_data"] else {}
            row["custom_fields"] = toon.decode(row["custom_fields"]) if row["custom_fields"] else {}
            row.pop("vector", None)
            results.append(row)

        return {"results": results, "total": len(results)}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `uv run pytest tests/test_semantic_search.py -v --tb=short`
Expected: ALL PASS

- [ ] **Step 5: Run full test suite**

Run: `uv run pytest --tb=short -q`
Expected: ALL PASS

- [ ] **Step 6: Commit**

```bash
git add src/datacore/query.py tests/test_semantic_search.py
git commit -m "feat: add semantic_search() to QueryEngine with vector search"
```

---

### Task 4: Add search REST endpoint

**Files:**
- Modify: `src/datacore/api/routes.py`
- Modify: `tests/test_semantic_search.py` (add API test)

- [ ] **Step 1: Write API test for search endpoint**

Append to `tests/test_semantic_search.py`:

```python
from fastapi.testclient import TestClient
from datacore.api import create_app


def test_search_endpoint_returns_results(search_setup):
    engine, store, embedder = search_setup
    app = create_app(store)
    client = TestClient(app)

    response = client.get("/api/search/t1?q=students+in+Springfield")
    assert response.status_code == 200
    data = response.json()
    assert "results" in data
    assert "total" in data
    assert data["total"] > 0


def test_search_endpoint_with_entity_type_filter(search_setup):
    engine, store, embedder = search_setup
    app = create_app(store)
    client = TestClient(app)

    response = client.get("/api/search/t1?q=people&entity_type=student")
    assert response.status_code == 200
    for r in response.json()["results"]:
        assert r["entity_type"] == "student"


def test_search_endpoint_with_limit(search_setup):
    engine, store, embedder = search_setup
    app = create_app(store)
    client = TestClient(app)

    response = client.get("/api/search/t1?q=students&limit=1")
    assert response.status_code == 200
    assert len(response.json()["results"]) <= 1


def test_search_endpoint_requires_query(search_setup):
    engine, store, embedder = search_setup
    app = create_app(store)
    client = TestClient(app)

    response = client.get("/api/search/t1")
    assert response.status_code == 422  # missing required query param
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `uv run pytest tests/test_semantic_search.py -k "endpoint" -v --tb=short`
Expected: FAIL — 404 (no route registered)

- [ ] **Step 3: Implement search endpoint**

In `src/datacore/api/routes.py`, add the QueryEngine import at the top and the search route inside `register_routes`:

Add to imports:
```python
from datacore.query import QueryEngine
```

Add route inside `register_routes`, after the existing routes:
```python
    @app.get("/api/search/{tenant_id}")
    def search_entities(
        tenant_id: str,
        q: str = Query(..., description="Search query text"),
        entity_type: str | None = Query(None, description="Filter by entity type"),
        limit: int = Query(10, ge=1, le=100, description="Max results"),
    ):
        engine = QueryEngine(store)
        result = engine.semantic_search(
            tenant_id=tenant_id,
            query=q,
            entity_type=entity_type,
            limit=limit,
        )
        return result
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `uv run pytest tests/test_semantic_search.py -v --tb=short`
Expected: ALL PASS

- [ ] **Step 5: Run full test suite**

Run: `uv run pytest --tb=short -q`
Expected: ALL PASS

- [ ] **Step 6: Commit**

```bash
git add src/datacore/api/routes.py tests/test_semantic_search.py
git commit -m "feat: add GET /api/search/{tenant_id} semantic search endpoint"
```

---

### Task 5: Update server entry point, exports, and final verification

**Files:**
- Modify: `src/datacore/api/server.py`
- Modify: `src/datacore/__init__.py`

- [ ] **Step 1: Update server.py to include Embedder**

Rewrite `src/datacore/api/server.py`:

```python
"""Uvicorn entry point for the datacore API."""

from datacore.api import create_app
from datacore.embedder import Embedder
from datacore.store import Store

app = create_app(Store(embedder=Embedder()))
```

- [ ] **Step 2: Update package exports**

In `src/datacore/__init__.py`:

```python
"""Datacore — centralized storage and query engine for NeoApex."""

from datacore.store import Store
from datacore.query import QueryEngine
from datacore.api import create_app
from datacore.embedder import Embedder

__all__ = ["Store", "QueryEngine", "create_app", "Embedder"]
```

- [ ] **Step 3: Run full test suite**

Run: `uv run pytest --tb=short -q`
Expected: ALL PASS

- [ ] **Step 4: Verify app can start (without API key — should fail clearly)**

Run: `uv run python3 -c "from datacore import Embedder; print('Embedder importable')"`
Expected: `Embedder importable`

- [ ] **Step 5: Commit**

```bash
git add src/datacore/api/server.py src/datacore/__init__.py
git commit -m "feat: update server entry point and exports for Embedder"
```

---

### Task 6: Delete old entity data

**Files:**
- None (data operation only)

- [ ] **Step 1: Delete existing acme_entities data**

```bash
rm -rf data/lancedb/acme_entities.lance
```

- [ ] **Step 2: Verify deletion**

Run: `uv run python3 -c "import lancedb; db = lancedb.connect('data/lancedb'); print(db.table_names())"`
Expected: Should only show `acme_models` (no `acme_entities`)

- [ ] **Step 3: Commit**

```bash
git add -A data/lancedb/
git commit -m "chore: delete old acme_entities data (no vector column)"
```
