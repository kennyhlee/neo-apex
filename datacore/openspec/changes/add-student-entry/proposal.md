## Why

Datacore needs a REST API layer and serialization cleanup to support the add-student-entry feature across NeoApex. Currently it's a library-only package with inconsistent serialization (JSON for `base_data`, TOON for `_custom_fields`) and no HTTP interface. Other NeoApex frontends (admindash) need HTTP access to model retrieval and entity CRUD.

## What Changes

- Rename `_custom_fields` to `custom_fields` — it's user data, not system metadata
- Unify serialization: switch `base_data` from JSON to TOON encoding so both columns use the same format
- Update QueryEngine flattening to decode TOON for both columns
- Add FastAPI REST API layer for model retrieval and entity CRUD (storage only — no extraction, no business logic)
- CORS configuration for admindash frontend (`localhost:5174`)

## Capabilities

### New Capabilities
- `datacore-rest-api`: FastAPI HTTP layer exposing model retrieval and entity CRUD endpoints — strictly storage, no business logic
- `toon-unified-serialization`: Both `base_data` and `custom_fields` use TOON encoding for consistency

### Modified Capabilities

_(none)_

## Impact

- **Store**: `put_entity()`, `get_active_entity()`, `get_entity_history()` switch `base_data` to TOON; column rename from `_custom_fields` to `custom_fields`
- **QueryEngine**: `_flatten_json_column()` renamed to `_flatten_toon_column()`, decodes TOON instead of JSON
- **New package**: `src/datacore/api/` with FastAPI app
- **Dependencies**: FastAPI and uvicorn added to `pyproject.toml`
- **Part of**: Cross-project `add-student-entry` change (datacore → papermite → admindash)
