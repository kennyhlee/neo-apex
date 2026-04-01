## Why

The Students page currently fetches data from a legacy backend (`localhost:8080`) with no server-side filtering, sorting, or status scoping. Users cannot search by base fields, hide columns, adjust page size, or see newly added students highlighted. The data source needs to shift to datacore's vector DB, and the table needs production-level UX: configurable columns, adaptive page sizes, persisted preferences, and real-time feedback when records are added.

## What Changes

- Replace `fetchStudents` (legacy backend) with a new datacore query endpoint that supports filtering, sorting, pagination, and status scoping
- Default to `_status=active` filter with the Status dropdown pre-selected to "Active"
- Default sort by `last_name` ascending
- Adaptive page size: default 20 rows if viewport fits, otherwise best-effort fit; user can change in increments of 10 up to max 50
- Newly added students appear at top of list with highlighted row background until user navigates away or changes sort field
- Column order: base data fields first (left), then custom data fields (right)
- Column visibility toggle — users can hide/show any column
- Table display preferences (visible columns, page size, sort field/direction) persisted in localStorage per user
- Search pane searches all base fields; address field supports fuzzy search (e.g., matching by city)

## Capabilities

### New Capabilities
- `student-query-api`: Datacore REST endpoint for querying student entities with filtering, sorting, pagination, and fuzzy address search
- `student-table-preferences`: localStorage-based persistence of table display preferences (column visibility, page size, sort) per user
- `student-list-ux`: Enhanced StudentsPage table with adaptive page size, column toggle, newly-added highlighting, and base-field search

### Modified Capabilities

_(none — no existing specs require requirement changes)_

## Impact

- **admindash frontend**: StudentsPage rewrite (data fetching, search, table config); new DataTable features (column toggle, sortable headers, variable page size, row highlighting); new localStorage preference hook; updated API client
- **datacore**: New `GET /api/entities/{tenant_id}/{entity_type}` query endpoint with filter/sort/pagination params; fuzzy address search support via DuckDB
- **Types**: Student interface may gain address fields; new preference types
- **No breaking changes**: The legacy `localhost:8080` endpoint can remain but will no longer be used by StudentsPage
