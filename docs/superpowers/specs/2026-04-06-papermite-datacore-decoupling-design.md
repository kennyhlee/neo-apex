# Papermite DataCore Decoupling: Remove Direct LanceDB Dependency

**Date:** 2026-04-06
**Status:** Approved

## Problem

Papermite imports DataCore as a Python library and reads/writes LanceDB directly for model definitions. This creates a tight coupling — Papermite needs `NEOAPEX_LANCEDB_DIR`, the `datacore` package as a dependency, and shares filesystem access to the same LanceDB data directory. All other Papermite→DataCore interactions (auth) already go through HTTP.

## Decision

Remove Papermite's direct LanceDB dependency entirely. Model reads go through DataCore's HTTP API. Model writes go through a new DataCore endpoint. Preview logic moves to the frontend (no backend call needed). The `datacore` Python package is removed from Papermite's dependencies.

## Changes

### DataCore — New API Endpoints

#### `GET /api/models/{tenant_id}`

List all active models for a tenant. Returns aggregated model definition across entity types — equivalent to what Papermite's `get_active_model()` in `lance_store.py` currently assembles.

Response:
```json
{
  "tenant_id": "acme",
  "version": 3,
  "status": "active",
  "model_definition": {
    "student": { "base_fields": [...], "custom_fields": [...] },
    "contact": { "base_fields": [...], "custom_fields": [...] }
  },
  "source_filename": "policy.pdf",
  "created_by": "Jane Admin",
  "created_at": "2026-04-01T00:00:00+00:00"
}
```

Returns `null` / 404 if no models exist for the tenant.

#### `PUT /api/models/{tenant_id}`

Store a finalized model definition. Accepts the full model definition with metadata, stores each entity type as a separate DataCore model record with a shared `change_id` for grouped rollback. Handles:
- Unchanged detection (skip write if identical to active)
- Tenant entity creation if missing
- Version management

Request:
```json
{
  "model_definition": {
    "student": { "base_fields": [...], "custom_fields": [...] }
  },
  "source_filename": "policy.pdf",
  "created_by": "Jane Admin"
}
```

Response:
```json
{
  "tenant_id": "acme",
  "version": 4,
  "status": "finalized",
  "model_definition": { ... },
  "source_filename": "policy.pdf",
  "created_by": "Jane Admin",
  "created_at": "2026-04-06T00:00:00+00:00"
}
```

Returns `status: "unchanged"` if model definition matches the current active version.

### Papermite Backend

#### Remove
- `app/storage/lance_store.py` — entire file
- `app/storage/__init__.py` — entire file (or the `storage/` directory)
- `lancedb_dir` from `app/config.py`
- `datacore` from `pyproject.toml` dependencies
- `tests/test_lance_store.py` — tests for deleted code

#### Modify
- `app/config.py` — add `datacore_url` (base URL, not just auth URL). Currently has `datacore_auth_url`; add `datacore_api_url` derived from services.json.
- `app/api/extraction.py` — replace `from app.storage.lance_store import get_active_model` with HTTP call to DataCore `GET /api/models/{tenant_id}`
- `app/api/extract.py` — same replacement
- `app/api/finalize.py`:
  - Remove `preview_finalize` import and `POST /finalize/preview` endpoint entirely
  - Replace `commit_finalize` with: build model definition using `_build_model_definition()` (moved from lance_store to finalize.py or a local helper), then `PUT /api/models/{tenant_id}` to DataCore
- Move `_build_model_definition()` and `_infer_type()` from `lance_store.py` to `app/api/finalize.py` (these are model-building logic, not storage)

### Papermite Frontend

#### Modify
- `src/api/client.ts` — remove `previewFinalize()` function
- `src/pages/FinalizedPage.tsx` — replace backend preview call with local comparison:
  1. Load draft from IndexedDB
  2. Load active model from app state (already fetched on Landing page, passed via route state or re-fetched)
  3. Compare locally to determine `"unchanged"` vs `"pending_confirmation"`
  4. Render preview tables from draft data directly

### What Stays the Same
- `GET /schema` — reads from domain model classes, no LanceDB
- `GET /config/models` — reads from config, no LanceDB
- `POST /tenants/{tenant_id}/upload` — extraction pipeline, no LanceDB
- All auth endpoints — already delegated to DataCore HTTP
- IndexedDB draft storage
- Review page
- Finalize page table rendering (just data source changes from backend response to local)

## Environment Variables

After this change, Papermite's env vars:

| Variable | Description | Default |
|---|---|---|
| `PAPERMITE_DATACORE_AUTH_URL` | DataCore auth endpoint | `http://localhost:6300/auth` |
| `PAPERMITE_DATACORE_API_URL` | DataCore API base URL | `http://localhost:6300/api` |
| `PAPERMITE_PORT` | Papermite backend port | `6210` |
| `CORS_ALLOWED_ORIGINS` | CORS override | Built from services.json |

`NEOAPEX_LANCEDB_DIR` is no longer needed by Papermite.

## Result

After this change:
- Papermite has zero direct DataCore Python imports
- Papermite has no LanceDB dependency
- Papermite communicates with DataCore exclusively via HTTP (auth + model API)
- `datacore` removed from Papermite's `pyproject.toml`
- One fewer service needs `NEOAPEX_LANCEDB_DIR`
