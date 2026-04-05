## Why

The Employee Dashboard "Total Students" stat card currently shows a hardcoded dash (`—`). With student data now in datacore, this card should display the live count of active students for the current tenant. This gives staff an at-a-glance view of enrollment size.

## What Changes

- Query datacore for active student count on HomePage mount
- Display the count in the existing "Total Students" stat card:
  - **No student entity table exists** → show `—` (hyphen)
  - **Table exists, active students found** → show the count (e.g., `42`)
  - **Table exists, zero active students** → show `0`
- Pass `tenant` prop to HomePage so it can scope queries

## Capabilities

### New Capabilities
- `dashboard-student-count`: Live active student count on the Employee Dashboard stat card

### Modified Capabilities

_(none)_

## Impact

- **admindash frontend**: HomePage gains `tenant` prop, calls `queryStudents` with `limit=1` to get `total` count, displays result in stat card
- **App.tsx**: Pass `tenant` to HomePage route
- **No backend changes**: Uses the existing `GET /api/entities/{tenant_id}/student/query` endpoint
