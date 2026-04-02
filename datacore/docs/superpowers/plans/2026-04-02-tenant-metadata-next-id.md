# Tenant Metadata & Student Next-ID Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add tenant metadata storage (as entity), a sequences table for ID counters, and a `GET /api/entities/{tenant}/student/next-id` endpoint to datacore.

**Architecture:** Tenant is stored as a regular entity (`entity_type="tenant"`) in the existing entities table — no new schema. A lightweight `{tenant_id}_sequences` table (no versioning) tracks ID counters per entity_type and year. The `next-id` endpoint reads the tenant's `_abbrev` from base_data and increments the sequence counter to produce IDs like `ACC-ST260001`. Tenant setup is enforced as a prerequisite for `put_model()` and `put_entity()`.

**Tech Stack:** Python, FastAPI, LanceDB, PyArrow, pytest

**Spec:** `docs/superpowers/specs/2026-04-01-tenant-metadata-next-id-design.md`

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `src/datacore/store.py` | Modify | Add `SEQUENCES_SCHEMA`, `derive_abbrev()`, sequence methods, tenant prerequisite check |
| `src/datacore/api/routes.py` | Modify | Add tenant PUT/GET endpoints, next-id endpoint, prerequisite error handling |
| `tests/test_abbrev.py` | Create | Tests for `derive_abbrev()` helper |
| `tests/test_sequences.py` | Create | Tests for `get_sequence()`, `increment_sequence()` |
| `tests/test_tenant_prerequisite.py` | Create | Tests for prerequisite enforcement in `put_model`/`put_entity` |
| `tests/test_tenant_api.py` | Create | Tests for tenant PUT/GET API endpoints |
| `tests/test_next_id.py` | Create | Tests for next-id API endpoint |
| `tests/conftest.py` | Modify | Add `put_tenant` helper, update `seeded_store` fixture |
| `tests/test_smoke.py` | Modify | Add tenant setup before model/entity calls |
| `tests/test_store_models.py` | Modify | Add tenant setup to `store` fixture usage |
| `tests/test_store_entities.py` | Modify | Add tenant setup to `store` fixture usage |
| `tests/test_store_list_models.py` | Modify | Add tenant setup to `store` fixture usage |
| `tests/test_store_rollback.py` | Modify | Add tenant setup to `store` fixture usage |
| `tests/test_api.py` | Modify | Add tenant setup to `app_client` fixture |

---

### Task 1: Abbreviation Derivation Helper

**Files:**
- Modify: `src/datacore/store.py` (add function after imports, before class)
- Create: `tests/test_abbrev.py`

- [ ] **Step 1: Write the failing tests**

Create `tests/test_abbrev.py`:

```python
"""Tests for tenant abbreviation derivation."""

from datacore.store import derive_abbrev


def test_one_word_name():
    assert derive_abbrev("Summit", "t1") == "SUM"


def test_one_word_short_name():
    assert derive_abbrev("Go", "t1") == "GO"


def test_two_word_name():
    assert derive_abbrev("Green Valley", "t1") == "GVA"


def test_three_word_name():
    assert derive_abbrev("Acme Child Center", "t1") == "ACC"


def test_four_word_name():
    assert derive_abbrev("New York Day School", "t1") == "NYD"


def test_no_name_long_tenant_id():
    assert derive_abbrev(None, "acme") == "ACM"


def test_no_name_short_tenant_id():
    assert derive_abbrev(None, "t1") == "T1"


def test_empty_string_name():
    assert derive_abbrev("", "myorg") == "MYO"


def test_case_insensitive():
    assert derive_abbrev("green valley", "t1") == "GVA"
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /Users/kennylee/Development/NeoApex/datacore && python -m pytest tests/test_abbrev.py -v`

Expected: FAIL — `ImportError: cannot import name 'derive_abbrev' from 'datacore.store'`

- [ ] **Step 3: Implement `derive_abbrev`**

Add to `src/datacore/store.py` after the existing imports (before `DEFAULT_DATA_DIR`):

```python
def derive_abbrev(name: str | None, tenant_id: str) -> str:
    """Derive an uppercase abbreviation from a tenant name.

    Rules:
    - 1 word:  first 3 chars (or fewer if short)
    - 2 words: 1st char of word 1 + first 2 chars of word 2
    - 3+ words: 1st char of first 3 words
    - No name / empty: first 3 chars of tenant_id (or full ID if < 3)
    """
    if not name or not name.strip():
        return tenant_id[:3].upper() if len(tenant_id) >= 3 else tenant_id.upper()
    words = name.split()
    if len(words) == 1:
        return words[0][:3].upper()
    elif len(words) == 2:
        return (words[0][0] + words[1][:2]).upper()
    else:
        return (words[0][0] + words[1][0] + words[2][0]).upper()
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /Users/kennylee/Development/NeoApex/datacore && python -m pytest tests/test_abbrev.py -v`

Expected: All 9 tests PASS

- [ ] **Step 5: Commit**

```bash
cd /Users/kennylee/Development/NeoApex/datacore
git add src/datacore/store.py tests/test_abbrev.py
git commit -m "feat: add derive_abbrev helper for tenant abbreviation"
```

---

### Task 2: Sequences Table Store Methods

**Files:**
- Modify: `src/datacore/store.py` (add schema, table name helper, two methods)
- Create: `tests/test_sequences.py`

- [ ] **Step 1: Write the failing tests**

Create `tests/test_sequences.py`:

```python
"""Tests for sequences table: get_sequence, increment_sequence."""


def test_get_sequence_no_table(store):
    """Returns 0 when no sequences table exists."""
    result = store.get_sequence("t1", "student", "2026")
    assert result == 0


def test_get_sequence_no_matching_row(store):
    """Returns 0 when table exists but no matching row."""
    store.increment_sequence("t1", "student", "2026")
    result = store.get_sequence("t1", "student", "2027")
    assert result == 0


def test_increment_sequence_first_call(store):
    """First increment returns 1."""
    result = store.increment_sequence("t1", "student", "2026")
    assert result == 1


def test_increment_sequence_subsequent(store):
    """Each call increments by 1."""
    store.increment_sequence("t1", "student", "2026")
    store.increment_sequence("t1", "student", "2026")
    result = store.increment_sequence("t1", "student", "2026")
    assert result == 3


def test_get_sequence_after_increments(store):
    """get_sequence reflects the current counter."""
    store.increment_sequence("t1", "student", "2026")
    store.increment_sequence("t1", "student", "2026")
    result = store.get_sequence("t1", "student", "2026")
    assert result == 2


def test_sequences_independent_per_year(store):
    """Different years have independent counters."""
    store.increment_sequence("t1", "student", "2026")
    store.increment_sequence("t1", "student", "2026")
    store.increment_sequence("t1", "student", "2027")

    assert store.get_sequence("t1", "student", "2026") == 2
    assert store.get_sequence("t1", "student", "2027") == 1


def test_sequences_independent_per_entity_type(store):
    """Different entity types have independent counters."""
    store.increment_sequence("t1", "student", "2026")
    store.increment_sequence("t1", "student", "2026")
    store.increment_sequence("t1", "staff", "2026")

    assert store.get_sequence("t1", "student", "2026") == 2
    assert store.get_sequence("t1", "staff", "2026") == 1


def test_sequences_tenant_isolation(store):
    """Different tenants have independent counters."""
    store.increment_sequence("t1", "student", "2026")
    store.increment_sequence("t1", "student", "2026")

    assert store.get_sequence("t1", "student", "2026") == 2
    assert store.get_sequence("t2", "student", "2026") == 0
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /Users/kennylee/Development/NeoApex/datacore && python -m pytest tests/test_sequences.py -v`

Expected: FAIL — `AttributeError: 'Store' object has no attribute 'get_sequence'`

- [ ] **Step 3: Implement sequences table methods**

Add `SEQUENCES_SCHEMA` after `ENTITIES_SCHEMA` in `src/datacore/store.py`:

```python
SEQUENCES_SCHEMA = pa.schema([
    pa.field("entity_type", pa.string()),
    pa.field("year", pa.string()),
    pa.field("counter", pa.int64()),
])
```

Add `_sequences_table_name` helper to the `Store` class (after `_entities_table_name`):

```python
    def _sequences_table_name(self, tenant_id: str) -> str:
        return f"{tenant_id}_sequences"
```

Add `get_sequence` and `increment_sequence` methods to the `Store` class (after `_trim_entity_versions`, before the table-access section):

```python
    # ── sequences (lightweight counters) ───────────────────────────

    def get_sequence(self, tenant_id: str, entity_type: str, year: str) -> int:
        """Get the current sequence counter, or 0 if not set."""
        table_name = self._sequences_table_name(tenant_id)
        if table_name not in self._table_names():
            return 0
        table = self._db.open_table(table_name)
        rows = (
            table.search()
            .where(f"entity_type = '{entity_type}' AND year = '{year}'")
            .to_list()
        )
        if not rows:
            return 0
        return rows[0]["counter"]

    def increment_sequence(
        self, tenant_id: str, entity_type: str, year: str
    ) -> int:
        """Increment and return the sequence counter for entity_type + year."""
        table_name = self._sequences_table_name(tenant_id)
        table = self._open_or_create(table_name, SEQUENCES_SCHEMA)
        where = f"entity_type = '{entity_type}' AND year = '{year}'"
        rows = table.search().where(where).to_list()
        current = rows[0]["counter"] if rows else 0
        new_counter = current + 1
        if rows:
            table.delete(where)
        table.add([{
            "entity_type": entity_type,
            "year": year,
            "counter": new_counter,
        }])
        return new_counter
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /Users/kennylee/Development/NeoApex/datacore && python -m pytest tests/test_sequences.py -v`

Expected: All 9 tests PASS

- [ ] **Step 5: Commit**

```bash
cd /Users/kennylee/Development/NeoApex/datacore
git add src/datacore/store.py tests/test_sequences.py
git commit -m "feat: add sequences table for lightweight ID counters"
```

---

### Task 3: Tenant Prerequisite Enforcement in Store

**Files:**
- Modify: `src/datacore/store.py:110-112` (add check to `put_model`), `src/datacore/store.py:247-250` (add check to `put_entity`)
- Create: `tests/test_tenant_prerequisite.py`
- Modify: `tests/conftest.py` (add tenant helper fixture)

- [ ] **Step 1: Write the failing tests**

Create `tests/test_tenant_prerequisite.py`:

```python
"""Tests for tenant prerequisite enforcement."""

import pytest


def test_put_model_without_tenant_raises(store):
    """put_model raises ValueError when no tenant entity exists."""
    with pytest.raises(ValueError, match="Tenant not set up"):
        store.put_model(
            tenant_id="t1",
            entity_type="student",
            model_definition={"base_fields": [], "custom_fields": []},
        )


def test_put_entity_without_tenant_raises(store):
    """put_entity raises ValueError when no tenant entity exists."""
    with pytest.raises(ValueError, match="Tenant not set up"):
        store.put_entity(
            tenant_id="t1",
            entity_type="student",
            entity_id="S001",
            base_data={"first_name": "Alice", "last_name": "Smith"},
        )


def test_put_tenant_entity_skips_check(store):
    """put_entity with entity_type='tenant' does not require tenant to exist."""
    result = store.put_entity(
        tenant_id="t1",
        entity_type="tenant",
        entity_id="t1",
        base_data={"tenant_id": "t1", "name": "Test School", "_abbrev": "TES"},
    )
    assert result["entity_type"] == "tenant"
    assert result["_version"] == 1


def test_put_model_after_tenant_setup_succeeds(store):
    """put_model succeeds when tenant entity exists."""
    store.put_entity(
        tenant_id="t1",
        entity_type="tenant",
        entity_id="t1",
        base_data={"tenant_id": "t1", "name": "Test School", "_abbrev": "TES"},
    )
    result = store.put_model(
        tenant_id="t1",
        entity_type="student",
        model_definition={"base_fields": [], "custom_fields": []},
    )
    assert result["_version"] == 1


def test_put_entity_after_tenant_setup_succeeds(store):
    """put_entity succeeds when tenant entity exists."""
    store.put_entity(
        tenant_id="t1",
        entity_type="tenant",
        entity_id="t1",
        base_data={"tenant_id": "t1", "name": "Test School", "_abbrev": "TES"},
    )
    result = store.put_entity(
        tenant_id="t1",
        entity_type="student",
        entity_id="S001",
        base_data={"first_name": "Alice", "last_name": "Smith"},
    )
    assert result["_version"] == 1
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /Users/kennylee/Development/NeoApex/datacore && python -m pytest tests/test_tenant_prerequisite.py -v`

Expected: `test_put_model_without_tenant_raises` and `test_put_entity_without_tenant_raises` FAIL (no ValueError raised). The other 3 tests should pass.

- [ ] **Step 3: Add prerequisite check to store**

Add `_check_tenant_exists` to the `Store` class in `src/datacore/store.py` (in the helpers section, after `_max_versions_for_entity_type`):

```python
    def _check_tenant_exists(self, tenant_id: str) -> None:
        """Raise ValueError if tenant entity has not been set up."""
        tenant = self.get_active_entity(tenant_id, "tenant", tenant_id)
        if tenant is None:
            raise ValueError("Tenant not set up")
```

Add the check as the first line of `put_model` (at the start of the method body, before `table_name = ...`):

```python
        self._check_tenant_exists(tenant_id)
```

Add the check to `put_entity` (at the start, after the key-conflict validation block, before `table_name = ...`):

```python
        if entity_type != "tenant":
            self._check_tenant_exists(tenant_id)
```

- [ ] **Step 4: Run prerequisite tests to verify they pass**

Run: `cd /Users/kennylee/Development/NeoApex/datacore && python -m pytest tests/test_tenant_prerequisite.py -v`

Expected: All 5 tests PASS

- [ ] **Step 5: Verify existing tests now fail (expected)**

Run: `cd /Users/kennylee/Development/NeoApex/datacore && python -m pytest tests/test_store_models.py tests/test_store_entities.py -v --tb=line 2>&1 | tail -20`

Expected: Multiple failures with `ValueError: Tenant not set up`

- [ ] **Step 6: Commit prerequisite enforcement**

```bash
cd /Users/kennylee/Development/NeoApex/datacore
git add src/datacore/store.py tests/test_tenant_prerequisite.py
git commit -m "feat: enforce tenant entity as prerequisite for put_model/put_entity"
```

---

### Task 4: Update Existing Test Fixtures

**Files:**
- Modify: `tests/conftest.py:22-31` (update `store` fixture), `tests/conftest.py:38-82` (update `seeded_store`)
- Modify: `tests/test_smoke.py:10-21` (add tenant setup)
- Modify: `tests/test_api.py:12-21` (add tenant setup to `app_client`)
- Modify: `tests/test_store_models.py` (add tenant setup before every `store.put_model` call)
- Modify: `tests/test_store_entities.py` (add tenant setup before every `store.put_entity` call)
- Modify: `tests/test_store_list_models.py` (add tenant setup)
- Modify: `tests/test_store_rollback.py` (add tenant setup)

- [ ] **Step 1: Add `setup_tenant` helper to conftest.py**

Add a new fixture after the `store` fixture in `tests/conftest.py`:

```python
def _setup_tenant(store, tenant_id="t1"):
    """Create a tenant entity for the given tenant_id."""
    store.put_entity(
        tenant_id=tenant_id,
        entity_type="tenant",
        entity_id=tenant_id,
        base_data={
            "tenant_id": tenant_id,
            "name": "Test School",
            "_abbrev": "TES",
        },
    )
```

Update the `seeded_store` fixture to call `_setup_tenant` before any `put_model` or `put_entity` calls:

```python
@pytest.fixture
def seeded_store(store):
    """Store with pre-loaded model definitions and entity records."""
    _setup_tenant(store, "t1")
    cid = "seed-change"
    store.put_model(
        ...  # rest unchanged
```

- [ ] **Step 2: Update test_smoke.py**

In `test_full_workflow()`, add tenant setup after the `engine = QueryEngine(store)` line (before `# ── 1. Store model definitions ──`):

```python
        # ── 0. Set up tenant ──
        store.put_entity(
            tenant_id="t1",
            entity_type="tenant",
            entity_id="t1",
            base_data={"tenant_id": "t1", "name": "Test School", "_abbrev": "TES"},
        )
```

- [ ] **Step 3: Update test_api.py**

In the `app_client` fixture, add tenant setup after `store = Store(...)` and before `app = create_app(store)`:

```python
        store.put_entity(
            tenant_id="t1",
            entity_type="tenant",
            entity_id="t1",
            base_data={"tenant_id": "t1", "name": "Test School", "_abbrev": "TES"},
        )
```

- [ ] **Step 4: Update test_store_models.py**

Every test function that calls `store.put_model("t1", ...)` needs tenant setup. Add a module-level autouse fixture at the top of the file (after the model def constants):

```python
@pytest.fixture(autouse=True)
def setup_tenant(store):
    """Ensure tenant exists before each test."""
    store.put_entity(
        tenant_id="t1",
        entity_type="tenant",
        entity_id="t1",
        base_data={"tenant_id": "t1", "name": "Test School", "_abbrev": "TES"},
    )
```

For `test_model_tenant_isolation`, which also uses `"t2"`, add tenant setup for `"t2"` inside the test body before the `store.get_active_model(tenant_id="t2", ...)` call. Note: `get_active_model` is a read — it does not require tenant setup. So no changes needed for t2 reads. Only `put_model("t2", ...)` would need it. Check if any test calls `put_model("t2", ...)` — in `test_model_tenant_isolation`, there is no `put_model("t2", ...)`, so no change needed for that test.

- [ ] **Step 5: Update test_store_entities.py**

Add the same autouse fixture at the top of the file (after the imports):

```python
import pytest


@pytest.fixture(autouse=True)
def setup_tenant(store):
    """Ensure tenant exists before each test."""
    store.put_entity(
        tenant_id="t1",
        entity_type="tenant",
        entity_id="t1",
        base_data={"tenant_id": "t1", "name": "Test School", "_abbrev": "TES"},
    )
```

For `test_entity_version_trimming_default_limit` which creates its own `Store` instance with `tmp_dir`, add tenant setup inside the test body after `s = Store(...)`:

```python
    s.put_entity(
        tenant_id="t1",
        entity_type="tenant",
        entity_id="t1",
        base_data={"tenant_id": "t1", "name": "Test School", "_abbrev": "TES"},
    )
```

- [ ] **Step 6: Update test_store_list_models.py**

Add autouse fixture after imports:

```python
import pytest


@pytest.fixture(autouse=True)
def setup_tenant(store):
    """Ensure tenant exists before each test."""
    store.put_entity(
        tenant_id="t1",
        entity_type="tenant",
        entity_id="t1",
        base_data={"tenant_id": "t1", "name": "Test School", "_abbrev": "TES"},
    )
```

- [ ] **Step 7: Update test_store_rollback.py**

Add autouse fixture after imports:

```python
import pytest


@pytest.fixture(autouse=True)
def setup_tenant(store):
    """Ensure tenant exists before each test."""
    store.put_entity(
        tenant_id="t1",
        entity_type="tenant",
        entity_id="t1",
        base_data={"tenant_id": "t1", "name": "Test School", "_abbrev": "TES"},
    )
```

For `test_rollback_tenant_isolation`, which calls `store.put_model(tenant_id="t2", ...)`, add inside the test body before that call:

```python
    store.put_entity(
        tenant_id="t2",
        entity_type="tenant",
        entity_id="t2",
        base_data={"tenant_id": "t2", "name": "Tenant Two", "_abbrev": "TEN"},
    )
```

- [ ] **Step 8: Run the full test suite**

Run: `cd /Users/kennylee/Development/NeoApex/datacore && python -m pytest -v`

Expected: All existing tests PASS, plus the new `test_abbrev.py`, `test_sequences.py`, and `test_tenant_prerequisite.py` tests PASS.

- [ ] **Step 9: Commit**

```bash
cd /Users/kennylee/Development/NeoApex/datacore
git add tests/
git commit -m "fix: update all test fixtures with tenant entity prerequisite"
```

---

### Task 5: Tenant API Endpoints (PUT and GET)

**Files:**
- Modify: `src/datacore/api/routes.py:1-6` (add imports), `src/datacore/api/routes.py:17-18` (add request model), `src/datacore/api/routes.py:18-40` (add routes before existing routes)
- Create: `tests/test_tenant_api.py`

- [ ] **Step 1: Write the failing tests**

Create `tests/test_tenant_api.py`:

```python
"""Tests for tenant API endpoints."""

import tempfile

import pytest
from fastapi.testclient import TestClient
from unittest.mock import MagicMock

from datacore import Store
from datacore.api import create_app


@pytest.fixture
def tenant_client():
    with tempfile.TemporaryDirectory() as tmp:
        mock_embedder = MagicMock()
        mock_embedder.embed.return_value = [0.0] * 1024
        store = Store(data_dir=tmp, embedder=mock_embedder)
        app = create_app(store)
        yield TestClient(app), store


def test_put_tenant_creates_entity(tenant_client):
    client, store = tenant_client
    resp = client.put(
        "/api/tenants/t1",
        json={
            "base_data": {
                "tenant_id": "t1",
                "name": "Acme Child Center",
                "primary_address": "123 Main St",
            },
        },
    )
    assert resp.status_code == 201
    data = resp.json()
    assert data["entity_type"] == "tenant"
    assert data["entity_id"] == "t1"
    assert data["base_data"]["name"] == "Acme Child Center"
    assert data["base_data"]["_abbrev"] == "ACC"
    assert data["_version"] == 1


def test_put_tenant_derives_abbrev_two_words(tenant_client):
    client, _ = tenant_client
    resp = client.put(
        "/api/tenants/t1",
        json={"base_data": {"tenant_id": "t1", "name": "Green Valley"}},
    )
    assert resp.status_code == 201
    assert resp.json()["base_data"]["_abbrev"] == "GVA"


def test_put_tenant_derives_abbrev_three_words(tenant_client):
    client, _ = tenant_client
    resp = client.put(
        "/api/tenants/t1",
        json={"base_data": {"tenant_id": "t1", "name": "Acme Child Center"}},
    )
    assert resp.status_code == 201
    assert resp.json()["base_data"]["_abbrev"] == "ACC"


def test_put_tenant_derives_abbrev_fallback_to_id(tenant_client):
    client, _ = tenant_client
    resp = client.put(
        "/api/tenants/myorg",
        json={"base_data": {"tenant_id": "myorg"}},
    )
    assert resp.status_code == 201
    assert resp.json()["base_data"]["_abbrev"] == "MYO"


def test_put_tenant_update_returns_200(tenant_client):
    client, _ = tenant_client
    client.put(
        "/api/tenants/t1",
        json={"base_data": {"tenant_id": "t1", "name": "Old Name"}},
    )
    resp = client.put(
        "/api/tenants/t1",
        json={"base_data": {"tenant_id": "t1", "name": "New Name"}},
    )
    assert resp.status_code == 200
    assert resp.json()["_version"] == 2


def test_put_tenant_with_custom_fields(tenant_client):
    client, _ = tenant_client
    resp = client.put(
        "/api/tenants/t1",
        json={
            "base_data": {"tenant_id": "t1", "name": "Test School"},
            "custom_fields": {"state_rating": "5-star"},
        },
    )
    assert resp.status_code == 201
    assert resp.json()["custom_fields"]["state_rating"] == "5-star"


def test_get_tenant_returns_entity(tenant_client):
    client, _ = tenant_client
    client.put(
        "/api/tenants/t1",
        json={"base_data": {"tenant_id": "t1", "name": "Test School"}},
    )
    resp = client.get("/api/tenants/t1")
    assert resp.status_code == 200
    assert resp.json()["base_data"]["name"] == "Test School"
    assert resp.json()["base_data"]["_abbrev"] == "TES"


def test_get_tenant_not_found(tenant_client):
    client, _ = tenant_client
    resp = client.get("/api/tenants/nonexistent")
    assert resp.status_code == 404
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /Users/kennylee/Development/NeoApex/datacore && python -m pytest tests/test_tenant_api.py -v`

Expected: FAIL — 405 Method Not Allowed (routes don't exist yet)

- [ ] **Step 3: Add tenant request model and routes**

In `src/datacore/api/routes.py`, add import at the top:

```python
from datacore.store import derive_abbrev
```

Add the `TenantRequest` model after the existing `CreateEntityRequest`:

```python
class TenantRequest(BaseModel):
    base_data: dict
    custom_fields: dict | None = None
```

Add the tenant routes inside `register_routes`, before the existing `get_model` route:

```python
    @app.put("/api/tenants/{tenant_id}")
    def put_tenant(tenant_id: str, body: TenantRequest):
        name = body.base_data.get("name")
        abbrev = derive_abbrev(name, tenant_id)
        base_data = {**body.base_data, "_abbrev": abbrev}

        existing = store.get_active_entity(tenant_id, "tenant", tenant_id)
        result = store.put_entity(
            tenant_id=tenant_id,
            entity_type="tenant",
            entity_id=tenant_id,
            base_data=base_data,
            custom_fields=body.custom_fields,
        )
        status = 200 if existing else 201
        return JSONResponse(status_code=status, content=result)

    @app.get("/api/tenants/{tenant_id}")
    def get_tenant(tenant_id: str):
        result = store.get_active_entity(tenant_id, "tenant", tenant_id)
        if result is None:
            raise HTTPException(status_code=404, detail="Tenant not found")
        return result
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /Users/kennylee/Development/NeoApex/datacore && python -m pytest tests/test_tenant_api.py -v`

Expected: All 9 tests PASS

- [ ] **Step 5: Run full suite to check no regressions**

Run: `cd /Users/kennylee/Development/NeoApex/datacore && python -m pytest -v`

Expected: All tests PASS

- [ ] **Step 6: Commit**

```bash
cd /Users/kennylee/Development/NeoApex/datacore
git add src/datacore/api/routes.py tests/test_tenant_api.py
git commit -m "feat: add PUT/GET tenant API endpoints"
```

---

### Task 6: Next-ID API Endpoint

**Files:**
- Modify: `src/datacore/api/routes.py` (add import, add route)
- Create: `tests/test_next_id.py`

- [ ] **Step 1: Write the failing tests**

Create `tests/test_next_id.py`:

```python
"""Tests for GET /api/entities/{tenant}/student/next-id endpoint."""

import tempfile
from unittest.mock import MagicMock, patch

import pytest
from fastapi.testclient import TestClient

from datacore import Store
from datacore.api import create_app


@pytest.fixture
def id_client():
    with tempfile.TemporaryDirectory() as tmp:
        mock_embedder = MagicMock()
        mock_embedder.embed.return_value = [0.0] * 1024
        store = Store(data_dir=tmp, embedder=mock_embedder)
        app = create_app(store)
        client = TestClient(app)
        # Set up tenant
        client.put(
            "/api/tenants/t1",
            json={
                "base_data": {
                    "tenant_id": "t1",
                    "name": "Acme Child Center",
                    "primary_address": "123 Main St",
                },
            },
        )
        yield client, store


def test_next_id_first_student(id_client):
    client, _ = id_client
    resp = client.get("/api/entities/t1/student/next-id")
    assert resp.status_code == 200
    data = resp.json()
    assert data["tenant_abbrev"] == "ACC"
    assert data["entity_abbrev"] == "ST"
    assert data["sequence"] == 1
    # ID format: ACC-ST{YY}0001
    assert data["next_id"].startswith("ACC-ST")
    assert data["next_id"].endswith("0001")


def test_next_id_increments(id_client):
    client, _ = id_client
    client.get("/api/entities/t1/student/next-id")
    resp = client.get("/api/entities/t1/student/next-id")
    data = resp.json()
    assert data["sequence"] == 2
    assert data["next_id"].endswith("0002")


def test_next_id_sequence_three(id_client):
    client, _ = id_client
    client.get("/api/entities/t1/student/next-id")
    client.get("/api/entities/t1/student/next-id")
    resp = client.get("/api/entities/t1/student/next-id")
    data = resp.json()
    assert data["sequence"] == 3
    assert data["next_id"].endswith("0003")


def test_next_id_no_tenant_returns_404(id_client):
    client, _ = id_client
    resp = client.get("/api/entities/nonexistent/student/next-id")
    assert resp.status_code == 404


def test_next_id_uses_current_year(id_client):
    client, _ = id_client
    resp = client.get("/api/entities/t1/student/next-id")
    data = resp.json()
    from datetime import datetime, timezone
    yy = str(datetime.now(timezone.utc).year)[-2:]
    assert f"-ST{yy}" in data["next_id"]


def test_next_id_year_rollover(id_client):
    """Different years get independent counters."""
    client, store = id_client
    # Manually set a counter for 2025
    store.increment_sequence("t1", "student", "2025")
    store.increment_sequence("t1", "student", "2025")

    # Current year should start at 1
    resp = client.get("/api/entities/t1/student/next-id")
    data = resp.json()
    assert data["sequence"] == 1
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /Users/kennylee/Development/NeoApex/datacore && python -m pytest tests/test_next_id.py -v`

Expected: FAIL — 404 or 405 (route doesn't exist yet)

- [ ] **Step 3: Add the next-id route**

Add import at top of `src/datacore/api/routes.py`:

```python
from datetime import datetime, timezone
```

Add the route inside `register_routes`, after the tenant routes and before the existing `get_model` route. **Important:** This route must be registered BEFORE `query_entities` because FastAPI matches `/api/entities/{tenant_id}/student/next-id` against the `query_entities` route pattern `/api/entities/{tenant_id}/{entity_type}/query` — the `next-id` route is more specific and needs to be matched first.

```python
    @app.get("/api/entities/{tenant_id}/student/next-id")
    def next_student_id(tenant_id: str):
        tenant = store.get_active_entity(tenant_id, "tenant", tenant_id)
        if tenant is None:
            raise HTTPException(status_code=404, detail="Tenant not set up")

        abbrev = tenant["base_data"].get("_abbrev", tenant_id[:3].upper())
        year = str(datetime.now(timezone.utc).year)
        yy = year[-2:]

        seq = store.increment_sequence(tenant_id, "student", year)
        next_id = f"{abbrev}-ST{yy}{seq:04d}"

        return {
            "next_id": next_id,
            "tenant_abbrev": abbrev,
            "entity_abbrev": "ST",
            "sequence": seq,
        }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /Users/kennylee/Development/NeoApex/datacore && python -m pytest tests/test_next_id.py -v`

Expected: All 6 tests PASS

- [ ] **Step 5: Run full suite**

Run: `cd /Users/kennylee/Development/NeoApex/datacore && python -m pytest -v`

Expected: All tests PASS

- [ ] **Step 6: Commit**

```bash
cd /Users/kennylee/Development/NeoApex/datacore
git add src/datacore/api/routes.py tests/test_next_id.py
git commit -m "feat: add GET /api/entities/{tenant}/student/next-id endpoint"
```

---

### Task 7: API-Level Prerequisite for Existing Routes

**Files:**
- Modify: `src/datacore/api/routes.py` (wrap `create_entity` and `get_model` with tenant checks)
- Modify: `tests/test_api.py` (add prerequisite test)

- [ ] **Step 1: Write the failing test**

Add to `tests/test_api.py`:

```python
def test_create_entity_without_tenant_returns_400(app_client):
    """POST /api/entities without tenant setup returns 400."""
    client, _ = app_client
    # Use a tenant that has no tenant entity
    resp = client.post(
        "/api/entities/no_tenant/student",
        json={"base_data": {"first_name": "Alice", "last_name": "Smith"}},
    )
    assert resp.status_code == 400
    assert "Tenant not set up" in resp.json()["detail"]
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/kennylee/Development/NeoApex/datacore && python -m pytest tests/test_api.py::test_create_entity_without_tenant_returns_400 -v`

Expected: FAIL — the route currently raises an unhandled `ValueError` which FastAPI converts to a 500.

- [ ] **Step 3: Wrap create_entity with error handling**

In `src/datacore/api/routes.py`, modify the `create_entity` function to catch `ValueError`:

```python
    @app.post("/api/entities/{tenant_id}/{entity_type}")
    def create_entity(
        tenant_id: str, entity_type: str, body: CreateEntityRequest
    ):
        entity_id = uuid.uuid4().hex[:12]
        try:
            result = store.put_entity(
                tenant_id=tenant_id,
                entity_type=entity_type,
                entity_id=entity_id,
                base_data=body.base_data,
                custom_fields=body.custom_fields,
            )
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e))
        return JSONResponse(status_code=201, content=result)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/kennylee/Development/NeoApex/datacore && python -m pytest tests/test_api.py::test_create_entity_without_tenant_returns_400 -v`

Expected: PASS

- [ ] **Step 5: Run full suite**

Run: `cd /Users/kennylee/Development/NeoApex/datacore && python -m pytest -v`

Expected: All tests PASS

- [ ] **Step 6: Commit**

```bash
cd /Users/kennylee/Development/NeoApex/datacore
git add src/datacore/api/routes.py tests/test_api.py
git commit -m "feat: return 400 when tenant not set up on entity creation"
```

---

### Task 8: Update papermite domain.py

**Files:**
- Modify: `/Users/kennylee/Development/NeoApex/papermite/backend/app/models/domain.py:118-126`

- [ ] **Step 1: Add the new optional fields to the Tenant class**

In `/Users/kennylee/Development/NeoApex/papermite/backend/app/models/domain.py`, add four fields to the `Tenant` class after `mailing_address`:

```python
class Tenant(BaseEntity):
    entity_type: str = "TENANT"
    name: Optional[str] = None
    display_name: Optional[str] = None
    contact_email: Optional[EmailStr] = None
    contact_phone: Optional[str] = None
    primary_address: str = ""
    mailing_address: Optional[str] = None
    license_number: Optional[str] = None
    capacity: Optional[int] = None
    accreditation: Optional[str] = None
    insurance_provider: Optional[str] = None
```

- [ ] **Step 2: Run papermite tests to verify no regressions**

Run: `cd /Users/kennylee/Development/NeoApex/papermite && python -m pytest tests/ -v --tb=short 2>&1 | tail -20`

Expected: All tests PASS (adding optional fields with defaults doesn't break anything)

- [ ] **Step 3: Commit**

```bash
cd /Users/kennylee/Development/NeoApex/papermite
git add backend/app/models/domain.py
git commit -m "feat: add license_number, capacity, accreditation, insurance_provider to Tenant"
```
