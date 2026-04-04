## Context

NeoApex is a multi-module platform for afterschool/childcare programs. Existing modules: Papermite (model ingestion), apexapi (data API), admindash, familyhub, enrollx, datacore, apexflow. Each module currently handles its own auth concerns (Papermite uses test_user.json + JWT). There is no central identity or tenant management service.

Launchpad is a new module that owns tenant lifecycle and identity. It is the first service a new customer touches (signup) and the ongoing source of truth for who can do what across the platform.

## Goals / Non-Goals

**Goals:**
- Standalone FastAPI + React service that can run independently
- Self-service tenant signup with atomic tenant + admin user creation
- Onboarding wizard that gates platform access until complete
- Tenant profile CRUD with immutable tenant name
- User management with domain-specific roles (admin, staff, teacher, parent)
- JWT issuance that other NeoApex modules can validate
- Backward compatibility: Papermite keeps working with its own auth until explicitly migrated

**Non-Goals:**
- Email verification, OAuth/SSO, or password reset (future work)
- Billing, subscriptions, or plan tiers
- Per-entity or per-field permission granularity (roles are coarse-grained)
- Migrating Papermite's auth to Launchpad (separate change)
- Building out staff/teacher/parent dashboards (those live in admindash/familyhub)

## Decisions

### 1. Standalone module structure mirroring Papermite

**Decision**: Launchpad follows the same project structure as Papermite — FastAPI backend with `app/api/`, `app/models/`, `app/storage/`, `app/config.py`, and a React + TypeScript + Vite frontend. Uses datacore for all data storage.

**Rationale**: Consistency across NeoApex modules reduces cognitive overhead. Same tooling (uvicorn, vite, pyproject.toml). Shared datacore means no additional infrastructure.

**Alternatives considered**:
- *Monolith*: Merge into Papermite. Rejected — wrong responsibility boundary, creates bad dependency direction.
- *Separate database*: Own Postgres/SQLite. Rejected — adds infrastructure complexity for low-volume CRUD. Datacore is already available.

### 1a. Shared UI style tokens (`@neoapex/ui-tokens`)

**Decision**: Launchpad is the first module to consume a shared style package at `NeoApex/ui-tokens/` containing design tokens (CSS variables or Tailwind config) for colors, typography, spacing, shadows, and border radii. Each module owns its own components — only style tokens are shared, not UI code.

**Rationale**: Ensures consistent look and feel across all NeoApex modules without coupling their component implementations. The shared package is created as part of Launchpad's build-out; other modules (Papermite, admindash) migrate to it in separate changes.

### 2. Data split: global `registry` table + per-tenant entity tables

**Decision**: Two storage locations:
- **`registry`** — a global datacore table (not tenant-scoped) holding users (with bcrypt-hashed passwords, roles, tenant_id) and per-tenant onboarding status. Queried cross-tenant during login (email lookup). Requires extending datacore's Store API with global table support (`put_global()`, `get_global()`, `query_global()`).
- **`{tenant_id}_entities`** — tenant profile data (display_name, contact_email, capacity, etc.) stored as a Tenant entity record, same as any other entity type. Read/written through datacore's existing entity API. Bootstrapped during Papermite model finalization (not during Launchpad registration).

Tenant model definitions live in `{tenant_id}_models` (written by Papermite, read by Launchpad for dynamic form rendering).

**Rationale**: Tenant info is domain data — it belongs in the entity table alongside students, families, etc. Users and onboarding status are platform-level concerns that need cross-tenant access (login by email). The `registry` table is the only global table in datacore. Extending datacore with global table support keeps the storage API consistent rather than bypassing it for this one table.

### 3. Domain-specific roles as string enum

**Decision**: Four roles stored as a string field on the user record:
- `admin`: Full platform access. Only role with Papermite (model management) access. Can edit tenant info, manage users.
- `staff`: View students, programs, schedules. Edit check-in/out, logistics. View tenant info (read-only). No model management.
- `teacher`: View assigned classes only. Edit grades, attendance for those classes. No tenant info or model access.
- `parent`: View own children only. No admin features.

Launchpad stores and serves role information. Each downstream module enforces its own role-based access rules.

**Rationale**: Roles reflect real afterschool program operations. Keeping enforcement per-module avoids a complex centralized permission system while the role definitions remain centralized.

### 4. Onboarding gates all access

**Decision**: Until `onboarding_complete` is `true` on the tenant record, no user in that tenant can access the main application. Admin users are redirected to the onboarding wizard. Non-admin users see a "Your admin is setting things up" message.

Onboarding steps: (1) Model setup (required) — redirects to Papermite's upload flow, (2) Tenant details — model-compliant form within Launchpad that reads the Tenant model definition via datacore. Model setup cannot be skipped because tenant details form depends on the model definition.

**Rationale**: Ensures minimum viable configuration before operations begin. Prevents confusion from staff/teachers logging into an unconfigured tenant. Model setup is a hard prerequisite for tenant details — without it, the dynamic form cannot be rendered.

### 4a. Tenant details form reads model definition from datacore

**Decision**: The tenant details form (both during onboarding and in settings) dynamically renders fields based on the Tenant model definition stored in datacore. This includes base fields (display_name, contact_email, etc.) and any custom fields the admin defined during model setup. Same pattern admindash uses for the Student entity.

**Rationale**: The model definition is the source of truth for what fields a Tenant entity has. Hardcoding the form would diverge from the model over time. Admindash already proves this pattern works — read model from datacore, render dynamic form with type-aware inputs. Launchpad replicates this approach for Tenant.

**Alternatives considered**:
- *Tenant details form in Papermite*: Avoids the datacore read and reuses existing EntityCard/FieldRow components. Rejected — breaks Launchpad's ownership of tenant lifecycle and forces admin to context-switch between modules for tenant config.
- *Static form with hardcoded fields*: Simpler but ignores custom fields and diverges from model definition.

### 5. Tenant name immutable, display_name editable

**Decision**: `name` (and derived `tenant_id`) are set at registration and cannot be changed. All other tenant fields — both base fields from the domain model (display_name, contact_email, address, etc.) and custom fields defined during model setup — are editable by admin. The set of editable fields is determined by the Tenant model definition in datacore, not hardcoded.

**Rationale**: `tenant_id` is used as a key across all NeoApex modules and datacore tables. Changing it would require cascading updates across the entire platform. `display_name` handles the "we rebranded" use case. Dynamic fields from the model definition keep the form and the model in sync.

### 6. JWT structure shared across NeoApex

**Decision**: Launchpad issues JWTs with payload: `{ user_id, email, tenant_id, role, exp }`. Other modules validate using a shared secret (env var `NEOAPEX_JWT_SECRET`). No need for public/private key infrastructure at this scale.

**Rationale**: Symmetric JWT validation is simple and sufficient. All modules run in the same trust boundary. If multi-region or third-party consumers emerge, switch to RS256 with JWKS.

### 7. Launchpad runs on port 8001

**Decision**: Backend on `:8001`, frontend on `:5174`. Papermite stays on `:8000`/`:5173`.

**Rationale**: Side-by-side development without port conflicts.

## Risks / Trade-offs

- **Datacore for user data** → Datacore's underlying storage (LanceDB) is not designed for transactional CRUD. Mitigation: Low-frequency operations (registrations, user adds). Datacore abstracts the backend for future migration.

- **Shared JWT secret** → Compromise of one module's env exposes all. Mitigation: Acceptable for current deployment model. Upgrade to asymmetric keys when needed.

- **Onboarding redirects to Papermite** → Cross-module navigation during onboarding. Mitigation: Simple URL redirect with a return URL parameter. Papermite's finalize flow already handles redirects.

- **No email verification** → Fake signups possible. Mitigation: Rate limiting on registration. Add email verification later.

## Open Questions

1. Should Launchpad's frontend be the "shell" that hosts other module UIs (micro-frontend), or remain a standalone app with links to other modules? (Current assumption: standalone with links/redirects)
2. Should test_user.json seeding live in Launchpad or remain per-module for dev convenience? (Current assumption: Launchpad seeds its own user store, Papermite keeps its own until migrated)
