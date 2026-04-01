## Context

StudentsPage currently fetches from a legacy Express backend at `localhost:8080` that reads from a static JSON file. The real student data lives in datacore's LanceDB vector store with a DuckDB query engine that supports SQL-level filtering, sorting, and pagination. The `QueryEngine.query()` method already flattens base_data (TOON) and custom_fields into queryable columns. Datacore's REST API has model and entity creation endpoints but no query/list endpoint.

The DataTable component is a simple paginated table with fixed page size (10), no sort, no column toggle, and no row highlighting. It needs to evolve to support the new requirements while remaining generic.

## Goals / Non-Goals

**Goals:**
- Fetch student data from datacore instead of legacy backend
- Server-side filtering by all base fields, with fuzzy address matching
- Server-side sorting with default `last_name ASC`
- Adaptive page sizing (default 20, configurable 10-50 in steps of 10)
- Column visibility toggle with base-first ordering
- Per-user table preferences persisted in localStorage
- Highlighted newly-added row pinned to top until navigation or sort change

**Non-Goals:**
- Removing the legacy `localhost:8080` backend (other pages may still use it)
- Full-text search across all fields (only base fields are searchable)
- Inline editing of student records
- Export/batch operations (existing buttons remain stubs)
- Server-side fuzzy search infrastructure beyond DuckDB `LIKE`/`ILIKE` — address fuzzy matching uses SQL `ILIKE '%term%'` which is sufficient for city/state substring matching

## Decisions

### 1. Datacore query endpoint design

**Decision**: Add `GET /api/entities/{tenant_id}/{entity_type}/query` with query params for filters, sort, pagination. Return `{ data: [...], total: int }`. Each item in `data` is a flat object with all base_data and custom_fields flattened to top-level keys, plus `entity_id`, `_status`, `_version`. The endpoint MUST also filter by `entity_type` in the WHERE clause since the entities table is shared across entity types.

**Why**: Keeps the REST API simple. Query params map naturally to DuckDB WHERE/ORDER BY clauses. The existing `QueryEngine.query()` already handles SQL execution with pagination and total count. Flat response matches QueryEngine's natural output — no restructuring needed.

**Alternatives considered**:
- POST with JSON body for complex filters — overkill for field-level equality/LIKE filters
- GraphQL — not justified for a single query pattern

**Filter params**: `_status`, `first_name`, `last_name`, `student_id`, `email`, `grade_level`, `gender`, `address` (fuzzy). All optional. Equality match by default; `address` uses `ILIKE '%term%'` across address-related columns.

**Sort params**: `sort_by` (column name, default `last_name`), `sort_dir` (`asc`|`desc`, default `asc`).

**Pagination params**: `limit` (default 20, max 50), `offset` (default 0).

### 2. Fuzzy address search

**Decision**: Use DuckDB `ILIKE '%term%'` across `address`, `city`, `state`, `zip` columns (OR condition).

**Why**: DuckDB ILIKE is fast enough for the data volumes here (< 10k records per tenant). No need for trigram indexes or external search engines.

**Alternatives considered**:
- DuckDB `jaro_winkler_similarity` — more accurate but slower and complex to configure thresholds
- External search service (Meilisearch) — too much infrastructure for this use case

### 3. Model definition caching via ModelContext

**Decision**: Create a `ModelContext` React context that fetches and caches model definitions per entity type. The model is fetched once on first access within a login session and cached in memory. On logout (AuthContext clears), the context resets. Components (StudentsPage, AddStudentPage) read from ModelContext instead of calling `fetchStudentModel` directly.

**Why**: Prevents mid-session model changes from causing inconsistencies. Avoids redundant API calls across components. sessionStorage was considered but adds serialization overhead; in-memory context clears naturally on logout/page reload.

**Column ordering**: The cached `ModelDefinition` provides ordered `base_fields[]` and `custom_fields[]` arrays. The frontend uses these to determine column order (base first, then custom, each group in model-definition order) and to distinguish base vs custom for display purposes.

### 4. Column visibility and preference storage

**Decision**: Store preferences in localStorage under key `admindash_table_prefs_{user_id}_{tenant_id}` as JSON. Schema: `{ hiddenColumns: string[], pageSize: number, sortBy: string, sortDir: string }`. The `user_id` is read from AuthContext (`useAuth().user.user_id`).

**Why**: Simple, no backend needed, scoped per user+tenant. Falls back to defaults when cleared.

**Alternatives considered**:
- sessionStorage — doesn't persist across browser sessions
- Backend preference store — overhead not justified for table display settings

### 5. Newly-added student highlighting


**Decision**: After `createStudent` returns, store the new entity's `entity_id` in StudentsPage component state (passed via router state from AddStudentPage). The newly-added row is prepended to the data array and rendered with a CSS highlight class. The highlight and pinning clear when: (a) user navigates away from StudentsPage, or (b) user changes the sort field.

**Why**: Client-side approach avoids polluting the API with "newest first" logic. Router state is the standard React Router mechanism for passing data between navigations.

**Alternatives considered**:
- URL query param `?highlight=id` — visible in URL, bookmarkable (undesirable)
- Global context/store — overkill for a single transient value

### 6. DataTable enhancements vs. new component

**Decision**: Enhance the existing DataTable component with optional props: `sortBy`, `sortDir`, `onSortChange`, `pageSizeOptions`, `onPageSizeChange`, `hiddenColumns`, `onToggleColumn`, `rowClassName`. All optional to maintain backward compatibility.

**Why**: DataTable is already used by StudentsPage and potentially other pages. Adding optional props keeps it generic without breaking existing usage.

## Risks / Trade-offs

- **DuckDB SQL injection via filter params** → Build WHERE clause with parameterized values, never interpolate user input directly into SQL strings
- **Address fuzzy search is substring-only** → Users expecting typo-tolerant search may be surprised. Acceptable for MVP; can add Levenshtein/trigram later
- **localStorage preferences can diverge from model changes** → If model definition adds/removes fields, hidden column list may reference stale names. On load, filter out any hiddenColumns entries that don't exist in current column set
- **Large page sizes (50) may slow rendering** → DataTable already handles this reasonably; no virtual scrolling needed at 50 rows
