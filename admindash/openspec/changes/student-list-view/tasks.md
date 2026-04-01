## 1. Datacore Query API

- [ ] 1.1 Add `GET /api/entities/{tenant_id}/{entity_type}/query` endpoint to datacore routes with filter, sort, and pagination params; include `entity_type` in WHERE clause
- [ ] 1.2 Build SQL WHERE clause from filter params with parameterized values (status default `active`, base field ILIKE, fuzzy address OR across address/city/state/zip); dynamically check which address columns exist before building OR clause
- [ ] 1.3 Add sort validation (reject unknown columns with 400) and pagination clamping (limit 1-50, default 20)

## 2. Admindash API Client

- [ ] 2.1 Add `queryStudents()` function in `api/client.ts` targeting the new datacore query endpoint with all filter/sort/pagination params
- [ ] 2.2 Update response types to match flat response shape from datacore (all fields at top level)

## 3. ModelContext

- [ ] 3.1 Create `ModelContext` — fetches and caches model definitions per entity type in memory; clears on logout; components read from context instead of calling `fetchStudentModel` directly
- [ ] 3.2 Refactor AddStudentPage to read model definition from ModelContext instead of fetching directly

## 4. Table Preferences

- [ ] 4.1 Create `useTablePreferences` hook — reads/writes localStorage key `admindash_table_prefs_{user_id}_{tenant_id}` (user_id from AuthContext), returns preferences with defaults, prunes stale hiddenColumns, validates pageSize
- [ ] 4.2 Add i18n keys for new UI elements (page size selector, column settings, address search, sort indicators)

## 5. DataTable Enhancements

- [ ] 5.1 Add optional sort props (`sortBy`, `sortDir`, `onSortChange`) — clickable column headers with sort indicator
- [ ] 5.2 Add optional page size props (`pageSizeOptions`, `onPageSizeChange`) — page size selector near pagination
- [ ] 5.3 Add optional `hiddenColumns` prop — filter out hidden columns from render
- [ ] 5.4 Add optional `rowClassName` prop — callback `(row) => string` for per-row CSS class (used for highlight)

## 6. StudentsPage Rewrite

- [ ] 6.1 Replace `fetchStudents` with `queryStudents` from datacore; wire filter state to query params; default status to `active` with dropdown pre-selected
- [ ] 6.2 Implement adaptive page size calculation based on viewport height (round down to nearest 10-increment, min 10, max 50)
- [ ] 6.3 Build dynamic search pane from ModelContext base fields; add Address fuzzy search input
- [ ] 6.4 Build column list from ModelContext (base_fields first, then custom_fields, in model definition order)
- [ ] 6.5 Wire column visibility toggle UI (popover with checkboxes)
- [ ] 6.6 Integrate `useTablePreferences` — load on mount, save on column/pageSize/sort changes
- [ ] 6.7 Implement newly-added student highlight — read `entity_id` from router location state, prepend to data, apply highlight CSS class, clear on sort change or navigation

## 7. AddStudentPage Integration

- [ ] 7.1 Pass newly created `entity_id` via React Router navigate state when redirecting to `/students` after successful creation
