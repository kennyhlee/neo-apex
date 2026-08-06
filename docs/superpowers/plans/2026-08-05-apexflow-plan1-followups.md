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
