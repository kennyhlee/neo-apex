## MODIFIED Requirements

### Requirement: Credential Authentication

Users must authenticate with email and password against the user store before accessing the application. The user store includes both database-persisted users and (in development) test_user.json seeded users.

#### Scenario: Valid credentials with tenant_admin role

- **WHEN** a user submits email and password that match a user in the user store
- **AND** the matched user has role `admin`
- **THEN** the backend returns a JWT token containing user_id, tenant_id, and role
- **AND** the frontend stores the token in localStorage
- **AND** if the user's tenant onboarding is incomplete, the user is redirected to the onboarding wizard
- **AND** if onboarding is complete, the user is redirected to the landing page

#### Scenario: Valid credentials with non-admin role

- **WHEN** a user submits email and password that match a user in the user store
- **AND** the matched user has role `staff`, `teacher`, or `parent`
- **THEN** the backend returns a JWT token containing user_id, tenant_id, and role
- **AND** the frontend stores the token in localStorage
- **AND** if the tenant's onboarding is not complete, the user sees a "setup pending" message
- **AND** if onboarding is complete, the user is redirected to the landing page

#### Scenario: Invalid credentials

- **WHEN** a user submits email and password that do not match any user
- **THEN** the backend returns HTTP 401 with message "Invalid credentials"

## ADDED Requirements

### Requirement: Registration link on login page

The login page SHALL include a navigation link to the registration page.

#### Scenario: User navigates to registration
- **WHEN** a user views the login page
- **THEN** a "Don't have an account? Sign up" link is displayed below the login form
- **AND** clicking it navigates to `/signup`
