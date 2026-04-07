# Read API Consolidation Phase 2 — Consumer Migration Design

**Date:** 2026-04-06
**Approach:** Direct inline replacement (Approach A) — no wrappers or helper layers

## Context

Phase 1 added `POST /api/query` to DataCore — a unified endpoint that accepts DuckDB SQL over `entities`, `models`, and `tenants` tables. Phase 2 migrates the three consumer services to use it, replacing old GET read endpoints.

Request format:
```json
{
  "tenant_id": "acme",
  "table": "entities | models | tenants",
  "sql": "SELECT * FROM data WHERE ..."
}
```

Response format:
```json
{
  "data": [...],
  "total": N
}
```

## Scope

### In scope
- LaunchPad backend: 4 GET calls → POST /api/query
- Papermite backend: 2 GET calls → POST /api/query
- AdminDash frontend: 3 read calls → POST /api/query, remove tenant listing + dropdown

### Out of scope
- Write endpoints (PUT tenants, PUT models, POST entities)
- `next-id`, `duplicate-check`, `search` endpoints
- `extract` endpoint (Papermite)
- Auth, registry, onboarding endpoints
- Removing old DataCore endpoints (future phase)

## Service 1: LaunchPad Backend

**File:** `launchpad/backend/app/api/tenants.py`

### get_tenant_profile() (line 27)
- Old: `httpx.get(f"/tenants/{tenant_id}")`
- New: `httpx.post("/api/query", json={"tenant_id": tenant_id, "table": "tenants", "sql": "SELECT * FROM data WHERE entity_type = 'tenant' AND _status = 'active'"})`
- Response: unified endpoint returns flattened rows in `data[]` — all `base_data` and `custom_fields` are top-level keys (e.g. `{"tenant_id": "t1", "name": "Acme", ...}`). Take `data[0]`. The existing handler's `{**entity.get("base_data", {}), **entity.get("custom_fields", {})}` merging logic is replaced by using the flattened row directly.
- 404 handling: empty `data[]` (total=0) replaces HTTP 404.

### update_tenant_profile() (line 45)
- Old: `httpx.get(f"/tenants/{tenant_id}")` to check existence before PUT
- New: same query as get_tenant_profile. Check `total > 0` instead of `status_code == 200`.
- The PUT call stays unchanged.

### get_model() (line 65)
- Old: `httpx.get(f"/models/{tenant_id}/tenant")`
- New: `httpx.post("/api/query", json={"tenant_id": tenant_id, "table": "models", "sql": "SELECT * FROM data WHERE entity_type = 'tenant' AND _status = 'active'"})`
- Response: take `data[0]`, extract `model_definition`.
- 404 handling: empty `data[]` returns None.

### get_model_info() (line 78)
- Same query as get_model(). Extract `model_definition`, `_version`, `_change_id`, `_created_at`, `_updated_at` from `data[0]`.

## Service 2: Papermite Backend

### extraction.py — _get_active_model() (line 15)
- Old: `httpx.get(f"{settings.datacore_api_url}/models/{tenant_id}")`
- New: `httpx.post(f"{settings.datacore_api_url}/api/query", json={"tenant_id": tenant_id, "table": "models", "sql": "SELECT * FROM data WHERE _status = 'active'"})`
- Response: returns `{"data": [...], "total": N}`. Caller accesses model records from `data`.
- 404 handling: empty `data[]` returns None.

### extract.py — _get_active_model() (line 21)
- Identical change to extraction.py. Both files have their own copy of this function — both change inline, no consolidation.

### finalize.py — excluded
- PUT /api/models is a write endpoint, stays as-is.

## Service 3: AdminDash Frontend

**Primary file:** `admindash/frontend/src/api/client.ts`

### New: postQuery() function
Single generic function replacing all old read helpers:
```typescript
export async function postQuery(
  tenantId: string,
  table: 'entities' | 'models' | 'tenants',
  sql: string,
): Promise<{ data: Record<string, unknown>[]; total: number }> {
  const resp = await fetch(`${DATACORE_API_BASE}/api/query`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tenant_id: tenantId, table, sql }),
  });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  return resp.json();
}
```

### Remove: fetchTenants()
- Tenant comes from the authenticated user's JWT (`user.tenant_id`), not a cross-tenant listing.

### Remove: fetchStudentModel()
- Callers use `postQuery(tenantId, 'models', "SELECT * FROM data WHERE entity_type = 'student' AND _status = 'active'")` directly.

### Remove: runQuery()
- Callers use `postQuery()` directly. Same SQL, POST instead of GET.

### Remove: queryStudents()
- SQL construction moves to call sites. Callers build their own SQL with filters, sorting, pagination and call `postQuery(tenantId, 'entities', sql)`.

### Response shape change
- Old `runQuery` returned `{rows, total}`. New `postQuery` returns `{data, total}`.
- `QueryResult` interface updates: `rows` → `data`.
- All consumers (`DashboardContext.tsx`, `StudentsPage.tsx`, etc.) update field access accordingly.

### Navbar changes (components/Navbar.tsx)
- Remove `fetchTenants()` import and the `useEffect` calling it
- Remove tenant dropdown `<select>` element
- Display tenant name from `useAuth()` user context (read-only)
- Remove `currentTenant` / `onTenantChange` props

### App.tsx changes
- Remove `onTenantChange` handler passed to Navbar
- `tenant` derived solely from `user.tenant_id` (already partially does this)

### Type changes (types/models.ts)
- Remove `TenantsResponse` type (no longer needed)
- Update `QueryResult` interface: `rows` → `data`

## Testing Strategy

- **LaunchPad**: Run existing backend tests. Manual curl verification of tenant profile and model endpoints.
- **Papermite**: Run existing backend tests. Manual verification of schema/model endpoints.
- **AdminDash**: `npm run build` for TypeScript checks. Manual verification of dashboard, students page, and add student flow. No test framework configured.

## Migration Order

1. LaunchPad (backend only, 4 calls, smallest surface)
2. Papermite (backend only, 2 calls)
3. AdminDash (frontend, largest change — SQL construction, Navbar/App refactor)

Each service is committed independently.
