# ApexFlow Plan 1 (Foundations) — follow-ups

Plan 1 lands on `feat/apexflow-plan1-foundations` (24 commits, `051d0f3..114e81d`
plus `de72ea9`, apexflow backend 0 → 350 tests). Task 13's gate found **one
live-reseed bug** (fixed, see below) and otherwise a clean bill: datacore
346, apexflow 350, familyhub backend 82, familyhub frontend build clean,
papermite 115 (`--ignore=backend/tests/test_auth.py`), launchpad backend 28,
admindash backend 183, `start-services.sh` syntax valid.

Companion: `2026-08-03-registration-plan5-followups.md` (the family-channel
plan this one builds on) — items 1, 2, 7, and 11 there are **transferred**
below rather than repeated in full, since apexflow/familyhub's Task 10-12
retarget didn't close any of them.

## Fixed during this gate

0. **Reseed script carried stale required fields forward, permanently
   blocking `publish_definition`.** Live run against DataCore hit a 409 on
   the very first tenant (`acme`): `registration_application` required
   fields `channel_started`/`config_version` were "not included+required by
   any unconditional section." Root cause: a PRIOR schema generation had
   these as required base fields (options `["parent","admin"]`); Task 2's
   `base_model.json` dropped them from `registration_application` in favor
   of `workflow_instance` fields of the same name (options
   `["family","staff"]`). `merge_model_definition`
   (`scripts/apexflow-reseed-dev.py`) correctly carries old fields forward
   as custom (that's the Papermite-merge property Task 13 verifies), but
   nothing in the new engine/template can ever satisfy a field the current
   base schema no longer declares — so `required: True` with no `default`
   blocks publish forever, for any tenant that ever touched the old
   registration schema. Fixed: carried-forward fields with `required: True`
   and no `default` are demoted to `required: False` on merge; fields with a
   `default` are untouched (they already self-satisfy
   `validate.py`'s `_coverage_errors` exemption regardless of `required`).
   TDD: two new tests in `apexflow/backend/tests/test_reseed_script.py`
   (`test_merge_model_definition_demotes_required_carried_field_without_default`,
   `test_merge_model_definition_keeps_required_true_when_field_has_default`).
   Commit `de72ea9`. Re-ran the full reseed after the fix — all 7 dev
   tenants (`acme`, `acme-afterschool`, `acme2`, `afterschool-abc`, `ruskin`,
   `test-dup`, `test-fix`) reseeded and published cleanly; all three Task 13
   verification checks passed (below).

1. **The final whole-branch review's three Important-severity items —
   fixed pre-merge in this same fix wave, not deferred:**
   - `familyhub_base_url`'s dev default pointed at a dead port (6000);
     CLAUDE.md/services.json pin FamilyHub frontend to 5620.
     `apexflow/backend/app/config.py`'s default and comment corrected; the
     two tests that hard-coded `:6000`
     (`apexflow/backend/tests/test_internal_api.py`,
     `familyhub/backend/tests/test_registration_routes.py`) re-pinned.
   - The family/token-scoped definition routes (`POST .../start`,
     `GET .../config` in `apexflow/backend/app/api/internal.py`) never
     checked `channel_access` — a `staff_only` definition was fully
     readable/startable through the public family surface. Both routes now
     404 (never 403, to avoid an existence oracle — same reasoning as
     `resolve_token`'s uniform 401) via a new
     `_require_family_channel_definition` helper.
   - Publish-time validation (`app/workflows/validate.py`) only checked
     that a guard/effect named a KNOWN primitive, never that its `params`
     dict carried what that primitive needs — a malformed definition
     (e.g. `items_in_status` with no `status`) passed `validate_definition`
     cleanly and only failed with a raw `KeyError` at first execution.
     Added a per-primitive required-param table
     (`GUARD_PARAM_VALIDATORS`/`EFFECT_PARAM_VALIDATORS`) covering every
     guard/effect primitive with a real param shape, plus the missing
     positive regression test for `_unguarded_branch_errors` and the
     missing `_capacity_summary` boundary test.

   TDD throughout: every new/failing test confirmed red before its fix
   landed; full suites green after (apexflow 374, familyhub backend 82,
   `bash -n start-services.sh` clean).

## Live reseed verification (Task 13 gate)

Ran against a locally started DataCore (`TRUST_ALL_IPS=1 uv run uvicorn
datacore.api.server:app --host 127.0.0.1 --port 5800`) with
`cd apexflow/backend && uv run python ../../scripts/apexflow-reseed-dev.py`.

- **(a) No active `registration_config` rows for `acme-afterschool`.**
  Confirmed via direct query: `{"data": [], "total": 0}`.
- **(b) A published `workflow_definition` exists for the enrollment
  template.** Confirmed: `acme-afterschool`'s active `workflow_definition`
  row is `{"name": "Enrollment", "status": "published", "version": "1",
  "channel_access": "family"}`.
- **(c) The Papermite-merge property held.** `acme-afterschool`'s
  `registration_application` model, post-reseed: new base fields
  (`application_id`, `school_year`, `student_id`, `family_id`,
  `requested_start_date`, `schedule_days`, `pickup_method`,
  `handbook_acknowledged`, `liability_waiver_signed`,
  `tuition_agreement_signed`, `signature_name`, `signature_date`) plus its
  model-setup custom fields — `agreement_signed_by`, `agreement_signed_date`,
  `conducts_signed_date`, `initials` — survived as `custom_fields`
  (`required: False`, unchanged), alongside the demoted-but-present old
  system fields (`config_version`, `channel_started`, etc., now
  `required: False`).

## Blocking-ish — before apexflow/familyhub go anywhere near production

1. **[Transferred, unchanged] `TRUST_ALL_IPS` must be unset in production,
   and familyhub must genuinely sit behind Cloudflare.** Still true post-Plan
   1: `start-services.sh` sets `TRUST_ALL_IPS=1` for every backend it starts
   locally (`start-services.sh:218,225,232,238,256`, including the apexflow
   entry added this plan), and `familyhub/backend/app/main.py:19,25`'s
   dev-bypass is enforced only by `middleware/cloudflare_ip.py:139`.
   familyhub still has no `fly.toml`/`deploy.yml` entry. Put this on the
   deploy checklist before either apexflow-backend or familyhub-backend gets
   a real Fly app.
2. **[Transferred, unchanged] The document-authorization seam has never been
   exercised end-to-end.** `DATACORE_R2_*` (`datacore/src/datacore/documents.py:11,18-20,49,60`)
   is still absent from the dev environment — Task 13's gate did not (and
   could not) exercise a real upload/download round trip. See "Deferred
   manual verification" below for what to run once R2 credentials exist;
   the family-actor convention itself (`family:{instance_entity_id}`,
   `apexflow/backend/app/api/internal.py:155-156`) and the cross-instance
   scoping (`internal.py:383-419`, filtered by `application_id = eid` before
   any `document_id` match) were code-reviewed but not live-tested.
3. **[Transferred, unchanged] `Referrer-Policy: no-referrer` and access-log
   path scrubbing for token URLs.** Confirmed still absent from both
   `familyhub/backend` and `apexflow/backend` (no `Referrer-Policy` header
   anywhere in either service). The magic-link token still lives in the URL
   by design; unchanged risk from Plan 5.
4. **[Transferred, generalized] `ApplicationsPage`-style pagination concerns
   now apply to future tracking UIs.** enrollx's `ApplicationsPage` (deleted
   in Task 12, `1cb1ceb`) never got a pagination fix before retirement; no
   equivalent component exists yet in apexflow (headless, Phase 2 frontend)
   or a future AdminDash tracking surface. Flag this **before** either is
   built, not after: any staff-facing list of `workflow_instance` rows needs
   pagination/virtualization from day one, not bolted on later.

## Deferred manual verification (document upload, needs live R2)

Same checklist shape as Plan 5's, re-scoped to apexflow/familyhub's actual
routes (`apexflow/backend/app/api/documents.py` for staff,
`apexflow/backend/app/api/internal.py` for the family/token-scoped path):

- [ ] Staff upload via `POST /documents/...` (`documents.py:70,80`) —
      confirm `uploaded_by` lands as `user.get("user_id", "staff")`, never a
      client-supplied value (the request schema has no `uploaded_by` field
      by design — `documents.py:6-9`).
- [ ] Family upload via the token-scoped internal route
      (`internal.py:362-374`) — confirm it lands as
      `family:{instance entity_id}` exactly (`_family_actor`,
      `internal.py:155-156`), not a bare `"family"` or the token itself.
- [ ] Cross-instance `document_id` refusal — attempt to fetch a document
      belonging to a different `workflow_instance` by guessing/reusing its
      `document_id` against a different token; confirm 404 (the listing
      query is scoped by `application_id = eid` before any id match,
      `internal.py:403-409`, so this should be structural, not just
      policy — worth confirming live).
- [ ] A non-sensitive document uploaded by staff is downloadable by the
      family on that same instance (the Task 10 intentional generalization
      noted in `internal.py:389-398` — own-tag OR non-sensitive, scoped to
      one instance only, never across instances).

## Engine / primitives

5. **`ENGINE_OWNED_FIELDS` globally bans the field name `"state"` across
   every entity model, not just `workflow_instance`.**
   (`apexflow/backend/app/workflows/schema.py:32-46`, `"state"` at line 38.)
   Parked at Task 4 (progress.md:15): no collision exists today (family uses
   `address_state`, verified), but the ban is global rather than scoped to
   `workflow_instance`'s own section declarations. A tenant model that
   legitimately wants a `state` field on some OTHER entity (e.g. a
   `student.state` field, unrelated to workflow state) would be blocked by a
   check that doesn't need to look past its own entity_model. Scope the ban
   per-model when a real case appears; not load-bearing for Plan 1.
6. **The lost-update / optimistic-concurrency gap on workflow instance
   writes.** Parked at Task 8 (progress.md:27): no compare-and-swap between
   ctx-build → effects → state-write, so two concurrent actions against the
   same instance (e.g. two submits racing under capacity) can lose an
   update. Real but structural — DataCore has no compare-and-swap primitive
   today, this predates Plan 1, and Phase 1 is dev-only single-user. No code
   TODO exists yet (grepped `lost-update`/`optimistic`/`compare-and-swap`
   across `apexflow/backend` — nothing); this follow-up doc is the only
   place it's tracked until a DataCore version-check write lands. Needs
   final-review triage on whether it's in scope for a future plan or
   deferred further.
7. **`PARENT_ACTIONS` in familyhub is a manually-synced constant, not
   derived from apexflow's engine transitions.**
   (`familyhub/backend/app/api/application.py:54`, guard at line 81.) It
   has already needed two manual updates this plan (Task 10 fix rounds
   added `withdraw` then `resubmit` — progress.md:33,34). Nothing enforces
   that this set stays a subset of what `machine.execute_action` will
   actually accept for a family actor; a definition change on the apexflow
   side that adds/removes a family-reachable transition won't be caught
   until a manual test or a live 403 surfaces it. Consider deriving this
   from the definition's `channel_access`/actor-scoped transitions instead
   of hand-maintaining a second list.
8. **Capacity summary reads only the FIRST `capacity_available` guard.**
   (`apexflow/backend/app/api/internal.py:205-219`, related:
   `apexflow/backend/app/workflows/machine.py:93-103`,
   `familyhub/backend/app/api/registration.py:106`.) Parked at Task 10
   (progress.md:35): a definition with more than one `capacity_available`
   guard across different transitions would only ever surface the first
   one's numbers in the summary. No known case needs a second guard today;
   simplify (single documented guard per definition) or generalize
   (aggregate/select) once a real multi-guard definition exists.
9. **`actor_role` conflates staff and admin.**
   (`apexflow/backend/app/workflows/primitives.py:273-278`, comment: "will
   currently pass for ANY staff"; registered at line 296.) Noted at Task 7
   (progress.md:24): Phase 1 has no need to distinguish the two roles at the
   guard level, but the guard's name/docstring should not overpromise
   role-granularity it doesn't check. Revisit when a transition needs
   admin-only (not staff-or-admin) gating.
10. **`send_email`'s copy is a generic placeholder, not real per-template
    text.** (`apexflow/backend/app/workflows/primitives.py:525-535`.) Task 7
    noted (progress.md:24) Task 9 would need to supply real template copy or
    accept placeholders; Task 9 accepted placeholders — the enrollment
    template's `send_email` calls (`apexflow/backend/app/templates/enrollment.py:198,247,276,282,299`,
    e.g. "approved"/"waitlisted") render a generic status-update notice with
    every interpolated value `html.escape()`d (the Plan 3 escaping gap must
    not recur here — confirmed guarded). A later template-authoring task
    should replace the generic notice with real per-template copy; the
    escaping contract is already tested and should carry forward unchanged.
11. **"not"-group NOR interpretation — confirmed working, flag for designer
    UX.** `ConditionGroup.not_` (`apexflow/backend/app/workflows/schema.py:98,107,111`)
    is implemented as NOR at `apexflow/backend/app/workflows/conditions.py:93-94`
    (`if group.not_: return not any(...)`) — i.e. "not [any of these]", not
    "not [all of these]" (NAND). Task 3 flagged this as a reading to
    confirm; Task 9's enrollment template exercises it correctly (the
    waitlist branch note in `enrollment.py:34` explicitly documents there's
    no guard-negation primitive, so `not` groups are the only way to express
    "none of X"). The semantics are right and tested — but NOR vs NAND is
    exactly the kind of thing a future definition-builder UI needs to make
    unambiguous to a non-engineer author (a checkbox labeled "not" reads as
    NAND to most people). Flag for the Phase 2 designer UI's copy/UX, not a
    code defect.
12. **`RepeatSpec.min`/`max` have no default-0 / edge-case coverage.**
    (`apexflow/backend/app/workflows/schema.py:183-190` — both plain
    required `int` fields, no defaults.) Task 4 noted (progress.md:17): no
    test exists for `min: 0` (an optional-repeat section with zero required
    instances) or for chained unreachability through a repeat section.
    Minor, deferred; worth a test once a real definition uses `min: 0`.

## Reseed / model hygiene

13. **The demotion fix (item 0 above) is a blunt instrument — worth
    revisiting once real tenant data exists beyond dev.** Demoting every
    carried-forward `required: True, no-default` field to optional is
    correct for the specific case this gate hit (stale engine-owned fields
    from a retired schema generation), but it would ALSO silently demote a
    genuinely-intended required custom field if a future tenant ever had
    one (Papermite finalize extraction fields are currently all
    `required: False` by convention — `services/mapper.py`'s
    `_infer_field_type` sets `required=False` default for anything in
    `custom_fields` — so this hasn't collided yet). If Papermite's mapper
    ever starts emitting `required: True` custom fields, this reseed
    behavior needs a second look.

## Cross-plan / infra

14. **Papermite's `backend/tests/test_auth.py` fails at COLLECTION, not
    just at runtime — needs its own fix, not a permanent `--ignore`.**
    Traced to ground truth (not just re-confirmed from progress.md:38):
    `184c8cd` ("refactor(papermite): remove registry_store — auth delegated
    to DataCore") deleted `papermite/backend/app/storage/registry_store.py`
    and `storage/__init__.py` entirely — only stale `.pyc` files remain
    under `papermite/backend/app/storage/__pycache__/` (dated Apr 4/2), no
    `.py` source. `test_auth.py` still does `from app.storage import
    get_registry_store` (line 10) AND `import bcrypt` (line 2) — bcrypt was
    never a papermite dependency (`papermite/pyproject.toml` has no
    `bcrypt`/`passlib` entry) and fails first, before the storage import is
    even reached. The whole file tests a LOCAL auth implementation
    (password hashing, a local user registry) that no longer exists in
    papermite — auth is now fully delegated to DataCore (`GET /auth/me`, per
    root `CLAUDE.md`'s Authentication section). Fix is to delete
    `test_auth.py` (dead code testing a deleted implementation), or replace
    it with a thin test that papermite's `require_tenant_admin()` correctly
    delegates to DataCore — not to restore `bcrypt`/local storage. Needs its
    own task; `--ignore=backend/tests/test_auth.py` should NOT become a
    permanent fixture of the papermite test command.
15. **Task 0's citation precision (no action needed, note only).** Verified
    against current source: `unified_routes.py`'s `QueryRequest` class is at
    line 22 (matches the correction already made — "actually :22-25" per
    progress.md:6), and the `unified_query` handler block runs 34→~77,
    matching the originally-cited range. No further action; recorded here
    only because it was an open citation-precision note in the ledger.

## Accepted minors from the final whole-branch review

The final whole-branch review's three Important items are fixed above
(item 1, "Fixed during this gate"). These six Minor items were accepted
rather than blocking the merge — tracked here per this doc's own
convention, not fixed in this wave.

19. **`start_due_clocks` writes `workflow_item` rows via bare
    `entity_base_data`, silently retyping a real bool to its string form.**
    (`apexflow/backend/app/workflows/primitives.py:554-574`, the
    `entity_base_data(item)` call at line 571.) Unlike `engine.py`'s
    `_item_base_data` (`engine.py:73-84`), which explicitly coerces
    `blocking` via `as_bool()` before writing, `_effect_start_due_clocks`
    round-trips `item` (already a flattened row, so a bool-typed field may
    already read back as the string `"true"`/`"false"` — `shared.py`'s
    `entity_base_data` docstring says plainly "No boolean-field coercion
    here") straight back through `dc.dc_update` with no coercion. Readers
    already tolerate either form via `as_bool()` (`engine.py:83`,
    `primitives.py:174`), so nothing is broken today — but every item
    writer should go through one coercing helper, not two with different
    contracts. Normalize when item writers unify.
20. **Family document uploads land as `sensitive: False` in practice, but
    the gap is one hop upstream of where it first looks.** apexflow's own
    token route (`TokenCreateDocumentRequest.sensitive: bool = False`,
    `apexflow/backend/app/api/internal.py:119`) DOES accept and forward a
    client-supplied value verbatim (`internal.py:396`) — no server-side
    override exists there. Every family upload lands `False` today because
    familyhub's thin proxy (`familyhub/backend/app/api/documents.py:22-28`)
    has no `sensitive` field on its own request body at all and never
    forwards one, by design: its docstring says the doc-metadata
    (`config.blocks[].config.docs[].sensitive`) it used to read "no longer
    exists on the facade's config bundle," pending the Phase 3 blocks
    compiler. Tighten both ends once that compiler exists: familyhub should
    forward the definition-declared per-doc sensitivity, and apexflow's
    token route should stop trusting an unvalidated client-supplied value
    once there's a real value to validate against.
21. **The spec's "friendly closed page" (deprecated lineage) and "hides
    ... from default lists" (retired lineage) are Phase 2/3 surfaces —
    unreachable today, not a bug.** (Spec:
    `docs/superpowers/specs/2026-08-05-apexflow-workflow-platform-design.md:59`.)
    The backend enforces the underlying state correctly (`lineage_status`
    transitions in `definitions.py:158-248`; staff-creation 409s via
    `engine.py:181-185`'s `lineage_not_active`) but surfaces it as a raw
    JSON 409 with no family-URL-specific handling — there is no
    `apexflow/frontend` directory yet (Phase 2 placeholder per CLAUDE.md;
    apexflow ships backend-only today) and `familyhub/frontend` has zero
    references to `lineage_status`. Both display surfaces need building
    once their host frontend exists; not this plan's scope (see item 16,
    below).
22. **Exactly 8 family-403 tests assert status only, no state-write
    re-fetch.** `apexflow/backend/tests/test_enrollment_template.py`'s
    "family-actor permission matrix" section (comment at line 344; tests at
    lines 347, 371, 428, 437, 446, 455, 464, 473) each check only
    `exc.value.status_code == 403` — none re-fetch the instance/item
    afterward to confirm the blocked action produced no side effect. (The
    same status-only pattern recurs elsewhere too —
    `test_items.py:551,592`, `test_machine.py:131,256,450`,
    `test_internal_api.py`'s parametrized
    `test_blocked_staff_only_actions_403_via_token` — but the review's
    "~8" count matches this one file's dedicated section exactly.) Worth a
    follow-up pass adding a re-fetch assertion to at least the dedicated
    permission-matrix section.
23. **`workflow_item.status` declares `"in_progress"` in
    `COMPLETABLE_STATUSES` but no code path ever writes it.**
    (`apexflow/backend/app/workflows/engine.py:64`, also referenced in
    docstrings at lines 455/500/506/509.) Every actual status write is one
    of `"not_started"` (item creation, `engine.py:153`), `"submitted"`/
    `"verified"` (`complete_item`, lines 488-491/511), `"rejected"` (521),
    or `"waived"` (535) — `"in_progress"` is declared as a legal value (a
    guard like `items_in_status` could reference it) but nothing in
    `engine.py`/`primitives.py`/`machine.py` ever assigns it. Either a
    future item-authority change needs to actually use it, or it should be
    dropped from the declared set — a dead-but-declared status is a minor
    trap for a future guard author who assumes it's reachable.

    **CLOSED** — `45c60c6` ("feat(apexflow): ItemStatus StrEnum as the single
    status vocabulary; drop in_progress"), on branch
    `feat/item-status-typing`. `in_progress` was dropped from
    `COMPLETABLE_STATUSES` (which is now derived from the new
    `ItemStatus` StrEnum rather than re-spelled), from `verify_item`'s
    source-status guard (now `VERIFIABLE_STATUSES = {SUBMITTED}`), and from
    two `engine.py` docstrings. `5ddc03c` removed it from the four
    TypeScript sites — `workflow-forms/src/types.ts` (the union and the
    `WorkflowItemView.status` comment), `familyhub HubPage.tsx`
    (`ITEM_TONE`, `ALL_ITEM_STATUSES`, `OUTSTANDING`), and `admindash
    workflowData.ts::itemActionVisibility` — plus the two now-dead i18n keys
    (`workflow-forms/src/i18n.ts`, `familyhub .../translations.ts`). The
    vocabulary now has exactly one spelling, in
    `apexflow/backend/app/workflows/shared.py::ItemStatus`; the TS side is
    GENERATED from it (`workflow-forms/src/itemStatus.generated.ts`) with a
    drift test that fails if the two disagree. See
    `docs/superpowers/plans/2026-08-09-workflow-item-status-typing.md`.
24. **Process lesson: interface maps must also pin cross-service
    CONFIGURATION facts (ports/URLs), not just code bindings.** The
    6000-vs-5620 `familyhub_base_url` bug (item 1 above) came from the
    plan's own stale constant — task-10-brief.md carried forward
    FamilyHub's pre-Task-2 port (6000) after `CLAUDE.md`/`services.json`
    had already moved to 5620/5630, and nothing in the `# ADJUST(bindings)`
    discipline (which this plan otherwise used correctly and consistently
    — see "Plan defects found in Plan 1" below) catches a stale
    CONFIGURATION value the way it catches a stale code-binding name,
    because no source-of-truth citation check exists for "does this
    literal still match services.json today." Extend the interface-map
    discipline to require citing `services.json`/`CLAUDE.md`'s Service
    Ports table directly (with a line number) for any hard-coded port/URL
    default, the same way it already requires citing a real source file
    for a field/function name.

25. **`message`-step bodies are still plain text while section descriptions
    render markdown.** `MessageStep` (`workflow-forms/src/StepRenderer.tsx`)
    splits `config.body` on newlines into escaped paragraphs. Now that
    `SectionDescription` exists as a hardened, single-call-site markdown
    renderer, pointing message bodies at it is a small change — but it is a
    separate authoring surface with its own review implications, so it was
    deliberately left out of the section-layout work.

26. **No CI runs any test suite.** `.github/workflows/` contains only
    `deploy.yml` and `discord-release.yml`; neither invokes pytest or vitest.
    Every suite is run locally by whoever remembers. This matters more now
    than it did: `workflow-forms`'s new vitest suite contains the markdown
    containment and link-scheme tests, which are a security boundary. A
    guard that only runs when someone remembers is weaker than it looks.
    Wiring a test workflow covering the four Python suites and two JS suites
    is its own piece of work.

27. **The spec and plan describe `disableParsingRawHTML` behavior that
    `markdown-to-jsx@9.10.2` does not have.**
    `docs/superpowers/specs/2026-08-09-workflow-form-section-layout-design.md`
    ("Required configuration") and the Task 4 code block in
    `docs/superpowers/plans/2026-08-09-workflow-form-section-layout.md` both
    state that `disableParsingRawHTML: true` causes raw HTML to render as
    literal text and imply that is sufficient. In practice the option demotes
    raw HTML to a plain-text AST node, so attribute text such as
    `onerror="alert(1)"` still reaches the reader as visible characters. The
    shipped component therefore adds a `stripRawHtml` pre-filter that the spec
    does not describe. The SECURITY guarantee is unaffected — a review
    verified across ~60 adversarial inputs that `disableParsingRawHTML` alone
    yields zero live elements and zero live attributes — but the documents no
    longer match the code. Amend both before treating them as reference.

## Phase 2 / Phase 3 pointers (not this plan's scope)

16. **Phase 2 — apexflow-frontend (definition/designer UI).** Currently a
    placeholder port entry only (`CLAUDE.md:13`, port 5900). Needs the
    "not"-group NOR-vs-NAND UX call-out (item 11) baked into its copy from
    the start.
17. **Phase 2/3 — AdminDash tracking UI for `workflow_instance` rows.**
    No component exists yet. Needs pagination/virtualization designed in
    from day one (item 4) rather than retrofitted.
18. **Phase 3 — a blocks compiler for familyhub's config bundle.**
    `familyhub/backend/app/api/registration.py:25,57` ships a literal
    `"blocks": []` placeholder ("ships `blocks: []` until that compiler
    exists" per the code comment) with a related note in
    `familyhub/backend/app/api/documents.py:28`. Task 10 scoped this
    explicitly to Phase 3 (progress.md:35, task-10-report.md:73,92,121);
    unchanged this gate.

---

## Plan defects found in Plan 1

**Small, and the countermeasure held.** Plan 1 reused Plan 5's
`# ADJUST(bindings)` convention from the start (the plan's own pre-flight
scan notes "Task5/Task8 force_cancel ordering already resolved in plan
text" — meaning several bindings issues were caught and fixed in the plan
document itself before implementation began, not discovered mid-task). What
survived into code comments:

- **`task-1-brief.md`'s Interfaces section named a config field
  `datacore_base_url`; the real field, transcribed from enrollx's actual
  source, is `datacore_url`** (`apexflow/backend/app/config.py:32-36`,
  citing `enrollx/backend/app/config.py:27`).
- **`task-1-brief.md`'s Interfaces section called a dependency
  `require_tenant_match`; that name belongs to a different service**
  (`admindash/backend/app/tenancy.py:291`) — enrollx's real equivalent, and
  what apexflow ported, is `require_staff_tenant`
  (`apexflow/backend/app/auth.py:91-96`, echoed in
  `apexflow/backend/tests/test_health.py:34-36`).
- **`match_or_create` family/student matching was never a real module to
  port** — Task 1 confirmed no `family.py` orchestration exists under
  enrollx's `app/workflows/`, so a minimal hand-written heuristic was
  implemented directly (`apexflow/backend/app/workflows/primitives.py:51-60`).
- **`items_in_status`'s shape needed extending beyond Task 7's original
  single-status/all-only design** to support a list of acceptable statuses
  and an `all`/`any` quantifier, done without inventing a new primitive name
  (`primitives.py:185-188`, Task 9).
- **`set_entity_field.params`'s exact shape** (`{ref, field, value}`, spec
  §4) needed confirming against Task 7's actual implementation before
  Task 4's exemption logic could rely on it
  (`apexflow/backend/app/workflows/validate.py:103-107`).
- **`send_email`'s per-template copy was deliberately deferred**, not a
  binding mismatch but a scope decision recorded the same way
  (`primitives.py:510-516`) — see follow-up item 10 above.
- Minor: familyhub's `apexflow_internal_key` dev default is noted
  `# ADJUST(bindings): apexflow dev default` to flag it must match
  apexflow's own `DEV_INTERNAL_KEY` (`familyhub/backend/app/config.py:22`) —
  a cross-service constant kept in sync by comment, not by import; same
  hazard class as item 7's `PARENT_ACTIONS`, smaller blast radius.

None of these needed a fix-round or blocked a task review — every one was
caught by the `# ADJUST(bindings)` discipline at write time, the same
mechanism Plan 5 introduced. No new plan-defect class emerged this time.

28. **The section-description reference-link check over-rejects ordinary
    prose.** `apexflow/backend/app/workflows/validate.py`'s
    `_MD_LINK_REF_R` (`^[ \t]*\[[^\]]+\]:\s*(\S+)`, added in the final
    fix wave of the form-section-layout branch) treats ANY line beginning
    `[label]: text` as a markdown link definition. Legitimate copy is
    blocked at publish with a misleading error naming a "link" that does not
    exist: `[Important]: read the handbook before you begin.` is rejected
    with "has a link to `'read'`", and `[^1]: Pickup is at 3pm on Fridays.`
    is rejected likewise. The RENDERER disagrees — it displays both as plain
    text — so a school can author copy that previews perfectly and cannot be
    saved.

    Fails closed (blocks publishing rather than allowing bad content),
    admin-facing rather than family-facing, and workaroundable by
    rephrasing, so it did not block the merge. Fix: only treat
    `[label]: target` as a link definition when `target` is URL-ish
    (contains `:` or `/`), or when the label is actually referenced by a
    `[x][label]` elsewhere in the same description. Introduced by commit
    `e9a42d0`; regression relative to the branch's own starting point, not a
    pre-existing defect.

29. **`lead` has no durable creation timestamp.** Lead staleness cannot be
    computed honestly: `_created_at` is reset on every write, and
    `lead_activity` records stage transitions with no timestamp of its own.
    The home page's "Inquiries to follow up" bucket is therefore state-based
    only, and the previous "stale > 7 days" bucket was dropped rather than
    carried forward wrong. Fix: write a `created_at` base-data field at lead
    creation.

30. **`_created_at` means last-modified, not created.** `store.py:378-388`'s
    `put_entity` rebuilds the row on every write with `_created_at = now`.
    Verified against live `acme` data: `workflow_item` rows at `_version: 3`
    have `_created_at == _updated_at`. Platform-wide, not page-specific — any
    consumer treating it as a creation time is wrong. The old home-page queue
    was one such consumer.

31. **`/api/query` applies no row cap.** `unified_routes.py:55` calls
    `QueryEngine.query` with no `limit`, unlike `/api/query/readonly`, which
    caps at 200. Fine at current volumes (tens of rows per tenant); a real
    limit belongs there before a large tenant arrives.

32. **`ModelContext`'s callbacks churn identity on every cache write.**
    `getModel` and `getCachedModel` are `useCallback(..., [cache])` over one
    shared cache object with no per-tenant or per-consumer scoping
    (`admindash/frontend/src/contexts/ModelContext.tsx`). Any successful model
    fetch anywhere in the app changes their identity, which re-fires every
    consumer effect that lists them as a dependency — the first run is
    discarded via its `cancelled` flag, but the requests still reach the
    server. Self-terminating, not an infinite loop. Fix by stabilising the
    callbacks (e.g. a ref-backed cache) so a write does not change their
    identity.

    Found via `useAttention`, which no longer applies: dropping the Inquiries
    card removed that hook's only use of `ModelContext`. The live instances are
    `HomePage.tsx`'s own `lead` and `program` effects, which have the same
    shape.

33. **The `due_at` probe can only ask "did a second query also fail?"**
    `useAttention` disambiguates an overdue-query rejection by running
    `dueAtProbeSql`: if the probe also rejects, the tenant has no `due_at`
    column and the overdue bucket is legitimately empty rather than failed
    (`admindash/frontend/src/hooks/useAttention.ts`). It cannot inspect the
    actual error, because `postQuery` (`api/client.ts`) throws a bare
    `Error("HTTP 400")` that preserves neither status nor body. A failure
    confined specifically to the two `due_at`-referencing queries — not caused
    by a missing column — would therefore be misreported as an empty bucket
    with no banner. A total outage is unaffected: the other three queries still
    set their own flags and the retry banner fires. Fix by giving `postQuery`
    an error type that carries status and body, the way `api/workflows.ts`'s
    `WorkflowApiError` already does, so the probe can match the Binder Error
    specifically.

34. **`/attention` renders nothing for an unrecognised `?bucket=` value.**
    A URL like `/attention?bucket=foo` selects no group and highlights no chip,
    so the page is blank without explanation
    (`admindash/frontend/src/pages/AttentionPage.tsx`). Should fall back to the
    all-buckets view. Same file: clicking a row whose instance fetch finds no
    match returns silently, giving no feedback that the click did nothing.
