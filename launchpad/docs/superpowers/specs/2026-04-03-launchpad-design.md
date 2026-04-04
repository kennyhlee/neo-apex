# Launchpad — Tenant Lifecycle & Identity Service

## Overview

Launchpad is a new NeoApex module that centralizes tenant lifecycle management and identity. It replaces the per-module auth pattern (e.g., Papermite's test_user.json) with a single service that owns signup, onboarding, tenant configuration, user management, and JWT issuance.

## Context

NeoApex is a multi-module platform for afterschool/childcare programs. Existing modules: Papermite (model ingestion), apexapi (data API), admindash, familyhub, enrollx, datacore, apexflow. Each module currently handles its own auth. There is no central identity or tenant management service.

## Goals

- Standalone FastAPI + React + TypeScript + Vite service
- Self-service tenant signup with atomic tenant + admin user creation
- Onboarding wizard that gates platform access until complete (model setup is required, not skippable)
- Tenant profile CRUD with model-compliant dynamic forms and immutable tenant name
- User management with domain-specific roles (admin, staff, teacher, parent)
- JWT issuance that all NeoApex modules can validate via shared secret
- Backward compatibility: Papermite keeps its own auth until explicitly migrated

## Non-Goals

- Email verification, OAuth/SSO, or password reset
- Billing, subscriptions, or plan tiers
- Per-entity or per-field permission granularity
- Migrating Papermite's auth to Launchpad (separate change)
- Staff/teacher/parent dashboards (those live in admindash/familyhub)

## Architecture

### Module Structure

Mirrors Papermite: `backend/app/{api,models,storage,config.py,main.py}`, `frontend/` (React + Vite). Backend on `:8001`, frontend on `:5174`.

### Shared UI Style Tokens

`NeoApex/ui-tokens/` — shared design tokens (CSS variables or Tailwind config) for colors, typography, spacing, shadows, border radii. Launchpad is the first consumer. Each module owns its own components — only tokens are shared, not UI code.

### Data Storage

Two storage locations, both via datacore:

- **`registry`** (global table) — users (user_id, name, email, password_hash, role, tenant_id, created_at) and per-tenant onboarding status (tenant_id, steps, onboarding_complete). Cross-tenant access for login email lookups. **Requires extending datacore Store API with global table support** (`put_global()`, `get_global()`, `query_global()`, `delete_global()`).

- **`{tenant_id}_entities`** — tenant profile data stored as a Tenant entity record (display_name, contact_email, address, license_number, capacity, accreditation, insurance_provider, plus any custom fields from the model definition). Same entity table used for students, families, etc. **Bootstrapped during Papermite model finalization**, not during Launchpad registration.

- **`{tenant_id}_models`** — Tenant model definition (written by Papermite, read by Launchpad for dynamic form rendering).

### Roles

Four roles stored as a string field on user records in the `registry` table:

| Role | Papermite Access | Tenant Info | User Mgmt | Downstream (admindash/familyhub) |
|------|-----------------|-------------|-----------|----------------------------------|
| `admin` | Full (model management) | View + Edit | Full | Full access |
| `staff` | None | View only | None | Students, programs, schedules; edit check-in/logistics |
| `teacher` | None | None | None | Assigned classes; edit grades, attendance |
| `parent` | None | None | None | Own children only |

Launchpad stores and serves roles. Each downstream module enforces its own access rules.

### JWT Structure

Payload: `{ user_id, email, tenant_id, role, exp }`. Signed with HS256 using shared secret `NEOAPEX_JWT_SECRET`. 24-hour expiry. All NeoApex modules validate using the same secret.

## Flows

### Registration

1. User visits `/signup`, enters name, email, password, tenant name
2. `POST /api/register` creates user record in `registry` with role `admin` and onboarding status `{ onboarding_complete: false }`
3. `tenant_id` derived from tenant name (kebab-case, numeric suffix on collision)
4. JWT issued, user auto-logged in
5. Redirect to `/onboard`

### Onboarding (gates all access)

1. **Model Setup** (required) — admin is redirected to Papermite's upload page with return URL. Papermite's finalize flow bootstraps `{tenant_id}_entities` and `{tenant_id}_models` tables. On return, step marked complete.
2. **Tenant Details** — Launchpad reads Tenant model definition from `{tenant_id}_models`, renders dynamic form with type-aware inputs (text, number, date, email, phone, boolean, selection). Admin fills in tenant profile, saved to `{tenant_id}_entities` as Tenant entity. Tenant name shown read-only.
3. On completion: `onboarding_complete` set to `true` in `registry`. Admin redirected to landing page. All tenant users can now access the platform.

Non-admin users who log in before onboarding completes see a "Your admin is setting things up" message.

### Login

1. User enters email + password at `/login`
2. `POST /api/login` queries `registry` table by email (cross-tenant), verifies bcrypt hash
3. JWT issued with user's tenant_id and role
4. Frontend checks onboarding status:
   - Admin + incomplete → `/onboard`
   - Admin + complete → landing page
   - Non-admin + incomplete → "setup pending" page
   - Non-admin + complete → landing page

### Tenant Profile (post-onboarding)

- `/settings/tenant` — reads Tenant model definition from datacore, renders dynamic form
- Admin: all fields editable except tenant name. Save via `PUT /api/tenants/{tenant_id}`
- Staff: read-only view. No save button.
- Teacher/parent: redirected away (no access)

### User Management

- `/settings/users` — admin-only
- List users, add user (name, email, password, role), edit role, remove user
- Last-admin protection: cannot demote or delete the only admin
- Users stored in global `registry` table, scoped by `tenant_id` in queries

## Risks / Trade-offs

- **Datacore for user data** — underlying LanceDB not designed for transactional CRUD. Acceptable for low-frequency auth operations. Datacore abstracts the backend.
- **Shared JWT secret** — compromise of one module's env exposes all. Acceptable for single-host deployment. Upgrade to asymmetric keys later.
- **Cross-module onboarding redirect** — Papermite redirect during onboarding. Mitigated by return URL parameter.
- **No email verification** — fake signups possible. Rate limiting on registration endpoint.

## Open Questions

1. Should Launchpad be the "shell" hosting other module UIs (micro-frontend), or standalone with links/redirects? (Current: standalone)
2. Should test_user.json seeding live in Launchpad or remain per-module for dev? (Current: Launchpad seeds its own store)

## Dependencies

- **Datacore** — must be extended with global table support before Launchpad storage layer can be built
- **Papermite** — model finalization bootstraps tenant entity tables; onboarding redirects to Papermite upload flow
- **`@neoapex/ui-tokens`** — created alongside Launchpad, consumed by frontend
