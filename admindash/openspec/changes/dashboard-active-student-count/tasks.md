## 1. Generic query endpoint in datacore

- [ ] 1.1 Add `GET /api/query/{tenant_id}/{table_type}` endpoint that accepts a `sql` query param, delegates to `QueryEngine.query()`, and returns `{ rows: [...], total: int }`
- [ ] 1.2 Make `limit` optional on the existing entity query endpoint (no limit = return all rows)

## 2. API client function

- [ ] 2.1 Add `runQuery(tenantId, tableType, sql)` function in `api/client.ts` that calls the generic query endpoint

## 3. DashboardContext with TTL cache

- [ ] 3.1 Create `DashboardContext` with cached student count (value + fetchedAt), 60-minute TTL, `invalidateStudentCount()` to clear cache
- [ ] 3.2 Wrap protected routes with `DashboardProvider` in App.tsx (alongside ModelProvider)

## 4. Wire HomePage and AddStudentPage

- [ ] 4.1 Add `tenant` prop to HomePage, pass from App.tsx, fetch count from DashboardContext on mount
- [ ] 4.2 Display count in Total Students stat card: count on success, `0` if count is 0, `—` on error/loading
- [ ] 4.3 Call `invalidateStudentCount()` in AddStudentPage after successful `createStudent`
