# Spec: Login

## Purpose

Authentication flow for users to log in with email and password credentials against the test user database.

## Requirements

### Requirement: Credential Authentication

Users must authenticate with email and password against the test user database before accessing the application.

#### Scenario: Valid credentials with tenant_admin role

- **WHEN** a user submits email and password that match a user in test_user.json
- **AND** the matched user has role `tenant_admin`
- **THEN** the backend returns a JWT token containing user_id, tenant_id, and role
- **AND** the frontend stores the token in localStorage
- **AND** the user is redirected to the landing page

#### Scenario: Valid credentials with non-admin role

- **WHEN** a user submits email and password that match a user in test_user.json
- **AND** the matched user does NOT have role `tenant_admin`
- **THEN** the backend returns a JWT token
- **AND** the frontend shows an "Access Denied" screen explaining tenant_admin role is required
- **AND** a logout option is available to return to the login page

#### Scenario: Invalid credentials

- **WHEN** a user submits email and password that do NOT match any user
- **THEN** the backend returns 401 Unauthorized
- **AND** the login form shows an error message "Invalid email or password"
- **AND** the password field is cleared

#### Scenario: Empty form submission

- **WHEN** a user clicks login with empty email or password
- **THEN** the form shows validation errors
- **AND** no API call is made

### Requirement: Multi-User Test Config

test_user.json supports multiple user accounts for testing different roles and tenants.

#### Scenario: Config structure

- **WHEN** the application loads test_user.json
- **THEN** it reads a `users` array where each entry has: user_id, name, email, password, tenant_id, tenant_name, role
