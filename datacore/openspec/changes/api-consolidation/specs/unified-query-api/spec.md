## ADDED Requirements

### Requirement: Unified query endpoint with DuckDB SQL

DataCore exposes `POST /api/query` that accepts DuckDB SQL for reading tenant, model, and entity data.

#### Scenario: Query entities with SQL
- **WHEN** `POST /api/query` with `{"tenant_id": "acme", "table": "entities", "sql": "SELECT * FROM data WHERE entity_type = 'student' AND _status = 'active' ORDER BY last_name LIMIT 10"}`
- **THEN** return `{"data": [...], "total": N}` with matching records

#### Scenario: Query entities with no results
- **WHEN** SQL matches no records
- **THEN** return `{"data": [], "total": 0}`

#### Scenario: Query tenant
- **WHEN** `POST /api/query` with `{"tenant_id": "acme", "table": "tenants", "sql": "SELECT * FROM data WHERE entity_type = 'tenant' AND _status = 'active'"}`
- **THEN** return tenant entity data

#### Scenario: Query active models
- **WHEN** `POST /api/query` with `{"tenant_id": "acme", "table": "models", "sql": "SELECT * FROM data WHERE _status = 'active'"}`
- **THEN** return all active model records for the tenant

#### Scenario: Query models filtered by entity type
- **WHEN** `POST /api/query` with `{"tenant_id": "acme", "table": "models", "sql": "SELECT * FROM data WHERE entity_type = 'student' AND _status = 'active'"}`
- **THEN** return the model record for that entity type

#### Scenario: Table not found
- **WHEN** tenant has no data for the specified table
- **THEN** return `{"data": [], "total": 0}`

#### Scenario: Invalid table name
- **WHEN** `table` is not one of `entities`, `models`, `tenants`
- **THEN** return 422

#### Scenario: Missing required fields
- **WHEN** `tenant_id`, `table`, or `sql` is missing
- **THEN** return 422

#### Scenario: SQL error
- **WHEN** SQL is malformed or references non-existent columns
- **THEN** return 400 with error detail
