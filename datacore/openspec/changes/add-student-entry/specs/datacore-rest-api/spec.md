## ADDED Requirements

### Requirement: GET model definition endpoint
The datacore API SHALL expose `GET /api/models/{tenant_id}/{entity_type}` to return the active model definition.

#### Scenario: Model exists
- **WHEN** a GET request is made with a valid tenant_id and entity_type
- **THEN** the API returns HTTP 200 with the active model definition as JSON

#### Scenario: Model not found
- **WHEN** no active model exists for the given tenant and entity type
- **THEN** the API returns HTTP 404 with an error message

### Requirement: POST entity creation endpoint
The datacore API SHALL expose `POST /api/entities/{tenant_id}/{entity_type}` to create a new entity record. This is strictly a storage endpoint — no extraction or business logic.

#### Scenario: Successful entity creation
- **WHEN** a POST request is made with valid `base_data` and optional `custom_fields`
- **THEN** the API generates a UUID `entity_id`, calls `Store.put_entity()`, and returns HTTP 201 with the created entity record including the generated `entity_id`

#### Scenario: Tenant table auto-creation
- **WHEN** a POST request targets a tenant that has no entities table yet
- **THEN** the datacore Store auto-creates the `{tenant_id}_entities` table (existing behavior via `_open_or_create`)

### Requirement: CORS configuration
The datacore API SHALL configure CORS to allow requests from the admindash frontend origin (`http://localhost:5174`) and papermite frontend origin (`http://localhost:5173`).

#### Scenario: Cross-origin request from admindash
- **WHEN** the admindash frontend makes a request to the datacore API
- **THEN** the response includes appropriate CORS headers allowing the request
