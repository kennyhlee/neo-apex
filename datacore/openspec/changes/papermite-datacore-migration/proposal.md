## Why

Papermite's `lance_store.py` contains hand-rolled LanceDB storage logic (versioning, archiving, trimming) that duplicates what the `datacore` package already provides. By swapping the storage plumbing to use `datacore.Store`, papermite eliminates this duplication, gains datacore's richer feature set (change_id correlation, per-entity-type versioning, configurable limits), and establishes the pattern for future NeoApex projects to share a common storage layer.

## What Changes

- Papermite adds `datacore` as a pip dependency
- `lance_store.py` is refactored to delegate all LanceDB operations (open/create table, insert, archive, trim, query) to `datacore.Store`
- The domain-specific logic (`_build_model_definition`, `_normalize_model_def`, `_infer_type`, change detection) stays in papermite
- The public API of `lance_store.py` (`get_active_model`, `preview_finalize`, `commit_finalize`) remains unchanged — callers (`finalize.py`, `extraction.py`) are not modified
- Papermite's direct `lancedb` dependency is removed (accessed transitively via datacore)
- The single shared `tenant_models` table migrates to datacore's per-tenant `{tenant_id}_models` table layout

## Capabilities

### New Capabilities

- `model-storage-delegation`: Papermite delegates model definition storage to datacore.Store, replacing hand-rolled LanceDB versioning with datacore's tenant-scoped, versioned storage

### Modified Capabilities

- `vector-store`: Datacore's vector-store capability is consumed by papermite — no requirement changes, but this change exercises it as a downstream dependency for the first time

## Impact

- `papermite/backend/app/storage/lance_store.py`: Major refactor — all LanceDB plumbing replaced with datacore.Store calls
- `papermite/backend/app/config.py`: `lancedb_dir` setting now passed to datacore.Store constructor
- `papermite/pyproject.toml`: Add `datacore` dependency, remove direct `lancedb` dependency
- `papermite/data/lancedb/`: Existing data directory structure changes (single `tenant_models` table → per-tenant `{tenant_id}_models` tables)
- No changes to API routes (`finalize.py`, `extraction.py`) — the public interface of `lance_store.py` is preserved
