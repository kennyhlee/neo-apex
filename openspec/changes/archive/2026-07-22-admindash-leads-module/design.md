## Context

AdminDash is a thin FastAPI backend + React SPA. The backend owns no storage — it JWT-validates requests and proxies to DataCore's entity API (`/api/entities/{tenant_id}/{entity_type}`) and query API (`/api/query`). DataCore stores every entity type in one shared per-tenant `{tenant}_entities` table keyed by an `entity_type` column, and (verified) accepts arbitrary new entity types with arbitrary `base_data` — no model registration required to persist. DataCore entity endpoints are themselves unauthenticated; all access control lives in the AdminDash backend proxy layer.

Existing entity pages (StudentsPage, ProgramPage) are **model-driven**: they load a per-tenant `ModelDefinition` and render dynamic forms/tables. Leads, by contrast, have a **fixed, product-defined schema** (the same for every school), so they do not need the model-driven machinery.

This change adds Lead + LeadActivity as new entity types, a dedicated AdminDash backend `leads` router to enforce lead-specific business rules, and new frontend pages. The `/leads` route and a placeholder `LeadPage` already exist and will be replaced.

## Goals / Non-Goals

**Goals:**
- Capture leads via public web form, authenticated manual entry, and email-paste import.
- Move leads through a fixed pipeline with auto-logged stage changes.
- Keep a single denormalized activity log per lead.
- One-click convert a lead into Family + Student records, pre-filled and linked, marking the lead Enrolled.
- Enforce lead-specific rules (public-intake field allowlist, tenant validation, double-conversion guard, auto-logging) server-side where they can be tested.

**Non-Goals:**
- No new DataCore storage tables or query-engine changes (leads reuse the entities table).
- No lead-scoring, assignment/ownership, SLA reminders, email *sending*, or analytics.
- No captcha/rate-limiting on the public form in this change (noted as a follow-up risk).
- No transactional/atomic multi-entity write across DataCore (conversion is best-effort sequential).
- No per-tenant customizable lead fields (fixed schema).

## Decisions

### D1 — Dedicated AdminDash `leads` backend router (not frontend orchestration over generic endpoints)
Add `admindash/backend/app/api/leads.py` with lead-specific endpoints, persisting by calling DataCore's entity/query API via the existing httpx proxy pattern.
- **Why:** Three requirements can't live safely in the client: (a) the **public web-form** endpoint is unauthenticated and must allowlist fields + validate the tenant server-side; (b) **stage transition + auto-logged activity** is a two-write pair; (c) **convert** is a multi-write with a double-conversion guard. AdminDash already has a pytest+respx suite, so server-side logic is directly testable.
- **Alternative considered:** Model leads as generic entities and orchestrate stage/activity/convert from the frontend using existing `createEntity`/`updateEntity`/`postQuery`. Rejected: cannot do public unauthenticated intake, scatters security-sensitive logic into the browser, no server enforcement of guards.

### D2 — Store leads and activities as DataCore entities (reuse, no new storage)
`lead` and `lead_activity` become new `entity_type` values in the existing per-tenant entities table. Activities are one denormalized type distinguished by a `type` field (`call|email|note|stage_change`) — matching the goal's "single lead_activities table, don't over-normalize."
- **Why:** DataCore already accepts new entity types with no schema change; this is the lowest-footprint persistence.
- **Alternative:** New dedicated tables in DataCore. Rejected as unnecessary and cross-cutting.

### D3 — Fixed-schema leads UI (not model-driven DynamicForm)
Leads pages use explicit, hard-coded fields/columns/stages rather than loading a `ModelDefinition`.
- **Why:** Leads have one product-wide schema; the model-driven path exists to support per-school-customizable entities (students) and would force per-tenant model seeding for no benefit.
- **Alternative:** Register a `lead` `ModelDefinition` per tenant and reuse DynamicForm/StudentsPage. Rejected: adds a seeding dependency and indirection for a fixed schema. (We still may register a lead model later purely for dashboard discoverability — deferred.)

### D4 — Human-friendly `lead_id` via DataCore `DEFAULT_ABBREVS`
Add `"lead": "LD"` to `DEFAULT_ABBREVS` in `datacore/src/datacore/api/routes.py` so leads get sequential ids (`ABR-LD26...`) like students (`ST`) and programs (`PR`). Activities keep only the internal `entity_id` (no human id).
- **Why:** Admins reference leads by a readable id; one-line change consistent with existing types, covered by a test.
- **Alternative:** entity_id (hex) only. Rejected: inconsistent with sibling entity types and poor UX; but low-cost enough to include.

### D5 — Email import parsed client-side (regex), reviewed, then saved via the normal create path
The email-import modal extracts candidate fields (name/email/phone/student name) with a small client-side util, lets the admin correct them, then POSTs a normal lead with `source=email_import`. No backend parse endpoint, no AI call.
- **Why:** Minimal; parsing an pasted inquiry email is a simple regex problem and keeps the backend surface small.
- **Alternative:** Backend/Papermite AI extraction. Rejected as over-engineered for T0.

### D6 — Public intake as an unauthenticated route in the admin SPA + a public backend endpoint
Frontend: a standalone route (e.g. `/inquire/:tenantId`) rendered outside the auth guard in `App.tsx`. Backend: `POST /api/public/leads/{tenant_id}` with **no** JWT dependency, which validates the tenant exists (via DataCore) and accepts only prospect fields, forcing `source=web_form`, `stage=New`.
- **Why:** Lowest-footprint way to satisfy "web form" intake for T0. AdminDash's Cloudflare-IP middleware only restricts origin traffic to Cloudflare, not end users, so a prospect's browser reaches it fine.
- **Alternative:** Separate standalone public app. Rejected as out of scope for T0.

### D7 — Conversion mapping (lead → family + student)
Server-side `convert` endpoint, executed sequentially: create `family` → create `student` (with `family_id`) → update lead (`converted_family_id`, `stage=Enrolled`, log stage_change). Mapping:
- Lead guardian name → `family.family_name`; lead email/phone → `family.primary_email`/`primary_phone`; lead address (if any) → `family.primary_address`.
- Lead student first/last name → `student.first_name`/`last_name`; grade-of-interest → `student.grade_level` (only if it matches a valid option, else left blank); `student.family_id` = new family id; `student.status = "Enrolled"`.
- Required student fields the lead lacks (`primary_address`) are surfaced in the review step for the admin to fill before commit.

## Risks / Trade-offs

- **Non-atomic conversion** (family created, then student fails) → orphan family. Mitigation: order writes family→student→lead, return a clear error identifying what succeeded; accept minor orphan risk for T0; note compensation/transaction as a follow-up.
- **Public intake abuse** (spam/enumeration on the unauthenticated endpoint) → Mitigation for this change: strict field allowlist, tenant-existence check, no data returned beyond an ack. Captcha + rate-limit deferred to a follow-up.
- **DataCore has no auth** → all lead access control depends on the AdminDash proxy correctly requiring JWT on every non-public route. Mitigation: reuse the existing `require_authenticated_user` dependency on all authed lead routes; cover the public route's field-allowlist with tests.
- **Required student fields at conversion** (`primary_address`, `student_id`) not present on a lead → Mitigation: conversion review step collects/generates them (student_id via DataCore next-id) before commit; block commit if a required field is empty.
- **Cross-service change** (one line in DataCore for the `LD` abbrev) → small blast radius, covered by a datacore test; deploy DataCore before AdminDash relies on the human id (AdminDash tolerates its absence).
