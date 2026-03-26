## Requirement: Tenant-Scoped Table Management

Datacore manages LanceDB tables scoped by tenant, with automatic schema creation.

### Scenario: Create a new table for a tenant

- **WHEN** a caller stores data to a table that doesn't exist
- **THEN** the table is created with the provided PyArrow schema
- **AND** the record is inserted with tenant_id, timestamps, and version=1

### Scenario: Store a new version of a record

- **WHEN** a caller stores data to an existing table for a tenant
- **THEN** the previous active record is archived
- **AND** a new record is inserted with an incremented version and status="active"

### Scenario: Retrieve active record

- **WHEN** a caller requests the active record for a tenant in a table
- **THEN** the record with status="active" is returned
- **AND** None is returned if no active record exists

### Scenario: List version history

- **WHEN** a caller requests version history for a tenant in a table
- **THEN** all versions are returned ordered by version descending

### Scenario: Model version trimming

- **WHEN** the number of versions for an entity type's model definition exceeds the configured max (default 100)
- **THEN** the oldest archived versions are deleted by timestamp to enforce the limit

### Scenario: Grouped rollback via change_id

- **WHEN** multiple records (model definitions and/or entity records) are updated in the same operation
- **THEN** they share a `change_id`
- **AND** a caller can roll back all changes with the same `change_id` across both models and entities tables to restore previous active versions

### Scenario: Entity version trimming

- **WHEN** the number of versions for a specific entity record exceeds the configured max for that entity type
- **THEN** the oldest version (by timestamp) is deleted
- **AND** the max is configurable per entity type (e.g., student=10, staff=20)
- **AND** if not configured for a specific entity type, defaults to 5
