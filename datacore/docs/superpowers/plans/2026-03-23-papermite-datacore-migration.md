# Papermite Datacore Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace papermite's hand-rolled LanceDB storage in `lance_store.py` with `datacore.Store` calls, storing each entity type as a separate model record with shared `change_id` for grouped rollback.

**Architecture:** `lance_store.py` becomes a thin adapter — domain logic (`_build_model_definition`, `_normalize_model_def`, `_infer_type`) stays, all LanceDB plumbing is replaced by `datacore.Store`. Each entity type gets its own model record in datacore's `{tenant_id}_models` table. Metadata fields (`source_filename`, `created_by`) are embedded inside the `model_definition` JSON with underscore prefixes and stripped on read. To retrieve all active entity types for a tenant, we use `store.get_model_history()` filtered to active status (avoiding QueryEngine which flattens JSON columns).

**Tech Stack:** Python 3.11+, datacore (local monorepo package), LanceDB (via datacore)

**Spec:** `openspec/changes/papermite-datacore-migration/specs/model-storage-delegation/spec.md`
**Design:** `openspec/changes/papermite-datacore-migration/design.md`

---

## File Structure

```
papermite/
├── pyproject.toml                              # MODIFY: swap lancedb → datacore dep, align toon
├── backend/app/storage/lance_store.py          # MODIFY: major refactor — replace LanceDB with datacore
└── tests/test_lance_store.py                   # CREATE: unit tests for the refactored storage layer
```

**No changes to:**
- `backend/app/api/finalize.py` — imports `preview_finalize`, `commit_finalize` (unchanged signatures)
- `backend/app/api/extraction.py` — imports `get_active_model` (unchanged signature)
- `backend/app/config.py` — `settings.lancedb_dir` used as-is

---

### Task 1: Dependency wiring

**Files:**
- Modify: `papermite/pyproject.toml`

- [ ] **Step 1: Update pyproject.toml**

Replace `lancedb>=0.6` with `datacore` path dependency and align TOON package name:

```toml
dependencies = [
    "fastapi>=0.115",
    "uvicorn[standard]>=0.30",
    "python-multipart>=0.0.9",
    "pydantic>=2.0",
    "pydantic-ai>=0.0.30",
    "docling>=2.70",
    "datacore @ file:///${PROJECT_ROOT}/../datacore",
    "PyJWT>=2.8",
    "python-toon>=0.1",
]
```

Note: If `file:///${PROJECT_ROOT}/../datacore` doesn't work with hatchling, try these alternatives in order:
1. `"datacore @ file:///../datacore"`
2. `"datacore @ file:///Users/kennylee/Development/NeoApex/datacore"` (absolute path, less portable but guaranteed to work)

- [ ] **Step 2: Verify installation**

Run from the papermite directory:
```bash
cd /Users/kennylee/Development/NeoApex/papermite
pip install -e .
```
Expected: Installs successfully with datacore resolved. Verify with:
```bash
python -c "from datacore import Store; print('OK')"
```
Expected: Prints `OK`

- [ ] **Step 3: Verify toon alignment**

```bash
python -c "import toon; print(toon.encode({'a': 1}))"
```
Expected: Prints a TOON-encoded string (not an ImportError or wrong package)

- [ ] **Step 4: Commit**

```bash
git add pyproject.toml
git commit -m "chore: replace lancedb with datacore dependency, align toon package name"
```

---

### Task 2: Write tests for the refactored storage layer

Since papermite has no existing tests, write them before refactoring. These tests define the contract that the refactored code must satisfy.

**Files:**
- Create: `papermite/tests/test_lance_store.py`

- [ ] **Step 1: Create the test file**

```python
"""Tests for lance_store.py after datacore migration.

These tests verify the public API contract is preserved:
- get_active_model() returns the correct dict shape
- commit_finalize() stores per-entity-type via datacore and returns correct shape
- preview_finalize() detects unchanged vs changed models
- Change detection skips writes for identical models
- Rollback via change_id reverts all entity types
"""

import tempfile
import uuid
from pathlib import Path
from unittest.mock import patch

from app.config import Settings
from app.models.extraction import (
    EntityResult,
    ExtractionResult,
    FieldMapping,
)
from app.storage.lance_store import (
    commit_finalize,
    get_active_model,
    preview_finalize,
)


def _make_extraction(tenant_id: str, filename: str = "test.pdf") -> ExtractionResult:
    """Build a minimal ExtractionResult with student and staff entity types."""
    return ExtractionResult(
        tenant_id=tenant_id,
        filename=filename,
        raw_text="test document text",
        entities=[
            EntityResult(
                entity_type="student",
                entity={"first_name": "Alice", "last_name": "Smith"},
                field_mappings=[
                    FieldMapping(field_name="first_name", value="Alice", source="base_model", required=True),
                    FieldMapping(field_name="last_name", value="Smith", source="base_model", required=True),
                    FieldMapping(field_name="bus_route", value="Route 5", source="custom_field", required=False),
                ],
            ),
            EntityResult(
                entity_type="staff",
                entity={"name": "Bob Jones", "role": "teacher"},
                field_mappings=[
                    FieldMapping(field_name="name", value="Bob Jones", source="base_model", required=True),
                    FieldMapping(field_name="role", value="teacher", source="base_model", required=True),
                ],
            ),
        ],
    )


def _patch_settings_and_reset(tmp_dir: str):
    """Patch settings.lancedb_dir and reset singletons for test isolation."""
    import app.storage.lance_store as module
    module._store = None
    return patch(
        "app.storage.lance_store.settings",
        Settings(lancedb_dir=Path(tmp_dir)),
    )


# -- get_active_model contract --

def test_get_active_model_none_when_no_data():
    """Returns None when no model has been committed for the tenant."""
    with tempfile.TemporaryDirectory() as tmp:
        with _patch_settings_and_reset(tmp):
            result = get_active_model("tenant_new")
            assert result is None


def test_get_active_model_returns_correct_shape():
    """After commit, get_active_model returns dict with exactly the expected keys."""
    with tempfile.TemporaryDirectory() as tmp:
        with _patch_settings_and_reset(tmp):
            extraction = _make_extraction("t1")
            commit_finalize("t1", extraction, created_by="admin")

            result = get_active_model("t1")
            assert result is not None
            expected_keys = {"tenant_id", "version", "status", "model_definition", "source_filename", "created_by", "created_at"}
            assert set(result.keys()) == expected_keys
            assert result["tenant_id"] == "t1"
            assert result["status"] == "active"
            assert result["source_filename"] == "test.pdf"
            assert result["created_by"] == "admin"


def test_get_active_model_definition_has_entity_types():
    """model_definition is keyed by entity type with base_fields and custom_fields."""
    with tempfile.TemporaryDirectory() as tmp:
        with _patch_settings_and_reset(tmp):
            extraction = _make_extraction("t1")
            commit_finalize("t1", extraction, created_by="admin")

            result = get_active_model("t1")
            model_def = result["model_definition"]
            assert "student" in model_def
            assert "staff" in model_def
            assert "base_fields" in model_def["student"]
            assert "custom_fields" in model_def["student"]


def test_get_active_model_no_internal_fields_leaked():
    """Return dict must not contain datacore-internal fields."""
    with tempfile.TemporaryDirectory() as tmp:
        with _patch_settings_and_reset(tmp):
            extraction = _make_extraction("t1")
            commit_finalize("t1", extraction, created_by="admin")

            result = get_active_model("t1")
            # No datacore internals
            for key in ("_change_id", "_updated_at", "_version", "_status", "entity_type"):
                assert key not in result
            # No underscore metadata in model_definition
            for entity_type, defn in result["model_definition"].items():
                for key in defn:
                    assert not key.startswith("_"), f"Leaked internal key {key} in {entity_type}"


# -- commit_finalize contract --

def test_commit_finalize_returns_correct_shape():
    """commit_finalize returns dict with expected keys and status 'finalized'."""
    with tempfile.TemporaryDirectory() as tmp:
        with _patch_settings_and_reset(tmp):
            extraction = _make_extraction("t1")
            result = commit_finalize("t1", extraction, created_by="admin")

            expected_keys = {"tenant_id", "version", "status", "model_definition", "source_filename", "created_by", "created_at"}
            assert set(result.keys()) == expected_keys
            assert result["status"] == "finalized"
            assert result["version"] == 1
            assert result["tenant_id"] == "t1"
            assert result["source_filename"] == "test.pdf"
            assert result["created_by"] == "admin"


def test_commit_finalize_unchanged_model_skips_write():
    """Committing the same model twice returns status 'unchanged' without incrementing version."""
    with tempfile.TemporaryDirectory() as tmp:
        with _patch_settings_and_reset(tmp):
            extraction = _make_extraction("t1")
            first = commit_finalize("t1", extraction, created_by="admin")
            assert first["status"] == "finalized"
            assert first["version"] == 1

            second = commit_finalize("t1", extraction, created_by="admin")
            assert second["status"] == "unchanged"
            assert second["version"] == 1  # not incremented


def test_commit_finalize_changed_model_increments_version():
    """A changed model gets a new version."""
    with tempfile.TemporaryDirectory() as tmp:
        with _patch_settings_and_reset(tmp):
            extraction1 = _make_extraction("t1", filename="v1.pdf")
            result1 = commit_finalize("t1", extraction1, created_by="admin")
            assert result1["version"] == 1

            # Change the extraction — add a new field
            extraction2 = _make_extraction("t1", filename="v2.pdf")
            extraction2.entities[0].field_mappings.append(
                FieldMapping(field_name="grade", value="5", source="base_model", required=False)
            )
            result2 = commit_finalize("t1", extraction2, created_by="admin")
            assert result2["status"] == "finalized"
            assert result2["version"] >= 2


# -- preview_finalize contract --

def test_preview_finalize_pending_confirmation():
    """Preview returns 'pending_confirmation' when no existing model."""
    with tempfile.TemporaryDirectory() as tmp:
        with _patch_settings_and_reset(tmp):
            extraction = _make_extraction("t1")
            result = preview_finalize("t1", extraction)

            assert result["status"] == "pending_confirmation"
            assert result["version"] == 1
            assert "model_definition" in result
            assert result["source_filename"] == "test.pdf"


def test_preview_finalize_unchanged():
    """Preview returns 'unchanged' when model matches active."""
    with tempfile.TemporaryDirectory() as tmp:
        with _patch_settings_and_reset(tmp):
            extraction = _make_extraction("t1")
            commit_finalize("t1", extraction, created_by="admin")

            result = preview_finalize("t1", extraction)
            assert result["status"] == "unchanged"
            assert result["version"] == 1
            assert result["created_by"] == "admin"


# -- Per-entity-type storage --

def test_per_entity_type_versioning():
    """Each entity type stored as separate datacore model record."""
    with tempfile.TemporaryDirectory() as tmp:
        with _patch_settings_and_reset(tmp):
            from datacore import Store
            extraction = _make_extraction("t1")
            commit_finalize("t1", extraction, created_by="admin")

            # Verify individual entity types are stored separately in datacore
            # by checking we can retrieve them independently
            from app.storage.lance_store import _get_store
            store = _get_store()
            student_model = store.get_active_model("t1", "student")
            staff_model = store.get_active_model("t1", "staff")

            assert student_model is not None
            assert staff_model is not None
            assert student_model["entity_type"] == "student"
            assert staff_model["entity_type"] == "staff"


def test_tenant_isolation():
    """Different tenants don't see each other's models."""
    with tempfile.TemporaryDirectory() as tmp:
        with _patch_settings_and_reset(tmp):
            ext1 = _make_extraction("t1")
            ext2 = _make_extraction("t2")
            commit_finalize("t1", ext1, created_by="admin1")
            commit_finalize("t2", ext2, created_by="admin2")

            r1 = get_active_model("t1")
            r2 = get_active_model("t2")
            assert r1["created_by"] == "admin1"
            assert r2["created_by"] == "admin2"

            # Tenant 3 has nothing
            assert get_active_model("t3") is None


def test_rollback_reverts_all_entity_types():
    """Rollback by change_id reverts all entity types from a finalization."""
    with tempfile.TemporaryDirectory() as tmp:
        with _patch_settings_and_reset(tmp):
            # First commit — baseline
            ext1 = _make_extraction("t1", filename="v1.pdf")
            commit_finalize("t1", ext1, created_by="admin")

            # Second commit — changed model (add a field)
            ext2 = _make_extraction("t1", filename="v2.pdf")
            ext2.entities[0].field_mappings.append(
                FieldMapping(field_name="grade", value="5", source="base_model", required=False)
            )
            result2 = commit_finalize("t1", ext2, created_by="admin")
            assert result2["version"] >= 2

            # Find the change_id from the second commit
            from app.storage.lance_store import _get_store
            store = _get_store()
            student = store.get_active_model("t1", "student")
            change_id = student["_change_id"]

            # Rollback
            store.rollback_by_change_id("t1", change_id)

            # Should be back to v1
            model = get_active_model("t1")
            assert model is not None
            assert model["source_filename"] == "v1.pdf"
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd /Users/kennylee/Development/NeoApex/papermite
python -m pytest tests/test_lance_store.py -v
```

Expected: Tests either fail (current code doesn't match new contract for per-entity-type storage) or error (if `datacore` import fails before refactor). This confirms the tests are testing real behavior.

- [ ] **Step 3: Commit**

```bash
git add tests/test_lance_store.py
git commit -m "test: add unit tests for lance_store.py datacore migration contract"
```

---

### Task 3: Refactor lance_store.py — replace imports and add _get_store

**Files:**
- Modify: `papermite/backend/app/storage/lance_store.py:1-34`

- [ ] **Step 1: Replace imports and add _get_store**

Replace lines 1-34 of `lance_store.py` with:

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
```

- [ ] **Step 2: Verify import works**

```bash
cd /Users/kennylee/Development/NeoApex/papermite
python -c "from app.storage.lance_store import _get_store; print('OK')"
```

Expected: Prints `OK` (no import errors)

- [ ] **Step 3: Commit**

```bash
git add backend/app/storage/lance_store.py
git commit -m "refactor: replace lancedb imports with datacore Store"
```

---

### Task 4: Refactor get_active_model

**Files:**
- Modify: `papermite/backend/app/storage/lance_store.py` — replace `get_active_model` function (lines 157-184)

- [ ] **Step 1: Replace get_active_model**

Replace the entire `get_active_model` function with:

```python
def _get_all_active_models(tenant_id: str) -> list[dict]:
    """Get all active model records for a tenant across all entity types.

    Uses the Store's internal LanceDB table directly to avoid QueryEngine's
    JSON flattening, which would destructure the model_definition column.
    """
    store = _get_store()
    table_name = f"{tenant_id}_models"
    if table_name not in store._table_names():
        return []
    table = store._db.open_table(table_name)
    rows = (
        table.search()
        .where("_status = 'active'")
        .to_list()
    )
    # Parse model_definition JSON
    for row in rows:
        if isinstance(row.get("model_definition"), str):
            row["model_definition"] = json.loads(row["model_definition"])
    return rows


def get_active_model(tenant_id: str) -> dict | None:
    """Get the active model definition for a tenant, or None if not found.

    Retrieves all active model records across entity types from datacore
    and reassembles them into a single model_definition dict.
    """
    rows = _get_all_active_models(tenant_id)
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
```

Note: We access `store._table_names()` and `store._db` directly — this is acceptable since
datacore and papermite are in the same monorepo with a tight coupling contract. The alternative
(QueryEngine) flattens the `model_definition` JSON column, which destroys the nested structure
we need to read back.

- [ ] **Step 2: Run relevant tests**

```bash
cd /Users/kennylee/Development/NeoApex/papermite
python -m pytest tests/test_lance_store.py::test_get_active_model_none_when_no_data -v
```

Expected: PASS (no data case should work with datacore)

- [ ] **Step 3: Commit**

```bash
git add backend/app/storage/lance_store.py
git commit -m "refactor: get_active_model retrieves all active entity types from datacore"
```

---

### Task 5: Refactor commit_finalize

**Files:**
- Modify: `papermite/backend/app/storage/lance_store.py` — replace `commit_finalize` function (lines 233-315)

- [ ] **Step 1: Replace commit_finalize**

Replace the entire `commit_finalize` function with:

```python
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

- [ ] **Step 2: Run tests**

```bash
cd /Users/kennylee/Development/NeoApex/papermite
python -m pytest tests/test_lance_store.py -k "commit" -v
```

Expected: All commit-related tests PASS

- [ ] **Step 3: Commit**

```bash
git add backend/app/storage/lance_store.py
git commit -m "refactor: commit_finalize stores per-entity-type via datacore with shared change_id"
```

---

### Task 6: Refactor preview_finalize

**Files:**
- Modify: `papermite/backend/app/storage/lance_store.py` — replace `preview_finalize` function (lines 199-230)

- [ ] **Step 1: Replace preview_finalize**

Replace the entire `preview_finalize` function with:

```python
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
    # to avoid version collisions after rollback
    store = _get_store()
    table_name = f"{tenant_id}_models"
    max_version = 0
    if table_name in store._table_names():
        table = store._db.open_table(table_name)
        all_rows = table.search().where("1=1").to_list()
        if all_rows:
            max_version = max(r["_version"] for r in all_rows)
    next_version = max_version + 1 if max_version > 0 else 1

    return {
        "status": "pending_confirmation",
        "version": next_version,
        "model_definition": model_definition,
        "source_filename": extraction.filename,
    }
```

- [ ] **Step 2: Run tests**

```bash
cd /Users/kennylee/Development/NeoApex/papermite
python -m pytest tests/test_lance_store.py -k "preview" -v
```

Expected: All preview-related tests PASS

- [ ] **Step 3: Commit**

```bash
git add backend/app/storage/lance_store.py
git commit -m "refactor: preview_finalize uses get_active_model for version calculation"
```

---

### Task 7: Remove dead code

**Files:**
- Modify: `papermite/backend/app/storage/lance_store.py`

- [ ] **Step 1: Delete the following functions and constants**

Remove these items entirely from the file (they are no longer used after the refactor):
- `_get_db()` function
- `_table_names()` function
- `_clear_stale_tables()` function
- `_get_max_version()` function
- `_trim_versions()` function
- `TABLE_NAME` constant
- `TABLE_SCHEMA` constant

Also remove the now-unused imports that were only needed by the deleted code. The `json` import is still needed by `get_active_model`. The `datetime`/`timezone` imports are still needed by `commit_finalize`.

- [ ] **Step 2: Verify no lancedb or pyarrow imports remain**

```bash
cd /Users/kennylee/Development/NeoApex/papermite
grep -n "import lancedb\|import pyarrow\|from lancedb\|from pyarrow" backend/app/storage/lance_store.py
```

Expected: No output (no matches)

- [ ] **Step 3: Run full test suite**

```bash
cd /Users/kennylee/Development/NeoApex/papermite
python -m pytest tests/test_lance_store.py -v
```

Expected: All tests PASS

- [ ] **Step 4: Commit**

```bash
git add backend/app/storage/lance_store.py
git commit -m "refactor: remove dead LanceDB plumbing code from lance_store.py"
```

---

### Task 8: Final verification

**Files:**
- All modified files

- [ ] **Step 1: Verify the complete refactored file**

Read `backend/app/storage/lance_store.py` and confirm:
1. Imports: only `datacore`, `json`, `uuid`, `datetime`, `app.config`, `app.models.extraction`
2. Domain logic unchanged: `_build_model_definition()`, `_normalize_model_def()`, `_infer_type()`
3. Storage singleton: `_get_store()`
4. Internal helper: `_get_all_active_models()`
5. Public API: `get_active_model()`, `preview_finalize()`, `commit_finalize()`

- [ ] **Step 2: Run the full test suite**

```bash
cd /Users/kennylee/Development/NeoApex/papermite
python -m pytest tests/test_lance_store.py -v
```

Expected: All 12 tests PASS

- [ ] **Step 3: Verify API callers still import correctly**

```bash
cd /Users/kennylee/Development/NeoApex/papermite
python -c "from app.api.finalize import router; print('finalize OK')"
python -c "from app.api.extraction import router; print('extraction OK')"
```

Expected: Both print OK (imports resolve, no errors)

- [ ] **Step 4: Verify return shape explicitly**

```bash
cd /Users/kennylee/Development/NeoApex/papermite
python -c "
from app.storage.lance_store import get_active_model, commit_finalize, preview_finalize
import inspect
# Verify function signatures haven't changed
sig_get = inspect.signature(get_active_model)
sig_commit = inspect.signature(commit_finalize)
sig_preview = inspect.signature(preview_finalize)
assert list(sig_get.parameters.keys()) == ['tenant_id']
assert list(sig_commit.parameters.keys()) == ['tenant_id', 'extraction', 'created_by']
assert list(sig_preview.parameters.keys()) == ['tenant_id', 'extraction']
print('All signatures match')
"
```

Expected: Prints "All signatures match"
