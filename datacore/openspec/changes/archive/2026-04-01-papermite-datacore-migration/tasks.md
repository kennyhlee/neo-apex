## 1. Dependency wiring

- [ ] 1.1 Add `datacore` as a path dependency in `papermite/pyproject.toml` (verify exact syntax works with hatchling — try `datacore @ file:///../datacore` or alternative)
- [ ] 1.2 Remove direct `lancedb` from papermite's dependencies
- [ ] 1.3 Align TOON dependency naming: papermite uses `toon>=0.1`, datacore uses `python-toon>=0.1` — verify they resolve to the same package and align
- [ ] 1.4 Verify `pip install -e .` succeeds in papermite's venv with datacore resolved

## 2. Refactor lance_store.py

- [ ] 2.1 Replace `lancedb` and `pyarrow` imports with `from datacore import Store, QueryEngine`
- [ ] 2.2 Replace `_get_db()` with `_get_store()` returning a lazy-initialized `datacore.Store` instance (using `settings.lancedb_dir`, `max_model_versions=50`)
- [ ] 2.3 Refactor `commit_finalize()` — iterate `_build_model_definition()` output by entity type, call `store.put_model()` once per entity type with a shared `change_id`, embed `_source_filename` and `_created_by` in each definition, reassemble into combined `model_definition` dict for return, translate status to `"finalized"`
- [ ] 2.4 Refactor `get_active_model()` — query all active model records for the tenant (via `QueryEngine` or iterating entity types), reassemble into combined `model_definition` dict keyed by entity type, extract `_source_filename`/`_created_by` metadata, strip datacore-internal fields (`_change_id`, `_updated_at`, `entity_type`)
- [ ] 2.5 Refactor `preview_finalize()` — use refactored `get_active_model()` for existing model lookup, calculate next version as max `_version` across active entity types + 1
- [ ] 2.6 Remove dead code: `_get_db()`, `_table_names()`, `_get_max_version()`, `_trim_versions()`, `_clear_stale_tables()`, `TABLE_NAME`, `TABLE_SCHEMA` constants
- [ ] 2.7 Keep domain logic unchanged: `_build_model_definition()`, `_normalize_model_def()`, `_infer_type()`

## 3. Verify

- [ ] 3.1 Verify no direct `lancedb` or `pyarrow` imports remain in `lance_store.py`
- [ ] 3.2 Verify `get_active_model`, `preview_finalize`, `commit_finalize` return the same dict shape as before (explicit key list check)
- [ ] 3.3 Run papermite's existing tests (if any) to confirm no regressions
- [ ] 3.4 Manual smoke test: call preview + commit finalize, then retrieve active model — confirm round-trip works
- [ ] 3.5 Verify rollback: commit a finalization, then rollback by change_id — confirm all entity types revert
