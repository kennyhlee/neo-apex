## 1. User & Tenant Storage Layer

- [ ] 1.1 Create `app/storage/user_store.py` with LanceDB-backed user CRUD (create, get_by_email, get_by_id, list_by_tenant, update, delete) and bcrypt password hashing
- [ ] 1.2 Create `app/storage/tenant_store.py` with LanceDB-backed tenant CRUD (create, get_by_id, update) using domain.py Tenant fields
- [ ] 1.3 Update `app/config.py` to add `PAPERMITE_SEED_TEST_USERS` setting and seed logic from test_user.json on startup when store is empty

## 2. Registration & Auth Updates

- [ ] 2.1 Add `POST /api/register` endpoint in `app/api/auth.py` — accepts name, email, password, tenant_name; creates tenant + admin user atomically; returns JWT
- [ ] 2.2 Update `POST /api/login` to authenticate against user_store instead of test_user.json (with backward compat for seeded users)
- [ ] 2.3 Update `get_current_user` dependency to look up users from user_store
- [ ] 2.4 Refactor `require_admin` to `require_role(*roles)` supporting admin/staff/teacher/parent roles

## 3. Tenant Profile API

- [ ] 3.1 Add `GET /api/tenants/{tenant_id}` endpoint returning tenant profile fields
- [ ] 3.2 Add `PUT /api/tenants/{tenant_id}` endpoint for admin-only tenant profile updates (tenant name immutable, display_name editable)
- [ ] 3.3 Register new tenant routes in `app/main.py`

## 4. User Management API

- [ ] 4.1 Add `GET /api/tenants/{tenant_id}/users` endpoint (admin-only, list users)
- [ ] 4.2 Add `POST /api/tenants/{tenant_id}/users` endpoint (admin-only, create user with role)
- [ ] 4.3 Add `PUT /api/tenants/{tenant_id}/users/{user_id}` endpoint (admin-only, update role/name, last-admin guard)
- [ ] 4.4 Add `DELETE /api/tenants/{tenant_id}/users/{user_id}` endpoint (admin-only, last-admin guard)
- [ ] 4.5 Create `app/api/users.py` route file and register in `app/main.py`

## 5. Onboarding Status API

- [ ] 5.1 Add onboarding status fields to tenant record (steps array with completion flags, `onboarding_complete` boolean — gates all app access)
- [ ] 5.2 Add `GET /api/tenants/{tenant_id}/onboarding-status` endpoint
- [ ] 5.3 Add `POST /api/tenants/{tenant_id}/onboarding-status` endpoint to mark steps complete

## 6. Frontend — Registration Page

- [ ] 6.1 Create `SignupPage.tsx` with form: name, email, password, tenant name; calls `POST /api/register`
- [ ] 6.2 Add `/signup` route in `App.tsx`
- [ ] 6.3 Add "Sign up" link to `LoginPage.tsx`
- [ ] 6.4 Add `register()` function to `api/client.ts`

## 7. Frontend — Onboarding Wizard

- [ ] 7.1 Create `OnboardingPage.tsx` with stepper UI showing "Set Up Model" and "Tenant Details" steps
- [ ] 7.2 Implement model setup step — link to existing upload flow with return-to-onboarding callback
- [ ] 7.3 Implement tenant details step — form with Tenant fields, calls `PUT /api/tenants/{tenant_id}`
- [ ] 7.4 Add `/onboard` route in `App.tsx` with redirect logic for incomplete onboarding
- [ ] 7.5 Add onboarding status API calls to `api/client.ts`

## 8. Frontend — Tenant Profile & User Management Pages

- [ ] 8.1 Create `TenantSettingsPage.tsx` at `/settings/tenant` — editable form for admins, read-only for others
- [ ] 8.2 Create `UserManagementPage.tsx` at `/settings/users` — user table with add/edit-role/remove actions (admin-only)
- [ ] 8.3 Add user management API calls to `api/client.ts`
- [ ] 8.4 Add settings routes in `App.tsx`

## 9. Frontend — Role-Based Route Protection

- [ ] 9.1 Add onboarding gate in `App.tsx` — block all routes (redirect to `/onboard`) until `onboarding_complete` is true; non-admin users see "setup pending" page
- [ ] 9.2 Update `App.tsx` to pass user role to route guards — redirect non-admins from admin-only pages (model management, user management, upload)
- [ ] 9.3 Update navigation to show/hide links based on role (admin: all, staff: tenant info read-only, teacher/parent: minimal)

## 10. Integration & Testing

- [ ] 10.1 Test full registration → onboarding → model setup → tenant details flow end-to-end
- [ ] 10.2 Verify existing test_user.json login still works with seed mechanism
- [ ] 10.3 Verify role-based access control across all API endpoints and frontend routes
