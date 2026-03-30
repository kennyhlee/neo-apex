# Datacore Public API for Model Access

**Date:** 2026-03-29
**Status:** Draft
**Scope:** Add `list_models()` to datacore `Store`, eliminate papermite's internal datacore access, move data directory to datacore

## Problem

Papermite's `lance_store.py` bypasses datacore's public API by accessing `store._db` and `store._table_names()` directly. This couples papermite to datacore's LanceDB internals, preventing other projects (admindash, etc.) from accessing model data through a stable interface.

Two specific internal-access patterns exist:

1. **`_get_all_active_models()`** — queries `{tenant_id}_models` table directly via `store._db.open_table()` to get all active model records across entity types.
2. **`preview_finalize()`** — queries all records (active + archived) via `store._db.open_table()` to compute the max version number for the next version.

## Design

### New datacore method: `list_models`

```python
def list_models(
    self,
    tenant_id: str,
    status: str | None = None,
) -> list[dict]:
```

**Parameters:**
- `tenant_id` — tenant scope
- `status` — filter by `"active"`, `"archived"`, or `None` for all records

**Returns:** List of model records, each with:
- `entity_type: str`
- `model_definition: dict` (JSON-deserialized, not raw string)
- `_version: int`
- `_status: str`
- `_change_id: str`
- `_created_at: str`
- `_updated_at: str`

Returns `[]` when the tenant has no models table.

**No pagination at the datacore level.** Max 50 versions per entity type (enforced by existing trim logic), so the dataset is small. Consumers handle display pagination.

### Papermite `lance_store.py` changes

**Replace `_get_all_active_models()`:**

Before (internal access):
```python
table = store._db.open_table(f"{tenant_id}_models")
rows = table.search().where("_status = 'active'").to_list()
```

After (public API):
```python
rows = store.list_models(tenant_id, status="active")
```

**Replace max version calculation in `preview_finalize()`:**

Before (internal access):
```python
table = store._db.open_table(f"{tenant_id}_models")
all_rows = table.search().where("1=1").to_list()
max_version = max(r["_version"] for r in all_rows)
```

After (public API):
```python
all_rows = store.list_models(tenant_id)
max_version = max((r["_version"] for r in all_rows), default=0)
```

### What stays the same

- **`store.put_model()`** — write path already uses public API, no changes needed
- **`store.get_active_model(tenant_id, entity_type)`** — single entity type lookup, stays for targeted queries
- **`store.get_model_history(tenant_id, entity_type)`** — per-entity-type history, stays
- **IndexedDB draft persistence** — browser-side flow unchanged
- **Finalize workflow** — upload > review > preview > commit flow unchanged
- **`_build_model_definition()`** — domain logic stays in papermite
- **`_normalize_model_def()`** — comparison logic stays in papermite

### Consumers

| Project | Usage |
|---|---|
| **papermite** | `list_models(tid, status="active")` for reassembling full model definition; `list_models(tid)` for max version in preview; future: version history UI for rollback |
| **admindash** | `list_models(tid, status="active")` to get entity type definitions for dynamically building entity tables (student table, guardian table, etc.) |

### Future: Model rollback (papermite, not in scope now)

The `list_models()` API provides the foundation for a future rollback feature:

1. **Version history UI** — `list_models(tenant_id)` returns all records with `_version`, `_change_id`, `_created_at`. Papermite groups by `_change_id` and displays the last N change sets, with a "load older" option.
2. **Revert** — admin picks a change set, papermite reads the old `model_definition` content and re-submits via `store.put_model()` with a fresh `change_id`. The existing `put_model` archive-before-insert logic handles the rest. Versions always move forward; no deletions.
3. **No new datacore method needed** — `list_models` + `put_model` cover the full revert workflow.

### Data directory: move to datacore

**Current state:** LanceDB data lives at `papermite/backend/data/lancedb`, configured via `settings.lancedb_dir` in papermite's `config.py`. Only papermite can access it.

**New state:** Data directory moves to `datacore/data/lancedb`. Datacore owns the data so it can:
- Run its own tests against real data structures independently
- Be deployed standalone without other project modules
- Serve as the single source of truth for all consumers

**Changes:**

1. **datacore `Store` default:** Change `data_dir` default from `"./data/lancedb"` to `datacore/data/lancedb` (relative to datacore project root, or absolute via env var).

2. **Environment variable:** All consumers configure data location via `NEOAPEX_LANCEDB_DIR`. Datacore's `Store.__init__` uses this as the default when no `data_dir` is passed:
   ```python
   import os
   DEFAULT_DATA_DIR = os.environ.get(
       "NEOAPEX_LANCEDB_DIR",
       str(Path(__file__).parent.parent.parent / "data" / "lancedb"),
   )
   ```

3. **Papermite config:** `settings.lancedb_dir` default changes from `papermite/backend/data/lancedb` to reading `NEOAPEX_LANCEDB_DIR`. Falls back to datacore's default path for local dev.

4. **Admindash (future):** Same pattern — `Store(data_dir=os.environ.get("NEOAPEX_LANCEDB_DIR"))`.

5. **Existing data:** If any data exists at `papermite/backend/data/lancedb`, it needs to be copied to `datacore/data/lancedb` once. This is a one-time manual step during dev setup, not an automated migration.

### Existing `rollback_by_change_id` in datacore

The current `rollback_by_change_id` method deletes versions and re-activates old ones at their original version numbers. This conflicts with the desired "versions always move forward" semantic. It will **not** be used by papermite's rollback feature. Whether to deprecate or modify it in datacore is out of scope for this change.
