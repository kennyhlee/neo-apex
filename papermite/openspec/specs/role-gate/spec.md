# Spec: Role Gate

## Purpose

Access control enforcement ensuring only authenticated users with appropriate roles can access the application's API routes and frontend pages.

## Requirements

### Requirement: API Route Protection

All API routes (except `POST /api/login` and `POST /api/register`) require a valid JWT. Route access is determined by role.

#### Scenario: Request with valid admin token

- **WHEN** an API request includes `Authorization: Bearer <valid_token>`
- **AND** the token's role is `admin`
- **THEN** the request proceeds normally for all routes
- **AND** the user's tenant_id is extracted from the token for tenant scoping

#### Scenario: Request with valid staff token

- **WHEN** an API request includes `Authorization: Bearer <valid_token>`
- **AND** the token's role is `staff`
- **THEN** tenant info read routes proceed (`GET /api/tenants/{tenant_id}`)
- **AND** model management routes return HTTP 403 (upload, extraction, finalize, schema)
- **AND** user management routes return HTTP 403
- **AND** tenant profile update routes return HTTP 403

#### Scenario: Request with valid teacher token

- **WHEN** an API request includes `Authorization: Bearer <valid_token>`
- **AND** the token's role is `teacher`
- **THEN** all Papermite routes return HTTP 403 except `GET /api/me`
- **AND** teacher permissions apply only in downstream apps (admindash)

#### Scenario: Request with valid parent token

- **WHEN** an API request includes `Authorization: Bearer <valid_token>`
- **AND** the token's role is `parent`
- **THEN** all Papermite routes return HTTP 403 except `GET /api/me`
- **AND** parent permissions apply only in downstream apps (familyhub)

#### Scenario: Request with no token

- **WHEN** an API request has no Authorization header
- **THEN** the backend returns HTTP 401

#### Scenario: Request with expired token

- **WHEN** an API request includes an expired JWT
- **THEN** the backend returns HTTP 401

### Requirement: Frontend route protection by role

The frontend SHALL restrict page access based on the authenticated user's role.

#### Scenario: Non-admin accessing admin-only pages

- **WHEN** a staff, teacher, or parent user navigates to `/settings/users`, `/upload`, `/review`, or `/finalize`
- **THEN** the user is redirected to the landing page

#### Scenario: Staff accessing tenant info page

- **WHEN** a staff user navigates to `/settings/tenant`
- **THEN** the page renders in read-only mode (no edit controls)

#### Scenario: Teacher or parent accessing Papermite pages

- **WHEN** a teacher or parent user logs into Papermite
- **THEN** they see only a minimal landing page with no model management or tenant settings access
