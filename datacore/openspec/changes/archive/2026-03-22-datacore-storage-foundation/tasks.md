## 1. Package scaffolding

- [x] 1.1 Create `pyproject.toml` with dependencies (lancedb, duckdb, pyarrow, python-toon) and hatchling build
- [x] 1.2 Create `src/datacore/__init__.py` with public API exports
- [x] 1.3 Create module files: `store.py`, `query.py`

## 2. Store — LanceDB abstraction

- [x] 2.1 Implement `Store` class with data_dir config and tenant table naming (`{tenant_id}_models`, `{tenant_id}_entities`)
- [x] 2.2 Implement `put_model()` — per entity type versioning, change_id correlation, archive previous active
- [x] 2.3 Implement `put_entity()` — per entity_id versioning, change_id, TOON-encoded custom fields in `_custom_fields` column, key conflict validation against base_data
- [x] 2.4 Implement `get_active_model()` / `get_active_entity()` — retrieve active record by tenant (+ entity_type/entity_id filters)
- [x] 2.5 Implement `get_model_history()` / `get_entity_history()` — list all versions ordered descending
- [x] 2.6 Implement `delete_version()` — remove a specific version from models or entities
- [x] 2.7 Implement `rollback_by_change_id()` — grouped rollback across models and entities by change_id
- [x] 2.8 Implement version trimming — models: default 100 per entity type; entities: configurable per entity type, default 5

## 3. Query — DuckDB + Arrow SQL layer

- [x] 3.1 Implement `QueryEngine` class wrapping Store
- [x] 3.2 Implement `query()` — load Arrow table, register as `data` in DuckDB, execute SQL, return list of dicts
- [x] 3.3 Implement TOON custom field flattening (decode TOON, expand into queryable columns)
- [x] 3.4 Implement pagination support (limit/offset params + total count)

## 4. Verify

- [x] 4.1 Smoke test: store model, store entity, retrieve, query with SQL, aggregate, paginate, rollback, key conflict validation
