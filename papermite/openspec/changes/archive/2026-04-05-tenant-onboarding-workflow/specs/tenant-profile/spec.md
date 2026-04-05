## ADDED Requirements

### Requirement: Tenant profile API
The backend SHALL expose CRUD endpoints for tenant profile information scoped to the authenticated user's tenant.

#### Scenario: Get tenant profile
- **WHEN** an authenticated admin calls `GET /api/tenants/{tenant_id}`
- **THEN** the backend returns the tenant's profile fields: name, display_name, contact_email, address, license_number, capacity, accreditation, insurance_provider
- **AND** the tenant_id in the path MUST match the user's tenant_id

#### Scenario: Update tenant profile
- **WHEN** an authenticated admin calls `PUT /api/tenants/{tenant_id}` with updated fields
- **THEN** the backend updates the tenant record with the provided fields (excluding `name` which is immutable)
- **AND** returns the updated tenant profile
- **AND** only admin-role users can update

#### Scenario: Attempt to change tenant name
- **WHEN** an admin calls `PUT /api/tenants/{tenant_id}` with a `name` field
- **THEN** the backend ignores the `name` field (does not update it)
- **AND** all other provided fields are updated normally

#### Scenario: Staff views tenant profile
- **WHEN** a user with role `staff` calls `GET /api/tenants/{tenant_id}`
- **THEN** the backend returns the tenant profile (read-only access granted)

#### Scenario: Staff attempts update
- **WHEN** a user with role `staff` calls `PUT /api/tenants/{tenant_id}`
- **THEN** the backend returns HTTP 403

#### Scenario: Teacher or parent attempts access
- **WHEN** a user with role `teacher` or `parent` calls `GET /api/tenants/{tenant_id}`
- **THEN** the backend returns HTTP 403

### Requirement: Tenant profile page
The frontend SHALL provide a tenant profile page accessible from the navigation.

#### Scenario: Admin views tenant profile
- **WHEN** an admin navigates to `/settings/tenant`
- **THEN** a form displays the current tenant details with all fields editable except tenant name (shown as read-only)
- **AND** a "Save" button persists changes via the update API

#### Scenario: Staff views tenant profile
- **WHEN** a staff user navigates to `/settings/tenant`
- **THEN** the tenant details are displayed in read-only mode
- **AND** no "Save" button is shown

#### Scenario: Teacher or parent cannot access tenant profile
- **WHEN** a teacher or parent navigates to `/settings/tenant`
- **THEN** they are redirected to the landing page
