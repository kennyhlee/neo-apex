## Why

DataCore has 5 read endpoints across tenants, models, and entities with inconsistent URL patterns and query mechanisms. Since DataCore already uses Apache Arrow (LanceDB) and DuckDB internally, a unified query endpoint can accept DuckDB SQL directly — one endpoint replaces five, with more flexible queries and a consistent response format.

Write endpoints stay as-is — each has unique business logic (versioning, auto-ID, embeddings) that doesn't benefit from SQL.

## What Changes

- Add `POST /api/query` — unified read endpoint accepting DuckDB SQL for tenant, model, and entity data
- **All existing endpoints remain unchanged** — Phase 1 is additive only
- Write endpoints (`PUT /api/tenants`, `PUT /api/models`, `POST /api/entities`) are excluded from consolidation

## Capabilities

### New Capabilities
- `unified-query-api`: Single `POST /api/query` endpoint for all read operations on tenants, models, and entities using DuckDB SQL

### Modified Capabilities

## Impact

- **DataCore**: New `unified_routes.py` with one endpoint, dispatching SQL to existing QueryEngine
- **Existing endpoints**: No changes — all remain functional
- **Consumers**: No changes required in Phase 1
- **Future phases**: Consumers migrate reads to unified query, then old read endpoints are removed
