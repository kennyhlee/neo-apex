# Error boundaries + template model prerequisites

**Date:** 2026-08-14
**Status:** design approved, not implemented

Two independent follow-ups from the ApexFlow workflow row-actions work. Both address
failures where the system knew what was wrong and didn't say so.

## Motivation

Both came out of one debugging session:

1. Clicking **Preview** on a workflow blanked the entire page. The cause was two copies of
   React (fixed separately in `7861f80`), but the *reason it was expensive to diagnose* is
   that a render throw in any of these frontends unmounts the root and shows nothing. The
   error existed in the console the whole time; nothing surfaced it.
2. Applying the "Program Signup" template produced
   `section 'signup_section' (step 'signup_form') references unknown entity model
   'enrollment'` immediately, with no user edits. The tenant simply lacked the `enrollment`
   model. The information needed to say so was available *before* the template was applied.

---

## Part 1 — Error boundaries

### Problem

No `componentDidCatch` / `ErrorBoundary` / `getDerivedStateFromError` exists anywhere in
apexflow, admindash, or familyhub. React unmounts the root on any render throw, producing a
blank page with no in-app indication of what happened.

This is worst in **familyhub**, whose users are parents — they cannot open a console, and a
blank page during registration reads as "the school's system is broken."

### Design

A per-app `components/ErrorBoundary.tsx`. Duplicated across the three frontends rather than
shared: these apps already keep their own copies of `DataTable`, `Modal`, and `StatusBadge`,
and `workflow-forms` is the form-rendering engine — an error boundary is not a
form-rendering concern and putting it there would widen that package's remit.

A class component, because `getDerivedStateFromError` has no hook equivalent.

**Placement: wrapping the routed main content, not the app root.** The nav survives, so a
crash leaves the user able to navigate away instead of stranded. In apexflow that is inside
`.app-shell` around `<main className="app-main">`'s inner `<Routes>`.

**It renders the error text.** These are internal staff tools behind auth; the message *is*
the diagnosis. familyhub is the exception — parents get a plain apology and a reload
button, with no stack.

**Reset on navigation.** The boundary is keyed on the current location so navigating away
clears the error state rather than leaving a sticky error panel.

### Contents

- Staff apps (apexflow, admindash): a heading, the error message, the component stack in a
  collapsed `<details>`, a "Copy details" button, and "Reload".
- familyhub: apology copy, a "Try again" button, no technical detail.

### Out of scope

- Reporting errors to a remote service. There is no error-tracking backend in this stack;
  adding one is its own decision.
- Per-route or per-panel boundaries. One boundary around main content is the high-value
  placement; finer granularity can come later if a specific panel warrants it.

---

## Part 2 — Template model prerequisites

### Problem

`app/templates/signup.py` binds `signup_section` to `entity_model: "enrollment"`. A tenant
without that model can apply the template successfully and then fails at publish with an
error naming a section and a step — which reads as an authoring mistake rather than a
missing tenant prerequisite. Nothing in the gallery or the apply dialog indicates the
template has a prerequisite at all.

The `enrollment` model *is* a shipped default (`launchpad/backend/app/data/base_model.json`),
so the remedy is launchpad's existing **Sync default entities** button — but nothing points
there.

### Design

**Derive the requirement; never declare it.**

`definitions.referenced_entity_models(steps)` already computes exactly the set of
`entity_model` values a definition's form sections name. Deriving from the template's own
steps means the prerequisite can never drift out of sync with the steps, which a
hand-maintained `required_models` field in each `catalog_entry()` inevitably would.

`GET /api/workflows/{tenant_id}/templates` already carries tenant context via
`require_staff_tenant`, so it can do the diff server-side. Each catalog entry gains:

```json
"missing_models": ["enrollment"]
```

— the models this template's sections reference that the tenant does not have. Empty for a
template the tenant can publish today.

`fetch_models` returns `None` for a model the tenant never set up, which is exactly the
signal to diff on. `STANDARD_BUNDLE_MODELS` is **not** unioned in here: this is a
per-template question, and a standard model the tenant lacks is just as missing.

**The gallery warns; it does not block.** A card with `missing_models` shows a warning
badge, and the apply dialog names the missing models and points at launchpad's Sync default
entities. `Use template` stays enabled: applying creates a valid draft that merely cannot
publish yet, which is a legitimate state — someone may want to author now and sync later.
Blocking would also make any gap in the derivation an unfixable wall.

### Out of scope

- Applying the same check to an existing definition (the health column already covers
  drift on published definitions).
- Auto-provisioning the missing model from apexflow. Model setup belongs to launchpad;
  reaching across to write a tenant's models from the workflow designer would put that
  responsibility in two places.
- Field-level model reconciliation in launchpad's sync (it compares entity names only). A
  real gap, but a separate change with its own design.

---

## Testing

**Backend** (`apexflow/backend/tests/test_designer_api.py`):
- a template whose referenced models the tenant has → `missing_models == []`
- a template referencing a model the tenant lacks → that model listed
- a tenant missing several referenced models → all listed, order-stable
- `missing_models` is present on every catalog entry, never absent

**Frontend** (`apexflow/frontend/src/utils/__tests__/`): a pure helper for the badge/copy
decision, so the logic is testable without component tests (none exist in these apps —
`vitest` runs `environment: 'node'` over `*.test.ts` only).

**Error boundary:** no automated test is possible in these apps — there is no jsdom or
Testing Library. Verification is a deliberate thrown error in a scratch build, confirmed by
hand, plus `tsc`/lint/build. This limitation must be stated in the plan rather than papered
over with a test that cannot run.

Per `feedback_verify_by_mutation`: every test written must be shown to fail when the
behaviour it covers is broken.
