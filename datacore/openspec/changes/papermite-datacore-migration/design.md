## Context

Papermite's `lance_store.py` (~220 lines) directly manages LanceDB for storing tenant model definitions. It handles table creation, versioning (max 50), archiving active→archived, trimming, and change detection. The `datacore` package (built in the same monorepo) provides all of this functionality through `datacore.Store` with additional capabilities like change_id correlation, per-entity-type versioning, and configurable limits.

Currently papermite uses a single shared `tenant_models` table with a `tenant_id` column filter. Datacore uses per-tenant tables (`{tenant_id}_models`), which provides stronger tenant isolation.

Three API routes consume `lance_store.py`:
- `GET /tenants/{tenant_id}/model` → `get_active_model()`
- `POST /tenants/{tenant_id}/finalize/preview` → `preview_finalize()`
- `POST /tenants/{tenant_id}/finalize/commit` → `commit_finalize()`

## Goals / Non-Goals

**Goals:**
- Replace all direct LanceDB operations in `lance_store.py` with `datacore.Store` calls
- Preserve the public API surface (`get_active_model`, `preview_finalize`, `commit_finalize`) — no changes to callers
- Keep domain logic (`_build_model_definition`, `_normalize_model_def`, `_infer_type`) in papermite
- Remove papermite's direct `lancedb` dependency

**Non-Goals:**
- Migrating existing data from the old `tenant_models` table format to per-tenant tables (manual or scripted migration is a follow-up)
- Storing entity records (student data, etc.) via `datacore.Store.put_entity()` — future work
- Changing the API response shape or route signatures
- Adding SQL query capability via `datacore.QueryEngine` — future work

## Decisions

### Decision 1: Store instance lifecycle — module-level singleton

Create a module-level `_store` instance in `lance_store.py`, initialized lazily on first use. This mirrors the current `_get_db()` pattern but wraps `datacore.Store` instead of raw `lancedb.connect()`.

```python
_store: Store | None = None

def _get_store() -> Store:
    global _store
    if _store is None:
        _store = Store(
            data_dir=settings.lancedb_dir,
            max_model_versions=MAX_VERSIONS,
        )
    return _store
```

**Rationale:** Matches the existing pattern. Avoids passing store instances through the call chain. Testable via patching.

### Decision 2: Map papermite's model storage to datacore's `put_model` / `get_active_model`

Papermite stores model definitions with these fields: `tenant_id`, `version`, `status`, `model_definition` (JSON), `source_filename`, `created_by`, `created_at`. Datacore's `put_model()` stores: `entity_type`, `model_definition` (JSON), `_version`, `_status`, `_change_id`, `_created_at`, `_updated_at`.

The mapping:
- Papermite's `tenant_id` → datacore's tenant scoping (separate tables per tenant)
- Each entity type in papermite's model definition maps to a separate datacore model record. `_build_model_definition()` already produces a dict keyed by entity type — each key becomes a `put_model()` call with its own `entity_type` and independent version history.
- A shared `change_id` ties all entity types from one finalization together, enabling grouped rollback via `store.rollback_by_change_id()`
- `source_filename` and `created_by` → stored inside each entity type's `model_definition` JSON as metadata fields, since datacore's schema doesn't have dedicated columns for these
- `version` → `_version` (datacore manages this automatically, per entity type)
- `status` → `_status` (datacore manages active/archived automatically)

**Field mapping — writing to datacore:**

`_build_model_definition()` returns `{"student": {base_fields: [...], custom_fields: [...]}, "staff": {...}}`. Each entity type is stored separately with a shared `change_id`:
```python
change_id = store._new_change_id()
for entity_type, definition in model_definition.items():
    model_def_with_meta = {
        **definition,
        "_source_filename": source_filename,
        "_created_by": created_by,
    }
    store.put_model(tenant_id, entity_type=entity_type, model_definition=model_def_with_meta, change_id=change_id)
```

**Field mapping — reading from datacore:**

`get_active_model()` reassembles the full model definition by reading all active models across entity types. Since datacore's `get_active_model()` returns one record per entity_type, we need to call it for each known entity type or query the models table to find all active entity types. The reassembled return dict:
```python
{
    "tenant_id": tenant_id,
    "version": max(row["_version"] for row in active_rows),  # highest version across entity types
    "status": "active",
    "model_definition": {row["entity_type"]: {k: v for k, v in row["model_definition"].items() if not k.startswith("_")} for row in active_rows},
    "source_filename": active_rows[0]["model_definition"]["_source_filename"],
    "created_by": active_rows[0]["model_definition"]["_created_by"],
    "created_at": max(row["_created_at"] for row in active_rows),
}
```

**Status translation:** Datacore stores `_status: "active"`. In `commit_finalize()`, the API returns `status: "finalized"`. In `get_active_model()`, the API returns `status: "active"`. These are hardcoded translations.

**Version calculation for preview:** `preview_finalize()` reports a version number. Since each entity type now has independent versions, the preview version is the max version across all active entity types + 1 (or `1` if no active models exist).

**Retrieving all active models for a tenant:** Datacore's `get_active_model()` requires an `entity_type` argument. To reassemble the full model definition, we need to query all active entity types. Use `store.get_table_as_arrow(tenant_id, "models")` with a DuckDB query filtering `_status = 'active'`, or iterate over known entity types. The simpler approach: use `QueryEngine` to `SELECT * FROM data WHERE _status = 'active'` on the models table, which returns all active entity type definitions in one query.

### Decision 3: Change detection stays in papermite

The `_normalize_model_def()` function and the "unchanged" check in `preview_finalize` / `commit_finalize` remain in papermite. Datacore doesn't do content-aware deduplication — it always creates a new version. Papermite continues to compare before calling `put_model()`.

**Rationale:** Change detection is domain logic (what counts as "the same" model definition). Datacore is storage, not business logic.

### Decision 4: Remove `_clear_stale_tables`

The current `lance_store.py` has `_clear_stale_tables()` which drops old per-entity tables from a previous storage format. Since we're migrating to datacore's table layout anyway, this cleanup code is no longer relevant and can be removed.

### Decision 5: Dependency wiring

- Add `datacore` as a path dependency in papermite's `pyproject.toml` (exact syntax to be verified during implementation — likely `datacore @ file:///../datacore` or a hatch-compatible relative path)
- Remove direct `lancedb` from papermite's dependencies (comes transitively via datacore)
- `pyarrow` is not a direct dependency of papermite (it comes transitively via `lancedb`), so no action needed
- Align TOON dependency: papermite currently lists `toon>=0.1` while datacore uses `python-toon>=0.1` — verify these resolve to the same package and align the naming

## Risks / Trade-offs

- **Data format change** → Existing `tenant_models` table won't be read by the new code (datacore uses `{tenant_id}_models` tables). Mitigation: this is explicitly a non-goal for this change; data migration is follow-up work. Old data remains intact.
- **Metadata loss** → `source_filename` and `created_by` move from dedicated columns into the `model_definition` JSON payload. Mitigation: these fields are only used in API responses, which still extract them from the returned dict. No query filtering on these fields.
- **Singleton store** → Module-level `_store` makes it slightly harder to test with different configs. Mitigation: the `_get_store()` function can be patched in tests, same as the current `_get_db()`.
