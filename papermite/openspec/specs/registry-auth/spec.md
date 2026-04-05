# Spec: Registry Auth

## Purpose

Authentication against the DataCore global registry table, replacing file-based test_user.json with centralized user lookups via bcrypt-hashed credentials.

## Requirements

### Requirement: Login via registry credentials
Papermite's login endpoint SHALL authenticate users by querying the DataCore global "registry" table for a matching email address and verifying the submitted password against the stored bcrypt hash.

#### Scenario: Successful login with valid credentials
- **WHEN** a user submits a POST to `/api/login` with a valid email and correct password
- **THEN** the system returns HTTP 200 with a JWT access token and the user's profile (user_id, name, email, tenant_id, role) — excluding the password hash

#### Scenario: Login fails for unknown email
- **WHEN** a user submits a POST to `/api/login` with an email not found in the registry table
- **THEN** the system returns HTTP 401 with message "Invalid credentials"

#### Scenario: Login fails for wrong password
- **WHEN** a user submits a POST to `/api/login` with a known email but an incorrect password
- **THEN** the system returns HTTP 401 with message "Invalid credentials"

### Requirement: Registry store reads from DataCore global table
Papermite SHALL include a `RegistryStore` class that queries the DataCore global "registry" table to look up user records by email, mirroring the pattern established in LaunchPad.

#### Scenario: User lookup by email returns matching record
- **WHEN** `RegistryStore.get_user_by_email(email)` is called with an email that exists in the registry
- **THEN** it returns a `UserRecord` with the correct user_id, name, email, password_hash, tenant_id, tenant_name, and role

#### Scenario: User lookup by email returns None for missing user
- **WHEN** `RegistryStore.get_user_by_email(email)` is called with an email that does not exist
- **THEN** it returns None

### Requirement: UserRecord model matches LaunchPad schema
Papermite SHALL use a `UserRecord` model with the same fields as LaunchPad's registry: `user_id`, `name`, `email`, `password_hash`, `tenant_id`, `tenant_name`, `role`, `created_at`.

#### Scenario: JWT token payload includes user identity fields
- **WHEN** a successful login generates a JWT token
- **THEN** the token payload contains `user_id`, `email`, `tenant_id`, and `role`

### Requirement: Remove test_user.json dependency
Papermite SHALL NOT load or reference `test_user.json` at any point during startup or request handling. The `Settings` class MUST NOT have a `test_user_path` field or `load_users()` / `find_user_by_email()` methods that read from a file.

#### Scenario: Application starts without test_user.json present
- **WHEN** Papermite backend starts and `test_user.json` does not exist on disk
- **THEN** the application starts successfully with no errors

#### Scenario: Login does not consult test_user.json
- **WHEN** a login request is made
- **THEN** no file I/O is performed against any JSON user file; all credential lookups go through DataCore
