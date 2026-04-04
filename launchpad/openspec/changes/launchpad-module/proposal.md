## Why

NeoApex needs a central service for tenant lifecycle and identity management. Currently, Papermite hardcodes users in `test_user.json` and owns its own JWT auth — but auth, tenant config, user management, and onboarding are cross-cutting concerns that every NeoApex module (admindash, familyhub, enrollx, etc.) depends on. Embedding these in Papermite (the document ingestion gateway) creates the wrong dependency direction.

Launchpad is a new standalone module that owns the full tenant lifecycle: signup, onboarding, tenant configuration, user management, and authentication. All other NeoApex modules become JWT consumers — they validate tokens issued by Launchpad rather than managing their own user stores.

## What Changes

- **New `launchpad` module**: FastAPI backend + React frontend, standalone service alongside Papermite, admindash, etc.
- **Tenant registration**: Self-service signup creates a tenant and first admin user. Replaces hardcoded test_user.json for new tenant creation.
- **Onboarding wizard**: Post-signup guided flow — Step 1: model setup (redirects to Papermite), Step 2: tenant details entry. Onboarding must complete before any user can access the platform.
- **Tenant profile management**: Model-compliant CRUD for tenant details. Launchpad reads the Tenant model definition from datacore (same pattern as admindash for Student) and dynamically renders the tenant details form with base fields + any custom fields defined in the model. Tenant name is immutable after creation.
- **User management**: Admin can invite and manage users with domain-specific roles: admin, staff, teacher, parent.
- **Centralized auth**: JWT issuance via `POST /api/login` and `POST /api/register`. All NeoApex modules validate these tokens.
- **Role definitions**: admin (full access), staff (view students/programs/schedules, edit check-in/logistics), teacher (view assigned classes, edit grades/attendance), parent (view own children only). Role enforcement details are per-module — Launchpad defines and stores roles, downstream apps enforce permissions.
- **Papermite migration** (separate change): Papermite removes its own auth routes and user loading, switches to validating Launchpad-issued JWTs. Only admin role can access Papermite.

## Capabilities

### New Capabilities
- `tenant-signup`: Registration flow — create tenant + first admin user, email/password, tenant name input, auto-login, redirect to onboarding.
- `onboarding-wizard`: Post-signup guided setup — stepper UI with model setup (redirect to Papermite) and tenant details steps. Gates all app access until complete.
- `tenant-profile`: Model-compliant tenant details CRUD — reads Tenant model definition from datacore to render dynamic form (base + custom fields). Admin can edit (except immutable tenant name), staff can view read-only, teacher/parent no access.
- `user-management`: Admin can add, list, update role, and remove users within their tenant. Roles: admin, staff, teacher, parent. Last-admin protection.
- `centralized-auth`: Login endpoint, JWT issuance, user store (datacore-backed with bcrypt passwords), token validation middleware sharable across NeoApex modules.
- `datacore-global-tables`: Extend datacore Store API with global (non-tenant-scoped) table support for the `registry` table. Required prerequisite for cross-tenant user lookups during login.

### Modified Capabilities
(None — this is a new module. Papermite auth migration will be a separate change.)

## Impact

- **New module**: `launchpad/` directory at the NeoApex project level with backend (FastAPI) and frontend (React + Vite) sub-directories.
- **Cross-project**: All NeoApex modules will eventually consume Launchpad JWTs. Papermite is the first to migrate (separate change). Datacore gains global table support as a prerequisite.
- **Data storage**: Global `registry` table in datacore for users, credentials, and onboarding status. Tenant profile data stored as Tenant entity records in existing `{tenant_id}_entities` tables.
- **No breaking changes**: Papermite continues working with its current auth until explicitly migrated.
