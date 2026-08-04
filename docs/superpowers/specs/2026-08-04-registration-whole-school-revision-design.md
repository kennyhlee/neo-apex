# Registration Flow — Whole-School Scope Revision

**Date:** 2026-08-04
**Status:** Draft for user review
**Amends:** `2026-08-03-student-registration-flow-design.md` (the Phase 1 spec). Where this document is silent, the original spec stands. The roadmap's "Interface contracts" section (`2026-08-03-registration-phase1-roadmap.md`) is superseded where the two conflict.

## 1. Why this revision

Phase 1 shipped registration keyed to an individual `program` entity: `registration_config.program_id`, a required `program_id` on application creation, per-program capacity, and the parent URL `/register/{tenant}/{program}`. In practice `program` rows are individual activities ("music", "baseball") — so as built, an application registers a student into one activity.

That contradicts the product intent and the tenant's own data. Registration is **admission to the afterschool as a whole for a school year**. The tenant's `registration_application` model — defined during model setup from the real admission packet ("Wei's Application.pdf") — has `application_id, school_year, school_id` plus agreement/signature custom fields and **no `program_id`**. Papermite's `RegistrationApplication` extraction class has the same shape. The registration flow also never consulted that model: the creation form and the engine's entity writes are hardcoded, and form blocks can only draw from `student|family|contact`.

Two changes, therefore:

1. **Re-scope**: applications and flow configs belong to the tenant (+ school year), not to a program.
2. **Model-driven application fields**: the tenant's `registration_application` model definition becomes usable in the flow, and the model itself is kept coherent between the seeded engine fields and model-setup customization.

### Decisions locked during review

| Decision | Choice |
|---|---|
| Application scope | Whole school, per `school_year`. `program_id` removed from applications and configs. |
| Programs/activities | **Fully separate step.** The registration flow never mentions programs. Assigning enrolled students to activities is a staff workflow outside registration (AdminDash; future design). |
| Capacity | School-wide: optional `capacity` on the **tenant** entity, evaluated per `school_year` at submission. Per-program capacity stays on the `program` entity for the future activity-assignment workflow; registration ignores it. |
| Migration | Revise contracts in place; no compatibility shims (feature is unreleased). Wipe/reseed dev-tenant registration data. |

## 2. Data model changes

- **`registration_config`** — drop `program_id`. One config lineage per tenant: `config_id, version, status (draft|published|archived), blocks`. "One active per program" becomes "at most one published config per tenant". Yearly flow changes are just new published versions (applications already pin `config_version`).
- **`registration_application`** — drop `program_id`. Engine-owned base fields (see §4): `application_id, school_year, status, family_id, student_id, config_version, channel_started, applicant_email, token_version, draft_data, submitted_at, decided_at`. Tenant-specific fields from model setup (e.g. `agreement_signed_by`, `initials`) live in `custom_fields` and are written by form blocks (§4).
- **`tenant`** — gains `capacity (number, optional)`: maximum admitted students per school year. Absent/zero means unlimited.
- **`enrollment`** — unchanged as an entity, but **registration no longer creates it**. Approval side effects are: match-or-create family + student, set student status, start post-approval due-date clocks. `enrollment` rows come from the separate activity-assignment workflow.
- **`program`** — unchanged. No longer referenced by any registration entity, route, or view.

**Application status** values are unchanged. The capacity rule becomes: at submission, if `count(applications in approved|enrolled for the same tenant + school_year) >= tenant.capacity`, the application lands `waitlisted`. (Enrollment rows no longer exist at admission time, so the count is over applications only.)

## 3. Contract revisions

Replacements for the roadmap's binding contracts. Unlisted contracts (magic-link token format, blob API, `uploaded_by` derivation, action names, item statuses, identifier convention) are unchanged.

**Application creation** (enrollx): `POST /api/registration/{tenant_id}/applications` body `{school_year, channel: "parent"|"admin", applicant_email?}` → `201 {application, items}`. 404 if the tenant has no published config: `"No published registration config for this tenant"`.

**Internal routes** (enrollx, consumed by familyhub):
- `POST /internal/registration/{tenant_id}/start` body `{school_year, applicant_email}` → `201 {application, items, token, link}`.
- `GET /internal/registration/{tenant_id}/config` → `{config, tenant: {tenant_id, name}, capacity: {capacity, admitted, full}}` (the `program` key is removed; `admitted` = the §2 count).
- `POST /internal/registration/{tenant_id}/request-link` body `{email}` — `program_id` dropped.
- Token-scoped routes (`/internal/application-by-token/…`) unchanged.

**familyhub facade**: `GET /api/registration/{tenant_id}` (config bundle) · `POST /api/registration/{tenant_id}/start` · token routes unchanged. Public URL: `familyhub.floatify.com/register/{tenant_id}`.

**flow-runtime types**: `RegistrationConfigDef` drops `program_id`. `FlowBlock` unchanged except the `form` block config (§4). `defaultSchoolYear()` (July rollover) moves into flow-runtime so both channels derive the same default; the parent start page shows it as a read-only line, staff can edit it.

**`publish_config`** validates against the tenant's single lineage (archive prior published version, as today) — the program existence check is removed.

## 4. Model-driven application fields

Two rules keep the `registration_application` model definition truthful, then the flow consumes it:

1. **Engine-owned fields are seeded and protected.** `base_model.json` declares the §2 base fields; LaunchPad seeds them as today. **Papermite finalization must merge, not replace**: when committing a model for an entity type that already exists in the tenant's models table, extracted fields that match existing base fields by name are dropped, and the remainder are appended to `custom_fields` — base fields are never removed. (This is what turned the acme-afterschool model into the extraction shape; `school_id` and similar extraction-only fields simply become custom fields. The merge rule applies to all entity types, not just this one.)
2. **Form blocks can draw from the application model.** The builder's `form` block `entity_type` choices become `student | family | contact | registration_application`. When `entity_type = "registration_application"`, the renderer shows the model's `custom_fields` only (engine base fields are excluded — same mechanism as the existing `{et}_id` exclusion, extended to the engine-owned list, which flow-runtime exports as a constant). On `complete_item`/`submit`, answers for such a block are written onto the application entity's `base_data` (they are application-level facts: signatures, initials), not into `draft_data`'s student/family staging. The engine rejects writes to engine-owned field names with a 400.

The default seeded flow template should include a `form` block with `entity_type: "registration_application"` so tenants who customized their application model during model setup see their fields without touching the builder.

## 5. UI changes

**EnrollX**
- `NewApplicationPage`: two fields — `school_year` (prefilled) and optional `applicant_email`. Program select removed.
- `ApplicationsPage`: drop the program column/filter; `school_year` becomes the primary filter (stays client-side; the existing `LIMIT 1000` pagination follow-up stands and is not made worse). Kanban/detail unchanged except program references removed.
- Builder moves from `/programs/:programId/flow` to a top-level `/flow` route ("Registration flow" nav item). The `/programs` page and nav entry are removed from EnrollX — programs are managed in AdminDash and no longer play a role here.
- `ApplicationDetailPage` / `ApplicationEntryPage`: remove program name/id display; show `school_year` + tenant name.

**FamilyHub**
- `RegisterPage` served at `/register/{tenant_id}`; shows tenant name + school year instead of program name. Hub unchanged except the same label swap.

**Email templates**: program name replaced by tenant display name + school year in all v1 templates.

**i18n**: string changes land in both `en-US` and `zh-CN`, per standing rules.

## 6. Migration / cleanup (dev only — nothing is deployed)

- Wipe registration data in dev tenants: `registration_config`, `registration_application`, `application_item`, `application_activity`, `document`, `payment` rows (LanceDB archive is acceptable; these are all test rows).
- Reseed models: update `base_model.json` (`registration_config` minus `program_id`; `registration_application` per §2; `tenant` + `capacity`), run LaunchPad's sync-defaults path, then re-run the Papermite merge for acme-afterschool so its agreement fields survive as `custom_fields`.
- Delete program-scoped code paths outright (no deprecation): `get_published_config(tenant, program_id)` → `get_published_config(tenant)`, `capacity_state` rewrite, route signature changes, `ProgramsPage`/`ProgramRow` removal from EnrollX, `flow-runtime` type change.
- Test suites follow the contracts: enrollx backend tests updating creation/config/capacity fixtures; familyhub tests updating start/config routes; the Plan 4/5 follow-up items remain tracked separately and are not absorbed here.

## 7. Out of scope

- Activity/program assignment workflow (own design; consumes `enrollment` + per-program capacity).
- Per-activity capacity and waitlists.
- Multiple concurrent flows per tenant (e.g. summer vs school-year programs as separate flows) — the single-lineage config covers current tenants; revisit if a real tenant needs two.
- Everything the original spec lists in §14, plus its Phase 2/3 items.

## 8. Testing strategy delta

- Capacity boundary tests move from per-program to per-`(tenant, school_year)` counting applications only.
- New: Papermite finalize merge rule (existing base fields preserved; extraction fields appended as custom; idempotent on re-commit).
- New: application-model form block — engine-owned field write rejected (400); custom field answer lands on application `base_data` and survives approval.
- Contract tests pinning the revised route signatures (creation body without `program_id` 201s; body with `program_id` 422s — proving the shim-free cutover).
- The manual acceptance gates from the Plan 4/5 follow-ups (browser click-through, live `publish_config`, R2 seam) should be executed **after** this revision lands, not before, so they are run once against the final shape.
