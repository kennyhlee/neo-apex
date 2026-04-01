## 1. Serialization & Schema Cleanup

- [ ] 1.1 Rename `_custom_fields` column to `custom_fields` in `ENTITIES_SCHEMA`, `Store` methods, and `QueryEngine` references
- [ ] 1.2 Switch `base_data` serialization from JSON to TOON in `Store.put_entity()`, `get_active_entity()`, and `get_entity_history()`
- [ ] 1.3 Update `QueryEngine._flatten_json_column()` to decode TOON instead of JSON; rename to `_flatten_toon_column()`
- [ ] 1.4 Update existing tests to reflect TOON encoding for `base_data` and `custom_fields` rename

## 2. REST API Layer

- [ ] 2.1 Add FastAPI and uvicorn dependencies to `pyproject.toml`
- [ ] 2.2 Create `src/datacore/api/` package with FastAPI app and CORS middleware (allow `localhost:5174`, `localhost:5173`)
- [ ] 2.3 Implement `GET /api/models/{tenant_id}/{entity_type}` — returns active model definition or 404
- [ ] 2.4 Implement `POST /api/entities/{tenant_id}/{entity_type}` — generate UUID entity_id, call `Store.put_entity()`, return 201
- [ ] 2.5 Add API tests for model retrieval and entity creation endpoints
