## Context

DataCore uses LanceDB (Arrow-based) for storage and DuckDB for SQL queries over Arrow tables. The existing query endpoint (`GET /api/query/{tenant_id}/{table_type}?sql=...`) already accepts DuckDB SQL. Other data operations (tenant profile, model definitions, entity creation) each have their own endpoint.

The consolidation applies only to data endpoints — not auth, registry, vector search, or sequence endpoints.

## Goals / Non-Goals

**Goals:**
- Add `POST /api/query` and `POST /api/mutate` as unified data endpoints
- Accept DuckDB SQL for both reads and writes
- Support tenant, model, and entity operations
- Phase 1 only: additive, no breaking changes

**Non-Goals:**
- Consolidating auth endpoints (`/auth/*`)
- Consolidating registry endpoints (`/api/registry/*`)
- Consolidating vector/semantic search
- Removing existing REST endpoints (future phase)
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

For `tenants` table, the query runs against the tenant's entities table filtered to `entity_type = 'tenant'`.

### Mutate endpoint

`POST /api/mutate` accepts:

```json
{
  "tenant_id": "acme",
  "table": "entities",
  "operation": "insert",
  "data": {
    "entity_type": "student",
    "base_data": {"first_name": "Alice", "last_name": "Smith"},
    "custom_fields": {}
  }
}
```

**Operations:**
- `insert` — create new record (entities, tenants)
- `upsert` — create or update (tenants, models)
- `delete` — delete record (entities — by version)

The mutate endpoint dispatches to existing `Store` methods (`put_entity`, `put_model`, `put_entity` for tenants). Business logic (auto student ID, tenant abbrev derivation, model version management) stays in the Store layer.

### Tables and what they map to

| Table | Read (query) | Write (mutate) |
|---|---|---|
| `entities` | `QueryEngine.query()` on `{tenant}_entities` | `Store.put_entity()` |
| `models` | `Store.list_models()` / `Store.get_active_model()` | `Store.put_model()` via PUT models logic |
| `tenants` | `Store.get_active_entity(tenant, "tenant", tenant)` | `Store.put_entity()` with entity_type="tenant" |

### What's excluded

| Endpoint | Why excluded |
|---|---|
| `/auth/*` | Authentication — different concern |
| `/api/registry/*` | User/onboarding CRUD with business logic (password hashing, etc.) |
| `/api/search/{tenant_id}` | Vector search requires embedding pipeline |
| `/api/entities/*/student/duplicate-check` | Vector search |
| `/api/entities/*/student/next-id` | Sequence counter with side effects |

### Implementation

New `unified_routes.py` registered in `create_app()`. Dispatches to existing Store and QueryEngine methods. No new storage logic.

## Alternatives Considered

**Structured JSON filters instead of SQL** — less expressive, requires inventing a query DSL that maps to SQL anyway. DuckDB SQL is already proven in the codebase.

**GraphQL** — overkill, adds client dependency. Rejected.
