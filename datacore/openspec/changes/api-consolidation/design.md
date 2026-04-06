## Context

DataCore uses LanceDB (Arrow-based) for storage and DuckDB for SQL queries over Arrow tables. The existing query endpoint (`GET /api/query/{tenant_id}/{table_type}?sql=...`) already accepts DuckDB SQL but is limited to one table type and uses GET with query params (problematic for long SQL).

Five read endpoints with different URL patterns and response shapes can be replaced by one.

## Goals / Non-Goals

**Goals:**
- Add `POST /api/query` as a unified read endpoint
- Accept DuckDB SQL for reads across tenants, models, and entities
- Consistent response format
- Phase 1 only: additive, no breaking changes

**Non-Goals:**
- Consolidating write endpoints (each has unique business logic)
- Consolidating auth, registry, search, or sequence endpoints
- Removing existing endpoints (future phase)
- Migrating consumers (future phase)

## Decisions

### Query endpoint

`POST /api/query` accepts:

```json
{
  "tenant_id": "acme",
  "table": "entities",
  "sql": "SELECT * FROM data WHERE entity_type = 'student' AND _status = 'active' ORDER BY last_name LIMIT 10"
}
```

- `tenant_id` — scopes to the tenant's data
- `table` — which table to query: `entities`, `models`, or `tenants`
- `sql` — DuckDB SQL against table alias `data` (same convention as existing query endpoint)

Response is always:
```json
{
  "data": [...],
  "total": N
}
```

### Table mapping

| Table value | Loads | Notes |
|---|---|---|
| `entities` | `{tenant_id}_entities` | Same as existing entity query endpoint |
| `models` | `{tenant_id}_models` | Deserializes model_definition JSON |
| `tenants` | `{tenant_id}_entities` filtered to entity_type='tenant' | Convenience — tenants are stored as entities |

### What this replaces (Phase 2, future)

| Current endpoint | Equivalent unified query |
|---|---|
| `GET /api/tenants/{tenant_id}` | `SELECT * FROM data WHERE entity_type = 'tenant' AND _status = 'active'` |
| `GET /api/models/{tenant_id}` | `SELECT * FROM data WHERE _status = 'active'` (table=models) |
| `GET /api/models/{tenant_id}/{entity_type}` | `SELECT * FROM data WHERE entity_type = '{et}' AND _status = 'active'` |
| `GET /api/entities/{tenant_id}/{entity_type}/query` | `SELECT * FROM data WHERE entity_type = '{et}' ...` |
| `GET /api/query/{tenant_id}/{table_type}` | Direct replacement — same SQL, just POST instead of GET |

### What's excluded

| Endpoint | Why |
|---|---|
| `PUT /api/tenants/{tenant_id}` | Write — abbrev derivation, versioning |
| `PUT /api/models/{tenant_id}` | Write — version management, unchanged detection |
| `POST /api/entities/{tenant_id}/{entity_type}` | Write — auto student ID, vector embedding |
| `/auth/*` | Authentication |
| `/api/registry/*` | User/onboarding CRUD with business logic |
| `/api/search/{tenant_id}` | Semantic search (vector) |
| `/api/entities/*/student/duplicate-check` | Vector search |
| `/api/entities/*/student/next-id` | Sequence counter |

### Implementation

New `unified_routes.py` with `register_unified_routes(app, store)`. Uses existing `QueryEngine.query()` for entities, `Store.list_models()`/`Store.get_active_model()` for models, `Store.get_active_entity()` for tenants. Reuses `QueryEngine._flatten_custom_fields()` for consistent field flattening.
