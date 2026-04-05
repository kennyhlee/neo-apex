# Spec: User Management

## Purpose

Admin-only CRUD operations for managing tenant users, including listing, adding, updating roles, and removing users.

## Requirements

### Requirement: User listing API
The backend SHALL expose `GET /api/tenants/{tenant_id}/users` to list all users belonging to the tenant.

#### Scenario: Admin lists users
- **WHEN** an authenticated admin calls `GET /api/tenants/{tenant_id}/users`
- **THEN** the backend returns an array of user objects with user_id, name, email, role, created_at
- **AND** passwords are never included in the response

#### Scenario: Non-admin attempts to list users
- **WHEN** a staff or viewer user calls `GET /api/tenants/{tenant_id}/users`
- **THEN** the backend returns HTTP 403

### Requirement: Add user API
The backend SHALL expose `POST /api/tenants/{tenant_id}/users` to create a new user within the tenant.

#### Scenario: Admin adds a new user
- **WHEN** an authenticated admin calls `POST /api/tenants/{tenant_id}/users` with `{ name, email, password, role }`
- **THEN** the backend creates the user with the specified role and tenant_id
- **AND** the password is stored hashed with bcrypt
- **AND** returns the created user (without password)

#### Scenario: Duplicate email within tenant
- **WHEN** the admin tries to add a user with an email that already exists
- **THEN** the backend returns HTTP 409 with message "Email already registered"

#### Scenario: Invalid role
- **WHEN** the admin provides a role not in `["admin", "staff", "teacher", "parent"]`
- **THEN** the backend returns HTTP 422

### Requirement: Update user role API
The backend SHALL expose `PUT /api/tenants/{tenant_id}/users/{user_id}` to update a user's role or name.

#### Scenario: Admin updates a user's role
- **WHEN** an admin calls `PUT /api/tenants/{tenant_id}/users/{user_id}` with `{ role: "staff" }`
- **THEN** the user's role is updated
- **AND** the updated user is returned

#### Scenario: Admin cannot demote themselves
- **WHEN** an admin tries to change their own role to a non-admin role
- **AND** they are the only admin in the tenant
- **THEN** the backend returns HTTP 400 with message "Cannot remove the last admin"

### Requirement: Remove user API
The backend SHALL expose `DELETE /api/tenants/{tenant_id}/users/{user_id}` to remove a user from the tenant.

#### Scenario: Admin removes a user
- **WHEN** an admin calls `DELETE /api/tenants/{tenant_id}/users/{user_id}`
- **THEN** the user record is deleted
- **AND** returns HTTP 204

#### Scenario: Admin cannot delete themselves if last admin
- **WHEN** an admin tries to delete themselves and they are the only admin
- **THEN** the backend returns HTTP 400 with message "Cannot remove the last admin"

### Requirement: User management page
The frontend SHALL provide a user management page accessible to tenant admins.

#### Scenario: Admin views user list
- **WHEN** an admin navigates to `/settings/users`
- **THEN** a table displays all tenant users with name, email, role, and actions (edit role, remove)

#### Scenario: Admin adds a user via UI
- **WHEN** an admin clicks "Add User" and fills in the form with name, email, password, and role
- **THEN** the new user is created via the API and appears in the table

#### Scenario: Non-admin cannot access user management
- **WHEN** a staff or viewer user navigates to `/settings/users`
- **THEN** they are redirected to the landing page or shown an access denied message
