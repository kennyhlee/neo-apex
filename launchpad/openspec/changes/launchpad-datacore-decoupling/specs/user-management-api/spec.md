## ADDED Requirements

### Requirement: User CRUD API endpoints on DataCore

DataCore exposes REST endpoints for managing user records in the global registry table.

#### Scenario: Query users
- **WHEN** `GET /api/registry/users?tenant_id={tenant_id}` is called
- **THEN** return array of user objects (without `password_hash`) for that tenant
- **WHEN** `GET /api/registry/users?email={email}` is called
- **THEN** return array with the matching user (without `password_hash`), or empty array if not found
- **WHEN** both `tenant_id` and `email` are provided
- **THEN** filter by both

#### Scenario: Create a new user
- **WHEN** `POST /api/registry/users` is called with `{name, email, password, tenant_id, tenant_name, role}`
- **THEN** hash the password with bcrypt, generate `user_id` as `u-{8-hex}`, store in registry table, return user object (without `password_hash`)

#### Scenario: Create user with duplicate email
- **WHEN** `POST /api/registry/users` is called with an email that already exists
- **THEN** return 409 Conflict

#### Scenario: Get user by ID
- **WHEN** `GET /api/registry/users/{user_id}` is called
- **THEN** return user object (without `password_hash`), or 404 if not found

#### Scenario: Update user
- **WHEN** `PUT /api/registry/users/{user_id}` is called with partial fields `{name?, role?}`
- **THEN** merge fields into existing record, return updated user object (without `password_hash`), or 404 if not found

#### Scenario: Delete user
- **WHEN** `DELETE /api/registry/users/{user_id}` is called
- **THEN** delete the user record, return 200, or 404 if not found

### Requirement: Auth routes use registry endpoints internally

DataCore's `auth_routes.py` calls the registry user/onboarding functions instead of duplicating Store access logic.

#### Scenario: Auth login uses registry
- **WHEN** `POST /auth/login` looks up a user by email
- **THEN** it calls the same user query function used by `/api/registry/users?email=`

#### Scenario: Auth registration uses registry
- **WHEN** `POST /auth/register` creates a user and onboarding record
- **THEN** it calls the same create functions used by `/api/registry/users` and `/api/registry/onboarding`
