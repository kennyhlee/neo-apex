# Signup, Tenant ID & Onboarding Redesign

## Problem

1. **Signup is open to anyone** — no check for whether the user's org already exists. Users who should be added by their admin are creating duplicate tenants.
2. **Tenant ID is auto-generated** from org name with no user confirmation or domain-based derivation.
3. **Onboarding model setup always goes through papermite** — no option to skip and use a default model.
4. **Papermite redirect has no tenant context** — no `tenant_id` or auth token passed, so papermite always stores models under "acme" (its hardcoded test user).

## Design

### 1. Signup Flow — Multi-Step with Email Domain Gating

Registration becomes a three-phase process.

#### Phase 1: Email Domain Check

New endpoint: `POST /api/register/check-email`

Request: `{ "email": "klee@acme.edu" }`

Backend logic:
1. Extract domain from email.
2. Check domain against a hardcoded common provider list: `gmail.com`, `yahoo.com`, `hotmail.com`, `outlook.com`, `icloud.com`, `protonmail.com`, `aol.com`, `mail.com`, `zoho.com`.
3. If common provider: respond `{ "status": "new_tenant" }`.
4. If org domain: query all existing users with matching email domain.
   - If any exist with role `admin`: respond `{ "status": "org_exists", "admin_email_hint": "j***@acme.edu" }` (masked for privacy — show first letter + domain).
   - If none exist: respond `{ "status": "new_tenant" }`.

Frontend behavior:
- `org_exists`: show message — "Your organization already has an account. Contact your admin at j***@acme.edu to get added."
- `new_tenant`: proceed to Phase 2.

#### Phase 2: Tenant ID Selection

New endpoint: `POST /api/register/suggest-ids`

Request: `{ "email": "klee@acme.edu", "tenant_name": "Acme Afterschool Program" }`

Backend generates up to 5 candidates using deterministic slug variations:
1. Domain stem — `acme` (from `acme.edu`). Skipped for common email providers.
2. First two words — `acme-afterschool`
3. Initials — `acme-asp`
4. Reversed key words — `afterschool-acme`
5. Full slug — `acme-afterschool-program`

Each candidate is checked against existing tenant IDs (via `registry.get_onboarding(candidate)`). Taken ones are filtered out.

Response: `{ "suggestions": ["acme", "acme-afterschool", "acme-asp", "afterschool-acme"] }`

Frontend shows the suggestions as selectable options. User can also type a custom ID, which is validated for uniqueness via the same endpoint (or a separate check).

#### Phase 3: Final Registration

Modified endpoint: `POST /api/register`

Request now includes user-confirmed tenant_id:
```json
{
  "name": "Kenny Lee",
  "email": "klee@acme.edu",
  "password": "...",
  "tenant_name": "Acme Afterschool Program",
  "tenant_id": "acme"
}
```

Backend no longer auto-generates tenant_id via `_slugify`. It validates the provided `tenant_id` for:
- **Uniqueness** — no existing tenant with the same ID.
- **Format** — lowercase alphanumeric and hyphens only, 3-40 characters, must start with a letter. Regex: `^[a-z][a-z0-9-]{2,39}$`.

### 2. Login Page Copy Change

Change the signup prompt from:
> "Don't have an account? Sign up"

To:
> "Setting up a new organization? Create your first admin account"

### 3. Onboarding — Optional Model Setup

#### Current flow
Step 1 (Model Setup) forces redirect to papermite. No way to skip.

#### New flow
Step 1 presents two options:

**Option A: "Upload Document"**
Existing papermite redirect flow, now with `tenant_id` and JWT token in the URL (see Section 4).

**Option B: "Use Default Model"**
Skips papermite. Calls a new backend endpoint to copy the base model into the tenant's datacore.

#### New endpoint: `POST /api/tenants/{tenant_id}/model/use-default`

- Requires admin role.
- Reads from `backend/app/data/base_model.json` — a shipped file containing all entity types with base_fields populated and custom_fields as empty arrays.
- For each entity type in the base model, calls `store.put_active_model(tenant_id, entity_type, model_definition)`.
- Marks the `model_setup` onboarding step as complete.
- Returns the model definition.

#### Base model content (`base_model.json`)

Contains all standard entity types: tenant, student, family, contact, etc. Each entity type has:
- `base_fields`: populated with standard field definitions (name, type, required, etc.)
- `custom_fields`: empty array `[]`

The exact field definitions should match what papermite would generate for a standard schema.

#### Frontend changes (OnboardingPage)

Step 1 card shows two buttons:
- **"Upload Document"** — redirects to papermite with auth context
- **"Use Default Model"** — calls `/model/use-default`, marks step complete, advances to Step 2

### 4. Papermite Redirect Fix

#### Current problem
Launchpad redirects to `papermiteUrl/upload?return_url=...` with no auth context. Papermite authenticates from `test_user.json`, always resolving to tenant "acme".

#### Redirect URL change
```
papermiteUrl/upload?tenant_id={tenant_id}&token={jwt}&return_url={returnUrl}
```

#### Prerequisite: Normalize roles across all modules

Replace `tenant_admin` with `admin` everywhere. All modules (launchpad, papermite, admindash) use the same role names: `admin`, `staff`, `teacher`, `parent`.

Files to change:
- `papermite/backend/app/api/auth.py` — `require_admin` checks `role != "tenant_admin"` → `role != "admin"`
- `papermite/frontend/src/App.tsx` — two references to `tenant_admin`
- `papermite/test_user.json` — role value
- `papermite/backend/tests/test_extract_api.py` — test fixture role
- `admindash/test_user.json` — role value

#### Papermite backend auth changes

`get_current_user` in `backend/app/api/auth.py` needs dual JWT support:

1. Try decoding token with papermite's own JWT secret (existing behavior, for direct papermite users).
2. If that fails, try decoding with launchpad's JWT secret.
3. If launchpad token is valid, construct a `TestUser` from token claims: `user_id`, `email`, `tenant_id`, `role`.
4. No role mapping needed — roles are consistent across modules.

New config setting: `PAPERMITE_LAUNCHPAD_JWT_SECRET` (default: `"neoapex-dev-secret-change-in-prod"` — matches launchpad's dev secret).

#### Papermite frontend changes

**Auth context from query params:**
Upload page reads `tenant_id` and `token` from query params. Uses them for API calls instead of requiring its own login flow.

**Return-to-launchpad flow:**
Currently papermite has no `return_url` handling. After finalize, it navigates to `"/"` (its own landing page). This needs to change:

1. **UploadPage** (`/upload`) — reads `return_url`, `tenant_id`, `token` from query params. Persists `return_url` through the multi-page flow (via URL query params forwarded to `/review/{id}` and `/finalize/{id}`).
2. **FinalizedPage** (`/finalize/:id`) — after successful `commitFinalize()`, checks for `return_url`. If present, redirects to it (back to launchpad). If absent, navigates to `"/"` as before (standalone papermite usage).

## Scope

### Changing
- `backend/app/api/auth.py` — new `check-email` and `suggest-ids` endpoints, modified `register`
- `backend/app/api/tenants.py` — new `use-default` endpoint
- `backend/app/data/base_model.json` — new file with base model definitions
- `frontend/src/pages/SignupPage.tsx` — multi-step registration flow
- `frontend/src/pages/LoginPage.tsx` — copy change
- `frontend/src/pages/OnboardingPage.tsx` — two-option model setup
- `frontend/src/api/client.ts` — new API functions
- Papermite `backend/app/api/auth.py` — dual JWT auth, `tenant_admin` → `admin`
- Papermite `backend/app/config.py` — new launchpad JWT secret setting
- Papermite `frontend/src/App.tsx` — `tenant_admin` → `admin`
- Papermite `test_user.json` — `tenant_admin` → `admin`
- Papermite `backend/tests/test_extract_api.py` — `tenant_admin` → `admin`
- `admindash/test_user.json` — `tenant_admin` → `admin`
- Papermite frontend upload page — read query params

### Not changing
- Login flow (beyond copy)
- User Management page
- Tenant Settings page
- Datacore storage layer
