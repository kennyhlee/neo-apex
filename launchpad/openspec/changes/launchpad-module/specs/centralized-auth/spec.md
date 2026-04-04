## ADDED Requirements

### Requirement: Login endpoint
The backend SHALL expose `POST /api/login` accepting email and password, returning a JWT on success.

#### Scenario: Valid credentials
- **WHEN** a user submits email and password that match a user in the store
- **THEN** the backend returns `{ token, user: { user_id, name, email, tenant_id, tenant_name, role } }`
- **AND** the JWT payload contains `{ user_id, email, tenant_id, role, exp }`
- **AND** the token expires after 24 hours

#### Scenario: Invalid credentials
- **WHEN** a user submits email and password that do not match any user
- **THEN** the backend returns HTTP 401 with message "Invalid credentials"

### Requirement: Current user endpoint
The backend SHALL expose `GET /api/me` returning the authenticated user's profile.

#### Scenario: Valid token
- **WHEN** a request includes a valid JWT in the Authorization header
- **THEN** the backend returns `{ user_id, name, email, tenant_id, tenant_name, role }`

#### Scenario: Invalid or expired token
- **WHEN** a request includes an invalid or expired JWT
- **THEN** the backend returns HTTP 401

### Requirement: JWT validation shared across NeoApex
All NeoApex modules SHALL validate Launchpad-issued JWTs using the shared secret `NEOAPEX_JWT_SECRET`.

#### Scenario: Papermite validates a Launchpad JWT
- **WHEN** Papermite receives a request with a JWT issued by Launchpad
- **AND** the JWT is valid and the role is `admin`
- **THEN** Papermite allows the request and extracts tenant_id and role from the token

#### Scenario: Non-admin JWT used against Papermite
- **WHEN** Papermite receives a request with a valid JWT where role is not `admin`
- **THEN** Papermite returns HTTP 403

### Requirement: Login page
The frontend SHALL provide a login page as the default unauthenticated view.

#### Scenario: Successful login for admin with incomplete onboarding
- **WHEN** an admin logs in successfully and tenant onboarding is not complete
- **THEN** the user is redirected to the onboarding wizard at `/onboard`

#### Scenario: Successful login for admin with complete onboarding
- **WHEN** an admin logs in successfully and tenant onboarding is complete
- **THEN** the user is redirected to the landing page

#### Scenario: Successful login for non-admin with incomplete onboarding
- **WHEN** a staff, teacher, or parent logs in and tenant onboarding is not complete
- **THEN** the user sees a "Your admin is setting things up" message

#### Scenario: Successful login for non-admin with complete onboarding
- **WHEN** a staff, teacher, or parent logs in and tenant onboarding is complete
- **THEN** the user is redirected to the landing page

### Requirement: Session persistence
JWT tokens SHALL persist across browser refresh using localStorage.

#### Scenario: Token survives refresh
- **WHEN** an authenticated user refreshes the browser
- **THEN** the app reads the token from localStorage
- **AND** validates it by calling `GET /api/me`
- **AND** the user remains logged in

#### Scenario: Logout clears session
- **WHEN** a user clicks "Log out"
- **THEN** the token is removed from localStorage
- **AND** the user is redirected to the login page
