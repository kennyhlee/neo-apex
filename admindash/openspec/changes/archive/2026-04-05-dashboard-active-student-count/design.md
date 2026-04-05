## Context

HomePage currently shows a hardcoded dash for "Total Students". The datacore query endpoint (`GET /api/entities/{tenant_id}/student/query`) already returns `{ data, total }` where `total` is the count of matching records. HomePage doesn't currently receive the `tenant` prop, but other pages (StudentsPage, AddStudentPage) do.

## Goals / Non-Goals

**Goals:**
- Show live active student count on the dashboard
- Handle three states: no entity table (dash), zero active (0), has active (count)
- Minimal changes — reuse existing `queryStudents` API client

**Non-Goals:**
- Real-time updates or polling (fetch on mount only)
- Caching the count (simple enough to re-fetch on each navigation)
- Other stat cards (attendance rate, total courses remain hardcoded for now)

## Decisions

### 1. Use existing query endpoint with limit=1

**Decision**: Use the existing generic query endpoint `GET /api/query/{tenant_id}/entities` with a SQL count query: `SELECT COUNT(*) as count FROM data WHERE entity_type='student' AND _status='active'`. Returns `{ rows: [{ count: N }], total: 1 }`. Read `rows[0].count` for the student count.

**Why**: Reuses the generic query infrastructure. No new endpoint needed. The same query mechanism can serve future dashboard stats.

**Alternatives considered**:
- Dedicated count endpoint — unnecessary; the generic query handles this
- Using the entity query endpoint with `limit=0` — conflates pagination with counting

### 3. Caching with invalidation + TTL

**Decision**: Cache the student count in a `DashboardContext` with a 60-minute TTL. The cache invalidates immediately when `createStudent` succeeds (via `invalidateStudentCount()`). On HomePage mount, if cache is valid (exists and not expired), use it; otherwise re-fetch.

**Why**: Avoids re-querying on every navigation to Home. TTL ensures stale data from other users' changes refreshes within an hour. Immediate invalidation on local student creation keeps the count accurate for the current user's actions.

**Schema**: `{ value: number | null, fetchedAt: number }` — `fetchedAt` is `Date.now()` for TTL comparison.

### 2. Error handling as "no data"

**Decision**: If the fetch fails (datacore not running, no entity table), show `—` (dash). Don't show error messages in the stat card.

**Why**: The dashboard should degrade gracefully. A missing count is not critical — the user can navigate to the Students page for details.
