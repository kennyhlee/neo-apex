## ADDED Requirements

### Requirement: Registration page
The system SHALL provide a registration page at `/signup` where a new user can create a tenant and their first admin account.

#### Scenario: Successful registration
- **WHEN** a user submits the registration form with valid name, email, password, and tenant name
- **THEN** the backend creates a new tenant record and a user record with role `admin`
- **AND** the password is stored hashed with bcrypt
- **AND** the user is automatically logged in (JWT issued)
- **AND** the user is redirected to the onboarding wizard

#### Scenario: Duplicate email
- **WHEN** a user submits a registration form with an email that already exists in the user store
- **THEN** the backend returns HTTP 409 with message "Email already registered"
- **AND** the form displays the error without clearing other fields

#### Scenario: Missing required fields
- **WHEN** a user submits the registration form with any required field empty
- **THEN** the frontend validates and shows inline errors before submitting to the backend

### Requirement: Registration API endpoint
The backend SHALL expose `POST /api/register` to create a tenant and first admin user atomically.

#### Scenario: Successful registration request
- **WHEN** the endpoint receives `{ name, email, password, tenant_name }`
- **THEN** it creates a tenant with a generated `tenant_id` (kebab-case from tenant_name)
- **AND** creates a user with `role: "admin"`, linking to the new tenant
- **AND** returns `{ token, user: { user_id, name, email, tenant_id, tenant_name, role } }`

#### Scenario: Tenant ID collision
- **WHEN** the generated `tenant_id` already exists in the store
- **THEN** the backend appends a numeric suffix to make it unique (e.g., `acme-2`)

### Requirement: Registration link on login page
The login page SHALL include a link to the registration page.

#### Scenario: Navigation from login to signup
- **WHEN** a user views the login page
- **THEN** a "Sign up" link is visible below the login form
- **AND** clicking it navigates to `/signup`
