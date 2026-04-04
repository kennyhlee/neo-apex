## 0. Datacore Extension — Global Table Support

- [ ] 0.1 Extend datacore Store API with global table methods: `put_global(table_name, record_key, data)`, `get_global(table_name, record_key)`, `query_global(table_name, filters)`, `delete_global(table_name, record_key)`
- [ ] 0.2 Add `registry` table schema to datacore — fields: `record_type` (user/onboarding), `record_key`, `data` (TOON-encoded), metadata fields (`_created_at`, `_updated_at`)
- [ ] 0.3 Test global table CRUD operations in datacore

## 1. Project Scaffolding

- [ ] 1.1 Create `launchpad/` project structure: `backend/app/{api,models,storage,config.py,main.py}`, `frontend/`, `pyproject.toml`, `test_user.json`
- [ ] 1.2 Set up FastAPI app in `main.py` with CORS, route registration, and startup config
- [ ] 1.3 Create `NeoApex/ui-tokens/` shared style package — design tokens (colors, typography, spacing, shadows, border radii) extracted from Papermite's existing theme spec
- [ ] 1.4 Set up React + Vite + TypeScript frontend with React Router, importing `@neoapex/ui-tokens`
- [ ] 1.5 Create `app/config.py` with settings: `NEOAPEX_JWT_SECRET`, `jwt_expiry_hours`, `datacore_store_path`, `PAPERMITE_URL`, port 8001

## 2. Storage Layer

- [ ] 2.1 Create `app/storage/registry_store.py` — datacore-backed CRUD for the global `registry` table: users (with bcrypt passwords, roles, tenant_id) and per-tenant onboarding status
- [ ] 2.2 Create `app/storage/tenant_entity_store.py` — read/write Tenant entity records in `{tenant_id}_entities` via datacore (tenant profile data)
- [ ] 2.3 Create `app/storage/model_store.py` — read Tenant model definition from `{tenant_id}_models` via datacore, return field schema for dynamic form rendering
- [ ] 2.4 Create `app/models/registry.py` — Pydantic models for user and onboarding status records
- [ ] 2.5 Create `app/models/tenant.py` — Pydantic models for tenant profile (maps to Tenant entity)

## 3. Centralized Auth API

- [ ] 3.1 Add `POST /api/login` endpoint — authenticate against user_store, return JWT
- [ ] 3.2 Add `POST /api/register` endpoint — atomic tenant + admin user creation, return JWT
- [ ] 3.3 Add `GET /api/me` endpoint — return current user profile from JWT
- [ ] 3.4 Create `get_current_user` and `require_role(*roles)` FastAPI dependencies
- [ ] 3.5 Register auth routes in `main.py`

## 4. Tenant Profile API

- [ ] 4.1 Add `GET /api/tenants/{tenant_id}` endpoint — admin and staff can read, teacher/parent get 403
- [ ] 4.2 Add `PUT /api/tenants/{tenant_id}` endpoint — admin-only, ignores `name` field
- [ ] 4.3 Create `app/api/tenants.py` route file and register in `main.py`

## 5. User Management API

- [ ] 5.1 Add `GET /api/tenants/{tenant_id}/users` endpoint (admin-only)
- [ ] 5.2 Add `POST /api/tenants/{tenant_id}/users` endpoint (admin-only, role validation, bcrypt)
- [ ] 5.3 Add `PUT /api/tenants/{tenant_id}/users/{user_id}` endpoint (admin-only, last-admin guard)
- [ ] 5.4 Add `DELETE /api/tenants/{tenant_id}/users/{user_id}` endpoint (admin-only, last-admin guard)
- [ ] 5.5 Create `app/api/users.py` route file and register in `main.py`

## 6. Onboarding Status API

- [ ] 6.1 Add `GET /api/tenants/{tenant_id}/onboarding-status` endpoint
- [ ] 6.2 Add `POST /api/tenants/{tenant_id}/onboarding-status` endpoint — mark steps complete, set `onboarding_complete` when all done

## 7. Frontend — Dynamic Form Components

- [ ] 7.1 Create `api/modelClient.ts` — fetch Tenant model definition from backend (which reads datacore)
- [ ] 7.2 Create `components/DynamicEntityForm.tsx` — renders form fields from model definition with type-aware inputs (text, number, date, email, phone, boolean toggle, selection dropdown/multi-select)
- [ ] 7.3 Create `components/FieldInput.tsx` — individual field input component handling all field types from the model type system (str, number, bool, date, datetime, email, phone, selection)
- [ ] 7.4 Add `GET /api/tenants/{tenant_id}/model` backend endpoint — returns Tenant entity model definition from datacore

## 8. Frontend — Login & Registration

- [ ] 8.1 Create `LoginPage.tsx` — email/password form, "Sign up" link
- [ ] 8.2 Create `SignupPage.tsx` — name, email, password, tenant name form; calls `POST /api/register`
- [ ] 8.3 Create `api/client.ts` — login, register, getCurrentUser, authFetch helper
- [ ] 8.4 Add routes in `App.tsx`: `/login`, `/signup`

## 9. Frontend — Onboarding Wizard

- [ ] 9.1 Create `OnboardingPage.tsx` — stepper UI with "Set Up Model" and "Tenant Details" steps
- [ ] 9.2 Implement model setup step — redirect to Papermite upload page with return URL
- [ ] 9.3 Implement tenant details step — read Tenant model definition from datacore, render dynamic form with type-aware inputs (text, number, date, selection, etc.), calls `PUT /api/tenants/{tenant_id}`. Only accessible after model setup is complete.
- [ ] 9.4 Add onboarding status API calls to `api/client.ts`
- [ ] 9.5 Add `/onboard` route with onboarding gate logic in `App.tsx`

## 10. Frontend — Tenant Profile & User Management

- [ ] 10.1 Create `TenantSettingsPage.tsx` at `/settings/tenant` — reads Tenant model definition, renders dynamic form (editable for admin, read-only for staff)
- [ ] 10.2 Create `UserManagementPage.tsx` at `/settings/users` — user table with add/edit-role/remove (admin-only)
- [ ] 10.3 Add tenant and user management API calls to `api/client.ts`
- [ ] 10.4 Add settings routes in `App.tsx`

## 11. Frontend — Access Control & Navigation

- [ ] 11.1 Add onboarding gate in `App.tsx` — block all routes until `onboarding_complete`, show "setup pending" for non-admin
- [ ] 11.2 Add role-based route guards — admin-only pages redirect non-admins
- [ ] 11.3 Create navigation component with role-aware links (admin: all, staff: tenant info, teacher/parent: minimal)
- [ ] 11.4 Create `SetupPendingPage.tsx` — message for non-admin users when onboarding incomplete

## 12. Integration & Testing

- [ ] 12.1 Test full registration → onboarding → model setup redirect → tenant details → landing page flow
- [ ] 12.2 Test user management: add user, update role, remove user, last-admin guard
- [ ] 12.3 Test role-based access: admin vs staff vs teacher vs parent across all endpoints
- [ ] 12.4 Test onboarding gate: non-admin blocked when incomplete, unblocked when complete
- [ ] 12.5 Test dynamic tenant form renders correctly from model definition (base + custom fields)
- [ ] 12.6 Verify JWT issued by Launchpad can be validated by Papermite
