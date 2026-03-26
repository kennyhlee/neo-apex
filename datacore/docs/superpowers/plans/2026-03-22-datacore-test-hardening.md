# Datacore Test Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the single monolithic smoke test with granular unit tests covering every spec scenario for the vector-store and sql-query capabilities.

**Architecture:** Each spec scenario becomes one or more focused test functions. Tests use `tempfile.TemporaryDirectory` for isolated LanceDB instances. A shared `conftest.py` provides fixtures for store/engine setup and common test data.

**Tech Stack:** pytest, datacore (Store, QueryEngine), tempfile

---

## File Structure

```
tests/
├── conftest.py                    ← Shared fixtures (store, engine, seed data)
├── test_store_models.py           ← Store model CRUD + versioning tests
├── test_store_entities.py         ← Store entity CRUD + versioning tests
├── test_store_rollback.py         ← Rollback by change_id tests
├── test_query_basic.py            ← Basic SQL query + tenant scoping tests
├── test_query_custom_fields.py    ← TOON custom field flattening + querying
├── test_query_aggregation.py      ← Aggregate queries (COUNT, SUM, GROUP BY)
├── test_query_pagination.py       ← LIMIT/OFFSET + total count tests
└── test_smoke.py                  ← (existing, keep as integration test)
```

---

### Task 1: Test Fixtures (conftest.py)

**Files:**
- Create: `tests/conftest.py`

- [ ] **Step 1: Write conftest.py with shared fixtures**

```python
import tempfile
import pytest
from datacore import Store, QueryEngine


@pytest.fixture
def tmp_dir():
    with tempfile.TemporaryDirectory() as d:
        yield d


@pytest.fixture
def store(tmp_dir):
    return Store(
        data_dir=tmp_dir,
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

- [ ] **Step 2: Verify fixtures load without error**

Run: `pytest tests/conftest.py --collect-only`
Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add tests/conftest.py
git commit -m "test: add shared fixtures for datacore unit tests"
```

---

### Task 2: Store Model CRUD Tests

**Files:**
- Create: `tests/test_store_models.py`

Covers spec scenarios: Create a new table for a tenant, Store a new version, Retrieve active record, List version history, Model version trimming.

- [ ] **Step 1: Write failing tests**

```python
"""Tests for Store model definition CRUD and versioning."""


def test_create_model_first_version(store):
    """Spec: Create a new table for a tenant — version starts at 1."""
    result = store.put_model(
        tenant_id="t1", entity_type="student",
        model_definition={"base_fields": [{"name": "name", "type": "str"}]},
    )
    assert result["_version"] == 1
    assert result["_status"] == "active"
    assert result["entity_type"] == "student"
    assert result["model_definition"]["base_fields"][0]["name"] == "name"
    assert result["_change_id"]  # auto-generated
    assert result["_created_at"]
    assert result["_updated_at"]


def test_create_model_auto_creates_table(store):
    """Spec: table is created if it doesn't exist."""
    assert store.get_active_model("t1", "student") is None
    store.put_model(
        tenant_id="t1", entity_type="student",
        model_definition={"base_fields": []},
    )
    assert store.get_active_model("t1", "student") is not None


def test_new_version_archives_previous(store):
    """Spec: Store a new version — previous active is archived."""
    store.put_model(
        tenant_id="t1", entity_type="student",
        model_definition={"base_fields": [{"name": "v1"}]},
    )
    store.put_model(
        tenant_id="t1", entity_type="student",
        model_definition={"base_fields": [{"name": "v2"}]},
    )
    active = store.get_active_model("t1", "student")
    assert active["_version"] == 2
    assert active["model_definition"]["base_fields"][0]["name"] == "v2"

    history = store.get_model_history("t1", "student")
    assert len(history) == 2
    assert history[0]["_version"] == 2
    assert history[0]["_status"] == "active"
    assert history[1]["_version"] == 1
    assert history[1]["_status"] == "archived"


def test_retrieve_active_model_none_when_missing(store):
    """Spec: Retrieve active — None if no active record exists."""
    assert store.get_active_model("t1", "nonexistent") is None
    assert store.get_active_model("missing_tenant", "student") is None


def test_model_history_ordered_descending(store):
    """Spec: List version history — ordered by version descending."""
    for i in range(3):
        store.put_model(
            tenant_id="t1", entity_type="student",
            model_definition={"version": i + 1},
        )
    history = store.get_model_history("t1", "student")
    versions = [h["_version"] for h in history]
    assert versions == [3, 2, 1]


def test_model_history_empty_when_missing(store):
    """History returns empty list for nonexistent tenant/entity_type."""
    assert store.get_model_history("t1", "student") == []
    assert store.get_model_history("missing", "student") == []


def test_model_version_trimming(store):
    """Spec: Model version trimming — max 5 (from fixture), oldest deleted."""
    for i in range(8):
        store.put_model(
            tenant_id="t1", entity_type="student",
            model_definition={"version": i + 1},
        )
    history = store.get_model_history("t1", "student")
    assert len(history) <= 5


def test_model_versioning_independent_per_entity_type(store):
    """Each entity type has independent version history."""
    store.put_model(
        tenant_id="t1", entity_type="student",
        model_definition={"entity": "student"},
    )
    store.put_model(
        tenant_id="t1", entity_type="staff",
        model_definition={"entity": "staff"},
    )
    assert store.get_active_model("t1", "student")["_version"] == 1
    assert store.get_active_model("t1", "staff")["_version"] == 1

    store.put_model(
        tenant_id="t1", entity_type="student",
        model_definition={"entity": "student-v2"},
    )
    assert store.get_active_model("t1", "student")["_version"] == 2
    assert store.get_active_model("t1", "staff")["_version"] == 1


def test_model_change_id_correlation(store):
    """Models updated in same operation share a change_id."""
    cid = "batch-001"
    r1 = store.put_model(
        tenant_id="t1", entity_type="student",
        model_definition={"v": 1}, change_id=cid,
    )
    r2 = store.put_model(
        tenant_id="t1", entity_type="staff",
        model_definition={"v": 1}, change_id=cid,
    )
    assert r1["_change_id"] == cid
    assert r2["_change_id"] == cid


def test_model_tenant_isolation(store):
    """Tenant t1 models are invisible to tenant t2."""
    store.put_model(
        tenant_id="t1", entity_type="student",
        model_definition={"tenant": "t1"},
    )
    assert store.get_active_model("t1", "student") is not None
    assert store.get_active_model("t2", "student") is None
```

- [ ] **Step 2: Run tests to verify they pass**

Run: `pytest tests/test_store_models.py -v`
Expected: all PASS (code already exists)

- [ ] **Step 3: Commit**

```bash
git add tests/test_store_models.py
git commit -m "test: add unit tests for Store model CRUD and versioning"
```

---

### Task 3: Store Entity CRUD Tests

**Files:**
- Create: `tests/test_store_entities.py`

Covers spec scenarios: Create entity, Store new version, Retrieve active, List history, Entity version trimming, Key conflict validation.

- [ ] **Step 1: Write tests**

```python
"""Tests for Store entity CRUD, versioning, and validation."""
import pytest


def test_create_entity_first_version(store):
    """First entity record gets version 1."""
    result = store.put_entity(
        tenant_id="t1", entity_type="student", entity_id="S001",
        base_data={"first_name": "Alice"},
        custom_fields={"city": "Springfield"},
    )
    assert result["_version"] == 1
    assert result["_status"] == "active"
    assert result["base_data"]["first_name"] == "Alice"
    assert result["_custom_fields"]["city"] == "Springfield"


def test_entity_new_version_archives_previous(store):
    """New version archives the previous active record."""
    store.put_entity(
        tenant_id="t1", entity_type="student", entity_id="S001",
        base_data={"first_name": "Alice-v1"},
    )
    store.put_entity(
        tenant_id="t1", entity_type="student", entity_id="S001",
        base_data={"first_name": "Alice-v2"},
    )
    active = store.get_active_entity("t1", "student", "S001")
    assert active["_version"] == 2
    assert active["base_data"]["first_name"] == "Alice-v2"

    history = store.get_entity_history("t1", "student", "S001")
    assert history[0]["_status"] == "active"
    assert history[1]["_status"] == "archived"


def test_retrieve_active_entity_none_when_missing(store):
    """Returns None for nonexistent entity."""
    assert store.get_active_entity("t1", "student", "NOPE") is None
    assert store.get_active_entity("missing", "student", "S001") is None


def test_entity_history_ordered_descending(store):
    """History returns versions newest first."""
    for i in range(3):
        store.put_entity(
            tenant_id="t1", entity_type="student", entity_id="S001",
            base_data={"v": i + 1},
        )
    history = store.get_entity_history("t1", "student", "S001")
    versions = [h["_version"] for h in history]
    assert versions == [3, 2, 1]


def test_entity_history_empty_when_missing(store):
    """History returns empty list for nonexistent records."""
    assert store.get_entity_history("t1", "student", "NOPE") == []
    assert store.get_entity_history("missing", "student", "S001") == []


def test_entity_version_trimming_per_entity_type(store):
    """Student max=3 (from fixture). Oldest deleted by timestamp."""
    for i in range(6):
        store.put_entity(
            tenant_id="t1", entity_type="student", entity_id="S001",
            base_data={"v": i + 1},
        )
    history = store.get_entity_history("t1", "student", "S001")
    assert len(history) <= 3


def test_entity_version_trimming_different_limits(store):
    """Staff max=2 (from fixture), different from student max=3."""
    for i in range(5):
        store.put_entity(
            tenant_id="t1", entity_type="staff", entity_id="E001",
            base_data={"v": i + 1},
        )
    history = store.get_entity_history("t1", "staff", "E001")
    assert len(history) <= 2


def test_entity_versioning_independent_per_entity_id(store):
    """Each entity_id has independent version history."""
    store.put_entity(
        tenant_id="t1", entity_type="student", entity_id="S001",
        base_data={"name": "Alice"},
    )
    store.put_entity(
        tenant_id="t1", entity_type="student", entity_id="S002",
        base_data={"name": "Bob"},
    )
    assert store.get_active_entity("t1", "student", "S001")["_version"] == 1
    assert store.get_active_entity("t1", "student", "S002")["_version"] == 1

    store.put_entity(
        tenant_id="t1", entity_type="student", entity_id="S001",
        base_data={"name": "Alice-v2"},
    )
    assert store.get_active_entity("t1", "student", "S001")["_version"] == 2
    assert store.get_active_entity("t1", "student", "S002")["_version"] == 1


def test_entity_custom_fields_stored_as_toon(store):
    """Custom fields are TOON-encoded, not JSON."""
    store.put_entity(
        tenant_id="t1", entity_type="student", entity_id="S001",
        base_data={"name": "Alice"},
        custom_fields={"city": "Springfield", "bus_day": "tuesday"},
    )
    # Read raw from LanceDB to verify TOON encoding
    table = store._db.open_table(store._entities_table_name("t1"))
    rows = table.search().where("entity_id = 'S001'").to_list()
    raw = rows[0]["_custom_fields"]
    # TOON format uses "key: value" not {"key": "value"}
    assert "{" not in raw
    assert "city: Springfield" in raw


def test_entity_custom_fields_empty_dict_ok(store):
    """Entity with no custom fields works fine."""
    result = store.put_entity(
        tenant_id="t1", entity_type="student", entity_id="S001",
        base_data={"name": "Alice"},
    )
    assert result["_custom_fields"] == {}
    entity = store.get_active_entity("t1", "student", "S001")
    assert entity["_custom_fields"] == {}


def test_entity_key_conflict_raises_error(store):
    """Custom field keys must not overlap with base_data keys."""
    with pytest.raises(ValueError, match="conflict with base data keys"):
        store.put_entity(
            tenant_id="t1", entity_type="student", entity_id="S001",
            base_data={"first_name": "Alice", "city": "Test"},
            custom_fields={"city": "Conflict"},
        )


def test_entity_key_conflict_multiple_keys(store):
    """Multiple conflicting keys are all reported."""
    with pytest.raises(ValueError, match="conflict with base data keys"):
        store.put_entity(
            tenant_id="t1", entity_type="student", entity_id="S001",
            base_data={"a": "1", "b": "2", "c": "3"},
            custom_fields={"a": "x", "b": "y"},
        )


def test_entity_version_trimming_default_limit(tmp_dir):
    """Spec: default max entity versions is 5 when not configured per type."""
    from datacore import Store

    store = Store(data_dir=tmp_dir)  # uses default_max_entity_versions=5
    for i in range(8):
        store.put_entity(
            tenant_id="t1", entity_type="course", entity_id="C001",
            base_data={"v": i + 1},
        )
    history = store.get_entity_history("t1", "course", "C001")
    assert len(history) <= 5


def test_entity_tenant_isolation(store):
    """Tenant t1 entities are invisible to tenant t2."""
    store.put_entity(
        tenant_id="t1", entity_type="student", entity_id="S001",
        base_data={"name": "Alice"},
    )
    assert store.get_active_entity("t1", "student", "S001") is not None
    assert store.get_active_entity("t2", "student", "S001") is None


def test_delete_version(store):
    """Delete a specific version from entities table."""
    store.put_entity(
        tenant_id="t1", entity_type="student", entity_id="S001",
        base_data={"v": 1},
    )
    store.put_entity(
        tenant_id="t1", entity_type="student", entity_id="S001",
        base_data={"v": 2},
    )
    result = store.delete_version(
        tenant_id="t1", table_type="entities", version=1,
        entity_type="student", entity_id="S001",
    )
    assert result is True
    history = store.get_entity_history("t1", "student", "S001")
    assert len(history) == 1
    assert history[0]["_version"] == 2


def test_delete_version_nonexistent_returns_false(store):
    """Deleting a version that doesn't exist returns False."""
    assert store.delete_version(
        tenant_id="t1", table_type="entities", version=999,
        entity_type="student", entity_id="S001",
    ) is False


def test_delete_version_invalid_table_type(store):
    """Invalid table_type raises ValueError."""
    with pytest.raises(ValueError, match="table_type must be"):
        store.delete_version(
            tenant_id="t1", table_type="bad", version=1,
            entity_type="student",
        )
```

- [ ] **Step 2: Run tests to verify they pass**

Run: `pytest tests/test_store_entities.py -v`
Expected: all PASS

- [ ] **Step 3: Commit**

```bash
git add tests/test_store_entities.py
git commit -m "test: add unit tests for Store entity CRUD, versioning, and validation"
```

---

### Task 4: Rollback Tests

**Files:**
- Create: `tests/test_store_rollback.py`

Covers spec scenario: Grouped rollback via change_id.

- [ ] **Step 1: Write tests**

```python
"""Tests for rollback_by_change_id across models and entities."""


def test_rollback_models_by_change_id(store):
    """Rolling back a change_id reverts all model updates in that batch."""
    cid1 = "good-change"
    store.put_model(
        tenant_id="t1", entity_type="student",
        model_definition={"v": "good"}, change_id=cid1,
    )
    store.put_model(
        tenant_id="t1", entity_type="staff",
        model_definition={"v": "good"}, change_id=cid1,
    )

    cid2 = "bad-change"
    store.put_model(
        tenant_id="t1", entity_type="student",
        model_definition={"v": "bad"}, change_id=cid2,
    )
    store.put_model(
        tenant_id="t1", entity_type="staff",
        model_definition={"v": "bad"}, change_id=cid2,
    )

    summary = store.rollback_by_change_id("t1", cid2)
    assert len(summary["models"]) == 2

    student = store.get_active_model("t1", "student")
    staff = store.get_active_model("t1", "staff")
    assert student["_version"] == 1
    assert student["model_definition"]["v"] == "good"
    assert staff["_version"] == 1
    assert staff["model_definition"]["v"] == "good"


def test_rollback_entities_by_change_id(store):
    """Rolling back a change_id reverts entity updates in that batch."""
    store.put_entity(
        tenant_id="t1", entity_type="student", entity_id="S001",
        base_data={"name": "Alice-v1"},
    )

    cid = "bad-entity-change"
    store.put_entity(
        tenant_id="t1", entity_type="student", entity_id="S001",
        base_data={"name": "Alice-BAD"}, change_id=cid,
    )
    assert store.get_active_entity("t1", "student", "S001")["base_data"]["name"] == "Alice-BAD"

    summary = store.rollback_by_change_id("t1", cid)
    assert len(summary["entities"]) == 1
    entity = store.get_active_entity("t1", "student", "S001")
    assert entity["base_data"]["name"] == "Alice-v1"


def test_rollback_across_models_and_entities(store):
    """change_id rollback works across both table types simultaneously."""
    store.put_model(
        tenant_id="t1", entity_type="student",
        model_definition={"v": "good"},
    )
    store.put_entity(
        tenant_id="t1", entity_type="student", entity_id="S001",
        base_data={"name": "good"},
    )

    cid = "cross-table-bad"
    store.put_model(
        tenant_id="t1", entity_type="student",
        model_definition={"v": "bad"}, change_id=cid,
    )
    store.put_entity(
        tenant_id="t1", entity_type="student", entity_id="S001",
        base_data={"name": "bad"}, change_id=cid,
    )

    summary = store.rollback_by_change_id("t1", cid)
    assert len(summary["models"]) == 1
    assert len(summary["entities"]) == 1
    assert store.get_active_model("t1", "student")["model_definition"]["v"] == "good"
    assert store.get_active_entity("t1", "student", "S001")["base_data"]["name"] == "good"


def test_rollback_nonexistent_change_id(store):
    """Rolling back a change_id that doesn't exist returns empty summary."""
    summary = store.rollback_by_change_id("t1", "doesnt-exist")
    assert summary == {"models": [], "entities": []}


def test_rollback_tenant_isolation(store):
    """Rollback only affects the specified tenant."""
    cid = "shared-cid"
    store.put_model(
        tenant_id="t1", entity_type="student",
        model_definition={"t": "t1-good"},
    )
    store.put_model(
        tenant_id="t1", entity_type="student",
        model_definition={"t": "t1-bad"}, change_id=cid,
    )
    store.put_model(
        tenant_id="t2", entity_type="student",
        model_definition={"t": "t2-only"},
    )

    store.rollback_by_change_id("t1", cid)
    assert store.get_active_model("t1", "student")["model_definition"]["t"] == "t1-good"
    assert store.get_active_model("t2", "student")["model_definition"]["t"] == "t2-only"
```

- [ ] **Step 2: Run tests to verify they pass**

Run: `pytest tests/test_store_rollback.py -v`
Expected: all PASS

- [ ] **Step 3: Commit**

```bash
git add tests/test_store_rollback.py
git commit -m "test: add unit tests for rollback_by_change_id"
```

---

### Task 5: Basic SQL Query Tests

**Files:**
- Create: `tests/test_query_basic.py`

Covers spec scenarios: Query a table with SQL, Query with tenant filter, Query non-existent table.

- [ ] **Step 1: Write tests**

```python
"""Tests for basic QueryEngine SQL queries and tenant scoping."""
import pytest
from datacore.query import TableNotFoundError


def test_query_basic_select(seeded_engine):
    """Spec: Query a table with SQL — results as list of dicts."""
    result = seeded_engine.query(
        tenant_id="t1", table_type="entities",
        sql="SELECT entity_id FROM data WHERE _status = 'active'",
    )
    assert isinstance(result, dict)
    assert "rows" in result
    assert "total" in result
    assert result["total"] == 3
    ids = {r["entity_id"] for r in result["rows"]}
    assert ids == {"S001", "S002", "S003"}


def test_query_tenant_scoping(seeded_store):
    """Spec: Query with tenant filter — only that tenant's data."""
    from datacore import QueryEngine

    # Seed tenant t2 with different data
    seeded_store.put_entity(
        tenant_id="t2", entity_type="student", entity_id="T2-001",
        base_data={"first_name": "Zara"},
    )
    engine = QueryEngine(seeded_store)

    t1_result = engine.query(
        tenant_id="t1", table_type="entities",
        sql="SELECT entity_id FROM data WHERE _status = 'active'",
    )
    t2_result = engine.query(
        tenant_id="t2", table_type="entities",
        sql="SELECT entity_id FROM data WHERE _status = 'active'",
    )
    assert t1_result["total"] == 3
    assert t2_result["total"] == 1
    assert t2_result["rows"][0]["entity_id"] == "T2-001"


def test_query_nonexistent_table_raises(seeded_engine):
    """Spec: Query non-existent table — TableNotFoundError."""
    with pytest.raises(TableNotFoundError):
        seeded_engine.query(
            tenant_id="no-tenant", table_type="entities",
            sql="SELECT * FROM data",
        )


def test_query_models_table(seeded_engine):
    """Can query the models table too."""
    result = seeded_engine.query(
        tenant_id="t1", table_type="models",
        sql="SELECT entity_type FROM data WHERE _status = 'active'",
    )
    assert result["total"] == 2
    types = {r["entity_type"] for r in result["rows"]}
    assert types == {"student", "staff"}


def test_query_invalid_table_type(seeded_engine):
    """Invalid table_type raises ValueError."""
    with pytest.raises(ValueError, match="table_type must be"):
        seeded_engine.query(
            tenant_id="t1", table_type="bad",
            sql="SELECT * FROM data",
        )
```

- [ ] **Step 2: Run tests to verify they pass**

Run: `pytest tests/test_query_basic.py -v`
Expected: all PASS

- [ ] **Step 3: Commit**

```bash
git add tests/test_query_basic.py
git commit -m "test: add unit tests for basic SQL queries and tenant scoping"
```

---

### Task 6: Custom Field Query Tests

**Files:**
- Create: `tests/test_query_custom_fields.py`

Covers spec scenario: Query custom fields with tenant filter.

- [ ] **Step 1: Write tests**

```python
"""Tests for querying TOON custom fields as flattened columns."""


def test_query_filter_on_custom_field(seeded_engine):
    """Spec: Custom fields queryable as regular columns."""
    result = seeded_engine.query(
        tenant_id="t1", table_type="entities",
        sql="SELECT entity_id, city FROM data WHERE city = 'Springfield' AND _status = 'active'",
    )
    assert result["total"] == 2
    ids = {r["entity_id"] for r in result["rows"]}
    assert ids == {"S001", "S003"}


def test_query_filter_on_different_custom_field(seeded_engine):
    """Can filter on any custom field."""
    result = seeded_engine.query(
        tenant_id="t1", table_type="entities",
        sql="SELECT entity_id, bus_day FROM data WHERE bus_day = 'monday' AND _status = 'active'",
    )
    assert result["total"] == 1
    assert result["rows"][0]["entity_id"] == "S002"


def test_query_base_and_custom_fields_together(seeded_engine):
    """Can select and filter on both base_data and custom fields."""
    result = seeded_engine.query(
        tenant_id="t1", table_type="entities",
        sql="SELECT first_name, city FROM data WHERE grade = '5' AND city = 'Springfield' AND _status = 'active'",
    )
    assert result["total"] == 2
    names = {r["first_name"] for r in result["rows"]}
    assert names == {"Alice", "Charlie"}


def test_query_entity_detail_by_id(seeded_engine):
    """Spec: Query entity detail by ID — full record returned."""
    result = seeded_engine.query(
        tenant_id="t1", table_type="entities",
        sql="SELECT entity_id, first_name, last_name, grade, city, bus_day FROM data WHERE entity_id = 'S001' AND _status = 'active'",
    )
    assert result["total"] == 1
    row = result["rows"][0]
    assert row["first_name"] == "Alice"
    assert row["last_name"] == "Smith"
    assert row["city"] == "Springfield"
    assert row["bus_day"] == "tuesday"


def test_query_entity_detail_not_found(seeded_engine):
    """Spec: Empty result for nonexistent entity_id."""
    result = seeded_engine.query(
        tenant_id="t1", table_type="entities",
        sql="SELECT * FROM data WHERE entity_id = 'NOPE' AND _status = 'active'",
    )
    assert result["total"] == 0
    assert result["rows"] == []
```

- [ ] **Step 2: Run tests to verify they pass**

Run: `pytest tests/test_query_custom_fields.py -v`
Expected: all PASS

- [ ] **Step 3: Commit**

```bash
git add tests/test_query_custom_fields.py
git commit -m "test: add unit tests for TOON custom field querying"
```

---

### Task 7: Aggregation Query Tests

**Files:**
- Create: `tests/test_query_aggregation.py`

Covers spec scenario: Aggregate queries with tenant filter.

- [ ] **Step 1: Write tests**

```python
"""Tests for aggregate SQL queries (COUNT, SUM, GROUP BY)."""


def test_count_all_active(seeded_engine):
    """COUNT(*) across all active entities."""
    result = seeded_engine.query(
        tenant_id="t1", table_type="entities",
        sql="SELECT COUNT(*) AS total_students FROM data WHERE entity_type = 'student' AND _status = 'active'",
    )
    assert result["rows"][0]["total_students"] == 3


def test_count_with_custom_field_filter(seeded_engine):
    """COUNT with filter on custom field."""
    result = seeded_engine.query(
        tenant_id="t1", table_type="entities",
        sql="SELECT COUNT(*) AS count FROM data WHERE bus_day = 'tuesday' AND _status = 'active'",
    )
    assert result["rows"][0]["count"] == 2


def test_group_by_custom_field(seeded_engine):
    """GROUP BY on a custom field with COUNT."""
    result = seeded_engine.query(
        tenant_id="t1", table_type="entities",
        sql="SELECT bus_day, COUNT(*) AS count FROM data WHERE _status = 'active' GROUP BY bus_day ORDER BY bus_day",
    )
    assert result["total"] == 2  # 2 groups
    groups = {r["bus_day"]: r["count"] for r in result["rows"]}
    assert groups["tuesday"] == 2
    assert groups["monday"] == 1


def test_group_by_base_field(seeded_engine):
    """GROUP BY on a base_data field."""
    result = seeded_engine.query(
        tenant_id="t1", table_type="entities",
        sql="SELECT grade, COUNT(*) AS count FROM data WHERE _status = 'active' GROUP BY grade ORDER BY grade",
    )
    grades = {r["grade"]: r["count"] for r in result["rows"]}
    assert grades["5"] == 2  # Alice and Charlie
    assert grades["3"] == 1  # Bob


def test_count_with_city_filter(seeded_engine):
    """Real-world: how many students in Springfield?"""
    result = seeded_engine.query(
        tenant_id="t1", table_type="entities",
        sql="SELECT COUNT(*) AS count FROM data WHERE city = 'Springfield' AND _status = 'active'",
    )
    assert result["rows"][0]["count"] == 2
```

- [ ] **Step 2: Run tests to verify they pass**

Run: `pytest tests/test_query_aggregation.py -v`
Expected: all PASS

- [ ] **Step 3: Commit**

```bash
git add tests/test_query_aggregation.py
git commit -m "test: add unit tests for aggregate SQL queries"
```

---

### Task 8: Pagination Query Tests

**Files:**
- Create: `tests/test_query_pagination.py`

Covers spec scenario: Query with pagination (LIMIT/OFFSET).

- [ ] **Step 1: Write tests**

```python
"""Tests for pagination (limit/offset) with total count."""


def test_pagination_first_page(seeded_engine):
    """First page returns limited rows but full total."""
    result = seeded_engine.query(
        tenant_id="t1", table_type="entities",
        sql="SELECT entity_id FROM data WHERE _status = 'active' ORDER BY entity_id",
        limit=2, offset=0,
    )
    assert result["total"] == 3
    assert len(result["rows"]) == 2
    assert result["rows"][0]["entity_id"] == "S001"
    assert result["rows"][1]["entity_id"] == "S002"


def test_pagination_second_page(seeded_engine):
    """Second page returns remaining rows."""
    result = seeded_engine.query(
        tenant_id="t1", table_type="entities",
        sql="SELECT entity_id FROM data WHERE _status = 'active' ORDER BY entity_id",
        limit=2, offset=2,
    )
    assert result["total"] == 3
    assert len(result["rows"]) == 1
    assert result["rows"][0]["entity_id"] == "S003"


def test_pagination_beyond_results(seeded_engine):
    """Offset beyond total returns empty rows but correct total."""
    result = seeded_engine.query(
        tenant_id="t1", table_type="entities",
        sql="SELECT entity_id FROM data WHERE _status = 'active' ORDER BY entity_id",
        limit=10, offset=100,
    )
    assert result["total"] == 3
    assert result["rows"] == []


def test_pagination_limit_only(seeded_engine):
    """Limit without offset starts from beginning."""
    result = seeded_engine.query(
        tenant_id="t1", table_type="entities",
        sql="SELECT entity_id FROM data WHERE _status = 'active' ORDER BY entity_id",
        limit=1,
    )
    assert result["total"] == 3
    assert len(result["rows"]) == 1
    assert result["rows"][0]["entity_id"] == "S001"


def test_no_pagination_returns_all(seeded_engine):
    """No limit/offset returns all rows."""
    result = seeded_engine.query(
        tenant_id="t1", table_type="entities",
        sql="SELECT entity_id FROM data WHERE _status = 'active' ORDER BY entity_id",
    )
    assert result["total"] == 3
    assert len(result["rows"]) == 3


def test_pagination_with_filter(seeded_engine):
    """Pagination works correctly with WHERE filters."""
    result = seeded_engine.query(
        tenant_id="t1", table_type="entities",
        sql="SELECT entity_id FROM data WHERE city = 'Springfield' AND _status = 'active' ORDER BY entity_id",
        limit=1, offset=0,
    )
    assert result["total"] == 2  # 2 in Springfield total
    assert len(result["rows"]) == 1  # but only 1 returned
```

- [ ] **Step 2: Run tests to verify they pass**

Run: `pytest tests/test_query_pagination.py -v`
Expected: all PASS

- [ ] **Step 3: Commit**

```bash
git add tests/test_query_pagination.py
git commit -m "test: add unit tests for pagination with total count"
```

---

### Task 9: Final Verification

**Files:**
- None (verification only)

- [ ] **Step 1: Run full test suite**

Run: `pytest tests/ -v -W error::DeprecationWarning`
Expected: all PASS, zero deprecation warnings

- [ ] **Step 2: Verify coverage of all spec scenarios**

Cross-reference:

| Spec Scenario | Test File | Status |
|---|---|---|
| Create a new table for a tenant | test_store_models.py | Covered |
| Store a new version of a record | test_store_models.py, test_store_entities.py | Covered |
| Retrieve active record | test_store_models.py, test_store_entities.py | Covered |
| List version history | test_store_models.py, test_store_entities.py | Covered |
| Model version trimming | test_store_models.py | Covered |
| Entity version trimming | test_store_entities.py | Covered |
| Grouped rollback via change_id | test_store_rollback.py | Covered |
| Query a table with SQL | test_query_basic.py | Covered |
| Query with tenant filter | test_query_basic.py | Covered |
| Query non-existent table | test_query_basic.py | Covered |
| Query custom fields with tenant filter | test_query_custom_fields.py | Covered |
| Aggregate queries with tenant filter | test_query_aggregation.py | Covered |
| Query entity detail by ID | test_query_custom_fields.py | Covered |
| Query with pagination | test_query_pagination.py | Covered |

- [ ] **Step 3: Commit all if any fixups were needed**

```bash
git add -A && git commit -m "test: complete spec-scenario test coverage for datacore"
```
