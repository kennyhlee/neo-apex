# Datacore Public API for Model Access — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `list_models()` to datacore's `Store` class and update papermite to use only public datacore APIs, eliminating internal access to `store._db` and `store._table_names()`. Move the data directory to datacore.

**Architecture:** datacore gets one new public method (`list_models`). Papermite's `lance_store.py` is rewritten to use only `store.list_models()` and `store.put_model()`. The LanceDB data directory moves from `papermite/backend/data/lancedb` to `datacore/data/lancedb`, with `NEOAPEX_LANCEDB_DIR` env var for configuration.

**Tech Stack:** Python, LanceDB, FastAPI, pytest

**Spec:** `docs/superpowers/specs/2026-03-29-datacore-public-api-design.md`

---

## File Map

| Action | File | Responsibility |
|--------|------|----------------|
| Modify | `../datacore/src/datacore/store.py` | Add `list_models()` method, update `DEFAULT_DATA_DIR` |
| Modify | `../datacore/src/datacore/__init__.py` | No change needed (Store already exported) |
| Create | `../datacore/tests/test_store_list_models.py` | Tests for `list_models()` |
| Create | `../datacore/.gitignore` | Ignore `data/` directory |
| Modify | `backend/app/storage/lance_store.py` | Replace internal access with `store.list_models()` |
| Modify | `backend/app/config.py` | Change `lancedb_dir` default to use `NEOAPEX_LANCEDB_DIR` |

---

### Task 1: Add `list_models()` to datacore Store — failing tests

**Files:**
- Create: `../datacore/tests/test_store_list_models.py`

- [ ] **Step 1: Write failing tests for `list_models()`**

Create `test_store_list_models.py` in the datacore test directory. These tests use the existing `store` and `seeded_store` fixtures from `conftest.py`.

```python
"""Tests for Store.list_models() method."""


MODEL_DEF_STUDENT = {
    "base_fields": [
        {"name": "first_name", "type": "str", "required": True},
        {"name": "last_name", "type": "str", "required": True},
    ],
    "custom_fields": [],
}

MODEL_DEF_STAFF = {
    "base_fields": [
        {"name": "name", "type": "str", "required": True},
        {"name": "role", "type": "str", "required": True},
    ],
    "custom_fields": [],
}


def test_list_models_empty_tenant(store):
    """Returns empty list when tenant has no models table."""
    result = store.list_models(tenant_id="nonexistent")
    assert result == []


def test_list_models_all_records(store):
    """Returns all records (active + archived) when status is None."""
    store.put_model("t1", "student", MODEL_DEF_STUDENT)
    store.put_model("t1", "student", {**MODEL_DEF_STUDENT, "iteration": 2})

    result = store.list_models("t1")
    assert len(result) == 2
    statuses = {r["_version"]: r["_status"] for r in result}
    assert statuses[1] == "archived"
    assert statuses[2] == "active"


def test_list_models_active_only(store):
    """Returns only active records when status='active'."""
    store.put_model("t1", "student", MODEL_DEF_STUDENT)
    store.put_model("t1", "student", {**MODEL_DEF_STUDENT, "iteration": 2})
    store.put_model("t1", "staff", MODEL_DEF_STAFF)

    result = store.list_models("t1", status="active")
    assert len(result) == 2
    assert all(r["_status"] == "active" for r in result)
    entity_types = {r["entity_type"] for r in result}
    assert entity_types == {"student", "staff"}


def test_list_models_archived_only(store):
    """Returns only archived records when status='archived'."""
    store.put_model("t1", "student", MODEL_DEF_STUDENT)
    store.put_model("t1", "student", {**MODEL_DEF_STUDENT, "iteration": 2})

    result = store.list_models("t1", status="archived")
    assert len(result) == 1
    assert result[0]["_status"] == "archived"
    assert result[0]["_version"] == 1


def test_list_models_deserializes_model_definition(store):
    """model_definition is returned as a dict, not a JSON string."""
    store.put_model("t1", "student", MODEL_DEF_STUDENT)

    result = store.list_models("t1")
    assert len(result) == 1
    assert isinstance(result[0]["model_definition"], dict)
    assert result[0]["model_definition"] == MODEL_DEF_STUDENT


def test_list_models_multiple_entity_types(seeded_store):
    """Returns records across all entity types for the tenant."""
    result = seeded_store.list_models("t1", status="active")
    entity_types = {r["entity_type"] for r in result}
    assert "student" in entity_types
    assert "staff" in entity_types


def test_list_models_tenant_isolation(store):
    """Tenant t2 cannot see tenant t1's models."""
    store.put_model("t1", "student", MODEL_DEF_STUDENT)

    result = store.list_models("t2")
    assert result == []
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /Users/kennylee/Development/NeoApex/datacore && python -m pytest tests/test_store_list_models.py -v`

Expected: FAIL with `AttributeError: 'Store' object has no attribute 'list_models'`

- [ ] **Step 3: Commit failing tests**

```bash
cd /Users/kennylee/Development/NeoApex/datacore
git add tests/test_store_list_models.py
git commit -m "test: add failing tests for Store.list_models()"
```

---

### Task 2: Implement `list_models()` in datacore Store

**Files:**
- Modify: `../datacore/src/datacore/store.py` (insert after `get_model_history` method, around line 192)

- [ ] **Step 1: Implement `list_models()`**

Add this method to the `Store` class in `store.py`, after the `get_model_history` method (around line 192, before `_trim_model_versions`):

```python
    def list_models(
        self,
        tenant_id: str,
        status: str | None = None,
    ) -> list[dict]:
        """List model records across all entity types for a tenant.

        Args:
            tenant_id: tenant scope
            status: filter by "active", "archived", or None for all

        Returns:
            List of model records with deserialized model_definition.
            Empty list if the tenant has no models table.
        """
        table_name = self._models_table_name(tenant_id)
        if table_name not in self._table_names():
            return []

        table = self._db.open_table(table_name)
        where = f"_status = '{status}'" if status else "1=1"
        rows = table.search().where(where).to_list()

        for row in rows:
            if isinstance(row.get("model_definition"), str):
                row["model_definition"] = json.loads(row["model_definition"])

        return rows
```

- [ ] **Step 2: Run tests to verify they pass**

Run: `cd /Users/kennylee/Development/NeoApex/datacore && python -m pytest tests/test_store_list_models.py -v`

Expected: All 7 tests PASS

- [ ] **Step 3: Run full datacore test suite to check for regressions**

Run: `cd /Users/kennylee/Development/NeoApex/datacore && python -m pytest -v`

Expected: All existing tests still pass

- [ ] **Step 4: Commit**

```bash
cd /Users/kennylee/Development/NeoApex/datacore
git add src/datacore/store.py
git commit -m "feat: add list_models() public API to Store"
```

---

### Task 3: Update datacore Store default data directory

**Files:**
- Modify: `../datacore/src/datacore/store.py` (lines 1-10 imports, lines 49-51 `__init__`)
- Create: `../datacore/.gitignore`

- [ ] **Step 1: Add `NEOAPEX_LANCEDB_DIR` env var support to Store**

In `store.py`, add `os` import at the top (after existing imports around line 7):

```python
import os
```

Add a module-level default after the imports (after line 10, before `_META_FIELDS`):

```python
DEFAULT_DATA_DIR = os.environ.get(
    "NEOAPEX_LANCEDB_DIR",
    str(Path(__file__).parent.parent.parent / "data" / "lancedb"),
)
```

Update the `__init__` signature to use the new default (line 51):

Change:
```python
        data_dir: str | Path = "./data/lancedb",
```
To:
```python
        data_dir: str | Path = DEFAULT_DATA_DIR,
```

- [ ] **Step 2: Create datacore `.gitignore`**

Create `/Users/kennylee/Development/NeoApex/datacore/.gitignore`:

```
# Runtime data
data/

# Python
__pycache__/
*.py[cod]
*.egg-info/
dist/
build/
.venv/
```

- [ ] **Step 3: Run datacore tests to verify nothing breaks**

Run: `cd /Users/kennylee/Development/NeoApex/datacore && python -m pytest -v`

Expected: All tests pass (tests use `tmp_dir` fixture, not default path)

- [ ] **Step 4: Commit**

```bash
cd /Users/kennylee/Development/NeoApex/datacore
git add src/datacore/store.py .gitignore
git commit -m "feat: default data dir to datacore/data/lancedb with NEOAPEX_LANCEDB_DIR env var"
```

---

### Task 4: Update papermite config to use `NEOAPEX_LANCEDB_DIR`

**Files:**
- Modify: `backend/app/config.py` (line 29)

- [ ] **Step 1: Update `lancedb_dir` default in Settings**

In `backend/app/config.py`, add `os` import at the top:

```python
import os
```

Change line 29 from:
```python
    lancedb_dir: Path = Path(__file__).parent.parent / "data" / "lancedb"
```
To:
```python
    lancedb_dir: Path = Path(os.environ.get(
        "NEOAPEX_LANCEDB_DIR",
        str(Path(__file__).resolve().parent.parent.parent.parent / "datacore" / "data" / "lancedb"),
    ))
```

This resolves to `NeoApex/datacore/data/lancedb` for local dev (papermite is at `NeoApex/papermite`), and can be overridden by the env var in deployment.

- [ ] **Step 2: Verify papermite backend starts**

Run: `cd /Users/kennylee/Development/NeoApex/papermite && source .venv/bin/activate && python -c "from app.config import settings; print(settings.lancedb_dir)"`

Expected: Prints a path ending in `datacore/data/lancedb`

- [ ] **Step 3: Commit**

```bash
cd /Users/kennylee/Development/NeoApex/papermite
git add backend/app/config.py
git commit -m "feat: point lancedb_dir to datacore/data/lancedb via NEOAPEX_LANCEDB_DIR"
```

---

### Task 5: Rewrite papermite `lance_store.py` to use public API only — failing tests

**Files:**
- Modify: `backend/app/storage/lance_store.py`

This task rewrites the file to eliminate all `store._db` and `store._table_names()` access. The business logic (`_build_model_definition`, `_normalize_model_def`, `_infer_type`) stays. The read functions (`_get_all_active_models`, `get_active_model`, `preview_finalize`) are rewritten.

- [ ] **Step 1: Rewrite `lance_store.py`**

Replace the entire file content with:

```python
"""LanceDB storage for tenant model definitions — delegated to datacore.

Stores the finalized model definition (schema only — field definitions per entity type)
per tenant with version history. Each entity type is stored as a separate datacore model
record with a shared change_id for grouped rollback. Max 50 versions per entity type.
"""
import json
import uuid
from datetime import datetime, timezone

from datacore import Store

from app.config import settings
from app.models.extraction import ExtractionResult, EntityResult

MAX_VERSIONS = 50

_store: Store | None = None


def _get_store() -> Store:
    """Get or create the datacore Store singleton."""
    global _store
    if _store is None:
        _store = Store(
            data_dir=settings.lancedb_dir,
            max_model_versions=MAX_VERSIONS,
        )
    return _store


def _build_model_definition(entities: list[EntityResult]) -> dict:
    """Convert extraction entities into a model definition (schema only).

    For each entity type, collects all field names classified as base_model
    or custom_field from the field_mappings, producing field definitions
    (name, type, required) without sample values.
    """
    from app.models.domain import ENTITY_CLASSES

    model_def: dict[str, dict] = {}

    for entity_result in entities:
        entity_type = entity_result.entity_type.lower()

        # Look up the domain model class for type info
        model_class = ENTITY_CLASSES.get(entity_type)
        schema_fields = set(model_class.model_fields.keys()) if model_class else set()

        base_fields: list[dict] = []
        custom_fields: list[dict] = []

        for mapping in entity_result.field_mappings:
            # Use explicit field_type from mapping if set, otherwise infer
            field_type = mapping.field_type if mapping.field_type != "str" else _infer_type(mapping.value)
            field_def: dict = {
                "name": mapping.field_name,
                "type": field_type,
                "required": mapping.required,
            }
            if field_type == "selection":
                field_def["options"] = mapping.options or []
                field_def["multiple"] = mapping.multiple or False

            if mapping.source == "base_model":
                base_fields.append(field_def)
            else:
                custom_fields.append(field_def)

        # If this entity type already exists (e.g. multiple students), merge fields
        if entity_type in model_def:
            existing_base_names = {f["name"] for f in model_def[entity_type]["base_fields"]}
            existing_custom_names = {f["name"] for f in model_def[entity_type]["custom_fields"]}
            for f in base_fields:
                if f["name"] not in existing_base_names:
                    model_def[entity_type]["base_fields"].append(f)
            for f in custom_fields:
                if f["name"] not in existing_custom_names:
                    model_def[entity_type]["custom_fields"].append(f)
        else:
            model_def[entity_type] = {
                "base_fields": base_fields,
                "custom_fields": custom_fields,
            }

    return model_def


def _infer_type(value) -> str:
    """Infer a simple type string from a Python value."""
    if value is None:
        return "str"
    if isinstance(value, bool):
        return "bool"
    if isinstance(value, (int, float)):
        return "number"
    if isinstance(value, (list, dict)):
        return "selection"
    return "str"


def _normalize_model_def(model_def: dict) -> dict:
    """Normalize a model definition for comparison (sort keys and field lists)."""
    normalized = {}
    for entity_type in sorted(model_def.keys()):
        entity = model_def[entity_type]
        normalized[entity_type] = {
            "base_fields": sorted(entity.get("base_fields", []), key=lambda f: f["name"]),
            "custom_fields": sorted(entity.get("custom_fields", []), key=lambda f: f["name"]),
        }
    return normalized


def get_active_model(tenant_id: str) -> dict | None:
    """Get the active model definition for a tenant, or None if not found.

    Retrieves all active model records across entity types from datacore
    and reassembles them into a single model_definition dict.
    """
    store = _get_store()
    rows = store.list_models(tenant_id, status="active")
    if not rows:
        return None

    # Reassemble per-entity-type records into combined model_definition
    model_definition = {}
    for row in rows:
        entity_type = row["entity_type"]
        defn = row["model_definition"]
        # Strip underscore-prefixed metadata keys
        clean_defn = {k: v for k, v in defn.items() if not k.startswith("_")}
        model_definition[entity_type] = clean_defn

    # Extract metadata from first record (all share the same source_filename/created_by)
    first_defn = rows[0]["model_definition"]

    return {
        "tenant_id": tenant_id,
        "version": max(row["_version"] for row in rows),
        "status": "active",
        "model_definition": model_definition,
        "source_filename": first_defn.get("_source_filename", ""),
        "created_by": first_defn.get("_created_by", ""),
        "created_at": max(row["_created_at"] for row in rows),
    }


def preview_finalize(
    tenant_id: str,
    extraction: ExtractionResult,
) -> dict:
    """Build the model definition and compare with active — without storing.

    Returns a preview with status "unchanged" or "pending_confirmation".
    """
    model_definition = _build_model_definition(extraction.entities)

    existing = get_active_model(tenant_id)
    if existing:
        existing_normalized = _normalize_model_def(existing["model_definition"])
        new_normalized = _normalize_model_def(model_definition)
        if existing_normalized == new_normalized:
            return {
                "status": "unchanged",
                "version": existing["version"],
                "model_definition": existing["model_definition"],
                "source_filename": existing["source_filename"],
                "created_by": existing["created_by"],
                "created_at": existing["created_at"],
            }

    # Calculate next version from max across ALL records (active + archived)
    store = _get_store()
    all_rows = store.list_models(tenant_id)
    max_version = max((r["_version"] for r in all_rows), default=0)
    next_version = max_version + 1 if max_version > 0 else 1

    return {
        "status": "pending_confirmation",
        "version": next_version,
        "model_definition": model_definition,
        "source_filename": extraction.filename,
    }


def commit_finalize(
    tenant_id: str,
    extraction: ExtractionResult,
    created_by: str,
) -> dict:
    """Store a finalized model definition via datacore.

    - Compares against existing active model; skips write if unchanged
    - Stores each entity type as a separate datacore model record
    - All entity types share a change_id for grouped rollback
    - Returns the stored model definition record with status
    """
    store = _get_store()

    model_definition = _build_model_definition(extraction.entities)

    # Check if model is unchanged from the active version
    existing = get_active_model(tenant_id)
    if existing:
        existing_normalized = _normalize_model_def(existing["model_definition"])
        new_normalized = _normalize_model_def(model_definition)
        if existing_normalized == new_normalized:
            return {
                "tenant_id": tenant_id,
                "version": existing["version"],
                "status": "unchanged",
                "model_definition": existing["model_definition"],
                "source_filename": existing["source_filename"],
                "created_by": existing["created_by"],
                "created_at": existing["created_at"],
            }

    # Store each entity type with a shared change_id
    change_id = uuid.uuid4().hex[:12]
    now = datetime.now(timezone.utc).isoformat()
    max_version = 0

    for entity_type, definition in model_definition.items():
        model_def_with_meta = {
            **definition,
            "_source_filename": extraction.filename,
            "_created_by": created_by,
        }
        result = store.put_model(
            tenant_id=tenant_id,
            entity_type=entity_type,
            model_definition=model_def_with_meta,
            change_id=change_id,
        )
        max_version = max(max_version, result["_version"])

    return {
        "tenant_id": tenant_id,
        "version": max_version,
        "status": "finalized",
        "model_definition": model_definition,
        "source_filename": extraction.filename,
        "created_by": created_by,
        "created_at": now,
    }
```

- [ ] **Step 2: Verify no internal access remains**

Run: `cd /Users/kennylee/Development/NeoApex/papermite && grep -n '_db\.\|_table_names' backend/app/storage/lance_store.py`

Expected: No output (no matches)

- [ ] **Step 3: Verify papermite backend starts**

Run: `cd /Users/kennylee/Development/NeoApex/papermite && source .venv/bin/activate && python -c "from app.storage.lance_store import get_active_model, preview_finalize, commit_finalize; print('imports OK')"`

Expected: `imports OK`

- [ ] **Step 4: Commit**

```bash
cd /Users/kennylee/Development/NeoApex/papermite
git add backend/app/storage/lance_store.py
git commit -m "refactor: replace internal datacore access with store.list_models() public API"
```

---

### Task 6: Copy existing data (manual, one-time)

This is a manual step, not automated.

- [ ] **Step 1: Check if papermite has existing data**

Run: `ls -la /Users/kennylee/Development/NeoApex/papermite/backend/data/lancedb/ 2>/dev/null || echo "no existing data"`

- [ ] **Step 2: If data exists, copy to datacore**

Run: `mkdir -p /Users/kennylee/Development/NeoApex/datacore/data/lancedb && cp -r /Users/kennylee/Development/NeoApex/papermite/backend/data/lancedb/* /Users/kennylee/Development/NeoApex/datacore/data/lancedb/`

If no data exists, skip this step.

- [ ] **Step 3: Verify end-to-end**

Start papermite backend and confirm it can read/write models at the new data location:

Run: `cd /Users/kennylee/Development/NeoApex/papermite && source .venv/bin/activate && uvicorn app.main:app --reload --port 8000`

Test via the frontend or curl that upload → review → finalize still works.
