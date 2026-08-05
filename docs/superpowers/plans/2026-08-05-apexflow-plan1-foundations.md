# ApexFlow Plan 1 — Foundations (headless engine + teardown) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `apexflow-backend` — the generic workflow engine (definitions, publish validation, instances, items, guarded state machine, magic links, internal routes), seed the enrollment template on it, retarget familyhub, and delete enrollx.

**Architecture:** apexflow-backend is a FastAPI service persisting nothing (DataCore only), structurally a generalization of enrollx-backend — whose config/auth/DataCore-client/token/email modules are ported nearly verbatim before the rest of enrollx is deleted. New pure-logic modules (schema, validation, guards/effects, machine execution) carry the bulk of the new tests. Spec: `docs/superpowers/specs/2026-08-05-apexflow-workflow-platform-design.md` — **the spec wins over this plan on any conflict.**

**Tech Stack:** Python 3.13 + uv, FastAPI + pydantic v2 + pydantic_settings, pytest, LanceDB via DataCore HTTP API only.

## Global Constraints

- Base branch: `docs/registration-flow-design`. Feature branch: `feat/apexflow-plan1-foundations`. Commit per task. TDD throughout.
- **Interface map governs:** Task 0 produces `docs/superpowers/plans/2026-08-05-apexflow-plan1-interface-map.md` from the real code. Where any code snippet in this plan disagrees with the map, **the map wins**; mark the divergence `# ADJUST(bindings)` in the commit touching it. (This convention caught all 18 plan defects in registration Plan 5.)
- **Identifier trap:** wherever a payload, token, or filter says `instance_id` it means DataCore's **`entity_id`**, never the WI-prefixed business id in `base_data`. Same for `definition_id` lookups by row (`entity_id`) vs lineage (`base_data.definition_id`). Every task inherits this rule.
- Env prefix `APEXFLOW_` (pydantic_settings). Secrets: `APEXFLOW_LINK_SECRET`, `APEXFLOW_INTERNAL_KEY` (min length 32 enforced in production mode, mirroring enrollx's `MIN_SECRET_LENGTH`). familyhub reads `FAMILYHUB_APEXFLOW_INTERNAL_KEY` / `FAMILYHUB_APEXFLOW_BASE_URL`.
- Every authenticated route: `require_tenant_match` + `require_role({"admin","staff"})`. Internal routes: `X-Internal-Key` only, no JWT. DataCore `/auth/me` validates JWTs.
- Ports: apexflow-backend **5910**, apexflow-frontend **5900** (reserved; no frontend in this plan). familyhub 6000/6010 unchanged.
- Engine-owned instance fields (constant `ENGINE_OWNED_FIELDS`, exported): `instance_id, workflow_instance_id, definition_id, definition_version, state, subject_refs, context, channel_started, applicant_email, token_version, draft_data, opened_at, closed_at`. Section writes naming any of these → 400.
- Item statuses: `not_started | in_progress | submitted | verified | rejected | waived`. Definition version statuses: `draft | published | superseded`. Lineage: `active | deprecated | retired`. Instance carries admin-cancel outcome as state `"cancelled"` (synthetic, always terminal-legal).
- No `Date.now`-style hidden clocks in guards: `date_window` and due clocks read a `now` injected via the evaluation context (testability).
- Email strings follow the enrollx `emails.py` pattern (HTML-escaped interpolation — the escaping gap noted in Plan 3 follow-ups must not be reproduced).

---

### Task 0: Branch, interface map, and scaffold decisions

**Files:**
- Create: `docs/superpowers/plans/2026-08-05-apexflow-plan1-interface-map.md`

**Interfaces:**
- Produces: the authoritative map every later task cites. Minimum contents, each with exact signatures copied from source (not paraphrased):
  1. enrollx DataCore client (`enrollx/backend/app/registration/datacore.py`): `dc_create`, `dc_update`, `dc_query`, `next_id`, error-relay conventions, custom_fields handling.
  2. enrollx auth deps (`app/auth.py` or equivalent): `require_tenant_match`, `require_role`, internal-key dependency.
  3. enrollx token module (magic links): sign/verify/revoke signatures, encoding.
  4. enrollx email module + Resend client surface.
  5. enrollx test fakes (`tests/fakes.py`): `FakeDataCore` methods and any signature drift (Plan 3 follow-up #13 warned `dc_update` lags — fix while porting).
  6. DataCore: entity routes used (`POST/PUT /api/entities/...`), `DEFAULT_ABBREVS` location (`datacore/src/datacore/api/routes.py:20-32`), models read path, query passthrough guard helpers.
  7. familyhub internal client (`familyhub/backend/app/...`): base-URL config, header name, routes called today.
  8. launchpad model seeding (`launchpad/backend/app/api/tenants.py:171-229`) and `base_model.json` structural conventions.
  9. Papermite finalize path (`papermite/backend/app/api/finalize.py:178-256`) — where model replacement happens today.

- [ ] **Step 1:** `git checkout docs/registration-flow-design && git pull && git checkout -b feat/apexflow-plan1-foundations`
- [ ] **Step 2:** Read each source listed above; write the map file with verbatim signatures and a "gotchas" section (identifier trap instances, TOON encoding of `base_data`, flattened-row vs envelope shapes noted in Plan 5 follow-up #10).
- [ ] **Step 3:** Commit: `git add docs/superpowers/plans/2026-08-05-apexflow-plan1-interface-map.md && git commit -m "docs(apexflow): plan 1 interface map from source"`

### Task 1: apexflow-backend scaffold by porting enrollx's load-bearing modules

**Files:**
- Create: `apexflow/pyproject.toml`, `apexflow/backend/app/{main.py,config.py,auth.py}`, `apexflow/backend/app/workflows/{__init__.py,datacore.py,tokens.py,emails.py}`, `apexflow/backend/tests/{conftest.py,fakes.py,test_health.py}`
- Modify: `services.json` (replace enrollx entries with `apexflow-frontend: 5900`, `apexflow-backend: 5910`), `start-services.sh`

**Interfaces:**
- Produces: `Settings` (env prefix `APEXFLOW_`, fields per map incl. `link_secret`, `internal_key`, `datacore_base_url`, production secret-length validator); `require_tenant_match`, `require_role`, `require_internal_key` FastAPI deps; `dc_create/dc_update/dc_query/next_id` (signatures identical to the map); token module `sign_link_token(tenant_id, instance_entity_id, token_version) -> str`, `verify_link_token(token) -> (tenant_id, instance_entity_id) | raise`; `FakeDataCore` (with the `custom_fields` param fixed).

- [ ] **Step 1:** Copy the mapped modules from `enrollx/backend` into the new layout; rename env prefix and secret names (`ENROLLX_` → `APEXFLOW_`, `ENROLLX_LINK_SECRET` → `APEXFLOW_LINK_SECRET`, `ENROLLX_INTERNAL_KEY` → `APEXFLOW_INTERNAL_KEY`); delete registration-specific and payment code from the copies (no Stripe imports anywhere).
- [ ] **Step 2:** Port `tests/fakes.py` + `conftest.py`; extend `FakeDataCore.dc_update` with the `custom_fields` parameter to match the real signature.
- [ ] **Step 3:** Write `test_health.py`: app boots, `/health` 200; auth deps reject cross-tenant (copy one representative 403 test per dep from enrollx's suite, retargeted). Run: `cd apexflow && uv sync --extra dev && uv run pytest backend/tests/ -v` → PASS.
- [ ] **Step 4:** Update `services.json` + `start-services.sh` (apexflow-backend on 5910; leave a frontend entry for 5900 pointing at `apexflow/frontend` even though it doesn't exist yet — guard start-services against its absence the same way placeholder dirs are handled today, per the map).
- [ ] **Step 5:** Commit: `feat(apexflow): backend scaffold — config, auth deps, datacore client, tokens, fakes`

### Task 2: Entity definitions, abbreviations, and model enrichment

**Files:**
- Modify: `launchpad/backend/app/data/base_model.json`, `datacore/src/datacore/api/routes.py` (DEFAULT_ABBREVS)
- Test: `datacore/tests/test_abbrevs_workflow.py` (new), plus the existing base_model validation one-liner

**Interfaces:**
- Produces: base_model entries `workflow_definition`, `workflow_instance`, `workflow_item`, `workflow_activity` with base_fields exactly as spec §3 (definition: `definition_id, name, version, status, lineage_status, channel_access, machine, steps` — `machine`/`steps` are JSON-serialized strings per the `registration_config.blocks` precedent); removal of `registration_config`, `application_item`, `application_activity`, `payment`; **retained + enriched** `registration_application` per spec §8 (incl. `student_id`, `family_id`); enriched `student`/`family`/`contact` per spec §8; `tenant` gains `capacity (number, optional)`. Abbrevs: `workflow_definition: WD, workflow_instance: WI, workflow_item: WT, workflow_activity: WA` (drop `registration_application: RA`? **No** — keep RA, entity survives).

- [ ] **Step 1:** Write failing test in datacore asserting `DEFAULT_ABBREVS` contains the four new abbrevs; run → FAIL.
- [ ] **Step 2:** Add abbrevs; run datacore suite → PASS.
- [ ] **Step 3:** Edit `base_model.json` per the Produces block, following the file's exact field-shape conventions (from the map). Validate: `python3 -c "import json; d=json.load(open('launchpad/backend/app/data/base_model.json')); assert 'workflow_definition' in d and 'payment' not in d and 'registration_config' not in d; print(sorted(d.keys()))"`.
- [ ] **Step 4:** Run launchpad backend tests (if any touch base_model). Commit: `feat(models): workflow entities + industry-standard admission fields; retire registration workflow entities`

### Task 3: Machine/steps schemas and condition expressions (pure)

**Files:**
- Create: `apexflow/backend/app/workflows/schema.py`, `apexflow/backend/app/workflows/conditions.py`
- Test: `apexflow/backend/tests/test_schema.py`, `apexflow/backend/tests/test_conditions.py`

**Interfaces:**
- Produces (pydantic v2 models, exact names): `Condition{source, op: Literal["eq","ne","in","empty","not_empty","truthy"], value}`, `ConditionGroup{all_?|any_?|not_?}` (aliases `all/any/not`, exactly one set), `StateDef{state_id,name,kind: Literal["initial","active","terminal"]}`, `GuardRef{primitive, params: dict}`, `EffectRef{primitive, params: dict}`, `TransitionDef{transition_id, from_ (alias "from"), to, action, actor: Literal["family","staff","system"], guards: list[GuardRef], effects: list[EffectRef]}`, `MachineDef{states, transitions}`, `FieldPick{name, required: bool}`, `SectionDef{section_id, entity_model, fields: list[FieldPick], mode: Literal["create","match_or_create"], repeat: {min:int,max:int}|None}`, `StepDef{step_id, type: Literal["form","documents","message"], title, required: bool, blocking: bool, available_in: list[str], show_if: ConditionGroup|None, review: Literal["staff","auto"]|None, config: dict}`; `evaluate_condition(group, data: dict) -> bool` where `data` keys are `"{section_id}.{field}"` and `"context.{key}"`; `ENGINE_OWNED_FIELDS` frozenset (Global Constraints list).

- [ ] **Step 1:** Write table-driven tests: round-trip each model from JSON (incl. `from`/`not` aliases); `evaluate_condition` truth table covering every op, nesting (`all` of `any`), missing-source (→ `empty` true, `truthy` false). Run → FAIL.
- [ ] **Step 2:** Implement; run → PASS. Commit: `feat(apexflow): definition schemas + condition evaluation`

### Task 4: Publish validation (machine, steps, required-field coverage)

**Files:**
- Create: `apexflow/backend/app/workflows/validate.py`
- Test: `apexflow/backend/tests/test_validate.py`

**Interfaces:**
- Consumes: Task 3 models.
- Produces: `validate_definition(machine: MachineDef, steps: list[StepDef], models: dict[str, dict]) -> list[str]` (empty = valid; `models` maps entity_type → merged model_definition dict). Also `definition_health(machine, steps, models) -> Literal["current","stale","broken"]` for reuse by creation-time refusal (Task 6) and the impact endpoint (Task 5).

- [ ] **Step 1:** Failing table-driven tests, one row per spec rule: exactly one initial state; ≥1 terminal; all states reachable from initial; non-terminal states have an outgoing transition; per `(from, action)` at most one unguarded transition and it is declared last; guard/effect refs resolve against the primitive registries (import from Task 7's registry module — stub the registry dict in this task with names only, `# ADJUST(bindings)` when Task 7 lands); `commit_sections` refs name declared sections; `available_in`/transition state refs exist; **coverage**: model-required field missing from unconditional sections → error, unless engine-supplied (`{model}_id` link fields, id fields), model-defaulted, or provided by `set_entity_field` on a transition; conditional sections containing model-required fields → error; sections naming `ENGINE_OWNED_FIELDS` → error. `definition_health`: dangling field ref → `"broken"`; coverage hole → `"stale"`; else `"current"`.
- [ ] **Step 2:** Implement (reachability = BFS over transitions); run → PASS. Commit: `feat(apexflow): publish-time validation + definition health`

### Task 5: Definitions API — publish, lineage lifecycle, model impact

**Files:**
- Create: `apexflow/backend/app/api/definitions.py`, `apexflow/backend/app/workflows/definitions.py` (service)
- Test: `apexflow/backend/tests/test_definitions_api.py`

**Interfaces:**
- Consumes: Tasks 1, 3, 4. Drafts are written via generic entity routes (this service adds none for drafting).
- Produces: `POST /api/workflows/{tenant_id}/definitions/{entity_id}/actions` body `{"action": name}` with actions `publish` (validate → 409 with error list on failure; supersede prior published row of the same lineage; set `status="published"`), `deprecate`, `reactivate`, `retire` (409 listing open-instance count when any are open — the `{"force_cancel": true}` branch is **wired in Task 8**, which owns `cancel_instance`; in this task `force_cancel` returns 501); `GET /api/workflows/{tenant_id}/model-impact?entity_type=X&field=Y` → `{references: [{definition_id, entity_id, version, sections|conditions}]}`; `get_published_definition(tenant, lineage_definition_id) -> row | None` for Task 6. Lineage rules: at most one published version; `lineage_status` read from the published row.

- [ ] **Step 1:** Failing tests: publish flips draft→published and prior published→superseded (both rows asserted via FakeDataCore); publish of invalid machine → 409 + errors; business-id-instead-of-entity-id → 404 **and the row stays draft** (the Plan 4 contract test, generalized); deprecate blocks Task 6 creation (write after Task 6; leave a placeholder test name here and fill in Task 6 — cross-task test, note in map); retire with open instances → 409; model-impact returns section + `show_if` + guard `data_condition` references.
- [ ] **Step 2:** Implement service + routes (`require_tenant_match` + role). Run suite → PASS. Commit: `feat(apexflow): definition publish, lineage lifecycle, model impact`

### Task 6: Instances and items — creation, applicability, item built-ins

**Files:**
- Create: `apexflow/backend/app/workflows/engine.py` (instance creation + item ops), `apexflow/backend/app/api/instances.py`
- Test: `apexflow/backend/tests/test_instances.py`, `apexflow/backend/tests/test_items.py`

**Interfaces:**
- Consumes: `get_published_definition` (Task 5), `definition_health` (Task 4), schemas (Task 3), dc client (Task 1).
- Produces: `create_instance(tenant, lineage_definition_id, context: dict, channel, applicant_email=None) -> {instance, items}` — 409 if lineage not `active` or health ≠ `current`; derives one `workflow_item` per step (documents steps: one item per `config.docs` entry, mirroring registration's `derive_items`); initial state = the machine's `initial` state; writes `workflow_activity` state_change row. Item ops (each logs activity, enforces the authority matrix): `save_draft(instance, section_answers) -> None` (writes `draft_data`; rejects `ENGINE_OWNED_FIELDS` with 400), `complete_item(instance, item_entity_id, actor) -> item` (form: required-field check vs pinned definition → 409 listing missing; documents: `payload_ref` must be a document of this instance; `review: auto` → status `verified`, else `submitted`; family actor allowed), `verify_item/reject_item/waive_item` (staff only). `applicable_items(definition, items, draft_data) -> list` filtering by `show_if` (dynamic, no item mutation). Routes: `POST /api/workflows/{tenant_id}/definitions/{entity_id}/instances`, item actions via Task 8's action route (built-in action names).
- HTTP surface for items rides the single actions endpoint (Task 8); this task implements the functions and unit-tests them directly.

- [ ] **Step 1:** Failing tests: creation derives items incl. per-doc fan-out; deprecated lineage → 409; stale definition (inject a models dict missing a required-covered field) → 409; draft save of engine-owned field → 400; form complete with missing required → 409 naming fields; `review: auto` form → `verified` on complete, documents default → `submitted`; family cannot verify (403); waive from any status; `applicable_items` hides a `show_if`-false step and reveals it when the driving answer changes.
- [ ] **Step 2:** Implement; run → PASS. Commit: `feat(apexflow): instance creation, item authority matrix, applicability`

### Task 7: Guards and effects primitive registries

**Files:**
- Create: `apexflow/backend/app/workflows/primitives.py` (both registries + `EvalContext`)
- Test: `apexflow/backend/tests/test_primitives.py`

**Interfaces:**
- Consumes: conditions (Task 3), dc client, item helpers (Task 6).
- Produces: `EvalContext{tenant_id, instance, items, definition, draft, models, actor, now: datetime, dc}` ; `GUARDS: dict[str, Callable[[EvalContext, dict], bool]]` with `all_blocking_items_complete` (applicable+blocking items all in `submitted|verified|waived`), `items_in_status{step_ids?, status}`, `capacity_available{count_states: list[str], capacity_field, scope_context_key?}` (counts instances of this lineage in `count_states`, scoped by e.g. `context.school_year`, vs the tenant-entity field; missing/0 capacity → True), `data_condition{condition}`, `date_window{start?, end?}` (compares `ctx.now`), `actor_role{roles}`; `EFFECTS: dict[str, Callable[[EvalContext, dict], None]]` with `commit_sections{section_ids}` (declaration order; repeat sections → one entity each; `match_or_create` binds to the map's bulk-add/match helpers `# ADJUST(bindings)`; link-field injection: a later section's model declaring `{earlier_model}_id` gets the resolved entity_id; results into `subject_refs`; re-validates required fields → raises → 409), `set_entity_field{ref, field, value}`, `send_email{template}` (Resend via Task 1 module; log `workflow_activity email_sent`), `issue_link` (Task 1 tokens; stores nothing beyond `token_version`), `start_due_clocks{step_ids}` (sets `due_at = now + due_days_after_state`), `set_context{key, value}`.

- [ ] **Step 1:** Failing tests per primitive (table-driven; capacity boundary at exactly-full; `date_window` end-inclusive as spec'd — pick end-of-day inclusive and assert it; commit order + link injection with a 3-section student/family/contact fixture; engine-owned rejection; orphan-tolerant commit of a field the model no longer declares).
- [ ] **Step 2:** Implement; run → PASS. Commit: `feat(apexflow): guard and effect primitive libraries`

### Task 8: Machine execution — the action endpoint, auto-advance, cancel

**Files:**
- Create: `apexflow/backend/app/workflows/machine.py`, extend `apexflow/backend/app/api/instances.py`
- Test: `apexflow/backend/tests/test_machine.py`, `apexflow/backend/tests/test_actions_api.py`

**Interfaces:**
- Consumes: Tasks 3–7.
- Produces: `execute_action(ctx, action_name, params) -> instance` — resolves item built-ins first; else transitions from current state matching `(action)` in declaration order, actor-checked (`family` actor may fire only `actor: family` transitions and family-permitted item built-ins), first guards-pass wins; no match → 409 `{allowed: [...]}` listing currently-satisfiable actions; effects run in listed order; state stored; activity logged. `run_system_transitions(ctx)` — called after every item mutation and action: evaluates `actor: system` transitions from the (possibly new) current state, declaration order, loops until fixpoint with a visited-state cycle guard. `cancel_instance(ctx)` — staff built-in from any non-terminal state → state `"cancelled"`, `closed_at` set, `token_version` incremented, activity logged. This task also replaces Task 5's `force_cancel` 501 with real bulk-cancel (add the passing test in `test_definitions_api.py`). Route: `POST /api/workflows/{tenant_id}/instances/{entity_id}/actions` body `{"action": name, ...params}`.

- [ ] **Step 1:** Failing tests: guarded-alternative ordering (two `submit` transitions, guard-full → waitlist branch; else default); actor gating (family firing a staff transition → 403); 409 lists allowed actions; system auto-advance fires after the item mutation that satisfies its guard (verify last item → state advances, activity shows both); auto-advance cycle guard terminates; cancel from non-terminal, refused from terminal; effect exception → no state write (assert state unchanged and a failed-action activity row).
- [ ] **Step 2:** Implement; run → PASS. Commit: `feat(apexflow): machine execution, system auto-advance, cancel_instance`

### Task 9: Enrollment template seed + lifecycle acceptance tests

**Files:**
- Create: `apexflow/backend/app/templates/enrollment.py` (the definition as data + a `seed_enrollment_template(tenant)` helper), `apexflow/backend/tests/test_enrollment_template.py`
- Create: `scripts/apexflow-reseed-dev.py` (wipe registration rows per spec §10 + push enriched models via launchpad sync + seed template for dev tenants)

**Interfaces:**
- Consumes: everything above.
- Produces: the template exactly per spec §7 — states `draft, submitted, in_review, pending_items, approved, enrolled, waitlisted, declined, withdrawn`; submit = guarded alternatives (`capacity_available` negated → `waitlisted`, else `submitted`); approve effects `commit_sections(family, student, contacts, application) + set_entity_field(student.status) + start_due_clocks + send_email(approved)`; `approved → enrolled` as `actor: system` guarded on post-approval items verified; reject_item flips to `pending_items` via a system transition guarded `items_in_status{status: rejected}`; steps: welcome message, form sections over `student/family/contact/registration_application` (contacts repeatable, all model-required fields covered unconditionally), documents (immunization, `sensitive: true`), review; context `school_year`.

- [ ] **Step 1:** Failing acceptance tests, table-driven over the full lifecycle: happy path draft→…→enrolled (staff channel, offline world — no Stripe anywhere); waitlist branch at capacity boundary; reject→pending_items→resubmit; waive; cancel; family-actor permission matrix; commit produces linked student/family/contact/registration_application entities with `student_id`/`family_id` stamped.
- [ ] **Step 2:** Implement template + make tests pass. **The template must pass `validate_definition` with zero errors as its own test.**
- [ ] **Step 3:** Write the reseed script (idempotent; prints what it wiped/seeded). Run it against local dev DataCore; verify with a direct query that old `registration_config` rows are gone and the template is published.
- [ ] **Step 4:** Commit: `feat(apexflow): enrollment template + lifecycle acceptance suite + dev reseed`

### Task 10: Magic-link internal routes + familyhub retarget

**Files:**
- Create: `apexflow/backend/app/api/internal.py`
- Modify: familyhub backend client/config/routes per map (base URL, header env, route paths), familyhub frontend `config.ts`/route param rename only (`program_id` → `definition_id` in the register path)
- Test: `apexflow/backend/tests/test_internal_api.py`, familyhub backend suite updated

**Interfaces:**
- Consumes: tokens (Task 1), engine (Tasks 6/8).
- Produces (all `X-Internal-Key`, no JWT): `POST /internal/workflows/{tenant_id}/{definition_id}/start` body `{context, applicant_email}` → `201 {instance, items, token, link}`; `GET /internal/workflows/{tenant_id}/{definition_id}/config` → `{definition, tenant: {tenant_id, name}, capacity: {capacity, admitted, full}}`; `GET /internal/instance-by-token/{token}` → `{instance, items, definition}`; `POST /internal/instance-by-token/{token}/actions` — family-actor enforcement (item built-ins `save_draft/complete_item` + `actor: family` transitions; all else 403); `GET /internal/instance-by-token/{token}/documents` (parent-upload visibility rule unchanged from registration: sensitive docs only when `uploaded_by == "parent:{instance entity_id}"`); `POST /internal/workflows/{tenant_id}/request-link` body `{email}` → always `200 {}` (anti-enumeration preserved). familyhub: env renames per Global Constraints; facade routes keep their public shapes but path segment `{program_id}` becomes `{definition_id}`; frontend register URL `/w/{tenant_id}/{definition_id}`.
- Document routes: port enrollx's two blob-proxy routes (`POST /api/documents/{tenant}`, `GET /api/documents/{tenant}/{doc_id}/url`) with `uploaded_by` derived server-side — staff `user_id` on the JWT surface, `parent:{instance entity_id}` on the token surface. **Never accepted from the client** (roadmap security rule, verbatim).

- [ ] **Step 1:** Failing tests: token scope (wrong tenant/instance → 403), revocation via `token_version` bump, family action allowlist incl. `actor: family` transitions, request-link anti-enumeration (unknown email still 200 `{}`), `uploaded_by` derivation on both surfaces, internal-key required (401/403 pinned to one code — pick 401, note in map).
- [ ] **Step 2:** Implement; run apexflow suite → PASS.
- [ ] **Step 3:** Retarget familyhub (client, env, param rename); update its tests; run `cd familyhub && uv run pytest backend/tests/ -q` → PASS (tests updated to the new contract count as the deliverable).
- [ ] **Step 4:** Commit: `feat(apexflow): internal token routes; familyhub retargeted enrollx→apexflow`

### Task 11: Papermite merge rule

**Files:**
- Modify: `papermite/backend/app/api/finalize.py` (per map §9)
- Test: `papermite/backend/tests/test_finalize_merge.py` (new)

**Interfaces:**
- Produces: on finalize-commit for an entity type already in the tenant's models: existing `base_fields` preserved verbatim; extracted fields matching an existing base **or custom** field by name → dropped; remainder appended to `custom_fields`. Idempotent on re-commit. Applies to every entity type.

- [ ] **Step 1:** Failing tests: existing-model merge preserves base fields and appends new custom; name collision dropped; fresh entity type still writes whole definition; re-commit adds nothing twice.
- [ ] **Step 2:** Implement; run papermite suite → PASS. Commit: `fix(papermite): finalize merges model definitions, never replaces`

### Task 12: enrollx deletion and repo bookkeeping

**Files:**
- Delete: `enrollx/` (entire module)
- Modify: `CLAUDE.md` (service table: enrollx → apexflow, description "workflow platform: designer + engine"; ports; commands section), `docs/deployment/*` mentions if any, `deploy/suite-manifest.json` only if it lists enrollx

**Interfaces:** none new; this task must leave every remaining suite green.

- [ ] **Step 1:** `grep -rn "enrollx\|ENROLLX" --include="*.py" --include="*.ts" --include="*.tsx" --include="*.json" --include="*.sh" --include="*.md" .` (excluding `docs/superpowers/` history and `.git`) — resolve every live-code hit before deleting.
- [ ] **Step 2:** `git rm -r enrollx` + the CLAUDE.md/services edits.
- [ ] **Step 3:** Full verification: datacore, apexflow, familyhub, papermite, launchpad, admindash backend suites + `./start-services.sh` boots without enrollx. Record outputs.
- [ ] **Step 4:** Commit: `chore: retire enrollx — apexflow replaces it`

### Task 13: Final gate

- [ ] **Step 1:** Run every backend suite; all green, outputs recorded (verification-before-completion applies — no summary claims without command output).
- [ ] **Step 2:** Write `docs/superpowers/plans/2026-08-05-apexflow-plan1-followups.md`: anything deferred, the transferred registration follow-ups (R2 seam, `TRUST_ALL_IPS`, referrer-policy, pagination), the deferred document-upload manual verification checklist, plan defects found (with `# ADJUST(bindings)` citations).
- [ ] **Step 3:** Merge per `superpowers:finishing-a-development-branch` back to `docs/registration-flow-design`.
