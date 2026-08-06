# ApexFlow Plan 2 — Workflow Designer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build apexflow-frontend — the workflow designer (definitions list, template gallery, step editor with live model-driven field pickers, machine editor over the primitive library, live preview, publish flow) — plus the backend read/validate surface it needs.

**Architecture:** React 19 + TS + Vite app on port 5900, patterned on admindash-frontend (auth, i18n, theme, components ported, not reinvented). apexflow-backend gains generic entity/query proxies (drafting surface), a designer read API with computed definition health, and a dry-run validate endpoint. flow-runtime gains a generalized step/section preview renderer alongside its registration-era exports (familyhub untouched until Phase 3). Spec: `docs/superpowers/specs/2026-08-05-apexflow-workflow-platform-design.md` §3 §5 — **spec wins over this plan on any conflict.**

**Tech Stack:** React 19 + TypeScript + Vite, native fetch, CSS variables + `@neoapex/ui-tokens`, FastAPI backend additions, pytest.

## Global Constraints

- Base branch: `docs/registration-flow-design`. Feature branch: `feat/apexflow-plan2-designer`. Commit per task. TDD for all backend code.
- **Interface map governs:** Task 0 produces `docs/superpowers/plans/2026-08-06-apexflow-plan2-interface-map.md` from real code. Map wins over plan text; divergences marked `# ADJUST(bindings)`. **The map MUST include a cross-service configuration-facts table** (ports, URLs, env names, localStorage keys) — the Plan 1 lesson: the one live bug came from a stale port constant, not a code binding.
- **No frontend test framework exists** (repo precedent). Frontend deliverables gate on: `npm run build` (tsc + vite) clean, `npm run lint` clean, backend contract tests for every endpoint the UI calls, and the Task 11 browser gate. Do not introduce a test framework in this plan.
- **Identifier trap (Plan 1 standing rule):** path params and API payloads use DataCore `entity_id`; lineage identity is `base_data.definition_id`. The designer edits DRAFT rows (addressed by entity_id) and lists LINEAGES (grouped by definition_id).
- Frontend conventions: no axios, no CSS-in-JS, no global state library; i18n strings in BOTH `en-US` and `zh-CN` following the admindash `i18n` pattern; auth via DataCore JWT (`neoapex_token` localStorage) with the admindash login-page pattern.
- Backend: every new authenticated route `require_staff_tenant`; `/api/query` gets the SQL-shape guard block byte-identical to datacore/admindash (the drift test `_GUARD_FILES` in `datacore/tests/test_readonly_query.py` AND `admindash/backend/tests/test_tenancy.py` MUST gain apexflow's file — they hard-fail on missing files, so add the real path).
- Ports/URLs (verified facts, not assumptions): apexflow-frontend 5900, apexflow-backend 5910, familyhub-frontend **5620** (family URL base `http://localhost:5620/w/{tenant_id}/{definition_id}`), DataCore 5800. Env prefix `APEXFLOW_`; frontend overrides `VITE_APEXFLOW_API_URL`.
- Draft autosave = generic entity writes of `workflow_definition` rows (spec: publish is the sole bespoke authoring action). Debounce autosave; never autosave a published row (drafts only).
- Guard/effect param forms are generated from a frontend catalog that mirrors `validate.py`'s param validators — Task 0 maps the exact param table; the catalog cites it.
- Definition health/badges vocabulary (fixed): `current | new-fields-available | stale | broken` + `lineage_status`. Backend computes health; frontend never re-implements validation.

---

### Task 0: Interface map (frontend-focused) + branch

**Files:**
- Create: `docs/superpowers/plans/2026-08-06-apexflow-plan2-interface-map.md`

**Interfaces:**
- Produces the map all tasks cite. Required contents, verbatim from source with file:line:
  1. admindash-frontend reusable patterns: `AuthContext` + login page + exchange-code flow, `config.ts` services.json import pattern, api client fetch wrapper + error shape, `useTranslation`/i18n file layout, `DataTable`, `Toast`/`useToast`, `Modal`, `Button`, `StatusBadge`, theme.css structure, eslint config.
  2. apexflow-backend current surface: every route in `api/*.py` with exact request/response shapes (definitions actions, model-impact, instances, actions, internal, documents); `Settings` fields; `workflows/validate.py` param-validator table (primitive → required/optional params — copy the table verbatim, the frontend catalog binds to it); `workflows/schema.py` TS-relevant shapes (MachineDef/StateDef/TransitionDef/StepDef/SectionDef/Condition/ConditionGroup, alias spellings, ENGINE_OWNED_FIELDS).
  3. `templates/enrollment.py`: the template's definition dict shape + `seed_enrollment_template` signature (the gallery instantiates from this).
  4. flow-runtime: current package exports, build/consumption mechanism (file: dep? workspace?), what familyhub imports (must not break).
  5. DataCore generic routes apexflow will proxy (`POST /api/entities/...`, `PUT`, `/api/query` readonly) + the SQL-guard block source (`datacore/src/datacore/api/readonly_query.py` guard functions + the two drift-test `_GUARD_FILES` lists) + models read route.
  6. admindash-backend's generic proxy routes (`entities.py`, `query.py`) as the porting source for Task 1.
  7. **Configuration-facts table**: every port, URL, env var, localStorage key, and services.json entry the designer touches, each with its source file:line.
  8. base_model.json `workflow_definition` field list (the draft row shape the designer writes).

- [ ] **Step 1:** `git checkout docs/registration-flow-design && git pull && git checkout -b feat/apexflow-plan2-designer`
- [ ] **Step 2:** Read the sources; write the map with verbatim signatures and the config-facts table.
- [ ] **Step 3:** Commit: `docs(apexflow): plan 2 interface map from source`

### Task 1: Backend — generic entity/query proxies (drafting surface)

**Files:**
- Create: `apexflow/backend/app/api/entities.py`, `apexflow/backend/app/api/query.py`, `apexflow/backend/app/tenancy.py` (SQL guard block, byte-identical per map §5)
- Modify: `apexflow/backend/app/main.py` (mount), `apexflow/backend/app/auth.py` (add the query-guard deps Task 1 of Plan 1 deliberately deferred), `datacore/tests/test_readonly_query.py` + `admindash/backend/tests/test_tenancy.py` (`_GUARD_FILES` gains apexflow's tenancy file)
- Test: `apexflow/backend/tests/test_entities_api.py`, `apexflow/backend/tests/test_query_api.py`; re-run both drift suites

**Interfaces:**
- Consumes: map §5/§6 (port from admindash's `entities.py`/`query.py` — same shapes, same tenant-match + read-only SQL guards).
- Produces: `POST /api/entities/{tenant_id}/{entity_type}`, `PUT /api/entities/{tenant_id}/{entity_type}/{entity_id}`, `GET` list/detail as the admindash surface has them (port exactly what exists, nothing more); `POST /api/query` (tenant-scoped, read-only-guarded). Frontend api client (Task 4) binds to these.

- [ ] **Step 1:** Failing tests: cross-tenant 403 on each route; non-SELECT SQL rejected; tenant-table-scoping asserted (the admindash test patterns, ported); draft write round-trip via FakeDataCore.
- [ ] **Step 2:** Port implementation per map; guard block byte-identical (the drift tests are the proof — update `_GUARD_FILES`, run both suites, they now hard-fail if the block drifts).
- [ ] **Step 3:** Full apexflow + datacore + admindash suites green. Commit: `feat(apexflow): generic entity/query proxies with SQL guard block`

### Task 2: Backend — designer read API + dry-run validate

**Files:**
- Create: `apexflow/backend/app/api/designer.py` (or extend `api/definitions.py` — implementer's call, one place)
- Test: `apexflow/backend/tests/test_designer_api.py`

**Interfaces:**
- Consumes: `workflows/definitions.py` service fns, `workflows/validate.py` (`validate_definition`, `definition_health`), models via `get_model_definition`.
- Produces (all `require_staff_tenant`):
  - `GET /api/workflows/{tenant_id}/definitions` → `{definitions: [{entity_id, definition_id, name, version, status, lineage_status, channel_access, health, open_instances, family_url?}]}` — one row per lineage-version row (frontend groups); `health` computed only for published + draft rows (superseded → `"superseded"` literal); `family_url` present when published + `channel_access == "family"` (built from the map's config facts).
  - `GET /api/workflows/{tenant_id}/definitions/{entity_id}/bundle` → `{definition (machine/steps parsed), models: {entity_type: model_def for every entity model referenced + student/family/contact/registration_application/lead}, health, errors: [...]}` — the single fetch the editor mounts from.
  - `POST /api/workflows/{tenant_id}/definitions/{entity_id}/validate` → `200 {errors: [...], health}` — dry-run `validate_definition`, no writes; the editor's inline-validation call.
  - `GET /api/workflows/{tenant_id}/primitives` → the guard/effect catalog `{guards: [{name, params: [{name, kind, required, enum?}]}], effects: [...]}` **generated from validate.py's param-validator table** (single source — no hand-written duplicate).
- [ ] **Step 1:** Failing tests per endpoint incl.: health computed (stale fixture), family_url only for family+published, validate returns the same errors publish would 409 with (assert equality on a broken fixture), primitives catalog matches the validator table (introspection test: every primitive in GUARDS/EFFECTS appears; params match).
- [ ] **Step 2:** Implement; suites green. Commit: `feat(apexflow): designer read API, dry-run validate, primitives catalog`

### Task 3: flow-runtime — generalized step/section preview renderer

**Files:**
- Modify: `flow-runtime/src/types.ts` (add apexflow types: `WorkflowStepDef`, `WorkflowSectionDef`, `ConditionGroupDef`, matching schema.py aliases exactly), `flow-runtime/src/` (new `StepRenderer.tsx` + `sectionFields.ts`)
- Keep: every existing export unchanged (familyhub compiles untouched — verify)

**Interfaces:**
- Consumes: map §4 (package build story), Task 2's bundle shape.
- Produces: `<StepRenderer steps={...} models={...} mode="preview" draft={...} onDraftChange={...} />` — renders form sections (fields from the model definition, required markers, repeat add-another UI), documents steps (doc list w/ sensitive badge), message steps (body + ack checkbox); `show_if` evaluated client-side (a TS port of the condition evaluator — cite conditions.py semantics incl. missing-source rules and the in-op list guard; unit-testable? no framework — keep the evaluator a pure function so Plan 3 can test it server-parity).
- [ ] **Step 1:** Implement types + renderer; `cd familyhub/frontend && npm run build` must stay green (proves no export broke).
- [ ] **Step 2:** Commit: `feat(flow-runtime): generalized step/section preview renderer`

### Task 4: apexflow-frontend scaffold

**Files:**
- Create: `apexflow/frontend/` (Vite app: config.ts, AuthContext + LoginPage, api client, i18n en-US/zh-CN, AppNav, theme.css, eslint) — ported per map §1 patterns
- Modify: `start-services.sh` (real frontend start replaces the Task-1-era guard)

**Interfaces:**
- Produces: `api/client.ts` (`postQuery`, `createEntity`, `updateEntity`, typed fetch wrapper), `api/designer.ts` (`listDefinitions`, `getBundle`, `validateDefinition`, `publishDefinition`, `lifecycleAction`, `getPrimitives` — bound to Tasks 1-2 shapes), `types/designer.ts` (TS mirrors of the map §2 schemas), routes `/login`, `/` (definitions list), `/definitions/:entityId` (editor) — consumed by Tasks 5-10.
- [ ] **Step 1:** Scaffold; login against local DataCore works (manual check documented); `npm run build` + `npm run lint` clean; start-services boots it.
- [ ] **Step 2:** Commit: `feat(apexflow): frontend scaffold — auth, api client, i18n, nav`

### Task 5: Definitions list page

**Files:**
- Create: `apexflow/frontend/src/pages/DefinitionsPage.tsx` + `.css`

**Interfaces:**
- Consumes: `listDefinitions`, `lifecycleAction`. Produces the home page: lineages grouped (published + draft rows per lineage), badges (status, lineage_status, health incl. `new-fields-available` hint when the bundle's models carry fields the definition doesn't reference — backend supplies via health? **DECISION: v1 badge set = status/lineage_status/health only**; new-fields hint deferred to follow-ups), actions: open editor (draft; or "new draft from published" = generic-write copy with version+1), deprecate/reactivate (confirm dialog), retire (shows `open_instances`, force-cancel checkbox), "New workflow" (blank draft) and "From template" (Task 6). i18n both locales.
- [ ] **Step 1:** Implement; build + lint clean; backend contract already tested (Task 2).
- [ ] **Step 2:** Commit: `feat(apexflow): definitions list — badges, lifecycle, entry points`

### Task 6: Template gallery + instantiate

**Files:**
- Create: `apexflow/frontend/src/pages/TemplateGalleryPage.tsx`; Modify: backend `templates/enrollment.py` (export `template_catalog()` → `[{template_id, name, description, definition}]`), new route `GET /api/workflows/{tenant_id}/templates` (+ test)

**Interfaces:**
- Produces: gallery lists templates from the backend route; "Use template" prompts for a name, writes a tenant-owned DRAFT `workflow_definition` row (generic entity write; new `definition_id` via `fetchNextEntityId`-equivalent — map §8 shape) and navigates to the editor. Template updates never propagate (spec §3) — the copy is complete at instantiate time.
- [ ] **Step 1:** Backend route + test (catalog contains enrollment; definition passes validate_definition). Frontend page; build/lint clean.
- [ ] **Step 2:** Commit: `feat(apexflow): template gallery + instantiate-as-draft`

### Task 7: Step editor

**Files:**
- Create: `apexflow/frontend/src/editor/StepEditor.tsx`, `SectionPanel.tsx`, `ShowIfBuilder.tsx`, editor CSS; `apexflow/frontend/src/editor/draftStore.ts` (single editor state + debounced autosave via `updateEntity`, drafts only)

**Interfaces:**
- Consumes: bundle (definition + models), Task 3 types. Produces: ordered step CRUD (add/remove/reorder via up-down buttons — no drag lib, repo precedent), per-type config panels: form → sections editor (add section → pick entity model → **field picker generated from the model definition listing ALL base+custom fields minus engine-owned/id/link fields**, include + required toggles with model-required fields auto-included and un-loosenable, mode create|match_or_create, repeat min/max), documents → docs list (name/description/sensitive/blocking/due_days_after_state), message → body + ack toggle, review staff|auto, available_in state multiselect, show_if builder (condition rows: source picker from declared sections' fields + context keys, op select, value input; all/any/not grouping one level deep — spec's schema allows nesting, v1 UI composes one group level, deeper nesting via... **DECISION: v1 UI edits one group level; nested groups render read-only with a "edit as JSON" escape hatch**). Inline validation: on every change, debounce-call `validateDefinition`, render errors attached to the offending step/section/field by parsing the error strings' ids (Task 2 asserted error strings name ids — the contract).
- [ ] **Step 1:** Implement; build/lint clean; i18n both locales.
- [ ] **Step 2:** Commit: `feat(apexflow): step editor — sections, field pickers, show_if, autosave`

### Task 8: Machine editor

**Files:**
- Create: `apexflow/frontend/src/editor/MachineEditor.tsx`, `TransitionPanel.tsx`, `GuardEffectComposer.tsx` + CSS

**Interfaces:**
- Consumes: primitives catalog (Task 2), draftStore. Produces: states list CRUD (state_id/name/kind with exactly-one-initial enforced in UI), transitions editor grouped by `(from, action)` showing declaration order with reorder (the guarded-alternatives semantics visible: "first match wins; unguarded last"), per-transition: to/actor/action fields, guards + effects composed from the catalog with param forms generated per param kind (str/list/enum/condition — condition params reuse ShowIfBuilder), `commit_sections` section_ids picker bound to declared sections, `set_entity_field` ref/field pickers (instance fields minus engine-owned, or model+field). Inline validation same channel as Task 7.
- [ ] **Step 1:** Implement; build/lint clean; i18n.
- [ ] **Step 2:** Commit: `feat(apexflow): machine editor — states, ordered transitions, guard/effect composer`

### Task 9: Live preview

**Files:**
- Create: `apexflow/frontend/src/editor/PreviewPane.tsx`

**Interfaces:**
- Consumes: Task 3 `StepRenderer`, draftStore. Produces: side-by-side preview mounting the real renderer in `preview` mode against the current draft + bundle models, with an in-memory draft-answers state so `show_if` reveals work live; a state selector to preview `available_in` filtering per machine state.
- [ ] **Step 1:** Implement; build/lint clean.
- [ ] **Step 2:** Commit: `feat(apexflow): live preview via flow-runtime`

### Task 10: Publish flow

**Files:**
- Create: `apexflow/frontend/src/editor/PublishDialog.tsx`; Modify: editor page wiring

**Interfaces:**
- Produces: Publish button → confirm dialog (runs validate first; blocks with the error list when non-empty) → `publishDefinition` (the Plan 1 action route) → success: supersede note + **family share URL surfaced** for `channel_access: family` (copy button; URL from config facts) → navigate to list. 409 from publish renders the same error mapping as inline validation. Channel-access selector (staff_only|family) lives in the editor header; version/lineage info visible.
- [ ] **Step 1:** Implement; build/lint clean; i18n.
- [ ] **Step 2:** Commit: `feat(apexflow): publish flow with validation gate + share URL`

### Task 11: Browser gate (coordinator-run) + hardening pass

**Files:**
- Modify: whatever the gate finds; Create: nothing new planned

**Interfaces:** none — this is the acceptance gate. The COORDINATOR (not a subagent) runs it with the Chrome plugin against the local stack:
- [ ] **Step 1:** Boot stack (`./start-services.sh` subset: datacore, apexflow backend+frontend). Login.
- [ ] **Step 2:** Click-through: template gallery → instantiate enrollment copy → editor loads with all four sections' field pickers showing model fields (verify acme-afterschool's `agreement_signed_by` custom field appears) → edit something in each editor (step, section field toggle, machine transition) → autosave verified by DataCore query → break the machine (delete a terminal state) → inline validation shows the error → fix → publish → verify `status='published'` by direct DataCore query (the Plan 4 lesson: never trust the UI's optimistic state) → share URL shown → deprecate from the list page → verify 409 on familyhub start route → reactivate. Record a GIF.
- [ ] **Step 3:** File every defect found as fix tasks (subagent-dispatched), re-run the click-through after fixes.

### Task 12: Final gate + follow-ups + merge

- [ ] **Step 1:** All suites green with outputs recorded (datacore, apexflow, familyhub backend, papermite w/ known ignore, launchpad, admindash) + all three frontends build + lint.
- [ ] **Step 2:** Write `docs/superpowers/plans/2026-08-06-apexflow-plan2-followups.md` (deferred: new-fields-available badge, nested show_if UI, model-impact surfacing in editor, anything from the gate).
- [ ] **Step 3:** Merge per `superpowers:finishing-a-development-branch` back to `docs/registration-flow-design`.
