## Context

Papermite is the data ingestion gateway for NeoApex/Floatify. Authentication currently relies on `test_user.json` — a static file loaded at startup with hardcoded users. There is no registration, no persistent user store, and no way for new tenants to self-onboard. The existing flow assumes a pre-configured tenant admin who jumps straight into document upload.

The backend is FastAPI with JWT auth (HS256, 24h expiry). The frontend is React + TypeScript + Vite with React Router. User state lives in localStorage (JWT token). Tenant data models are stored in LanceDB via datacore. Tenant entity fields (name, license_number, capacity, accreditation, insurance_provider) already exist in `models/domain.py`.

Existing specs: `login` (email/password → JWT), `role-gate` (tenant_admin-only enforcement), `session` (localStorage persistence), `theme` (light Floatify aesthetic).

## Goals / Non-Goals

**Goals:**
- Self-service tenant sign-up: new user → new tenant + first admin account
- Guided post-signup onboarding: model setup → tenant details, with clear progress indication
- Tenant profile CRUD for admins
- User management: admin can add users with roles (admin, staff, teacher, parent)
- Backward compatibility: existing test_user.json users continue to work for development

**Non-Goals:**
- Email verification or OAuth/SSO — out of scope, password-based auth only for now
- Billing, subscription management, or plan tiers
- Cross-project user federation (admindash, familyhub consuming user data)
- Permission granularity beyond role-based (no per-entity or per-field permissions)
- Password reset flow (can be added later)

## Decisions

### 1. User storage: JSON file → SQLite via LanceDB tenant_users table

**Decision**: Store users in a `tenant_users` LanceDB table alongside existing `tenant_models`, rather than introducing a separate database.

**Rationale**: Papermite already depends on LanceDB (via datacore) for model storage. Adding SQLite or Postgres would introduce a new dependency and deployment complexity. LanceDB can handle the low-volume user/tenant data adequately. If scale demands it later, migrating to Postgres is straightforward since the data access patterns are simple CRUD.

**Alternatives considered**:
- *PostgreSQL*: More robust but adds deployment dependency. Overkill for the expected user volume per tenant (< 50 users).
- *JSON file on disk*: Simplest, but no concurrent write safety and no query capability.
- *SQLite directly*: Good option but adds another library when LanceDB already provides table storage.

### 2. Onboarding wizard: stepper UI with route-per-step

**Decision**: Implement onboarding as a multi-step wizard with discrete routes (`/onboard/model`, `/onboard/tenant-info`) and a progress indicator. Each step can be completed independently and progress is tracked in the user's record.

**Rationale**: Route-per-step allows browser back/forward navigation, deep-linking, and resume-after-logout. A single-page wizard with internal state would lose progress on refresh. The existing upload → review → finalize flow already uses route-per-step, so this is consistent.

**Alternatives considered**:
- *Single-page wizard with tabs*: Simpler state management but loses progress on refresh and breaks browser navigation.
- *Modal-based setup*: Too constrained for the amount of information needed.

### 3. Role model: domain-specific roles (admin, staff, teacher, parent)

**Decision**: Roles are a string field on the user record. Access control is enforced at the route level in FastAPI dependencies and at the page level in React Router. Roles reflect the afterschool/childcare domain:

- `admin`: Full access — model management (Papermite-specific), tenant info (view + edit), user management, all data
- `staff`: Can view students, programs, schedules. Can edit check-in/out, logistics. Can view tenant info (read-only). No model access, no user management.
- `teacher`: Can view their assigned classes only. Can edit grades, attendance for their classes. No model access, no tenant info, no user management.
- `parent`: Can view their own children only. No model access, no tenant info, no user management.

**Rationale**: These roles map to real-world afterschool program operations. The admin is the only role with Papermite model management access — staff, teacher, and parent never interact with the data model definition. The current `require_admin()` dependency becomes `require_role(*roles)` accepting one or more allowed roles. Within Papermite specifically, most routes remain admin-only since Papermite is the model management tool; the other roles primarily apply to downstream apps (admindash, familyhub).

### 4. Registration flow: single-page form → create tenant + user atomically

**Decision**: The sign-up page collects: user name, email, password, tenant name. On submit, the backend creates both the tenant record and the first admin user in a single transaction-like operation. The user is then logged in automatically and redirected to onboarding.

**Rationale**: Separating tenant creation from user creation adds complexity with no benefit at this stage. The first user is always the admin. Subsequent users are added via the user management page.

### 5. Tenant profile: reuse existing Tenant domain model fields

**Decision**: The tenant details form maps directly to the fields already defined in `models/domain.py` Tenant class: `display_name`, `contact_email`, `address`, `capacity`, `accreditation`, `insurance_provider`, `license_number`. Store in a `tenants` LanceDB table. The `name` (tenant name) is set at registration and is immutable — it serves as the tenant identifier. The `display_name` is editable and used for UI display.

**Rationale**: These fields were already designed for tenant metadata. Immutable tenant name prevents confusion with tenant_id derivation and cross-system references.

### 6. Backward compatibility: test_user.json as seed data

**Decision**: Keep test_user.json loading for development. On startup, if the user store is empty, seed it from test_user.json. In production, test_user.json is ignored and all users come from the database.

**Rationale**: Preserves the existing dev workflow. Environment variable (`PAPERMITE_SEED_TEST_USERS=true`) controls whether seeding happens.

## Risks / Trade-offs

- **LanceDB for user storage** → LanceDB is optimized for vector/analytical workloads, not transactional CRUD. Mitigation: User operations are low-frequency (registration, occasional user adds). If performance becomes an issue, migrate to SQLite with minimal API changes.

- **No email verification** → Fake signups possible. Mitigation: Acceptable for initial launch; add email verification as a follow-up when needed. Rate limiting on the registration endpoint provides basic protection.

- **Password stored as plaintext in test_user.json** → Security risk if pattern continues. Mitigation: New user storage uses bcrypt hashing. test_user.json remains plaintext for dev convenience but is never used in production.

- **Onboarding gate blocks access** → Admin can't explore the app before completing setup. Mitigation: This is intentional — onboarding ensures the minimum viable tenant configuration is in place before the admin or any invited users can operate. Steps within onboarding can still be done in any order.

## Open Questions

1. Should the onboarding wizard allow reordering steps (e.g., tenant details before model setup), or enforce a fixed sequence? (Current assumption: fixed sequence, but each step can be skipped and revisited)
