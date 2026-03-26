## Requirement: SQL Query via DuckDB + Arrow

Datacore exposes LanceDB table data as Arrow tables queryable via DuckDB SQL. Tables are registered under the alias `data` in DuckDB.

### Scenario: Query a table with SQL

- **WHEN** a caller executes a SQL query string against a table type (e.g., `SELECT * FROM data`)
- **THEN** the LanceDB table is loaded as an Arrow table
- **AND** DuckDB executes the SQL against it (table registered as `data`)
- **AND** results are returned as a list of dicts

### Scenario: Query with tenant filter

- **WHEN** a caller provides a tenant_id with a SQL query
- **THEN** the correct tenant-scoped table is loaded (e.g., `t1_entities`)
- **AND** the query runs only against that tenant's data

### Scenario: Query non-existent table

- **WHEN** a caller queries a table that doesn't exist
- **THEN** a clear `TableNotFoundError` is raised (not a crash)

### Scenario: Query custom fields with tenant filter

- **WHEN** a caller executes a SQL query that filters on custom fields (e.g., `SELECT * FROM data WHERE city = 'Springfield'` or `WHERE bus_day = 'tuesday'`)
- **AND** a tenant_id is provided
- **THEN** the query runs against the tenant's data including custom fields stored in the TOON document structure
- **AND** custom fields are flattened into queryable columns as if they were regular columns
- **AND** results are returned as a list of dicts

### Scenario: Aggregate queries with tenant filter

- **WHEN** a caller executes a SQL query with aggregate functions (e.g., `SELECT COUNT(*) FROM data WHERE entity_type = 'student' AND absent_date = '2026-03-22'` or `SELECT bus_day, COUNT(*) FROM data WHERE bus_day = 'tuesday' GROUP BY bus_day`)
- **AND** a tenant_id is provided
- **THEN** DuckDB executes the aggregation against the tenant's data
- **AND** aggregate functions (COUNT, SUM, AVG, MIN, MAX, GROUP BY) work across both base and custom fields
- **AND** results are returned as a list of dicts

### Scenario: Query entity detail by ID with tenant filter

- **WHEN** a caller requests a specific entity by its entity_id (e.g., `SELECT * FROM data WHERE entity_id = 'S12345'`)
- **AND** a tenant_id is provided
- **THEN** the full record is returned including all base model fields and custom fields
- **AND** empty result is returned if the entity doesn't exist within that tenant

### Scenario: Query with pagination (LIMIT/OFFSET)

- **WHEN** a caller provides `limit` and `offset` parameters alongside a SQL query
- **AND** a tenant_id is provided
- **THEN** results are scoped to the tenant and paginated accordingly
- **AND** the total count of matching records (before pagination) is also returned for the caller to determine total pages
