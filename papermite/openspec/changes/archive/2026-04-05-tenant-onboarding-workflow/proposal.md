## Why

Papermite currently relies on a hardcoded `test_user.json` for authentication — there is no way for a new tenant to sign up, create their first admin user, or manage additional users. Before Floatify can onboard real customers, Papermite needs a self-service tenant onboarding flow that guides new users from sign-up through model setup and tenant configuration.

## What Changes

- **Tenant sign-up flow**: New users can register, which creates a tenant and the first tenant admin user — replacing the hardcoded test_user.json approach for new tenants.
- **Onboarding guided experience**: After sign-up, the tenant admin is walked through a step-by-step setup: (1) upload documents to define the data model (existing), (2) enter tenant details (name, license, capacity, accreditation, insurance, contact info).
- **User management**: Tenant admins can invite and manage users with different roles (admin, staff, teacher, parent) within their tenant.
- **Tenant profile management**: Tenant admins can view and edit tenant information (except immutable tenant name). Staff can view tenant info read-only. Teacher and parent have no access.
- **Auth system evolution**: The login spec and role-gate spec remain intact for existing users, but the auth backend gains a registration endpoint and user storage beyond test_user.json.
- **Onboarding gate**: Users cannot access the landing page or app features until the tenant admin completes onboarding. Non-admin users see a "setup pending" message if onboarding is incomplete.

## Capabilities

### New Capabilities
- `tenant-signup`: Self-service registration flow — create tenant + first admin user, email/password credentials, tenant name input.
- `onboarding-wizard`: Post-signup guided setup experience — stepper UI that walks the admin through model setup (existing upload flow) and tenant details entry, with progress tracking and skip/resume support.
- `tenant-profile`: Tenant details entry and management — form for license number, capacity, accreditation, insurance provider, contact info; viewable and editable by tenant admins.
- `user-management`: Tenant admin can add, list, and manage users with role assignments (admin, staff, teacher, parent) within their tenant.

### Modified Capabilities
- `login`: Registration link added to login page; post-login redirects to onboarding wizard if setup is incomplete instead of landing page.
- `role-gate`: New roles (staff, teacher, parent) need route-level access control. Only admin can access model management. Staff can view tenant info. Teacher and parent have minimal Papermite access.

## Impact

- **Backend**: New API routes for registration, tenant profile CRUD, user management. User storage needs to move beyond test_user.json (database or file-based store). JWT payload may need updates for new roles.
- **Frontend**: New pages for sign-up, onboarding wizard, tenant profile form, user management. App.tsx routing updates. Login page gains registration link.
- **Existing specs**: `login` gains a registration entry point. `role-gate` expands to handle staff/viewer roles with appropriate permission levels.
- **Cross-project**: Other NeoApex modules (admindash, familyhub) will eventually consume the user/role data — but that's out of scope for this change.
