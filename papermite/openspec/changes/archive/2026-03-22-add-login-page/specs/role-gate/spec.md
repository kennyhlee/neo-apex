# Spec: Role Gate

## ADDED Requirements

### Requirement: API Route Protection

All API routes (except POST /login) require a valid JWT with tenant_admin role.

#### Scenario: Request with valid admin token

- **WHEN** an API request includes `Authorization: Bearer <valid_token>`
- **AND** the token's role is `tenant_admin`
- **THEN** the request proceeds normally
- **AND** the user's tenant_id is extracted from the token for tenant scoping

#### Scenario: Request with no token

- **WHEN** an API request has no Authorization header
- **THEN** the backend returns 401 Unauthorized

#### Scenario: Request with non-admin token

- **WHEN** an API request includes a valid token but role is not `tenant_admin`
- **THEN** the backend returns 403 Forbidden with detail "Requires tenant_admin role"

### Requirement: Frontend Route Protection

All app pages are protected; unauthenticated users see the login page.

#### Scenario: Unauthenticated user navigates to any page

- **WHEN** a user with no token navigates to /, /upload, /review/:id, or /finalize/:id
- **THEN** they are redirected to the login page

#### Scenario: Authenticated non-admin user

- **WHEN** a user with a valid token but non-admin role accesses the app
- **THEN** they see an "Access Denied" screen with the option to log out
