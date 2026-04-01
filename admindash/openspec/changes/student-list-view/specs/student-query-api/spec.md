## ADDED Requirements

### Requirement: Query endpoint returns paginated student entities
The datacore REST API SHALL expose `GET /api/entities/{tenant_id}/{entity_type}/query` that returns `{ data: [...], total: int }`. Each item in `data` SHALL be a flat object with all base_data and custom_fields flattened to top-level keys, plus `entity_id`, `_status`, and `_version`. The endpoint SHALL filter by `entity_type` in the WHERE clause since the entities table is shared across entity types. The `total` field SHALL reflect the count after filters are applied (before pagination).

#### Scenario: Default query with no params
- **WHEN** client sends `GET /api/entities/acme/student/query` with no query params
- **THEN** response returns students with `_status=active`, sorted by `last_name ASC`, limit 20, offset 0

#### Scenario: Custom pagination
- **WHEN** client sends `GET /api/entities/acme/student/query?limit=10&offset=20`
- **THEN** response returns at most 10 students starting from offset 20, with `total` reflecting all matching records

### Requirement: Status filter defaults to active
The endpoint SHALL accept a `_status` query param. When omitted, it SHALL default to `active`. When set to empty string or `all`, it SHALL return entities of all statuses.

#### Scenario: Default status filter
- **WHEN** client sends query with no `_status` param
- **THEN** only entities with `_status=active` are returned

#### Scenario: Explicit status filter
- **WHEN** client sends `_status=graduated`
- **THEN** only entities with `_status=graduated` are returned

#### Scenario: All statuses
- **WHEN** client sends `_status=all`
- **THEN** entities of all statuses are returned

### Requirement: Sort by any base field
The endpoint SHALL accept `sort_by` (column name, default `last_name`) and `sort_dir` (`asc` or `desc`, default `asc`). The endpoint SHALL validate that `sort_by` references a known column and reject unknown columns with HTTP 400.

#### Scenario: Default sort
- **WHEN** client sends query with no sort params
- **THEN** results are sorted by `last_name` ascending

#### Scenario: Custom sort
- **WHEN** client sends `sort_by=first_name&sort_dir=desc`
- **THEN** results are sorted by `first_name` descending

#### Scenario: Invalid sort column
- **WHEN** client sends `sort_by=nonexistent_column`
- **THEN** endpoint returns HTTP 400 with error message

### Requirement: Filter by base fields
The endpoint SHALL accept query params matching base field names (`first_name`, `last_name`, `student_id`, `email`, `grade_level`, `gender`). Each filter SHALL use case-insensitive substring match (`ILIKE '%value%'`). Multiple filters SHALL be combined with AND.

#### Scenario: Single filter
- **WHEN** client sends `first_name=jan`
- **THEN** only students whose `first_name` contains "jan" (case-insensitive) are returned

#### Scenario: Multiple filters
- **WHEN** client sends `first_name=jan&grade_level=Grade 5`
- **THEN** only students matching both conditions are returned

### Requirement: Fuzzy address search
The endpoint SHALL accept an `address` query param that searches across address-related columns (`address`, `city`, `state`, `zip`) using `ILIKE '%value%'` with OR logic. If none of these columns exist in the data, the filter SHALL be silently ignored.

#### Scenario: Address search matches city
- **WHEN** client sends `address=springfield`
- **THEN** students with "springfield" in any of `address`, `city`, `state`, or `zip` columns are returned

#### Scenario: Address columns not present
- **WHEN** client sends `address=springfield` but no address-related columns exist in data
- **THEN** the filter is ignored and all students (matching other filters) are returned

### Requirement: Pagination limit bounds
The endpoint SHALL enforce `limit` between 1 and 50. Values above 50 SHALL be clamped to 50. Values below 1 SHALL default to 20.

#### Scenario: Limit exceeds max
- **WHEN** client sends `limit=100`
- **THEN** response returns at most 50 records

#### Scenario: Limit below minimum
- **WHEN** client sends `limit=0`
- **THEN** response uses default limit of 20
