# Registration Whole-School Scope Revision — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Re-scope registration from "one program" to "the whole school, per school year", and make the tenant's `registration_application` model definition usable inside the flow.

**Architecture:** `program_id` is deleted outright (no shims) from `registration_config`, `registration_application`, every enrollx/familyhub route, both frontends and `workflow-forms`. A tenant has exactly one registration-config lineage; capacity moves onto the `tenant` entity and is counted per `school_year` over applications only. Papermite's finalize merges into the existing model instead of replacing it, so engine-owned base fields survive model setup. A `form` block may now draw from `entity_type: "registration_application"`, and its answers are written onto the application's own `base_data`.

**Tech Stack:** Python 3.12 / FastAPI / pytest (enrollx, familyhub, papermite backends) · React 19 + TypeScript + Vite (enrollx, familyhub frontends) · `@neoapex/workflow-forms` (shared TS package) · LanceDB via DataCore HTTP API.

## Global Constraints

Copied verbatim from the spec (`docs/superpowers/specs/2026-08-04-registration-whole-school-revision-design.md`) and the standing repo rules. **Every task's requirements implicitly include this section.**

- **No compatibility shims.** The feature is unreleased. Delete program-scoped code paths outright; do not deprecate, do not accept `program_id` "for now".
- **Creation body contract:** `POST /api/registration/{tenant_id}/applications` body is exactly `{school_year, channel: "parent"|"admin", applicant_email?}`. A body carrying `program_id` **must** 422.
- **404 message on missing config** (exact string): `"No published registration config for this tenant"`.
- **Config bundle shape:** `GET /internal/registration/{tenant_id}/config` → `{config, tenant: {tenant_id, name}, capacity: {capacity, admitted, full}}`. The `program` key is gone.
- **Capacity rule:** at submission, if `count(applications in approved|enrolled for the same tenant + school_year) >= tenant.capacity`, the application lands `waitlisted`. Absent or zero `tenant.capacity` means unlimited. Enrollment rows are NOT counted (they no longer exist at admission time).
- **Approval side effects are exactly:** match-or-create family + student, set student status, start post-approval due-date clocks. **No `enrollment` row is created.**
- **Public parent URL:** `familyhub.floatify.com/register/{tenant_id}` (route `/register/:tenantId`).
- **Builder route:** top-level `/flow` in EnrollX. `/programs` and its nav entry are removed.
- **i18n:** every string change lands in **both** `en-US` and `zh-CN`.
- **DataCore data-shape rule:** every top-level field of a flattened query row arrives as a **string** (`"false"` is truthy in Python and JS). Coerce before arithmetic or truthiness. Values inside a parsed JSON blob (`draft_data`, parsed `blocks`) are real types and must NOT be re-coerced.
- **DataCore sparse-column rule:** never put a SQL predicate on a field that only one entity type writes — DuckDB binder-errors on a tenant where no row carries that key. Filter in Python via `engine.rows_matching` instead. `entity_type`, `_status`, `entity_id`, `status`, `application_id` are safe in SQL.
- **Identifier convention:** rows carry two independent ids. `entity_id` is DataCore's; the business id (`application_id`, `item_id`, `config_id`) is an ordinary field. Every action, route param and `payload_ref` uses `entity_id`. The one exception is `document_id`, which doubles as its `entity_id` by construction.
- **Money is integer cents.** No float arithmetic anywhere.
- **Frontends:** React 19 + TS + Vite, native `fetch` (no axios), CSS variables (no CSS-in-JS), no global state library.
- **Deferred, do not attempt in this plan:** document upload steps in the click-through (skip or waive document items), and the `uploaded_by` R2 seam checks from the Plan 5 follow-ups. Task 12 records both in a follow-ups doc.

### Engine-owned application fields (BINDING list, used by Tasks 1, 4, 5, 9)

```
application_id, registration_application_id, school_year, status, family_id,
student_id, config_version, channel_started, applicant_email, token_version,
draft_data, submitted_at, decided_at
```

Note `registration_application_id` is in the list: DataCore auto-assigns `"{entity_type}_id"` when absent, and `engine.create_application` pre-sets it, so it is engine-owned even though the spec's §2 prose omits it.

---

## File Structure

**Created**
- `docs/superpowers/plans/2026-08-04-registration-whole-school-followups.md` — deferred manual verification (Task 12).
- `scripts/reset_registration_dev_data.py` — wipe dev registration rows + reseed models (Task 11).
- `enrollx/backend/tests/test_application_model_fields.py` — application-model form-block writes (Task 4).
- `enrollx/backend/tests/test_config_hydration.py` — server-side model hydration (Task 5).
- `papermite/backend/tests/test_finalize_merge.py` — merge rule (Task 7).

**Modified — shared contract**
- `workflow-forms/src/types.ts` — drop `program_id`; add `ENGINE_OWNED_APPLICATION_FIELDS`, `APPLICATION_ENTITY_TYPE`.
- `workflow-forms/src/blockConfig.ts` — add `hydratedFormFields`, `defaultSchoolYear`.
- `workflow-forms/src/index.ts` — export the new names.

**Modified — enrollx backend**
- `app/registration/engine.py` — config lookup, capacity, `create_application`, `tenant_label`, `default_school_year`, `hydrate_config_blocks`; delete `get_program`.
- `app/registration/datacore.py` — add `get_model_definition`.
- `app/registration/actions.py` — email labels, submit capacity, approve (no enrollment), publish_config, application-model field writes.
- `app/registration/emails.py` — `program_label` → `school_label`.
- `app/registration/items.py` — validate `config.entity_type`.
- `app/api/registration.py` — creation body contract.
- `app/api/internal.py` — start/config/request-link signatures, hydration.
- `tests/fakes.py`, `tests/test_*.py` — fixtures follow the contracts.

**Modified — familyhub backend**
- `app/api/registration.py` — `/registration/{tenant_id}` and `/start`, school-year derivation.
- `app/api/application.py` — `RequestLinkBody` drops `program_id`.
- `tests/test_registration_routes.py`, `tests/test_application_routes.py`.

**Modified — papermite backend**
- `app/api/finalize.py` — merge instead of replace.

**Modified — launchpad**
- `app/data/base_model.json` — `registration_config` / `registration_application` drop `program_id`.

**Modified — enrollx frontend**
- `src/App.tsx`, `src/components/AppNav.tsx`, `src/components/BlockConfigPanel.tsx`,
  `src/types/registration.ts`, `src/api/registration.ts`, `src/i18n/translations.ts`,
  `src/pages/{ConfigBuilder,NewApplication,Applications,ApplicationDetail,ApplicationEntry}Page.tsx`.
- **Deleted:** `src/pages/ProgramsPage.tsx`. **Kept:** `src/pages/ProgramsPage.css` — it holds shared classes (`.programs-page`, `.programs-error`, `.programs-muted`, `.program-card`, `.bcp-row`) that four surviving pages import.

**Modified — familyhub frontend**
- `src/App.tsx`, `src/api/facade.ts`, `src/types/registration.ts`, `src/i18n/translations.ts`,
  `src/pages/{Register,Hub,RequestLink}Page.tsx`.

---

## Task 1: workflow-forms contract

**Files:**
- Modify: `workflow-forms/src/types.ts`
- Modify: `workflow-forms/src/blockConfig.ts`
- Modify: `workflow-forms/src/index.ts`

**Interfaces:**
- Consumes: nothing (first task).
- Produces:
  - `RegistrationConfigDef` = `{config_id: string; version: number; status: 'draft'|'published'|'archived'; blocks: FlowBlock[]}` — **no `program_id`**.
  - `ApplicationSummary` — **no `program_id`**.
  - `export const APPLICATION_ENTITY_TYPE = 'registration_application'`
  - `export const ENGINE_OWNED_APPLICATION_FIELDS: readonly string[]`
  - `export function defaultSchoolYear(now?: Date): string`
  - `export interface ModelFieldSource { base_fields: FlowField[]; custom_fields: FlowField[] }`
  - `export function hydratedFormFields(entityType: string, model: ModelFieldSource): FlowField[]`

This package has no test runner (`workflow-forms/package.json` has no `test` script); its verification is that both consuming frontends typecheck against it (Tasks 9 and 10) and `npx tsc --noEmit -p workflow-forms/tsconfig.json` passes here.

- [ ] **Step 1: Drop `program_id` from the two types and add the two constants**

In `workflow-forms/src/types.ts`, replace the `RegistrationConfigDef` interface with:

```ts
export interface RegistrationConfigDef {
  config_id: string;
  version: number;
  status: 'draft' | 'published' | 'archived';
  blocks: FlowBlock[];
}
```

and replace the `ApplicationSummary` interface with:

```ts
/** The slice of a registration_application entity the renderer needs. */
export interface ApplicationSummary {
  application_id: string;
  school_year: string;
  status: ApplicationStatus;
  channel_started: 'parent' | 'admin';
  config_version: number;
  applicant_email?: string;
}
```

Then append to the end of `types.ts`:

```ts
/** The `form` block `entity_type` naming the application itself. */
export const APPLICATION_ENTITY_TYPE = 'registration_application';

/**
 * Base fields of `registration_application` owned by the registration engine.
 *
 * Two consumers, one list: the hosts exclude these when hydrating an
 * application-model form block (a parent must never be shown an editable
 * `status` or `config_version`), and enrollx's engine rejects a form answer
 * that targets one with a 400. The Python side restates it as
 * `engine.ENGINE_OWNED_APPLICATION_FIELDS` — the two MUST stay identical.
 *
 * `registration_application_id` is included even though the spec's field
 * table omits it: DataCore auto-assigns `"{entity_type}_id"` when absent and
 * `create_application` pre-sets it, so it is engine-owned in practice.
 */
export const ENGINE_OWNED_APPLICATION_FIELDS: readonly string[] = [
  'application_id',
  'registration_application_id',
  'school_year',
  'status',
  'family_id',
  'student_id',
  'config_version',
  'channel_started',
  'applicant_email',
  'token_version',
  'draft_data',
  'submitted_at',
  'decided_at',
];
```

- [ ] **Step 2: Add `defaultSchoolYear` and `hydratedFormFields` to blockConfig.ts**

At the top of `workflow-forms/src/blockConfig.ts`, extend the type import to include what the new helpers need:

```ts
import type {
  ApplicationItem, FlowBlock, FlowField, PaymentPlanKind, PaymentPlanOption,
  RegistrationConfigDef, RequiredDoc,
} from './types';
import { APPLICATION_ENTITY_TYPE, ENGINE_OWNED_APPLICATION_FIELDS } from './types';
```

Then append to the end of the file:

```ts
/**
 * The academic year straddling `now`, rolling over each July: `${y}-${y+1}`
 * where `y` is `now`'s year when the month is July or later, else the
 * previous year. `getMonth()` is 0-indexed, so `>= 6` IS July.
 *
 * Lives here so both channels derive the identical default: the staff New
 * Application form prefills it, the parent start page shows it read-only,
 * and familyhub-backend + enrollx restate the same rule in Python
 * (`_school_year_for_date`, `engine.default_school_year`).
 */
export function defaultSchoolYear(now: Date = new Date()): string {
  const y = now.getMonth() >= 6 ? now.getFullYear() : now.getFullYear() - 1;
  return `${y}-${y + 1}`;
}

/** A tenant model definition, as both hosts already hold it. */
export interface ModelFieldSource {
  base_fields: FlowField[];
  custom_fields: FlowField[];
}

/**
 * The fields a `form` block sourced from an entity model should render.
 *
 * THE ONE derivation, shared by every host, because the two rules below are
 * easy to get subtly different and a mistake is visible to parents:
 *
 * 1. The entity's own `{entityType}_id` is auto-generated and never editable
 *    (project convention) — always excluded.
 * 2. For `registration_application` ONLY, the engine owns every base field
 *    (`ENGINE_OWNED_APPLICATION_FIELDS`), so only the tenant's
 *    `custom_fields` are offered — those are the agreement/signature fields
 *    model setup extracted from the real admission packet. The engine-owned
 *    exclusion is deliberately NOT applied to other entity types: `status`
 *    is a perfectly legitimate `student` field and dropping it there would
 *    silently delete a field staff rely on.
 */
export function hydratedFormFields(
  entityType: string, model: ModelFieldSource,
): FlowField[] {
  const isApplication = entityType === APPLICATION_ENTITY_TYPE;
  const fields = isApplication
    ? model.custom_fields
    : [...model.base_fields, ...model.custom_fields];
  const excluded = new Set<string>([`${entityType}_id`]);
  if (isApplication) {
    for (const name of ENGINE_OWNED_APPLICATION_FIELDS) excluded.add(name);
  }
  return fields.filter((f) => !excluded.has(f.name));
}
```

- [ ] **Step 3: Export the new names**

Replace `workflow-forms/src/index.ts` with:

```ts
export * from './types';
export { FlowRenderer, type FlowRendererProps } from './FlowRenderer';
export { flowT, flowTWith, useFlowT, useFlowLocale, type Locale } from './i18n';
export { validateFlowField } from './validateField';
export {
  formFields, docsOf, plansOf, planAmounts, messageBody,
  resolvePlanKind, paymentAmountFor,
  defaultSchoolYear, hydratedFormFields, type ModelFieldSource,
} from './blockConfig';
export { formatCents } from './money';
```

(`APPLICATION_ENTITY_TYPE` and `ENGINE_OWNED_APPLICATION_FIELDS` ride the existing `export * from './types'`.)

- [ ] **Step 4: Typecheck the package**

Run: `cd /Users/kennylee/Development/NeoApex && npx tsc --noEmit -p workflow-forms/tsconfig.json`
Expected: no output (clean). If `FlowRenderer.tsx` or a block file references `config.program_id` / `application.program_id`, it will error here — fix by deleting the reference, not by re-adding the field.

- [ ] **Step 5: Commit**

```bash
git add workflow-forms/src
git commit -m "refactor(workflow-forms): drop program_id, add application-model field helpers"
```

---

## Task 2: enrollx engine — single config lineage, tenant capacity, no programs

**Files:**
- Modify: `enrollx/backend/app/registration/engine.py`
- Modify: `enrollx/backend/tests/fakes.py`
- Modify: `enrollx/backend/tests/test_registration_engine.py`

**Interfaces:**
- Consumes: nothing from Task 1 (Python side is independent).
- Produces:
  - `engine.ENGINE_OWNED_APPLICATION_FIELDS: frozenset[str]`
  - `engine.default_school_year(ref: date | None = None) -> str`
  - `engine.tenant_label(tenant_id, token=None) -> str`
  - `engine.get_published_config(tenant_id, token=None) -> dict | None`
  - `engine.get_config_for_application(tenant_id, app_row, token=None) -> dict | None`
  - `engine.capacity_state(tenant_id, school_year, token=None) -> {"capacity": int|None, "admitted": int, "full": bool}`
  - `engine.is_capacity_full(tenant_id, school_year, token=None) -> bool`
  - `engine.create_application(tenant_id, school_year, channel, applicant_email, actor, token=None) -> {"application": ..., "items": [...]}`
  - **Removed:** `engine.get_program`.
- Test helper produced: `tests.fakes.seed_config(fdc, tenant="acme", capacity=None)` replaces `seed_program_and_config`.

- [ ] **Step 1: Write the failing tests**

Replace the whole of `enrollx/backend/tests/test_registration_engine.py` with the file below. It keeps every surviving behavior test from the original (activity logging, guarded status writes, item creation, sparse-column safety) and rewrites the capacity/config ones onto the new contract.

```python
"""Engine helpers: config lookup (single per-tenant lineage), tenant capacity
counted per school_year, application creation, guarded status writes."""
import json

import pytest
from fastapi import HTTPException

from app.registration import engine
from tests.fakes import BLOCKS, FakeDataCore, install_fake_datacore, seed_config


@pytest.fixture
def fake_dc(monkeypatch):
    fdc = FakeDataCore()
    install_fake_datacore(monkeypatch, fdc)
    return fdc


def seed_tenant(fdc, tenant="acme", capacity=None, name="Acme Afterschool"):
    """The tenant entity's entity_id IS the tenant_id (platform invariant)."""
    base = {"name": name, "display_name": name}
    if capacity is not None:
        base["capacity"] = capacity
    fdc.rows.append(FakeDataCore._store_row(tenant, "tenant", tenant, base))


# ── config lookup ─────────────────────────────────────────────────────────

def test_published_config_is_found_without_a_program(fake_dc):
    seed_config(fake_dc)
    cfg = engine.get_published_config("acme")
    assert cfg is not None and cfg["config_id"] == "cfg1"


def test_published_config_is_none_on_a_tenant_with_no_configs(fake_dc):
    assert engine.get_published_config("emptytenant") is None


def test_config_for_application_resolves_the_pinned_version(fake_dc):
    seed_config(fake_dc)
    fake_dc.dc_create("acme", "registration_config", {
        "config_id": "cfg0", "version": 1, "status": "archived",
        "blocks": json.dumps(BLOCKS)})
    # cfg1 (seeded) is version 2 published; cfg0 is version 1 archived.
    fake_dc.dc_update("acme", "registration_config",
                      fake_dc.find("registration_config", config_id="cfg1")[0]["entity_id"],
                      {"config_id": "cfg1", "version": 2, "status": "published",
                       "blocks": json.dumps(BLOCKS)})
    pinned = engine.get_config_for_application("acme", {"config_version": 1})
    assert pinned["config_id"] == "cfg0"


# ── capacity ──────────────────────────────────────────────────────────────

def test_capacity_state_counts_applications_for_that_school_year_only(fake_dc):
    seed_tenant(fake_dc, capacity=2)
    fake_dc.dc_create("acme", "registration_application", {
        "application_id": "A1", "school_year": "2026-2027", "status": "approved"})
    fake_dc.dc_create("acme", "registration_application", {
        "application_id": "A2", "school_year": "2026-2027", "status": "enrolled"})
    fake_dc.dc_create("acme", "registration_application", {
        "application_id": "A3", "school_year": "2027-2028", "status": "approved"})
    state = engine.capacity_state("acme", "2026-2027")
    assert state == {"capacity": 2, "admitted": 2, "full": True}
    assert engine.capacity_state("acme", "2027-2028") == {
        "capacity": 2, "admitted": 1, "full": False}


def test_capacity_ignores_enrollment_rows(fake_dc):
    """Registration no longer creates enrollment rows, and an enrollment left
    over from the activity-assignment workflow must not consume a seat."""
    seed_tenant(fake_dc, capacity=1)
    fake_dc.dc_create("acme", "enrollment", {
        "student_id": "s1", "program_id": "PR1", "status": "active"})
    assert engine.capacity_state("acme", "2026-2027")["full"] is False


def test_absent_or_zero_tenant_capacity_means_unlimited(fake_dc):
    seed_tenant(fake_dc)  # no capacity at all
    fake_dc.dc_create("acme", "registration_application", {
        "application_id": "A1", "school_year": "2026-2027", "status": "approved"})
    assert engine.capacity_state("acme", "2026-2027") == {
        "capacity": None, "admitted": 1, "full": False}

    fake_dc.rows.clear()
    seed_tenant(fake_dc, capacity=0)
    assert engine.capacity_state("acme", "2026-2027")["capacity"] is None
    assert engine.is_capacity_full("acme", "2026-2027") is False


def test_capacity_state_on_a_tenant_with_no_rows_at_all(fake_dc):
    """First parent visit to a brand-new tenant: neither `school_year` nor
    `status` exists as a column yet. Must not raise (sparse-column rule)."""
    assert engine.capacity_state("brandnew", "2026-2027") == {
        "capacity": None, "admitted": 0, "full": False}


# ── tenant label + default school year ────────────────────────────────────

def test_tenant_label_prefers_display_name_then_name_then_id(fake_dc):
    seed_tenant(fake_dc, name="Acme Afterschool")
    assert engine.tenant_label("acme") == "Acme Afterschool"
    assert engine.tenant_label("nosuchtenant") == "nosuchtenant"


@pytest.mark.parametrize("month,expected", [(7, "2026-2027"), (6, "2025-2026")])
def test_default_school_year_rolls_over_in_july(month, expected):
    import datetime
    assert engine.default_school_year(datetime.date(2026, month, 1)) == expected


# ── application creation ──────────────────────────────────────────────────

def test_create_application_derives_items_and_logs_draft(fake_dc):
    seed_config(fake_dc)
    result = engine.create_application(
        "acme", "2026-2027", "admin", "p@example.com", actor="u1")
    app = result["application"]
    assert app["base_data"]["status"] == "draft"
    assert "program_id" not in app["base_data"]
    assert len(result["items"]) == 4
    acts = fake_dc.find("application_activity", application_id=app["entity_id"])
    assert [a["to_value"] for a in acts] == ["draft"]


def test_create_application_404s_without_a_published_config(fake_dc):
    with pytest.raises(HTTPException) as exc:
        engine.create_application("acme", "2026-2027", "admin", None, actor="u1")
    assert exc.value.status_code == 404
    assert exc.value.detail == "No published registration config for this tenant"


def test_get_program_is_gone(fake_dc):
    """Programs play no role in registration any more (spec §1 decision table)."""
    assert not hasattr(engine, "get_program")


# ── guarded status writes (unchanged behavior, kept as regression cover) ──

def test_set_application_status_guards_and_logs(fake_dc):
    seed_config(fake_dc)
    created = engine.create_application("acme", "2026-2027", "admin", None, actor="u1")
    eid = created["application"]["entity_id"]
    row = engine.require_application("acme", eid)
    engine.set_application_status("acme", row, "submitted", "u1")
    assert fake_dc.get_entity("acme", "registration_application", eid)["status"] == "submitted"
    row = engine.require_application("acme", eid)
    with pytest.raises(HTTPException) as exc:
        engine.set_application_status("acme", row, "draft", "u1")
    assert exc.value.status_code == 409


def test_as_bool_reads_the_stringified_wire_value(fake_dc):
    assert engine.as_bool("false") is False
    assert engine.as_bool("true") is True
    assert engine.as_bool(None) is False
```

- [ ] **Step 2: Update the shared test seed helper**

In `enrollx/backend/tests/fakes.py`, delete `seed_program_and_config` entirely and replace it with:

```python
def seed_config(fdc: FakeDataCore, tenant="acme", capacity=None):
    """Seed the tenant's ONE published registration config.

    `capacity`, when given, is written on the TENANT entity (whose entity_id
    is the tenant_id) — capacity is school-wide now, not per program. The
    tenant row is only created when a capacity is supplied; tests that need a
    named tenant row without a capacity seed it themselves.
    """
    if capacity is not None:
        fdc.rows.append(FakeDataCore._store_row(
            tenant, "tenant", tenant,
            {"name": "Acme Afterschool", "display_name": "Acme Afterschool",
             "capacity": capacity}))
    fdc.dc_create(tenant, "registration_config", {
        "config_id": "cfg1", "version": 1,
        "status": "published", "blocks": json.dumps(BLOCKS)})
```

Also in `fakes.py`, remove `program_id` from the `BLOCKS` comment block if present (it is not) and leave `BLOCKS` otherwise untouched.

- [ ] **Step 3: Run the tests to verify they fail**

Run: `cd /Users/kennylee/Development/NeoApex/enrollx && uv run python -m pytest backend/tests/test_registration_engine.py -v`
Expected: FAIL — `TypeError: get_published_config() missing 1 required positional argument: 'program_id'`, `ImportError: cannot import name 'seed_config'` in other files, and `AttributeError` for `default_school_year` / `tenant_label`.

- [ ] **Step 4: Implement the engine changes**

In `enrollx/backend/app/registration/engine.py`:

(a) Extend the imports at the top:

```python
import json
import uuid
from datetime import date, datetime, timezone
```

(b) Add these module constants directly under `ITEM_DONE_STATUSES`:

```python
# Application statuses that consume a seat against the tenant's capacity.
# Enrollment rows are deliberately NOT counted: approval no longer creates
# one (spec §2), so at admission time applications are the only evidence.
ADMITTED_STATUSES = {"approved", "enrolled"}

# Base fields of registration_application owned by this engine. Restated in
# TypeScript as workflow-forms's ENGINE_OWNED_APPLICATION_FIELDS — the two
# lists MUST stay identical. A form block answer naming one of these is
# rejected with a 400 (actions._apply_application_fields); the hosts also
# exclude them when hydrating an application-model form block.
ENGINE_OWNED_APPLICATION_FIELDS = frozenset({
    "application_id", "registration_application_id", "school_year", "status",
    "family_id", "student_id", "config_version", "channel_started",
    "applicant_email", "token_version", "draft_data", "submitted_at",
    "decided_at",
})
```

(c) **Delete** `get_program` entirely.

(d) Replace `get_published_config` and `get_config_for_application` with:

```python
def get_published_config(tenant_id, token=None):
    """The tenant's single published registration config, or None.

    One lineage per tenant (spec §2): "at most one published config per
    tenant" — `_publish_config` archives any prior published version, so at
    most one row can match. Filtered in Python because on a tenant with no
    registration_config rows yet `status` may not exist as a column at all;
    configs per tenant are a handful.
    """
    rows = rows_matching(tenant_id, "registration_config", token, status="published")
    return rows[0] if rows else None


def get_config_for_application(tenant_id, app_row, token=None):
    """The config version pinned at application start. Archived config
    versions are still `_status = 'active'` rows (only their own `status`
    field says 'archived') — they stay queryable so an in-flight
    application keeps working against the version it was created under
    even after a newer version is published."""
    rows = dc.list_entities(tenant_id, "registration_config", "", token)
    want = int(app_row.get("config_version") or 0)
    for r in rows:
        if int(r.get("version") or 0) == want:
            return r
    return get_published_config(tenant_id, token)
```

(e) Replace `capacity_state` and `is_capacity_full` with:

```python
def _positive_int(value):
    """Coerce a stringly-typed capacity to a positive int, else None.

    Absent, empty, zero, negative and unparseable all mean "unlimited"
    (spec §2: "Absent/zero means unlimited"). Returning None rather than 0
    keeps the caller's `capacity is not None` test meaningful.
    """
    if value in (None, ""):
        return None
    try:
        n = int(float(str(value)))
    except (TypeError, ValueError):
        return None
    return n if n > 0 else None


def get_tenant_row(tenant_id, token=None):
    """The tenant entity row. Its entity_id IS the tenant_id (platform
    invariant, see app/tenant_lookup.py). Read through `dc.get_entity` —
    a module-attribute call, so the test fake's monkeypatch applies."""
    return dc.get_entity(tenant_id, "tenant", tenant_id, token)


def tenant_label(tenant_id, token=None) -> str:
    """Display name for emails and parent-facing headers. Falls back through
    display_name -> name -> the raw tenant_id so a template never renders an
    empty school name."""
    row = get_tenant_row(tenant_id, token) or {}
    return str(row.get("display_name") or row.get("name") or tenant_id)


def default_school_year(ref: date | None = None) -> str:
    """The academic year straddling `ref`, rolling over each July.

    Restates workflow-forms's `defaultSchoolYear()` and familyhub's
    `_school_year_for_date` so all three channels agree. Used server-side
    for the capacity snapshot in the public config bundle, which has no
    school_year of its own to key on.
    """
    d = ref or datetime.now(timezone.utc).date()
    start = d.year if d.month >= 7 else d.year - 1
    return f"{start}-{start + 1}"


def capacity_state(tenant_id, school_year, token=None) -> dict:
    """School-wide admitted count for one school year (spec §2).

    Capacity lives on the TENANT entity; per-program capacity stays on
    `program` for the future activity-assignment workflow and is ignored
    here. Both the tenant read and the application scan are filtered in
    Python for the sparse-column reason: this is reached on a parent's very
    FIRST visit to a new tenant, when neither `school_year` nor `status` is
    a column on registration_application yet and a SQL predicate would
    binder-error into a 500.

    Read-then-decide with no locking, so it is not safe against two
    concurrent submissions racing the boundary — same unresolved-race
    category as `settle_payment_item`'s provider_ref lookup.
    """
    capacity = _positive_int((get_tenant_row(tenant_id, token) or {}).get("capacity"))
    apps = rows_matching(tenant_id, "registration_application", token,
                         school_year=school_year)
    admitted = len([a for a in apps if a.get("status") in ADMITTED_STATUSES])
    full = capacity is not None and admitted >= capacity
    return {"capacity": capacity, "admitted": admitted, "full": full}


def is_capacity_full(tenant_id, school_year, token=None) -> bool:
    """Consulted at exactly ONE place in the lifecycle: the `_submit` gate,
    which routes a submission to `waitlisted` instead of `submitted` when the
    school year is full. `_approve` and `_promote_waitlist` perform NO
    capacity check — staff can admit past a full year deliberately."""
    return capacity_state(tenant_id, school_year, token)["full"]
```

(f) Replace `create_application` with:

```python
def create_application(tenant_id, school_year, channel, applicant_email,
                       actor, token=None) -> dict:
    """Create a draft application pinned to the tenant's currently published
    config, derive its application_item rows from that config's blocks, and
    log the initial draft status. 404s if the tenant has no published config.

    Applications are admission to the school as a whole for one school year
    (spec §1) — there is no program to scope to.
    """
    config = get_published_config(tenant_id, token)
    if config is None:
        raise HTTPException(404, "No published registration config for this tenant")
    app_id = dc.next_id(tenant_id, "registration_application", token)
    base = {
        "application_id": app_id,
        # Pre-set DataCore's auto-ID field so create doesn't mint a second,
        # different id for the same row (DataCore auto-assigns
        # "{entity_type}_id" only when the field is absent).
        "registration_application_id": app_id,
        "school_year": school_year,
        "status": "draft",
        "config_version": int(config.get("version") or 1),
        "channel_started": channel,
        "token_version": 1,
        "draft_data": "{}",
    }
    if applicant_email:
        base["applicant_email"] = applicant_email
    created = dc.dc_create(tenant_id, "registration_application", base, token)
    app_entity_id = created["entity_id"]
    blocks = json.loads(config.get("blocks") or "[]")
    items = [create_application_item(tenant_id, app_entity_id, fields, token)
             for fields in derive_items(blocks)]
    # Initial status is set directly at creation (there is no prior status to
    # transition from), but it is still logged like any other status write.
    log_activity(tenant_id, app_entity_id, "status_change", "", "draft", actor, token)
    return {"application": created, "items": items}
```

- [ ] **Step 5: Run the engine tests to verify they pass**

Run: `cd /Users/kennylee/Development/NeoApex/enrollx && uv run python -m pytest backend/tests/test_registration_engine.py -v`
Expected: PASS (all tests in this file). Other test files will still fail — Task 3 fixes them.

- [ ] **Step 6: Commit**

```bash
git add enrollx/backend/app/registration/engine.py enrollx/backend/tests/fakes.py enrollx/backend/tests/test_registration_engine.py
git commit -m "feat(enrollx): single per-tenant config lineage and school-wide capacity"
```

---

## Task 3: enrollx actions — approval without enrollment, school-year emails, single-lineage publish

**Files:**
- Modify: `enrollx/backend/app/registration/actions.py`
- Modify: `enrollx/backend/app/registration/emails.py`
- Modify: `enrollx/backend/tests/test_actions_approve.py`
- Modify: `enrollx/backend/tests/test_actions_review.py`
- Modify: `enrollx/backend/tests/test_actions_runtime.py`
- Modify: `enrollx/backend/tests/test_actions_config.py`
- Modify: `enrollx/backend/tests/test_registration_emails.py`

**Interfaces:**
- Consumes from Task 2: `engine.tenant_label`, `engine.is_capacity_full(tenant_id, school_year, token)`, `engine.get_published_config(tenant_id, token)`, `tests.fakes.seed_config`.
- Produces:
  - `emails.magic_link_email(school_label, link)`, `emails.submission_receipt_email(school_label, application_display_id)`, `emails.status_change_email(school_label, new_status)`, `emails.action_needed_email(school_label, item_title, reason)` — the first parameter is renamed from `program_label`; call shape is otherwise unchanged.
  - `actions._school_label(tenant_id, app_row, token) -> str` (internal, consumed by Task 5's `internal.py::_send_magic_link`).
  - `_approve` return envelope loses `enrollment_id`; keeps `{"application", "family_id", "student_id"}`.

- [ ] **Step 1: Write the failing tests**

Apply these edits to the existing test files.

In `enrollx/backend/tests/test_actions_approve.py`: change the import to `from tests.fakes import FakeDataCore, install_fake_datacore, seed_config`, replace every `seed_program_and_config(...)` call with `seed_config(...)`, and drop `"program_id": "PR1",` from every creation body literal. Then replace the enrollment assertion (originally around line 75) with these two tests:

```python
def test_approve_creates_family_and_student_but_no_enrollment(client, fake_dc):
    seed_config(fake_dc)
    created = client.post("/api/registration/acme/applications", json={
        "school_year": "2026-2027", "channel": "admin",
        "applicant_email": "parent@example.com"}).json()
    eid = created["application"]["entity_id"]
    client.post(f"/api/registration/acme/applications/{eid}/actions", json={
        "action": "save_draft",
        "draft_data": {"student": {"first_name": "Mia", "last_name": "Chen"},
                       "family": {"family_name": "Chen"}}})
    for item in created["items"]:
        client.post(f"/api/registration/acme/applications/{eid}/actions", json={
            "action": "complete_item", "item_id": item["entity_id"]})
    client.post(f"/api/registration/acme/applications/{eid}/actions",
                json={"action": "submit"})
    resp = client.post(f"/api/registration/acme/applications/{eid}/actions",
                       json={"action": "approve"})
    assert resp.status_code == 200
    body = resp.json()
    assert body["family_id"] and body["student_id"]
    assert "enrollment_id" not in body
    # Registration must not create enrollment rows any more (spec §2):
    # those come from the separate activity-assignment workflow.
    assert fake_dc.find("enrollment") == []
    student = fake_dc.get_entity("acme", "student", body["student_id"])
    assert student["status"] == "Enrolled"
```

In `enrollx/backend/tests/test_actions_runtime.py`: same import/seed/body edits, then replace `test_submit_waitlists_when_program_full` with:

```python
def test_submit_waitlists_when_the_school_year_is_full(client, fake_dc):
    seed_config(fake_dc, capacity=1)
    fake_dc.dc_create("acme", "registration_application", {
        "application_id": "A9", "school_year": "2026-2027", "status": "approved"})
    created = client.post("/api/registration/acme/applications", json={
        "school_year": "2026-2027", "channel": "admin"}).json()
    eid = created["application"]["entity_id"]
    for item in created["items"]:
        client.post(f"/api/registration/acme/applications/{eid}/actions", json={
            "action": "complete_item", "item_id": item["entity_id"]})
    resp = client.post(f"/api/registration/acme/applications/{eid}/actions",
                       json={"action": "submit"})
    assert resp.status_code == 200
    assert resp.json()["application"]["base_data"]["status"] == "waitlisted"


def test_submit_is_not_waitlisted_by_a_different_school_year(client, fake_dc):
    seed_config(fake_dc, capacity=1)
    fake_dc.dc_create("acme", "registration_application", {
        "application_id": "A9", "school_year": "2025-2026", "status": "approved"})
    created = client.post("/api/registration/acme/applications", json={
        "school_year": "2026-2027", "channel": "admin"}).json()
    eid = created["application"]["entity_id"]
    for item in created["items"]:
        client.post(f"/api/registration/acme/applications/{eid}/actions", json={
            "action": "complete_item", "item_id": item["entity_id"]})
    resp = client.post(f"/api/registration/acme/applications/{eid}/actions",
                       json={"action": "submit"})
    assert resp.json()["application"]["base_data"]["status"] == "submitted"
```

In `enrollx/backend/tests/test_actions_config.py`: drop `program_id` from every `draft_config(...)` helper and config literal (change the helper signature to `def draft_config(fake_dc, blocks=BLOCKS, version=1)`), and replace `test_version_scan_is_scoped_per_program` with:

```python
def test_publish_archives_the_tenants_other_published_config(client, fake_dc):
    """One lineage per tenant: publishing must leave exactly one published
    config, whatever the prior one was called."""
    fake_dc.dc_create("acme", "registration_config", {
        "config_id": "cfg-old", "version": 4, "status": "published",
        "blocks": json.dumps(BLOCKS)})
    cfg = draft_config(fake_dc)
    resp = client.post(f"/api/registration/acme/applications/{cfg}/actions",
                       json={"action": "publish_config"})
    assert resp.status_code == 200
    published = [r for r in fake_dc.find("registration_config")
                 if r["status"] == "published"]
    assert len(published) == 1
    assert published[0]["entity_id"] == cfg
    # version continues the tenant's own lineage, not a per-program one
    assert int(published[0]["version"]) == 5
```

In `enrollx/backend/tests/test_actions_review.py`: same import/seed/body edits; rename `test_resend_link_email_subject_keeps_the_program_name` to `test_resend_link_email_subject_keeps_the_school_label` and assert on the tenant name instead:

```python
def test_resend_link_email_subject_keeps_the_school_label(client, fake_dc):
    """Regression: `update_application` returns an ENVELOPE, not a flattened
    row, so rebinding app_row from it silently emptied the email subject."""
    seed_config(fake_dc, capacity=10)  # seeds the named tenant row too
    created = client.post("/api/registration/acme/applications", json={
        "school_year": "2026-2027", "channel": "admin",
        "applicant_email": "parent@example.com"}).json()
    eid = created["application"]["entity_id"]
    resp = client.post(f"/api/registration/acme/applications/{eid}/actions",
                       json={"action": "resend_link"})
    assert resp.status_code == 200
    acts = [a for a in fake_dc.find("application_activity", application_id=eid)
            if a["type"] == "email_sent"]
    assert any("magic_link:" in a["to_value"] for a in acts)
```

In `enrollx/backend/tests/test_registration_emails.py`: rename every `program_label` argument/local to `school_label` and every literal like `"Fall 2026 Afterschool"` to `"Acme Afterschool 2026-2027"`. The escaping assertions keep their existing shape.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd /Users/kennylee/Development/NeoApex/enrollx && uv run python -m pytest backend/tests/test_actions_approve.py backend/tests/test_actions_runtime.py backend/tests/test_actions_config.py backend/tests/test_actions_review.py backend/tests/test_registration_emails.py -v`
Expected: FAIL — `assert fake_dc.find("enrollment") == []` fails (an enrollment row is created), `is_capacity_full()` gets the wrong argument, and `magic_link_email()` still names its parameter `program_label`.

- [ ] **Step 3: Rename the email template parameter**

In `enrollx/backend/app/registration/emails.py`, rename the first parameter of all four v1 templates from `program_label` to `school_label`, and update the internal locals accordingly. The four signatures become:

```python
def magic_link_email(school_label: str, link: str) -> tuple[str, str]:
def submission_receipt_email(school_label: str, application_display_id: str) -> tuple[str, str]:
def status_change_email(school_label: str, new_status: str) -> tuple[str, str]:
def action_needed_email(school_label: str, item_title: str, reason: str) -> tuple[str, str]:
```

Inside each, rename `safe_label = html.escape(program_label)` → `safe_label = html.escape(school_label)` (and `safe_program_label` in `status_change_email` → `safe_school_label`), and replace every `{program_label}` in a subject line with `{school_label}`. Update the section comment above them to:

```python
# ── v1 templates ──────────────────────────────────────────────────────────
#
# `school_label` is the tenant's display name plus the school year (spec §5:
# "program name replaced by tenant display name + school year"). Built by
# `actions._school_label`; never a program name.
```

- [ ] **Step 4: Rewrite the action handlers**

In `enrollx/backend/app/registration/actions.py`:

(a) Replace `_program_label` with:

```python
def _school_label(tenant_id, app_row, token=None) -> str:
    """The label every v1 email uses: the school's display name plus the
    school year (spec §5). Replaces the former program name — registration
    is admission to the school as a whole now, so there is no program to
    name."""
    year = str(app_row.get("school_year", "")).strip()
    label = engine.tenant_label(tenant_id, token)
    return f"{label} {year}".strip()
```

Then update every call site in this module: `_program_label(app_row)` → `_school_label(tenant_id, app_row, token)`. There are five (`_submit` ×2, `_reject_item`, `_request_changes`, `_decline`, `_resend_link` — six occurrences in total). Keep the existing comment in `_resend_link` about not rebinding `app_row`, adjusting its wording from "loses the program name" to "loses the school label".

(b) In `_submit`, replace the capacity line:

```python
    full = engine.is_capacity_full(tenant_id, app_row.get("school_year", ""), token)
```

(c) In `_approve`, delete the entire "# 3. Enrollment" block (the `dc.dc_create(tenant_id, "enrollment", {...})` call), renumber the following comments 3./4./5./6., and change the final return to:

```python
    # 6. Straight to enrolled if nothing remains open
    enrolled = _maybe_enroll(tenant_id, application_entity_id, actor, token)
    return {"application": enrolled or updated,
            "family_id": family_id,
            "student_id": student["entity_id"]}
```

Add this note directly above the (now) step-3 student write:

```python
    # NOTE (spec §2): approval creates family + student and starts the
    # post-approval due-date clocks — and nothing else. It deliberately does
    # NOT create an `enrollment` row: enrollments mean "assigned to an
    # activity", which is a separate staff workflow in AdminDash. The
    # application's own `approved`/`enrolled` status is the record of
    # admission.
```

(d) In `_publish_config`, replace the `program_id`/`siblings` lookup and the archive comment with:

```python
    # One lineage per tenant (spec §2): every registration_config row in the
    # tenant is a sibling. Item derivation assumes exactly one published
    # config, so two left `published` at once would make it ambiguous which
    # one a new application derives its items from.
    siblings = dc.list_entities(tenant_id, "registration_config", "", token)
```

and in the version-scan `else` branch, change the comment "Scan ALL configs for the program" to "Scan ALL configs for the tenant".

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd /Users/kennylee/Development/NeoApex/enrollx && uv run python -m pytest backend/tests/test_actions_approve.py backend/tests/test_actions_runtime.py backend/tests/test_actions_config.py backend/tests/test_actions_review.py backend/tests/test_registration_emails.py -v`
Expected: PASS. `test_applications_api.py` / `test_internal_api.py` still fail — Task 5 fixes them.

- [ ] **Step 6: Commit**

```bash
git add enrollx/backend/app/registration/actions.py enrollx/backend/app/registration/emails.py enrollx/backend/tests
git commit -m "feat(enrollx): approval stops creating enrollments; school-year emails and capacity"
```

---

## Task 4: enrollx — application-model form blocks write to the application

**Files:**
- Create: `enrollx/backend/tests/test_application_model_fields.py`
- Modify: `enrollx/backend/app/registration/actions.py`
- Modify: `enrollx/backend/app/registration/items.py`

**Interfaces:**
- Consumes from Task 2: `engine.ENGINE_OWNED_APPLICATION_FIELDS`, `engine.get_config_for_application`, `engine.update_application`.
- Consumes from Task 3: the rewritten `_complete_item` / `_submit` bodies.
- Produces:
  - `actions.APPLICATION_ENTITY_TYPE = "registration_application"`
  - `actions._apply_application_fields(tenant_id, app_row, block_ids, token) -> dict | None`
  - `items.FORM_ENTITY_TYPES = {"student", "family", "contact", "registration_application"}`

**Ordering rule this task must honor (easy to get wrong):** `engine.update_application` and `engine.set_application_status` both rebuild the full `base_data` from the FLATTENED row they are handed. Writing fields with a stale `app_row` therefore silently discards whatever the other write just persisted. So: in `_complete_item`, apply the fields **after** any status write, from a freshly re-fetched row; in `_submit`, apply them **before** the status write and re-fetch afterwards.

- [ ] **Step 1: Write the failing test**

Create `enrollx/backend/tests/test_application_model_fields.py`:

```python
"""A `form` block with entity_type=registration_application writes its answers
onto the application entity's own base_data (spec §4 rule 2)."""
import json

import pytest
from fastapi.testclient import TestClient

from app.auth import require_authenticated_user
from app.main import app
from tests.fakes import FakeDataCore, install_fake_datacore

APP_FORM_BLOCKS = [
    {"block_id": "b1", "type": "form", "title": "Agreement", "required": True,
     "blocking": True, "config": {"entity_type": "registration_application"}},
    {"block_id": "b9", "type": "review", "title": "Review", "required": True,
     "blocking": False, "config": {}},
]


@pytest.fixture
def fake_dc(monkeypatch):
    fdc = FakeDataCore()
    install_fake_datacore(monkeypatch, fdc)
    fdc.dc_create("acme", "registration_config", {
        "config_id": "cfg1", "version": 1, "status": "published",
        "blocks": json.dumps(APP_FORM_BLOCKS)})
    return fdc


@pytest.fixture
def client(fake_dc):
    app.dependency_overrides[require_authenticated_user] = lambda: {
        "user_id": "u1", "tenant_id": "acme", "role": "admin", "_token": "Bearer x"}
    yield TestClient(app)
    app.dependency_overrides.clear()


def create(client):
    return client.post("/api/registration/acme/applications", json={
        "school_year": "2026-2027", "channel": "admin"}).json()


def act(client, eid, **payload):
    return client.post(f"/api/registration/acme/applications/{eid}/actions", json=payload)


def test_custom_field_answer_lands_on_application_base_data(client, fake_dc):
    created = create(client)
    eid = created["application"]["entity_id"]
    item = created["items"][0]
    act(client, eid, action="save_draft", draft_data={
        "b1": {"agreement_signed_by": "Wei Chen", "initials": "WC"}})
    resp = act(client, eid, action="complete_item", item_id=item["entity_id"])
    assert resp.status_code == 200
    row = fake_dc.get_entity("acme", "registration_application", eid)
    assert row["agreement_signed_by"] == "Wei Chen"
    assert row["initials"] == "WC"


def test_answer_survives_submit_and_approval(client, fake_dc):
    created = create(client)
    eid = created["application"]["entity_id"]
    act(client, eid, action="save_draft", draft_data={
        "b1": {"agreement_signed_by": "Wei Chen"},
        "student": {"first_name": "Mia", "last_name": "Chen"},
        "family": {"family_name": "Chen"}})
    act(client, eid, action="complete_item", item_id=created["items"][0]["entity_id"])
    assert act(client, eid, action="submit").status_code == 200
    assert act(client, eid, action="approve").status_code == 200
    row = fake_dc.get_entity("acme", "registration_application", eid)
    assert row["agreement_signed_by"] == "Wei Chen"
    assert row["status"] in {"approved", "enrolled"}


def test_submit_applies_answers_even_without_complete_item(client, fake_dc):
    """`_submit` applies every application-model block, so a non-blocking
    block the parent never explicitly completed still records its answers."""
    created = create(client)
    eid = created["application"]["entity_id"]
    act(client, eid, action="save_draft", draft_data={"b1": {"initials": "WC"}})
    act(client, eid, action="complete_item", item_id=created["items"][0]["entity_id"])
    act(client, eid, action="save_draft", draft_data={"b1": {"initials": "XY"}})
    assert act(client, eid, action="submit").status_code == 200
    row = fake_dc.get_entity("acme", "registration_application", eid)
    assert row["initials"] == "XY"


@pytest.mark.parametrize("field", ["status", "config_version", "application_id",
                                   "token_version", "draft_data"])
def test_engine_owned_field_write_is_rejected_400(client, fake_dc, field):
    created = create(client)
    eid = created["application"]["entity_id"]
    act(client, eid, action="save_draft", draft_data={"b1": {field: "hacked"}})
    resp = act(client, eid, action="complete_item",
               item_id=created["items"][0]["entity_id"])
    assert resp.status_code == 400
    detail = resp.json()["detail"]
    assert field in detail["fields"]
    row = fake_dc.get_entity("acme", "registration_application", eid)
    assert row["status"] == "draft"  # nothing was written


def test_a_student_form_block_does_not_touch_the_application(client, fake_dc):
    """Only entity_type=registration_application blocks write to the
    application; a student block's answers stay in draft_data staging."""
    fake_dc.rows = [r for r in fake_dc.rows if r["entity_type"] != "registration_config"]
    fake_dc.dc_create("acme", "registration_config", {
        "config_id": "cfg2", "version": 1, "status": "published",
        "blocks": json.dumps([
            {"block_id": "s1", "type": "form", "title": "Student", "required": True,
             "blocking": True, "config": {"entity_type": "student"}},
            {"block_id": "b9", "type": "review", "title": "Review", "required": True,
             "blocking": False, "config": {}}])})
    created = create(client)
    eid = created["application"]["entity_id"]
    act(client, eid, action="save_draft", draft_data={"s1": {"first_name": "Mia"}})
    act(client, eid, action="complete_item", item_id=created["items"][0]["entity_id"])
    row = fake_dc.get_entity("acme", "registration_application", eid)
    assert "first_name" not in row
    assert json.loads(row["draft_data"])["s1"] == {"first_name": "Mia"}
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd /Users/kennylee/Development/NeoApex/enrollx && uv run python -m pytest backend/tests/test_application_model_fields.py -v`
Expected: FAIL — `KeyError: 'agreement_signed_by'` (the answers stay in `draft_data`) and the 400 tests return 200.

- [ ] **Step 3: Implement the write path in actions.py**

Add near the top of `enrollx/backend/app/registration/actions.py`, under `COMPLETE_ITEM_APP_STATUSES`:

```python
# The `form` block entity_type naming the application itself. Restated in
# TypeScript as workflow-forms's APPLICATION_ENTITY_TYPE.
APPLICATION_ENTITY_TYPE = "registration_application"
```

Then add these two helpers to the "shared helpers" section, after `_maybe_enroll`:

```python
def _application_form_blocks(tenant_id, app_row, token):
    """Form blocks of this application's pinned config that draw from the
    tenant's `registration_application` model."""
    cfg = engine.get_config_for_application(tenant_id, app_row, token)
    try:
        blocks = json.loads((cfg or {}).get("blocks") or "[]")
    except json.JSONDecodeError:
        return []
    return [b for b in blocks
            if isinstance(b, dict) and b.get("type") == "form"
            and (b.get("config") or {}).get("entity_type") == APPLICATION_ENTITY_TYPE]


def _apply_application_fields(tenant_id, app_row, block_ids, token):
    """Copy an application-model form block's answers onto the application's
    own base_data (spec §4 rule 2). Returns the update envelope, or None when
    there was nothing to write.

    Why base_data and not draft_data: these are application-level FACTS —
    signatures, initials, the agreement's signer — not staging for a student
    or family row that approval will later materialize. They belong on the
    application entity, and they must outlive `draft_data`.

    `block_ids` is a set to restrict to (complete_item's single block) or
    None for every application-model block (submit).

    CALLER ORDERING (load-bearing): `engine.update_application` rebuilds the
    whole base_data from the FLATTENED `app_row` it is given, so calling this
    with a row fetched before some other write in the same handler silently
    discards that write. Pass a freshly re-fetched row, and never interleave
    this with `set_application_status` on the same stale row.
    """
    blocks = [b for b in _application_form_blocks(tenant_id, app_row, token)
              if block_ids is None or b.get("block_id") in block_ids]
    if not blocks:
        return None
    try:
        draft = json.loads(app_row.get("draft_data") or "{}")
    except json.JSONDecodeError:
        return None
    answers = {}
    for b in blocks:
        section = draft.get(b.get("block_id"))
        if isinstance(section, dict):
            answers.update(section)
    if not answers:
        return None
    illegal = sorted(k for k in answers if k in engine.ENGINE_OWNED_APPLICATION_FIELDS)
    if illegal:
        # 400 before any write: a form must never be able to move an
        # application's status, repoint its config_version, or rewrite the
        # email its magic link was delivered to. The builder and both hosts
        # already exclude these fields from an application-model block, so
        # reaching here means a hand-authored config or a crafted draft.
        raise HTTPException(400, {
            "error": "Form answers may not write engine-owned application fields",
            "fields": illegal,
        })
    return engine.update_application(tenant_id, app_row, answers, token)
```

In `_complete_item`, replace the tail of the function (from `result = {"item": updated_item}`) with:

```python
    result = {"item": updated_item}
    if status == "pending_items":
        items = engine.get_items(tenant_id, application_entity_id, token)
        if not any(i.get("status") == "rejected" for i in items):
            result["application"] = engine.set_application_status(
                tenant_id, app_row, "in_review", actor, token)
    # LAST, and from a re-fetched row: the status write above (when it ran)
    # rebuilt base_data from `app_row`, so applying fields from that same
    # stale row would drop the status change.
    fresh = engine.require_application(tenant_id, application_entity_id, token)
    applied = _apply_application_fields(tenant_id, fresh, {item.get("block_id")}, token)
    if applied:
        result["application"] = applied
    return result
```

In `_submit`, insert the application-field write between the blocking-items check and the capacity check:

```python
    if incomplete:
        raise HTTPException(409, {"error": "Blocking items incomplete", "items": incomplete})
    # BEFORE the status write, then re-fetch: `set_application_status` rebuilds
    # base_data from the row it is handed, so a stale row would drop these.
    if _apply_application_fields(tenant_id, app_row, None, token):
        app_row = engine.require_application(tenant_id, application_entity_id, token)
    full = engine.is_capacity_full(tenant_id, app_row.get("school_year", ""), token)
```

- [ ] **Step 4: Validate `config.entity_type` at publish time**

In `enrollx/backend/app/registration/items.py`, add under `PLAN_TYPES`:

```python
# The entity models a `form` block may draw from. `registration_application`
# is the tenant's own application model (spec §4); its answers are written
# onto the application entity rather than staged in draft_data.
FORM_ENTITY_TYPES = {"student", "family", "contact", "registration_application"}
```

and inside `validate_blocks`, immediately before the `if btype == "documents":` branch:

```python
        if btype == "form":
            et = cfg.get("entity_type")
            if et is not None and et not in FORM_ENTITY_TYPES:
                errors.append(
                    f"{where}: config.entity_type must be one of "
                    f"{sorted(FORM_ENTITY_TYPES)}")
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd /Users/kennylee/Development/NeoApex/enrollx && uv run python -m pytest backend/tests/test_application_model_fields.py backend/tests/test_registration_items.py -v`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add enrollx/backend/app/registration/actions.py enrollx/backend/app/registration/items.py enrollx/backend/tests/test_application_model_fields.py
git commit -m "feat(enrollx): application-model form blocks write to application base_data"
```

---

## Task 5: enrollx routes — creation contract, internal routes, server-side model hydration

**Files:**
- Modify: `enrollx/backend/app/api/registration.py`
- Modify: `enrollx/backend/app/api/internal.py`
- Modify: `enrollx/backend/app/registration/datacore.py`
- Modify: `enrollx/backend/app/registration/engine.py`
- Modify: `enrollx/backend/tests/test_applications_api.py`
- Modify: `enrollx/backend/tests/test_internal_api.py`
- Modify: `enrollx/backend/tests/fakes.py`
- Create: `enrollx/backend/tests/test_config_hydration.py`

**Interfaces:**
- Consumes from Tasks 2–4: `engine.create_application(tenant_id, school_year, channel, applicant_email, actor, token)`, `engine.capacity_state(tenant_id, school_year, token)`, `engine.default_school_year()`, `engine.tenant_label`, `actions._school_label`.
- Produces:
  - `dc.get_model_definition(tenant_id, entity_type, token=None) -> dict | None`
  - `engine.hydrate_config_blocks(tenant_id, config_row, token=None) -> dict | None`
  - `POST /api/registration/{tenant_id}/applications` body `{school_year, channel, applicant_email?}`, extra keys → 422.
  - `POST /internal/registration/{tenant_id}/start` body `{school_year, applicant_email}` → `201 {application, items, token, link}`.
  - `GET /internal/registration/{tenant_id}/config` → `{config, tenant: {tenant_id, name}, capacity: {capacity, admitted, full}}`.
  - `POST /internal/registration/{tenant_id}/request-link` body `{email}`.
- Test helper produced: `tests.fakes.install_fake_datacore` also stubs `get_model_definition`; `FakeDataCore.set_model(tenant, entity_type, definition)`.

**Why hydration is here (beyond the spec's literal text):** `workflow-forms` never fetches anything — the host supplies `config.fields` for a form block that draws from an entity model. The enrollx frontend does that itself, but **familyhub holds no DataCore credential at all**, so on the parent channel an entity-sourced form block currently renders zero fields. Spec §4 says a tenant's customized application fields must appear "without touching the builder"; on the parent channel that is only true if enrollx hydrates before serving the config. This closes that gap for both `student`-style blocks and the new application-model block.

- [ ] **Step 1: Write the failing tests**

Rewrite `enrollx/backend/tests/test_applications_api.py`'s body constant and add the contract tests:

```python
BODY = {"school_year": "2026-2027", "channel": "admin",
        "applicant_email": "parent@example.com"}
```

Replace `test_create_application_404_without_config` and add two contract tests:

```python
def test_create_application_404_without_config(client, fake_dc):
    resp = client.post("/api/registration/acme/applications", json=BODY)
    assert resp.status_code == 404
    assert resp.json()["detail"] == "No published registration config for this tenant"


def test_create_application_rejects_program_id_422(client, fake_dc):
    """Shim-free cutover: a caller still sending program_id must fail loudly,
    not have it silently ignored (spec §8)."""
    seed_config(fake_dc)
    resp = client.post("/api/registration/acme/applications",
                       json={**BODY, "program_id": "PR1"})
    assert resp.status_code == 422


def test_create_application_requires_school_year_422(client, fake_dc):
    seed_config(fake_dc)
    resp = client.post("/api/registration/acme/applications",
                       json={"channel": "admin"})
    assert resp.status_code == 422
```

(and change the import + every `seed_program_and_config(...)` to `seed_config(...)`.)

In `enrollx/backend/tests/test_internal_api.py`: change the import to `seed_config`, replace every `/internal/registration/acme/PR1/...` path with `/internal/registration/acme/...`, change `start()` to post to `/internal/registration/acme/start`, drop `"program_id": "PR1"` from the request-link body, and replace the config-bundle test with:

```python
def test_config_bundle_shape(client, fake_dc):
    seed_config(fake_dc, capacity=10)
    resp = client.get("/internal/registration/acme/config", headers=KEY)
    assert resp.status_code == 200
    data = resp.json()
    assert set(data) == {"config", "tenant", "capacity"}
    assert data["config"]["config_id"] == "cfg1"
    assert data["tenant"] == {"tenant_id": "acme", "name": "Acme Afterschool"}
    assert data["capacity"] == {"capacity": 10, "admitted": 0, "full": False}


def test_config_bundle_404s_without_a_published_config(client, fake_dc):
    assert client.get("/internal/registration/emptytenant/config",
                      headers=KEY).status_code == 404
```

Also update `test_all_internal_routes_require_key` to the new paths.

Create `enrollx/backend/tests/test_config_hydration.py`:

```python
"""enrollx hydrates entity-model form fields before serving a config to
familyhub — the parent channel has no DataCore access of its own."""
import json

import pytest
from fastapi.testclient import TestClient

from app.config import settings
from app.main import app
from tests.fakes import FakeDataCore, install_fake_datacore

KEY = {"X-Internal-Key": "dev-internal-key-change-in-prod"}

BLOCKS = [
    {"block_id": "s1", "type": "form", "title": "Student", "required": True,
     "blocking": True, "config": {"entity_type": "student"}},
    {"block_id": "a1", "type": "form", "title": "Agreement", "required": True,
     "blocking": True, "config": {"entity_type": "registration_application"}},
    {"block_id": "c1", "type": "form", "title": "Extra", "required": False,
     "blocking": False, "config": {"custom_fields": [
         {"name": "nickname", "type": "str", "required": False}]}},
    {"block_id": "r1", "type": "review", "title": "Review", "required": True,
     "blocking": False, "config": {}},
]


@pytest.fixture
def fake_dc(monkeypatch):
    fdc = FakeDataCore()
    install_fake_datacore(monkeypatch, fdc)
    monkeypatch.setattr(settings, "internal_key", "dev-internal-key-change-in-prod")
    fdc.rows.append(FakeDataCore._store_row("acme", "tenant", "acme", {
        "name": "Acme Afterschool", "display_name": "Acme Afterschool"}))
    fdc.dc_create("acme", "registration_config", {
        "config_id": "cfg1", "version": 1, "status": "published",
        "blocks": json.dumps(BLOCKS)})
    fdc.set_model("acme", "student", {
        "base_fields": [{"name": "student_id", "type": "str", "required": True},
                        {"name": "first_name", "type": "str", "required": True}],
        "custom_fields": [{"name": "allergies", "type": "str", "required": False}]})
    fdc.set_model("acme", "registration_application", {
        "base_fields": [{"name": "application_id", "type": "str", "required": True},
                        {"name": "school_year", "type": "str", "required": True}],
        "custom_fields": [{"name": "agreement_signed_by", "type": "str", "required": True},
                          {"name": "initials", "type": "str", "required": False}]})
    return fdc


@pytest.fixture
def client(fake_dc):
    return TestClient(app)


def blocks_of(payload):
    return {b["block_id"]: b for b in json.loads(payload["config"]["blocks"])}


def test_student_block_gets_base_plus_custom_minus_the_id_field(client, fake_dc):
    body = client.get("/internal/registration/acme/config", headers=KEY).json()
    fields = [f["name"] for f in blocks_of(body)["s1"]["config"]["fields"]]
    assert fields == ["first_name", "allergies"]


def test_application_block_gets_custom_fields_only(client, fake_dc):
    body = client.get("/internal/registration/acme/config", headers=KEY).json()
    fields = [f["name"] for f in blocks_of(body)["a1"]["config"]["fields"]]
    assert fields == ["agreement_signed_by", "initials"]


def test_builder_authored_block_is_left_alone(client, fake_dc):
    body = client.get("/internal/registration/acme/config", headers=KEY).json()
    assert "fields" not in blocks_of(body)["c1"]["config"]


def test_a_missing_model_degrades_to_no_fields_not_a_500(client, fake_dc):
    fake_dc.models.clear()
    resp = client.get("/internal/registration/acme/config", headers=KEY)
    assert resp.status_code == 200
    assert blocks_of(resp.json())["s1"]["config"]["fields"] == []


def test_token_bundle_is_hydrated_too(client, fake_dc):
    started = client.post("/internal/registration/acme/start", headers=KEY, json={
        "school_year": "2026-2027", "applicant_email": "p@example.com"}).json()
    body = client.get(f"/internal/application-by-token/{started['token']}",
                      headers=KEY).json()
    fields = [f["name"] for f in blocks_of(body)["a1"]["config"]["fields"]]
    assert fields == ["agreement_signed_by", "initials"]
```

Extend `enrollx/backend/tests/fakes.py`: add a model store to `FakeDataCore.__init__` and two methods, then register the stub.

```python
    def __init__(self):
        self.rows: list[dict] = []
        self.models: dict[tuple[str, str], dict] = {}
        self.seq = 0
```

```python
    # ── models table (used by config hydration) ───────────────────────────
    def set_model(self, tenant_id, entity_type, definition):
        """Seed one entity type's model definition for this tenant."""
        self.models[(tenant_id, entity_type)] = definition

    def get_model_definition(self, tenant_id, entity_type, token=None):
        return self.models.get((tenant_id, entity_type))
```

and in `install_fake_datacore`, extend the loop tuple to:

```python
    for name in ("dc_create", "dc_update", "next_id", "list_entities", "get_entity",
                 "get_model_definition"):
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd /Users/kennylee/Development/NeoApex/enrollx && uv run python -m pytest backend/tests/test_applications_api.py backend/tests/test_internal_api.py backend/tests/test_config_hydration.py -v`
Expected: FAIL — 404s on `/internal/registration/acme/config` (route still has `{program_id}`), `program_id` accepted with 201 instead of 422, `AttributeError: 'FakeDataCore' object has no attribute 'set_model'` before the edit above.

- [ ] **Step 3: Add the model read to datacore.py**

In `enrollx/backend/app/registration/datacore.py`, add `import json` at the top and append:

```python
def get_model_definition(tenant_id: str, entity_type: str,
                         token: str | None = None) -> dict | None:
    """One entity type's model definition from the tenant's `models` table.

    Separate from the entity helpers because it targets a different table and
    a different row shape. Returns None when the tenant has no model for this
    type, or when the stored definition is unusable — callers must degrade to
    "no fields" rather than failing a parent's registration over a model that
    was never set up.
    """
    _validate_id(tenant_id, "tenant_id")
    _validate_id(entity_type, "entity_type")
    rows = dc_query(
        tenant_id,
        f"SELECT * FROM data WHERE entity_type = {sql_literal(entity_type)} "
        f"AND _status = 'active'",
        token, table="models")
    if not rows:
        return None
    raw = rows[0].get("model_definition")
    if isinstance(raw, str):
        try:
            raw = json.loads(raw)
        except json.JSONDecodeError:
            return None
    return raw if isinstance(raw, dict) else None
```

- [ ] **Step 4: Add hydration to engine.py**

Append to `enrollx/backend/app/registration/engine.py`:

```python
def model_form_fields(tenant_id, entity_type, token=None) -> list[dict]:
    """The fields a form block sourced from `entity_type` should render.

    Python twin of workflow-forms's `hydratedFormFields` — the two must agree,
    because the same config is rendered by the staff host (which hydrates in
    TypeScript) and the parent host (which receives this).

    Rules: the entity's own `{entity_type}_id` is auto-generated and never
    editable, so it is always dropped; for `registration_application` the
    engine owns every base field, so only the tenant's custom fields are
    offered. The engine-owned exclusion is NOT applied to other entity types
    — `status` is a legitimate student field.

    Never raises: a tenant with no models table, no model for this type, or a
    malformed definition all degrade to `[]`. A missing model must not 500 a
    parent's registration page.
    """
    try:
        model = dc.get_model_definition(tenant_id, entity_type, token) or {}
    except HTTPException:
        return []
    base = [f for f in (model.get("base_fields") or []) if isinstance(f, dict)]
    custom = [f for f in (model.get("custom_fields") or []) if isinstance(f, dict)]
    if entity_type == "registration_application":
        fields = custom
        excluded = {f"{entity_type}_id"} | set(ENGINE_OWNED_APPLICATION_FIELDS)
    else:
        fields = base + custom
        excluded = {f"{entity_type}_id"}
    return [f for f in fields if f.get("name") not in excluded]


def hydrate_config_blocks(tenant_id, config_row, token=None):
    """Return `config_row` with every entity-sourced form block carrying a
    resolved `config.fields` list.

    workflow-forms never fetches anything: the HOST supplies `config.fields`.
    The enrollx frontend does that itself, but familyhub holds no DataCore
    credential at all, so without this an entity-sourced form block renders
    zero fields on the parent channel — the channel that matters most.
    Builder-authored blocks (`config.custom_fields`, no `entity_type`) are
    left untouched; `formFields()` already prefers a hydrated list when one
    is present.
    """
    if not config_row:
        return config_row
    try:
        blocks = json.loads(config_row.get("blocks") or "[]")
    except json.JSONDecodeError:
        return config_row
    cache: dict[str, list[dict]] = {}
    changed = False
    for b in blocks:
        if not isinstance(b, dict) or b.get("type") != "form":
            continue
        cfg = dict(b.get("config") or {})
        entity_type = cfg.get("entity_type")
        if not isinstance(entity_type, str) or not entity_type:
            continue
        if entity_type not in cache:
            cache[entity_type] = model_form_fields(tenant_id, entity_type, token)
        cfg["fields"] = cache[entity_type]
        b["config"] = cfg
        changed = True
    if not changed:
        return config_row
    out = dict(config_row)
    out["blocks"] = json.dumps(blocks)
    return out
```

- [ ] **Step 5: Rewrite the creation route**

Replace the `ApplicationCreate` model and `create_application` route in `enrollx/backend/app/api/registration.py`:

```python
from fastapi import APIRouter, Depends
from pydantic import BaseModel, ConfigDict


class ApplicationCreate(BaseModel):
    """Whole-school application creation (spec §3).

    `extra="forbid"` is load-bearing, not tidiness: this is a shim-free
    cutover, so a caller still sending `program_id` must get a loud 422
    rather than have it silently dropped and a subtly wrong application
    created.
    """
    model_config = ConfigDict(extra="forbid")

    school_year: str
    channel: Literal["parent", "admin"]
    applicant_email: str | None = None


@router.post("/registration/{tenant_id}/applications", status_code=201)
def create_application(tenant_id: str, body: ApplicationCreate,
                       user=Depends(require_staff_tenant)):
    return engine.create_application(
        tenant_id, body.school_year, body.channel, body.applicant_email,
        actor=user.get("user_id", "staff"), token=user.get("_token"))
```

- [ ] **Step 6: Rewrite the internal routes**

In `enrollx/backend/app/api/internal.py`:

(a) Replace `RequestLinkRequest` with:

```python
class RequestLinkRequest(BaseModel):
    email: str
```

(b) Replace `_send_magic_link`, `start_application`, `public_config` and the `request_link` body loop:

```python
def _send_magic_link(tenant_id, app_row):
    link_token = tokens.make_link_token(tenant_id, app_row["entity_id"],
                                        int(app_row.get("token_version") or 1))
    link = tokens.magic_link_url(link_token)
    subject, body_html = emails.magic_link_email(
        _school_label(tenant_id, app_row), link)
    emails.send_application_email(tenant_id, app_row["entity_id"], "magic_link",
                                  app_row.get("applicant_email", ""), subject, body_html)
    return link_token, link


@router.post("/internal/registration/{tenant_id}/start", status_code=201)
def start_application(tenant_id: str, body: StartRequest):
    result = engine.create_application(tenant_id, body.school_year,
                                       "parent", body.applicant_email, actor="parent")
    app_row = engine.require_application(tenant_id, result["application"]["entity_id"])
    link_token, link = _send_magic_link(tenant_id, app_row)
    return {**result, "token": link_token, "link": link}


@router.get("/internal/registration/{tenant_id}/config")
def public_config(tenant_id: str):
    """The parent-facing bundle (spec §3). `capacity` is a snapshot for the
    CURRENT default school year — this route has no school_year of its own,
    and `default_school_year()` is the same July-rollover rule the parent
    start page and the staff form both use, so the "we're full" notice a
    parent sees matches the year their application will be created under."""
    config = engine.get_published_config(tenant_id)
    if not config:
        raise HTTPException(404, "This school is not open for registration")
    return {
        "config": engine.hydrate_config_blocks(tenant_id, config),
        "tenant": {"tenant_id": tenant_id, "name": engine.tenant_label(tenant_id)},
        "capacity": engine.capacity_state(tenant_id, engine.default_school_year()),
    }
```

Add the import `from app.registration.actions import PARENT_ACTIONS, _school_label, perform_action` (extend the existing `actions` import line).

In `request_link`, delete the two lines:

```python
        if body.program_id and app_row.get("program_id") != body.program_id:
            continue
```

(c) In `application_by_token`, hydrate the config it returns:

```python
@router.get("/internal/application-by-token/{token}")
def application_by_token(token: str):
    tenant_id, app_row = resolve_token(token)
    config = engine.get_config_for_application(tenant_id, app_row)
    return {
        "application": app_row,
        "items": engine.get_items(tenant_id, app_row["entity_id"]),
        # Hydrated for the same reason as public_config: familyhub cannot
        # resolve entity-model fields itself.
        "config": engine.hydrate_config_blocks(tenant_id, config),
    }
```

- [ ] **Step 7: Run the full enrollx suite**

Run: `cd /Users/kennylee/Development/NeoApex/enrollx && uv run python -m pytest backend/tests/ -v`
Expected: PASS, all files. If `test_checkout_service.py` / `test_balance_obligation.py` / `test_stripe_webhook.py` fail on a `program_id` key in a fixture literal, delete that key from the fixture — those fixtures never assert on it (verify with `grep -n program backend/tests/test_checkout_service.py` before editing).

- [ ] **Step 8: Commit**

```bash
git add enrollx/backend
git commit -m "feat(enrollx): whole-school route contracts and server-side config hydration"
```

---

## Task 6: familyhub backend — tenant-scoped facade

**Files:**
- Modify: `familyhub/backend/app/api/registration.py`
- Modify: `familyhub/backend/app/api/application.py`
- Modify: `familyhub/backend/tests/test_registration_routes.py`
- Modify: `familyhub/backend/tests/test_application_routes.py`

**Interfaces:**
- Consumes from Task 5: `GET /internal/registration/{tenant_id}/config`, `POST /internal/registration/{tenant_id}/start` body `{school_year, applicant_email}`, `POST /internal/registration/{tenant_id}/request-link` body `{email}`.
- Produces:
  - `GET /api/registration/{tenant_id}` → the enrollx bundle verbatim.
  - `POST /api/registration/{tenant_id}/start` body `{applicant_email}` → enrollx's start response plus `hub_url`.
  - `POST /api/application/request-link` body `{tenant_id, email}`.
  - `app.api.registration._today()` — kept as the test seam for pinning "today".

- [ ] **Step 1: Write the failing tests**

In `familyhub/backend/tests/test_registration_routes.py`: replace the `BUNDLE` constant and rewrite every route path.

```python
BUNDLE = {
    "config": {"config_id": "RC0001", "version": 1,
               "status": "published", "blocks": []},
    "tenant": {"tenant_id": "acme", "name": "Acme Afterschool"},
    "capacity": {"capacity": 20, "admitted": 3, "full": False},
}
```

Then: every `"/internal/registration/acme/PR0001/config"` → `"/internal/registration/acme/config"`; every `"/internal/registration/acme/PR0001/start"` → `"/internal/registration/acme/start"`; every client call `"/api/registration/acme/PR0001"` → `"/api/registration/acme"` and `"/api/registration/acme/PR0001/start"` → `"/api/registration/acme/start"`; `"/api/registration/acme/NOPE"` stays as a 404 case (it is now an unknown tenant, not an unknown program). Update the passthrough assertion:

```python
def test_config_bundle_passthrough(client, fake_http):
    fake_http.add("GET", "/internal/registration/acme/config", FakeResponse(200, BUNDLE))
    resp = client.get("/api/registration/acme")
    assert resp.status_code == 200
    body = resp.json()
    assert body["tenant"]["name"] == "Acme Afterschool"
    assert body["capacity"]["full"] is False
    assert fake_http.calls[0]["headers"]["X-Internal-Key"] == "test-internal-key"
```

Delete `test_start_derives_school_year_from_program_start_date_not_from_today` and `test_start_falls_back_cleanly_when_start_date_unusable` entirely (there is no program to derive from any more) and replace them with:

```python
@pytest.mark.parametrize("today,expected", [
    (datetime.date(2026, 3, 1), "2025-2026"),
    (datetime.date(2026, 7, 1), "2026-2027"),
    (datetime.date(2026, 12, 31), "2026-2027"),
])
def test_start_derives_school_year_with_the_july_rollover(
        client, fake_http, monkeypatch, today, expected):
    """Same rule as workflow-forms's defaultSchoolYear() and enrollx's
    engine.default_school_year() — all three channels must agree."""
    monkeypatch.setattr("app.api.registration._today", lambda: today)
    fake_http.add("POST", "/internal/registration/acme/start",
                  FakeResponse(201, {"token": "tok123"}))
    resp = client.post("/api/registration/acme/start",
                       json={"applicant_email": "parent@example.com"})
    assert resp.status_code == 201
    start_call = next(c for c in fake_http.calls if c["method"] == "POST")
    assert start_call["json"]["school_year"] == expected


def test_start_no_longer_prefetches_the_config_bundle(client, fake_http):
    """The pre-flight GET existed only to read program.start_date. With the
    school year derived locally it is a wasted round trip on the parent's
    slowest connection — and only enrollx can answer "is this tenant open",
    which the start call itself already does."""
    fake_http.add("POST", "/internal/registration/acme/start",
                  FakeResponse(201, {"token": "tok123"}))
    client.post("/api/registration/acme/start",
                json={"applicant_email": "parent@example.com"})
    assert all(c["method"] == "POST" for c in fake_http.calls)
```

Delete `test_start_config_fetch_masks_upstream_500` (the pre-flight fetch is gone) and remove the now-unneeded `fake_http.add("GET", ...)` line from `test_start_returns_token_and_hub_url`, `test_start_passes_through_upstream_errors`, `test_start_masks_upstream_500` and `test_start_is_rate_limited_per_ip`.

In `familyhub/backend/tests/test_application_routes.py`: find the request-link test and assert the forwarded body no longer carries `program_id`:

```python
def test_request_link_forwards_only_the_email(client, fake_http):
    fake_http.add("POST", "/internal/registration/acme/request-link",
                  FakeResponse(200, {}))
    resp = client.post("/api/application/request-link",
                       json={"tenant_id": "acme", "email": "p@example.com"})
    assert resp.status_code == 200 and resp.json() == {"status": "ok"}
    sent = next(c for c in fake_http.calls if c["method"] == "POST")["json"]
    assert sent == {"email": "p@example.com"}
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd /Users/kennylee/Development/NeoApex/familyhub && uv run python -m pytest backend/tests/ -v`
Expected: FAIL — `AssertionError: Unexpected upstream call: GET .../PR0001/config` and 404s on the new paths.

- [ ] **Step 3: Rewrite familyhub's registration facade**

Replace the body of `familyhub/backend/app/api/registration.py` below the module docstring with:

```python
import datetime

from fastapi import APIRouter, Depends, HTTPException, Response
from fastapi.responses import JSONResponse
from pydantic import BaseModel, field_validator

from app.ratelimit import limit_start
from app.relay import relay as _relay
from app.upstream import call_upstream, enrollx, internal_headers

router = APIRouter()


@router.get("/registration/{tenant_id}")
def get_registration_bundle(tenant_id: str) -> Response:
    """The public config bundle: `{config, tenant, capacity}`.

    Registration is admission to the school as a whole for a school year
    (spec §1) — there is no program segment in the URL any more.
    """
    resp = call_upstream(
        "GET",
        enrollx(f"/internal/registration/{tenant_id}/config"),
        headers=internal_headers(),
    )
    return _relay(resp)


class StartBody(BaseModel):
    applicant_email: str

    @field_validator("applicant_email")
    @classmethod
    def basic_email_shape(cls, v: str) -> str:
        v = v.strip()
        if len(v) < 6 or "@" not in v or "." not in v.rsplit("@", 1)[-1]:
            raise ValueError("invalid email address")
        return v


def _today() -> datetime.date:
    """Indirection point so tests can pin "today" without monkeypatching the
    stdlib `datetime.date` type directly."""
    return datetime.date.today()


def _school_year_for_date(ref: datetime.date) -> str:
    """Academic year straddling `ref`, rolling over each July --
    `${y}-${y+1}` where `y` is `ref`'s year if `ref.month >= 7` else
    `ref.year - 1`.

    Restates workflow-forms's `defaultSchoolYear()` (its JS `getMonth() >= 6`
    is the same July boundary, 0-indexed) and enrollx's
    `engine.default_school_year`. All three must agree: the parent sees this
    value on the start page, enrollx's capacity snapshot is computed for it,
    and the staff form prefills the same string.

    Wall-clock is now the only source, and correctly so: the former
    program-`start_date` derivation existed because a program could span a
    year other than the current one. A whole-school application has no such
    anchor -- the school year a parent is registering for IS the one
    straddling today.
    """
    start_year = ref.year if ref.month >= 7 else ref.year - 1
    return f"{start_year}-{start_year + 1}"


@router.post(
    "/registration/{tenant_id}/start",
    dependencies=[Depends(limit_start)],
)
def start_registration(tenant_id: str, body: StartBody) -> Response:
    resp = call_upstream(
        "POST",
        enrollx(f"/internal/registration/{tenant_id}/start"),
        json_body={
            "school_year": _school_year_for_date(_today()),
            "applicant_email": body.applicant_email,
        },
        headers=internal_headers(),
    )
    if resp.status_code >= 400:
        return _relay(resp)
    data = resp.json()
    token = data.get("token")
    if not token:
        # Latent defense only -- the binding is confirmed correct today
        # (internal.py always sets "token"). If it ever didn't, silently
        # building "/application/" would hand the parent a broken link.
        raise HTTPException(502, "Upstream did not return a magic-link token")
    data["hub_url"] = f"/application/{token}"
    return JSONResponse(data, status_code=resp.status_code)
```

- [ ] **Step 4: Drop `program_id` from the request-link body**

In `familyhub/backend/app/api/application.py`, replace `RequestLinkBody` and the forwarded payload:

```python
class RequestLinkBody(BaseModel):
    tenant_id: str
    email: str
```

```python
        call_upstream(
            "POST",
            enrollx(f"/internal/registration/{body.tenant_id}/request-link"),
            json_body={"email": body.email},
            headers=internal_headers(),
        )
```

and delete the now-unused `from typing import Optional` if nothing else in the file uses it (`CheckoutBody.item_id` does — keep it).

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd /Users/kennylee/Development/NeoApex/familyhub && uv run python -m pytest backend/tests/ -v`
Expected: PASS, all files.

- [ ] **Step 6: Commit**

```bash
git add familyhub/backend
git commit -m "feat(familyhub): tenant-scoped registration facade, no program segment"
```

---

## Task 7: papermite finalize merges instead of replacing

**Files:**
- Modify: `papermite/backend/app/api/finalize.py`
- Create: `papermite/backend/tests/test_finalize_merge.py`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces:
  - `finalize._fetch_existing_model_definition(tenant_id) -> dict`
  - `finalize._merge_model_definition(existing: dict, incoming: dict) -> dict`

- [ ] **Step 1: Write the failing test**

Create `papermite/backend/tests/test_finalize_merge.py`:

```python
"""Finalize must MERGE an extracted model into the tenant's existing one, not
replace it (spec §4 rule 1). Model setup turned acme-afterschool's
registration_application model into the extraction shape and deleted the
engine's own base fields; that must be impossible."""
import pytest

from app.api.finalize import _merge_model_definition

SEEDED = {
    "registration_application": {
        "base_fields": [
            {"name": "application_id", "type": "str", "required": True},
            {"name": "school_year", "type": "str", "required": True},
            {"name": "status", "type": "selection", "required": True},
        ],
        "custom_fields": [],
    },
    "student": {
        "base_fields": [{"name": "student_id", "type": "str", "required": True},
                        {"name": "first_name", "type": "str", "required": True}],
        "custom_fields": [],
    },
}

EXTRACTED = {
    "registration_application": {
        "base_fields": [
            {"name": "application_id", "type": "str", "required": True},
            {"name": "school_year", "type": "str", "required": True},
            {"name": "school_id", "type": "str", "required": False},
        ],
        "custom_fields": [
            {"name": "agreement_signed_by", "type": "str", "required": True},
            {"name": "initials", "type": "str", "required": False},
        ],
    },
}


def test_existing_base_fields_are_never_removed():
    merged = _merge_model_definition(SEEDED, EXTRACTED)
    names = [f["name"] for f in merged["registration_application"]["base_fields"]]
    assert names == ["application_id", "school_year", "status"]


def test_extracted_fields_matching_a_base_field_are_dropped():
    merged = _merge_model_definition(SEEDED, EXTRACTED)
    custom = [f["name"] for f in merged["registration_application"]["custom_fields"]]
    assert "application_id" not in custom and "school_year" not in custom


def test_remaining_extracted_fields_are_appended_as_custom():
    merged = _merge_model_definition(SEEDED, EXTRACTED)
    custom = [f["name"] for f in merged["registration_application"]["custom_fields"]]
    assert custom == ["school_id", "agreement_signed_by", "initials"]


def test_merge_is_idempotent_on_recommit():
    once = _merge_model_definition(SEEDED, EXTRACTED)
    twice = _merge_model_definition(once, EXTRACTED)
    assert twice == once


def test_entity_types_absent_from_the_extraction_are_preserved():
    merged = _merge_model_definition(SEEDED, EXTRACTED)
    assert "student" in merged
    assert [f["name"] for f in merged["student"]["base_fields"]] == [
        "student_id", "first_name"]


def test_a_wholly_new_entity_type_is_taken_verbatim():
    incoming = {"lead": {"base_fields": [{"name": "lead_id", "type": "str",
                                          "required": True}],
                         "custom_fields": []}}
    merged = _merge_model_definition(SEEDED, incoming)
    assert merged["lead"]["base_fields"] == incoming["lead"]["base_fields"]


def test_merge_on_an_empty_tenant_is_the_extraction_itself():
    assert _merge_model_definition({}, EXTRACTED) == EXTRACTED
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd /Users/kennylee/Development/NeoApex/papermite && uv run pytest backend/tests/test_finalize_merge.py -v`
Expected: FAIL with `ImportError: cannot import name '_merge_model_definition' from 'app.api.finalize'`.

- [ ] **Step 3: Implement the merge**

In `papermite/backend/app/api/finalize.py`, add `import json` at the top and append these two functions after `_build_model_definition`:

```python
def _fetch_existing_model_definition(tenant_id: str) -> dict:
    """The tenant's active model definition, one row per entity type.

    DataCore stores models as one row per entity_type; `/api/query` on the
    `models` table returns them with `model_definition` as either a dict or a
    JSON string depending on the path, so both are handled. Keys starting
    with `_` inside a stored definition are DataCore's own provenance
    metadata (`_source_filename`, `_created_by`) and are stripped — the same
    thing `put_tenant_models` does before comparing.

    Returns {} when the tenant has no model yet.
    """
    try:
        resp = httpx.post(
            f"{settings.datacore_api_url}/query",
            json={
                "tenant_id": tenant_id,
                "table": "models",
                "sql": "SELECT * FROM data WHERE _status = 'active'",
            },
            timeout=30.0,
        )
    except httpx.HTTPError:
        raise HTTPException(status_code=502, detail="Failed to read the existing model")
    if resp.status_code != 200:
        raise HTTPException(status_code=502, detail="Failed to read the existing model")

    out: dict = {}
    for row in resp.json().get("data", []):
        entity_type = row.get("entity_type")
        raw = row.get("model_definition")
        if isinstance(raw, str):
            try:
                raw = json.loads(raw)
            except json.JSONDecodeError:
                continue
        if not entity_type or not isinstance(raw, dict):
            continue
        out[entity_type] = {
            "base_fields": [f for f in raw.get("base_fields") or [] if isinstance(f, dict)],
            "custom_fields": [f for f in raw.get("custom_fields") or [] if isinstance(f, dict)],
        }
    return out


def _merge_model_definition(existing: dict, incoming: dict) -> dict:
    """Merge an extracted model definition onto the tenant's existing one.

    Why merging and not replacing (spec §4 rule 1): base fields are SEEDED by
    LaunchPad from `base_model.json` and are load-bearing for running code —
    the registration engine writes `status`, `config_version`, `token_version`
    and the rest onto every application. A replace turned acme-afterschool's
    `registration_application` model into the extraction's shape and dropped
    them, which is what this rule exists to prevent. The rule applies to ALL
    entity types, not just this one.

    Per entity type already present in `existing`:
      - `base_fields` are preserved verbatim — never removed, never
        reordered, never overwritten by an extracted field of the same name;
      - every incoming field (base OR custom) whose name matches an existing
        base field is dropped — the seeded declaration wins;
      - every remaining incoming field is appended to `custom_fields`, unless
        one of that name is already there. First write wins, which is what
        makes re-committing the same document a no-op.

    Entity types absent from `existing` are taken from `incoming` unchanged;
    entity types absent from `incoming` are carried through untouched, so a
    single-entity extraction can never delete the rest of the tenant's model.

    Pure function — no I/O, no mutation of either input.
    """
    merged = {
        et: {"base_fields": list(d.get("base_fields") or []),
             "custom_fields": list(d.get("custom_fields") or [])}
        for et, d in existing.items()
    }
    for et, d in incoming.items():
        if et not in merged:
            merged[et] = {"base_fields": list(d.get("base_fields") or []),
                          "custom_fields": list(d.get("custom_fields") or [])}
            continue
        base_names = {f.get("name") for f in merged[et]["base_fields"]}
        custom_names = {f.get("name") for f in merged[et]["custom_fields"]}
        for field in list(d.get("base_fields") or []) + list(d.get("custom_fields") or []):
            name = field.get("name")
            if not name or name in base_names or name in custom_names:
                continue
            merged[et]["custom_fields"].append(field)
            custom_names.add(name)
    return merged
```

Then in `finalize_commit`, replace the single build line with the merge:

```python
    model_definition = _merge_model_definition(
        _fetch_existing_model_definition(tenant_id),
        _build_model_definition(extraction.entities),
    )
```

- [ ] **Step 4: Run the papermite suite**

Run: `cd /Users/kennylee/Development/NeoApex/papermite && uv run pytest backend/tests/ -v`
Expected: PASS. `test_finalize_api.py` mocks `httpx.put`; if it does not also mock `httpx.post` for the new models read, add the mock there (a `FakeResponse(200, {"data": []})` for the `/query` call) rather than removing the read.

- [ ] **Step 5: Commit**

```bash
git add papermite/backend
git commit -m "feat(papermite): finalize merges into the existing model instead of replacing it"
```

---

## Task 8: base_model.json reseed

**Files:**
- Modify: `launchpad/backend/app/data/base_model.json`

**Interfaces:**
- Consumes: nothing.
- Produces: `registration_config` and `registration_application` declarations without `program_id`. `tenant.capacity` already exists in the file (verified) and needs no change.

- [ ] **Step 1: Remove `program_id` from the two registration entities**

In `launchpad/backend/app/data/base_model.json`, delete this line from `registration_config.base_fields`:

```json
      {"name": "program_id", "type": "str", "required": true},
```

and this line from `registration_application.base_fields`:

```json
      {"name": "program_id", "type": "str", "required": true},
```

Leave `program`, `enrollment` and `attendance` untouched — those still carry `program_id` and belong to the separate activity-assignment workflow.

- [ ] **Step 2: Verify the file is still valid JSON and the fields are gone**

Run:
```bash
cd /Users/kennylee/Development/NeoApex && python3 -c "
import json
m = json.load(open('launchpad/backend/app/data/base_model.json'))
for et in ('registration_config', 'registration_application'):
    names = [f['name'] for f in m[et]['base_fields']]
    assert 'program_id' not in names, (et, names)
    print(et, names)
assert 'capacity' in [f['name'] for f in m['tenant']['base_fields']]
assert 'program_id' in [f['name'] for f in m['enrollment']['base_fields']]
print('ok')
"
```
Expected: both field lists printed without `program_id`, then `ok`.

- [ ] **Step 3: Commit**

```bash
git add launchpad/backend/app/data/base_model.json
git commit -m "chore(launchpad): base_model drops program_id from registration entities"
```

---

## Task 9: EnrollX frontend

**Files:**
- Modify: `enrollx/frontend/src/types/registration.ts`
- Modify: `enrollx/frontend/src/api/registration.ts`
- Modify: `enrollx/frontend/src/App.tsx`
- Modify: `enrollx/frontend/src/components/AppNav.tsx`
- Modify: `enrollx/frontend/src/components/BlockConfigPanel.tsx`
- Modify: `enrollx/frontend/src/pages/ConfigBuilderPage.tsx`
- Modify: `enrollx/frontend/src/pages/NewApplicationPage.tsx`
- Modify: `enrollx/frontend/src/pages/ApplicationsPage.tsx`
- Modify: `enrollx/frontend/src/pages/ApplicationDetailPage.tsx`
- Modify: `enrollx/frontend/src/pages/ApplicationEntryPage.tsx`
- Modify: `enrollx/frontend/src/i18n/translations.ts`
- Delete: `enrollx/frontend/src/pages/ProgramsPage.tsx`
- **Keep:** `enrollx/frontend/src/pages/ProgramsPage.css` (shared classes; four surviving pages import it)

**Interfaces:**
- Consumes from Task 1: `RegistrationConfigDef` and `ApplicationSummary` without `program_id`; `defaultSchoolYear`, `hydratedFormFields`, `APPLICATION_ENTITY_TYPE`.
- Consumes from Task 5: creation body `{school_year, channel, applicant_email?}`.
- Produces: route `/flow` (builder), no `/programs`.

- [ ] **Step 1: Types and API client**

In `enrollx/frontend/src/types/registration.ts`: delete `program_id` from `ApplicationRow` and from `ConfigRow`, and delete the whole `ProgramRow` interface.

In `enrollx/frontend/src/api/registration.ts`, change `createApplication`'s body type:

```ts
export async function createApplication(
  tenantId: string,
  body: { school_year: string; channel: 'admin'; applicant_email?: string },
): Promise<CreateApplicationResponse> {
```

- [ ] **Step 2: Routes and nav**

In `enrollx/frontend/src/App.tsx`: delete the `ProgramsPage` import and both `/programs` routes, and add the top-level builder route:

```tsx
                      <Route path="/flow" element={<ConfigBuilderPage />} />
```

In `enrollx/frontend/src/components/AppNav.tsx`, replace the Programs link:

```tsx
      <NavLink to="/flow" className="app-nav-link">{t('nav.flow')}</NavLink>
```

Delete `enrollx/frontend/src/pages/ProgramsPage.tsx`:

```bash
git rm enrollx/frontend/src/pages/ProgramsPage.tsx
```

**Do not delete `ProgramsPage.css`** — `NewApplicationPage`, `ConfigBuilderPage`, `ApplicationDetailPage` and `ApplicationEntryPage` all use its `.programs-page` / `.programs-error` / `.programs-muted` / `.program-card` / `.bcp-row` classes.

- [ ] **Step 3: BlockConfigPanel offers the application model**

In `enrollx/frontend/src/components/BlockConfigPanel.tsx`, replace the `ENTITY_TYPES` constant:

```tsx
// The four models a `form` block may draw from (spec §4). Kept in sync with
// enrollx's `items.FORM_ENTITY_TYPES`, which rejects anything else at
// publish time. `registration_application` offers only the tenant's own
// custom fields — engine-owned base fields are excluded by
// `hydratedFormFields` and rejected outright by the engine on write.
const ENTITY_TYPES = ['student', 'family', 'contact', 'registration_application'] as const;
```

and render the option labels through i18n so `registration_application` does not read as a raw identifier:

```tsx
              {ENTITY_TYPES.map((et) => (
                <option key={et} value={et}>{t(`builder.entity.${et}`)}</option>
              ))}
```

- [ ] **Step 4: ConfigBuilderPage — tenant-scoped, at /flow, with a starter template**

Apply these edits to `enrollx/frontend/src/pages/ConfigBuilderPage.tsx`:

(a) Imports — drop `useParams` and `ProgramRow`, add the workflow-forms helpers:

```tsx
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FlowRenderer, hydratedFormFields } from '@neoapex/workflow-forms';
import type {
  BlockType, FlowBlock, PaymentPlanOption, RegistrationConfigDef, RequiredDoc,
} from '@neoapex/workflow-forms';
```
and change `import type { ConfigRow, ProgramRow } from '../types/registration.ts';` to `import type { ConfigRow } from '../types/registration.ts';`.

(b) Add the starter template above the component:

```tsx
/**
 * Seeded when a tenant opens the builder with no config at all (spec §4).
 *
 * The `registration_application` block is the point: model setup extracts a
 * tenant's real admission-packet fields (agreements, signatures, initials)
 * into that model's `custom_fields`, and without a block drawing from it
 * those fields would never reach a family. Seeding it means a tenant who
 * customized their application model sees their own fields without ever
 * opening the block panel.
 */
function starterBlocks(t: (key: string) => string): FlowBlock[] {
  return [
    { ...newBlock('form', t('builder.starter.student')),
      config: { entity_type: 'student' } },
    { ...newBlock('form', t('builder.starter.application')),
      config: { entity_type: 'registration_application' } },
  ];
}
```

(c) In the component, delete `const { programId = '' } = useParams();` and the `program` state, and rewrite `load()`:

```tsx
  /**
   * One config lineage per tenant (spec §2), so the query is scoped by
   * `entity_type` + `_status` only — both DataCore system columns present on
   * every row, never a single-writer binder hazard. `SELECT *` throughout.
   */
  const load = useCallback(async () => {
    if (!tenant) return;
    try {
      const cr = await postQuery(tenant, 'entities',
        "SELECT * FROM data WHERE entity_type = 'registration_config' AND _status = 'active'");
      const rows = cr.data as unknown as ConfigRow[];
      // ConfigRow.version arrives from DataCore as a string on every row
      // (data-shape trap: every entity field is a string) — coerce before
      // comparing/sorting/incrementing.
      const latest = [...rows].sort((a, b) => Number(b.version) - Number(a.version))[0];
      if (latest) {
        setEntityId(latest.entity_id);
        setConfigId(latest.config_id);
        setVersion(Number(latest.version));
        setConfigStatus(latest.status === 'published' ? 'published' : 'draft');
        const parsed = JSON.parse(String(latest.blocks)) as FlowBlock[];
        setBlocks(parsed.filter((b) => b.type !== 'review'));
      } else {
        setEntityId(null);
        setConfigId(null);
        setVersion(1);
        setConfigStatus('draft');
        // Unsaved starter template — nothing is written until Save draft.
        setBlocks(starterBlocks(t));
      }
      setError(null);
    } catch (e) {
      setError(String(e));
    }
  }, [tenant, t]);
```

(d) `previewConfig` — drop `program_id` and route field hydration through the shared helper:

```tsx
  const previewConfig: RegistrationConfigDef = useMemo(() => ({
    config_id: configId ?? 'preview',
    version,
    status: 'draft',
    blocks: withReview(blocks, t('builder.reviewTitle')).map((b) => {
      const et = b.type === 'form' && typeof b.config.entity_type === 'string'
        ? b.config.entity_type : null;
      if (!et) return b;
      const m = models[et];
      // ONE derivation of "which model fields does this block show",
      // shared with ApplicationEntryPage and restated server-side by
      // enrollx's `engine.model_form_fields` for the parent channel.
      const fields = m ? hydratedFormFields(et, m) : [];
      return { ...b, config: { ...b.config, fields } };
    }),
  }), [blocks, models, configId, version, t]);
```

(e) `saveDraft` — drop `program_id` from both writes:

```tsx
        await updateEntity(tenant, 'registration_config', entityId, {
          config_id: configId, version,
          status: 'draft', blocks: blocksJson,
        });
```
```tsx
      const created = await createEntity(tenant, 'registration_config', {
        config_id: cid, version: nextVersion,
        status: 'draft', blocks: blocksJson,
      });
```

(f) Header subtitle — replace `{program?.name ?? programId} · ` with `{t('builder.subtitleTenant')} · `.

- [ ] **Step 5: NewApplicationPage — two fields**

Replace the whole of `enrollx/frontend/src/pages/NewApplicationPage.tsx` with:

```tsx
// enrollx/frontend/src/pages/NewApplicationPage.tsx
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { defaultSchoolYear } from '@neoapex/workflow-forms';
import { useTranslation } from '../hooks/useTranslation.ts';
import { useAuth } from '../contexts/AuthContext.tsx';
import { useToast } from '../hooks/useToast.ts';
import { createApplication } from '../api/registration.ts';
import Button from '../components/ui/Button.tsx';
import './ProgramsPage.css';

/**
 * Staff-assisted entry, step 1: confirm the school year and optionally record
 * the parent's email, then create the application on the "admin" channel
 * (spec §5). An application is admission to the school as a whole for that
 * year — there is no program to pick.
 *
 * `defaultSchoolYear()` comes from workflow-forms so this prefill, the parent
 * start page's read-only line, and enrollx's own capacity snapshot all agree
 * on the July rollover.
 */
export default function NewApplicationPage() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const tenant = user?.tenant_id ?? '';
  const { toast } = useToast();
  const navigate = useNavigate();
  const [schoolYear, setSchoolYear] = useState(defaultSchoolYear());
  const [email, setEmail] = useState('');
  const [creating, setCreating] = useState(false);

  const create = async () => {
    if (!schoolYear.trim()) return;
    setCreating(true);
    try {
      const resp = await createApplication(tenant, {
        school_year: schoolYear.trim(),
        channel: 'admin',
        ...(email.trim() ? { applicant_email: email.trim() } : {}),
      });
      toast({ message: t('newApp.created'), tone: 'success' });
      // createApplication's 201 envelope is {application, items}, and the
      // route param used everywhere downstream is the application's
      // entity_id, never the RA-prefixed business `application_id`.
      navigate(`/applications/${resp.application.entity_id}/enter`);
    } catch (e) {
      toast({ message: t('newApp.createError'), detail: String(e), tone: 'danger' });
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="programs-page">
      <header className="page-header">
        <h1 className="page-title">{t('newApp.title')}</h1>
      </header>
      <form className="program-card" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 12 }}
        onSubmit={(e) => { e.preventDefault(); void create(); }}>
        <div className="bcp-row">
          <label htmlFor="newapp-year">{t('newApp.schoolYear')}</label>
          <input id="newapp-year" value={schoolYear} required
            onChange={(e) => setSchoolYear(e.target.value)} />
        </div>
        <div className="bcp-row">
          <label htmlFor="newapp-email">{t('newApp.applicantEmail')}</label>
          <input id="newapp-email" type="email" value={email}
            onChange={(e) => setEmail(e.target.value)} />
        </div>
        <div>
          <Button variant="primary" type="submit" loading={creating}
            loadingText={t('common.loading')} disabled={!schoolYear.trim()}>
            {t('newApp.create')}
          </Button>
        </div>
      </form>
    </div>
  );
}
```

- [ ] **Step 6: ApplicationsPage — school year is the primary filter**

In `enrollx/frontend/src/pages/ApplicationsPage.tsx`:

- Delete the `ProgramRow` import, the `programs` state, the `programFilter` state, the second `useEffect` that loads programs, and the `programName` callback.
- In `load()`, drop the `programFilter` predicate from the `where` array (leaving `entity_type`, `_status` and the optional `status`).
- Delete the `program_id` column from `columns` and the program `<select>` from the filter bar.
- In the Kanban card, replace `{programName(r.program_id)} · {r.school_year}` with `{r.school_year}`.
- Update the file-level SQL comment: delete the `program_id` bullet and the "SQL #2 (programs …)" paragraph; keep the `school_year`-is-single-writer note verbatim (it is still exactly why the year filter stays client-side).

- [ ] **Step 7: ApplicationDetailPage and ApplicationEntryPage**

In `ApplicationDetailPage.tsx`, replace the header subtitle line:

```tsx
            {app.school_year} · {t(`apps.channel.${app.channel_started}`)}
            {app.applicant_email ? ` · ${app.applicant_email}` : ''}
```

In `ApplicationEntryPage.tsx`:
- Add `hydratedFormFields` to the workflow-forms value import.
- Replace SQL #3 and its comment:

```tsx
        // SQL #3: `entity_type` + `_status` only — one config lineage per
        // tenant now, so there is nothing to scope by beyond the type.
        const cr = await postQuery(tenant, 'entities',
          "SELECT * FROM data WHERE entity_type = 'registration_config' AND _status = 'active'");
```
- Replace the per-block hydration body with the shared helper:

```tsx
          try {
            const m = await getModel(tenant, et);
            return { ...b, config: { ...b.config, fields: hydratedFormFields(et, m) } };
          } catch {
            return { ...b, config: { ...b.config, fields: [] } };
          }
```
- Drop `program_id` from the `setConfig({...})` object and from the `summary` object.

- [ ] **Step 8: i18n — both locales**

In `enrollx/frontend/src/i18n/translations.ts`, in the `en-US` block: delete `'nav.programs'`, every `'programs.*'` key, `'newApp.program'`, and `'apps.colProgram'` / `'apps.filterProgram'` if present. Add:

```ts
    'nav.flow': 'Registration flow',
    'builder.subtitleTenant': 'School-wide',
    'builder.starter.student': 'Student information',
    'builder.starter.application': 'Application & agreements',
    'builder.entity.student': 'Student',
    'builder.entity.family': 'Family',
    'builder.entity.contact': 'Contact',
    'builder.entity.registration_application': 'Application (school’s own form)',
```

and change:

```ts
    'entry.noConfig': 'No registration flow is published for this school.',
    'builder.publishConfirmBody':
      'New applications will use this version. Applications already in progress keep the version they started with.',
```

Mirror every one of the above in the `zh-CN` block:

```ts
    'nav.flow': '报名流程',
    'builder.subtitleTenant': '全校',
    'builder.starter.student': '学生信息',
    'builder.starter.application': '申请与协议',
    'builder.entity.student': '学生',
    'builder.entity.family': '家庭',
    'builder.entity.contact': '联系人',
    'builder.entity.registration_application': '申请表（学校自定义）',
    'entry.noConfig': '该学校尚未发布报名流程。',
    'builder.publishConfirmBody': '新的申请将使用此版本。进行中的申请仍沿用其开始时的版本。',
```

(and delete the same `programs.*` / `nav.programs` / `newApp.program` keys from `zh-CN`.)

Keep `programStatus.*` — those are used by AdminDash-style status rendering elsewhere; verify with `grep -rn "programStatus" enrollx/frontend/src` and delete only if there are zero hits outside the translations file.

- [ ] **Step 9: Typecheck and build**

Run: `cd /Users/kennylee/Development/NeoApex/enrollx/frontend && npm run build`
Expected: `tsc -b` clean, then a successful Vite build. Any remaining `program_id` reference surfaces here as a TS error — delete the reference.

Run: `cd /Users/kennylee/Development/NeoApex/enrollx/frontend && npm run lint`
Expected: no errors.

- [ ] **Step 10: Commit**

```bash
git add enrollx/frontend
git commit -m "feat(enrollx-frontend): builder at /flow, whole-school applications, programs removed"
```

---

## Task 10: FamilyHub frontend

**Files:**
- Modify: `familyhub/frontend/src/App.tsx`
- Modify: `familyhub/frontend/src/api/facade.ts`
- Modify: `familyhub/frontend/src/types/registration.ts`
- Modify: `familyhub/frontend/src/pages/RegisterPage.tsx`
- Modify: `familyhub/frontend/src/pages/HubPage.tsx`
- Modify: `familyhub/frontend/src/pages/RequestLinkPage.tsx`
- Modify: `familyhub/frontend/src/i18n/translations.ts`

**Interfaces:**
- Consumes from Task 1: `RegistrationConfigDef`/`ApplicationSummary` without `program_id`, `defaultSchoolYear`.
- Consumes from Task 6: `GET /api/registration/{tenantId}` → `{config, tenant, capacity}`; `POST /api/registration/{tenantId}/start`; `POST /api/application/request-link` body `{tenant_id, email}`.
- Produces: route `/register/:tenantId`.

- [ ] **Step 1: Route**

In `familyhub/frontend/src/App.tsx`, replace the register route:

```tsx
            <Route path="/register/:tenantId" element={<RegisterPage />} />
```

- [ ] **Step 2: Types**

In `familyhub/frontend/src/types/registration.ts`:
- Delete the `ProgramRecord` type and its doc comment.
- Replace `CapacityState` and `RegistrationBundle`:

```ts
/**
 * Computed capacity snapshot (`enrollx/backend/app/registration/engine.py`
 * `capacity_state`), school-wide for one school year. This is a freshly-built
 * Python dict, NOT a DataCore row -- FastAPI serializes its `int`/`bool`
 * values as real JSON types, so these fields need NO stringly-typed coercion.
 */
export interface CapacityState {
  capacity: number | null;
  admitted: number;
  full: boolean;
}

/** The school this registration belongs to, as enrollx names it. */
export interface TenantSummary {
  tenant_id: string;
  name: string;
}

export interface RegistrationBundle {
  /** Normalized: `blocks` parsed from its wire JSON-string into `FlowBlock[]`,
   *  `version` coerced to a number. Ready to pass straight to `FlowRenderer`. */
  config: RegistrationConfigDef;
  tenant: TenantSummary;
  capacity: CapacityState;
}
```

- [ ] **Step 3: Facade**

In `familyhub/frontend/src/api/facade.ts`:
- Change the type import list: drop `ProgramRecord`, add `TenantSummary`.
- In `normalizeConfig`, delete the `program_id: String(data.program_id ?? ''),` line.
- Replace `RawConfigBundle`, `fetchRegistrationBundle` and `startRegistration`:

```ts
interface RawConfigBundle {
  config: EntityRecord;
  tenant: TenantSummary;
  capacity: CapacityState;
}

/**
 * GET /api/registration/{tenant_id} -> `{config, tenant, capacity}`.
 *
 * Fullness comes from `capacity.full` (a freshly-computed boolean, no
 * coercion needed) and is school-wide for the current school year.
 */
export async function fetchRegistrationBundle(
  tenantId: string,
): Promise<RegistrationBundle> {
  const resp = await fetch(
    `${API_BASE}/api/registration/${encodeURIComponent(tenantId)}`,
  );
  const raw = await jsonOrThrow<RawConfigBundle>(resp);
  return { config: normalizeConfig(raw.config), tenant: raw.tenant, capacity: raw.capacity };
}

/**
 * POST /api/registration/{tenant_id}/start -> enrollx's start response
 * (`{application, items, token, link}`) plus familyhub's own `hub_url`.
 */
export async function startRegistration(
  tenantId: string,
  applicantEmail: string,
): Promise<StartResponse> {
  const resp = await fetch(
    `${API_BASE}/api/registration/${encodeURIComponent(tenantId)}/start`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ applicant_email: applicantEmail }),
    },
  );
  return jsonOrThrow<StartResponse>(resp);
}
```
- Replace `requestLink`:

```ts
export async function requestLink(tenantId: string, email: string): Promise<void> {
  const resp = await fetch(`${API_BASE}/api/application/request-link`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tenant_id: tenantId, email }),
  });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
}
```

- [ ] **Step 4: RegisterPage**

In `familyhub/frontend/src/pages/RegisterPage.tsx`:
- Import `defaultSchoolYear` from `@neoapex/workflow-forms`.
- Change `const { tenantId = '', programId = '' } = useParams();` to `const { tenantId = '' } = useParams();`.
- In `toApplicationSummary`, delete the `program_id` line.
- In the bundle-loading effect, call `fetchRegistrationBundle(tenantId)` and change the dep array to `[tenantId]`.
- In `onStart`, call `startRegistration(tenantId, value)`.
- Replace both `<h1>{String(bundle.program.name ?? '')}</h1>` occurrences with the school + year header:

```tsx
        <header className="register-header">
          <h1>{bundle.tenant.name}</h1>
          <p className="register-school-year">
            {t('register.schoolYear')}: {defaultSchoolYear()}
          </p>
```
(the `running` branch's header keeps its `linkSent` notice below this block; the `email` branch keeps its `capacity.full` notice.)
- Change the `Phase` doc comment's `notFound` line to: `` `notFound`  -- the tenant's config bundle 404s (bad URL, or the school simply isn't open -- the backend does not distinguish the two). ``
- Change the `register.programFull` key usage to `register.schoolFull`.

- [ ] **Step 5: HubPage**

In `familyhub/frontend/src/pages/HubPage.tsx`:
- Delete `program_id` from `ApplicationView` and from `toApplicationView`.
- Replace the `form`-kind affordance's link target:

```tsx
    if (item.kind === 'form' && decoded) {
      return (
        <Link
          className="hub-action link"
          to={`/register/${decoded.tenantId}?token=${encodeURIComponent(token)}`}
        >
          {t('hub.continueForm')}
        </Link>
      );
    }
```

- [ ] **Step 6: RequestLinkPage**

In `familyhub/frontend/src/pages/RequestLinkPage.tsx`: delete `const prefillProgram = searchParams.get('program') ?? undefined;` and change the call to `await requestLink(tenantId.trim(), email.trim());`.

- [ ] **Step 7: i18n — both locales**

In `familyhub/frontend/src/i18n/translations.ts`, `en-US`: rename `register.programFull` → `register.schoolFull` and add `register.schoolYear`; update the landing copy and the waitlist banner:

```ts
    'register.schoolFull': 'This school year is currently full. You can still apply — you will be placed on the waitlist.',
    'register.schoolYear': 'School year',
    'register.notFound': 'This registration link is not available. Check the address with your school.',
    'statusBanner.waitlisted': 'This school year is currently full. You are on the waitlist and will be contacted if a spot opens.',
```

and replace the landing string that says "Registration links are program-specific" with:

```ts
      'Registration links are specific to your school. If you were expecting to register a student, please use the link your school sent you.',
```

`zh-CN`:

```ts
    'register.schoolFull': '本学年名额已满。您仍可提交申请，将进入候补名单。',
    'register.schoolYear': '学年',
    'statusBanner.waitlisted': '本学年名额已满。您已进入候补名单，如有空位我们会与您联系。',
```
and the landing string: `'报名链接由各学校单独提供。如果您需要为学生报名，请使用学校发送给您的链接。'`

- [ ] **Step 8: Typecheck and build**

Run: `cd /Users/kennylee/Development/NeoApex/familyhub/frontend && npm run build`
Expected: clean `tsc -b` + Vite build.

Run: `cd /Users/kennylee/Development/NeoApex/familyhub/frontend && npm run lint`
Expected: no errors.

- [ ] **Step 9: Commit**

```bash
git add familyhub/frontend
git commit -m "feat(familyhub-frontend): /register/{tenant_id}, school name + school year"
```

---

## Task 11: dev data wipe and model reseed

**Files:**
- Create: `scripts/reset_registration_dev_data.py`

**Interfaces:**
- Consumes from Task 8: the revised `base_model.json`.
- Produces: a repeatable dev reset. Not wired into `start-services.sh` — it is destructive and must stay explicit.

**Target tenants:** `acme-afterschool` (the real dev tenant, per `datacore/data/lancedb`), plus any tenant passed on the command line.

- [ ] **Step 1: Write the script**

Create `scripts/reset_registration_dev_data.py`:

```python
#!/usr/bin/env python3
"""Wipe a dev tenant's registration data and reseed its registration models.

DEV ONLY, and destructive. Nothing is deployed, so the whole-school revision
takes the simple path the spec authorizes (§6): archive every registration
row rather than migrating it, then re-put the registration model definitions
from base_model.json so the tenant's models match the new base fields.

Archive, not delete: DataCore's archive flips `_status` to 'archived', which
is exactly what every registration query filters on, and it leaves the rows
recoverable. There is no delete endpoint and this does not need one.

Model reseed uses PUT /api/models/{tenant} with ONLY the two registration
entity types. That route merges by entity_type at the store level, so the
tenant's other models (including anything model setup customized) are
untouched. It does mean the tenant's `registration_application` custom
fields are reset to base_model's empty list -- re-run Papermite's finalize
for the tenant afterwards to fold the admission-packet fields back in as
custom fields (spec §6; Task 7's merge rule makes that safe now).

Usage:
    python3 scripts/reset_registration_dev_data.py                # acme-afterschool
    python3 scripts/reset_registration_dev_data.py acme other-dev
    python3 scripts/reset_registration_dev_data.py --dry-run
"""
import argparse
import json
import sys
from pathlib import Path

import httpx

REPO = Path(__file__).resolve().parent.parent
BASE_MODEL = REPO / "launchpad" / "backend" / "app" / "data" / "base_model.json"
DEFAULT_TENANTS = ["acme-afterschool"]

# Every entity type the registration feature owns. `document` and `payment`
# rows are registration-scoped in this codebase (they carry application_id),
# so they go too -- these are all test rows.
REGISTRATION_TYPES = [
    "registration_config",
    "registration_application",
    "application_item",
    "application_activity",
    "document",
    "payment",
]

RESEED_TYPES = ["registration_config", "registration_application"]


def datacore(port: int) -> str:
    return f"http://localhost:{port}/api"


def load_port() -> int:
    services = json.loads((REPO / "services.json").read_text())
    for key in ("datacore-backend", "datacore"):
        entry = services.get(key)
        if isinstance(entry, dict) and entry.get("port"):
            return int(entry["port"])
        if isinstance(entry, int):
            return entry
    return 5800


def active_entity_ids(base: str, tenant: str, entity_type: str) -> list[str]:
    resp = httpx.post(f"{base}/query", json={
        "tenant_id": tenant, "table": "entities",
        "sql": f"SELECT entity_id FROM data WHERE entity_type = '{entity_type}' "
               f"AND _status = 'active'",
    }, timeout=30.0)
    if resp.status_code != 200:
        # A tenant that has never written this type has no column/table for
        # it; that is "nothing to wipe", not an error.
        return []
    return [r["entity_id"] for r in resp.json().get("data", []) if r.get("entity_id")]


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("tenants", nargs="*", default=None)
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()
    tenants = args.tenants or DEFAULT_TENANTS
    base = datacore(load_port())
    base_model = json.loads(BASE_MODEL.read_text())

    for tenant in tenants:
        print(f"\n== {tenant} ==")
        for entity_type in REGISTRATION_TYPES:
            ids = active_entity_ids(base, tenant, entity_type)
            print(f"  {entity_type}: {len(ids)} active row(s)")
            if not ids or args.dry_run:
                continue
            resp = httpx.post(f"{base}/entities/{tenant}/{entity_type}/archive",
                              json={"entity_ids": ids}, timeout=60.0)
            resp.raise_for_status()
            print(f"    archived {resp.json().get('archived', 0)}")

        reseed = {et: base_model[et] for et in RESEED_TYPES}
        print(f"  reseeding models: {', '.join(reseed)}")
        if args.dry_run:
            continue
        resp = httpx.put(f"{base}/models/{tenant}", json={
            "model_definition": reseed,
            "source_filename": "base_model.json",
            "created_by": "reset_registration_dev_data.py",
        }, timeout=60.0)
        resp.raise_for_status()
        print(f"    {resp.json().get('status', 'ok')}")

    print("\nDone. Re-run Papermite finalize for any tenant whose application "
          "model carried custom fields (Task 7's merge rule preserves the "
          "base fields now).")
    return 0


if __name__ == "__main__":
    sys.exit(main())
```

- [ ] **Step 2: Start the stack and dry-run the script**

Run: `cd /Users/kennylee/Development/NeoApex && ./start-services.sh`
Then: `cd /Users/kennylee/Development/NeoApex && python3 scripts/reset_registration_dev_data.py --dry-run`
Expected: per-type row counts for `acme-afterschool`, no writes.

- [ ] **Step 3: Run it for real**

Run: `cd /Users/kennylee/Development/NeoApex && python3 scripts/reset_registration_dev_data.py`
Expected: archive counts printed, then a models `status` line.

Verify the model no longer declares `program_id`:

```bash
curl -s -X POST http://localhost:5800/api/query -H 'Content-Type: application/json' \
  -d '{"tenant_id":"acme-afterschool","table":"models","sql":"SELECT entity_type, model_definition FROM data WHERE _status = '"'"'active'"'"' AND entity_type = '"'"'registration_application'"'"'"}' \
  | python3 -m json.tool
```
Expected: the `base_fields` list contains no `program_id`.

Verify no active registration rows remain:

```bash
curl -s -X POST http://localhost:5800/api/query -H 'Content-Type: application/json' \
  -d '{"tenant_id":"acme-afterschool","table":"entities","sql":"SELECT entity_type, count(*) AS n FROM data WHERE _status = '"'"'active'"'"' AND entity_type IN ('"'"'registration_config'"'"','"'"'registration_application'"'"','"'"'application_item'"'"') GROUP BY entity_type"}'
```
Expected: `{"data": []}`.

- [ ] **Step 4: Commit**

```bash
git add scripts/reset_registration_dev_data.py
git commit -m "chore(scripts): dev-only registration data wipe and model reseed"
```

---

## Task 12: browser click-through and follow-ups doc

**Files:**
- Create: `docs/superpowers/plans/2026-08-04-registration-whole-school-followups.md`

**Interfaces:**
- Consumes: everything. This is the acceptance gate.

**Preconditions:** Task 11 has run, `./start-services.sh` is up, and a staff login exists for `acme-afterschool`. If the tenant entity has no `capacity`, that is fine — the flow is then unlimited and no waitlist branch is exercised (record that in the follow-ups doc rather than inventing a capacity).

**Document upload is explicitly deferred** (see Global Constraints): when the click-through reaches a document item, **waive it from the staff detail page** (`Waive` on `ApplicationDetailPage`) or skip it on the parent side. Do not attempt an R2 upload.

- [ ] **Step 1: Run all three backend suites and both frontend builds**

```bash
cd /Users/kennylee/Development/NeoApex/enrollx && uv run python -m pytest backend/tests/ -q
cd /Users/kennylee/Development/NeoApex/familyhub && uv run python -m pytest backend/tests/ -q
cd /Users/kennylee/Development/NeoApex/papermite && uv run pytest backend/tests/ -q
cd /Users/kennylee/Development/NeoApex/enrollx/frontend && npm run build
cd /Users/kennylee/Development/NeoApex/familyhub/frontend && npm run build
```
Expected: three green suites, two clean builds. Do not proceed past a failure — fix it.

- [ ] **Step 2: Builder — publish, verified against DataCore directly**

Using `claude-in-chrome` (call `tabs_context_mcp` first, then `tabs_create_mcp`):
1. Open `http://localhost:5900/flow` and log in if redirected.
2. Confirm the starter template appears with two form steps: "Student information" (`student`) and "Application & agreements" (`registration_application`).
3. Select the second block; confirm the entity-type select offers "Application (school's own form)".
4. Click **Save draft**, then **Publish** and confirm the modal.

Verify by querying DataCore, not by reading the UI:

```bash
curl -s -X POST http://localhost:5800/api/query -H 'Content-Type: application/json' \
  -d '{"tenant_id":"acme-afterschool","table":"entities","sql":"SELECT entity_id, config_id, version, status FROM data WHERE entity_type = '"'"'registration_config'"'"' AND _status = '"'"'active'"'"'"}' \
  | python3 -m json.tool
```
Expected: exactly one row with `"status": "published"`, and **no `program_id` column in the result**.

- [ ] **Step 3: Staff channel — create, fill, submit**

1. Navigate to `http://localhost:5900/applications` → **New application**.
2. Confirm the form shows only **School year** (prefilled with the current academic year) and **Applicant email** — no program select.
3. Enter an email and create. You land on `/applications/{entity_id}/enter`.
4. Step through the flow: fill the student form, fill the application/agreement form, waive or skip any document step, and submit from the Review block.
5. Open `/applications` and confirm the row appears with the school year and no Program column, and that the school-year filter works.
6. Open the application's detail page; confirm the subtitle reads `{school_year} · {channel}` with no program.

- [ ] **Step 4: Staff channel — approve, and confirm no enrollment row is created**

From the detail page, click **Approve** and confirm. Then:

```bash
curl -s -X POST http://localhost:5800/api/query -H 'Content-Type: application/json' \
  -d '{"tenant_id":"acme-afterschool","table":"entities","sql":"SELECT entity_id FROM data WHERE entity_type = '"'"'enrollment'"'"' AND _status = '"'"'active'"'"'"}'
```
Expected: `{"data": []}` — approval creates family + student and nothing else (spec §2).

Also confirm the application-model answers landed on the application itself:

```bash
curl -s -X POST http://localhost:5800/api/query -H 'Content-Type: application/json' \
  -d '{"tenant_id":"acme-afterschool","table":"entities","sql":"SELECT * FROM data WHERE entity_type = '"'"'registration_application'"'"' AND _status = '"'"'active'"'"'"}' \
  | python3 -m json.tool
```
Expected: the agreement/signature field values you typed appear as top-level columns on the application row.

- [ ] **Step 5: Parent channel — register through submit, then the hub**

1. Open `http://localhost:6000/register/acme-afterschool`.
2. Confirm the header shows the school name and a read-only school year, not a program name.
3. Enter a different email and start. Confirm the flow renders **with fields in both form blocks** — this is what server-side hydration exists for; empty forms here mean Task 5's hydration is not reaching the parent channel.
4. Fill both forms, waive/skip documents, submit.
5. Follow the "View application status" link to `/application/{token}` and confirm the hub renders item statuses and the submitted banner.
6. Click a form item's **Continue form** affordance and confirm it navigates to `/register/acme-afterschool?token=…` (no program segment).

- [ ] **Step 6: Write the follow-ups doc**

Create `docs/superpowers/plans/2026-08-04-registration-whole-school-followups.md` recording, at minimum:

```markdown
# Registration Whole-School Revision — follow-ups

Companion to `2026-08-04-registration-whole-school-revision.md`. Everything
here was deliberately deferred by the plan's Global Constraints, not missed.

## Deferred manual verification — needs a human + real credentials

1. **Document upload, both channels.** The click-through waived/skipped every
   document item by instruction. `DATACORE_R2_*` is still absent from the dev
   environment, so no document row can be created at all
   (`datacore/documents.py` raises `KeyError` → 500 → familyhub masks to 502).
   Once R2 test credentials exist, run: a parent upload through
   `/register/{tenant_id}`, a staff upload through
   `/applications/{id}/enter`, and the download links on both the staff
   detail page and the parent hub.

2. **The `uploaded_by` seam (carried over from Plan 5 follow-up #2).** The two
   `uploaded_by` format literals live on opposite sides of a process boundary
   and have never been exercised together. Re-run specifically: the
   cross-application `document_id` refusal, and that a parent upload lands as
   `parent:{application entity_id}`. This is the one thing only a live run can
   confirm.

3. **Capacity waitlist branch.** [Record whether the dev tenant had a
   `capacity` value. If it did not, the waitlist path was covered only by
   `test_submit_waitlists_when_the_school_year_is_full`, not in the browser.]

## Observations from the click-through

[Record anything surprising here — empty form blocks, slow steps, copy that
reads wrong, any step that needed a workaround.]

## Known open items carried forward

- Plan 5 follow-ups #4–#10 (RegisterPage cold-resume error collapsing,
  dead-token retry loop, duplicated row helpers between HubPage and
  RegisterPage, Referrer-Policy, secret-length check, stale docstrings) are
  untouched by this revision and still stand.
- `ApplicationsPage`'s `LIMIT 1000` pagination follow-up stands; this revision
  did not make it worse (spec §5).
- Activity/program assignment workflow (spec §7) is a separate design and
  consumes `enrollment` + per-program capacity.
```

Fill the bracketed placeholders with what actually happened. **Do not leave a bracket in the committed file.**

- [ ] **Step 7: Commit**

```bash
git add docs/superpowers/plans/2026-08-04-registration-whole-school-followups.md
git commit -m "docs: whole-school registration revision follow-ups"
```

---

## Self-Review

**Spec coverage**

| Spec section | Requirement | Task |
|---|---|---|
| §2 | `registration_config` drops `program_id`; one lineage per tenant | 2, 3(d), 8, 9 |
| §2 | `registration_application` drops `program_id` | 2, 8, 9 |
| §2 | `tenant.capacity` | already in `base_model.json` (verified in Task 8 Step 2); consumed in Task 2 |
| §2 | Approval no longer creates `enrollment` | 3(c) |
| §2 | Capacity counted per `(tenant, school_year)` over applications only | 2 |
| §3 | Creation body `{school_year, channel, applicant_email?}`, 404 message | 5 |
| §3 | Internal start / config / request-link signatures | 5 |
| §3 | familyhub facade + `/register/{tenant_id}` | 6, 10 |
| §3 | `RegistrationConfigDef` drops `program_id`; `defaultSchoolYear()` in workflow-forms | 1 |
| §3 | `publish_config` validates against the single lineage | 3(d) |
| §4.1 | Papermite finalize merges, never removes base fields | 7 |
| §4.2 | `form` block `entity_type` gains `registration_application`; renderer shows custom fields only; answers → application `base_data`; engine-owned rejected 400 | 1, 4, 5, 9 |
| §4 | Default seeded template includes an application-model form block | 9 Step 4(b) |
| §5 | EnrollX pages, `/flow` route, Programs removal | 9 |
| §5 | FamilyHub pages | 10 |
| §5 | Email templates use tenant name + school year | 3 |
| §5 | i18n in both locales | 9 Step 8, 10 Step 7 |
| §6 | Dev wipe + reseed | 8, 11 |
| §6 | Delete program-scoped code paths outright | 2, 3, 5, 9, 10 |
| §8 | Capacity boundary tests per `(tenant, school_year)` | 2, 3 |
| §8 | Papermite merge tests | 7 |
| §8 | Application-model form block tests | 4 |
| §8 | Contract tests (no `program_id` 201, `program_id` 422) | 5 |
| §8 | Manual gates run after this revision lands | 12 |

**Placeholder scan:** the only bracketed text is in Task 12 Step 6's follow-ups template, which explicitly instructs filling it from the click-through and forbids committing a bracket.

**Type consistency checked:**
- `engine.capacity_state(tenant_id, school_year, token)` returns `{capacity, admitted, full}` in Task 2 and is consumed with those exact keys by Task 5's `public_config`, Task 6's `BUNDLE` fixture and Task 10's `CapacityState`. (`approved`/`enrolled` are gone; `admitted` is the spec's name.)
- `engine.create_application(tenant_id, school_year, channel, applicant_email, actor, token)` — positional order identical at both call sites (`api/registration.py`, `api/internal.py`).
- `ENGINE_OWNED_APPLICATION_FIELDS` — same 13 names in `types.ts` (Task 1) and `engine.py` (Task 2), both including `registration_application_id`.
- `hydratedFormFields(entityType, model)` (TS, Task 1) and `engine.model_form_fields(tenant_id, entity_type, token)` (Python, Task 5) implement the same two rules and are cross-referenced in each other's docstrings.
- `seed_config(fdc, tenant="acme", capacity=None)` — one signature, used identically in Tasks 2, 3 and 5.
- `_school_label(tenant_id, app_row, token=None)` — defined in Task 3, imported by Task 5's `internal.py`.
- `emails.*_email(school_label, ...)` — renamed once in Task 3 and every call site updated in the same task.
</content>
</invoke>
