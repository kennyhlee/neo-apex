# ApexFlow Plan 3 (Channels) — follow-ups

Plan 3 lands on `feat/apexflow-plan3-channels` (Tasks 0–16; datacore 346→352,
apexflow backend 462→481, familyhub backend 82→74 (facade suite reshaped —
coverage-parity PASS verified by the Task 6 review's direct baseline
measurement), admindash backend 183→194, admindash frontend vitest 0→92,
plus `apexflow/frontend`/`familyhub/frontend`/`workflow-forms` builds clean).
The Task 15 browser gate passed end-to-end on BOTH channels after two fix
rounds (below): staff entry → autosave → complete → submit → auto-advance →
approve → commit → drawer verify/waive → auto-advance enrolled; family
start → StepRenderer runtime → submit → hub → deprecate → friendly closed
page → in-flight link continuity → reactivate → resubmit → approve →
commit; CAS race demonstrated live (one 200, one 409 conflict).

Companions: `2026-08-05-apexflow-plan1-followups.md`,
`2026-08-06-apexflow-plan2-followups.md`. Items transferred from those docs
that Plan 3 CLOSED: Plan 1 item 6 (lost-update CAS — closed by Tasks 1–2),
item 7 (PARENT_ACTIONS hand-sync — closed by Tasks 3/6/7, allowlist
deleted), item 21's family half (deprecated-lineage friendly page — closed
by Tasks 4/7); Plan 1 item 18 / Plan 2's blocks-compiler gap (familyhub
`blocks: []` placeholder — closed by Tasks 4–7: the facade now relays
steps+models and the compiler concept is retired with the block runtime,
Task 8); Plan 2 item 8 (validate-422 full-page hijack — closed by Task 13);
Plan 1 item 4 / Plan 2 item 17's sharp edge is mitigated in-code (every
tracking SQL builder pins `_status = 'active'`, unit-tested).

## Fixed during the Task 15 gate (two fix rounds, both re-reviewed)

0a. **`workflow_activity.at` is a DuckDB reserved keyword — the drawer's
    activity query 400'd and blanked the whole drawer.** `activitySql`
    ordered by bare `at` → DataCore `/api/query` Parser Error; the drawer's
    `Promise.all` load treated one failed section as total failure, so
    items/documents/actions rendered empty too (items were live-verified
    fine by direct query — the drawer was the only casualty). Fixed
    (`21ea07e`): `"at"` quoted in `activitySql` (vitest assertions updated;
    all other builder columns audited for reserved words — none), and the
    drawer refetch moved to `Promise.allSettled` with a `settledSection`
    helper + per-section error state, so a failing section renders its own
    error note without blanking siblings. Re-review: both ADDRESSED, no new
    breakage. Live re-verified: items/verify/waive/activity/actions all
    functional; the waive → `approved → enrolled` auto-advance ran and the
    activity feed shows the full causal chain.
0b. **familyhub's runtime form rendered unstyled** — RegisterPage mounted
    StepRenderer without importing `@neoapex/workflow-forms/src/workflow-forms.css`
    (apexflow's PreviewPane precedent). Fixed (`cdb3056`); live re-verified
    styled.

## Blocking-ish — before apexflow/familyhub/admindash go near production

1. **[Transferred, unchanged] `TRUST_ALL_IPS` must be unset in production;
   familyhub/apexflow behind Cloudflare.** Unchanged from Plans 1–2;
   `start-services.sh` still sets it for local dev.
   → **MOSTLY CLOSED by hardening wave (2026-08-08)**: production boot now
   REFUSES `TRUST_ALL_IPS=1` in both services (`6decc2d`, live failed-boot
   demonstrated); apexflow gained the fifth allowlist copy with `/health`
   exempt (`fc485e1`); absence proven across all four deployed Fly apps
   (`fly secrets list`) and all fly.toml/deploy.yml. Fly + deploy.yml
   entries for apexflow-api/familyhub-api exist (`9e98354`); the actual
   Fly app creation + Cloudflare DNS fronting remains pending (blocked on
   operator: permission classifier denied `fly apps create`; CF dashboard
   login needed). See wave rulings section below.
2. **[Transferred, unchanged] Document-authorization seam never exercised
   end-to-end.** `DATACORE_R2_*` still absent; Plan 3 built NEW upload
   surfaces that extend the deferred manual checklist:
   - [x] Staff upload via admindash proxy (`POST /api/workflows/{tenant}/documents`
         → apexflow `/api/documents/{tenant}`) — presign → PUT → then
         `complete_item` with `payload_ref`; confirm the engine's
         `payload_ref` validation (`payload_ref_invalid` on cross-instance
         ids) against real uploads, and `uploaded_by` = staff user_id.
         **DONE live 2026-08-08**: full AdminDash browser walk on
         AAC-WI260015 — StaffEntryPage upload → real R2 PUT →
         `complete_item`; item `submitted`, `payload_ref` AAC-DC260007,
         `uploaded_by` u-001 (DataCore-verified).
   - [x] Family upload via `POST /api/instance/{token}/documents` — confirm
         server-DERIVED `sensitive` (Task 4) lands on the document row
         (client-supplied value ignored), `uploaded_by` = `family:{eid}`.
         **DONE live 2026-08-08**: FamilyHub runtime browser upload on
         AAC-WI260013 — `sensitive: true` server-derived,
         `uploaded_by family:cff5de17fb4b`, `payload_ref` AAC-DC260004.
         Plus live: staff-sensitive doc hidden from family LIST + 403 on
         url; staff ad-hoc non-sensitive listed + 200; cross-instance
         document_id → 404.
   - [x] The drawer's document download link via the url proxy.
         **DONE live 2026-08-08**: drawer Download opened the presigned R2
         URL (real object served).

   → **CLOSED by hardening wave (2026-08-08)**: R2 enabled on the
   Cloudflare account (operator-approved), bucket `neoapex-documents` +
   scoped API token created, `DATACORE_R2_*` in `~/.zshrc`. The live gate
   caught one real provisioning defect: the bucket had NO CORS policy, so
   browser PUTs failed until a CORS rule (origins 5620/5600 +
   familyhub/admin.floatify.com; GET/PUT; content-type) was added — now
   part of the bucket config. Remember the 20 MB bucket-level object cap
   (deployment follow-ups) is still unset.
3. **[Transferred] Referrer-Policy/log scrubbing for token URLs** — still
   absent from familyhub/apexflow backends; unchanged risk.
   → **CLOSED by hardening wave (2026-08-08)**: `013fbbd` + `6f5ab9e` —
   `Referrer-Policy: no-referrer` on every response (twin
   `security_headers.py`, outermost middleware, live-curled on 200/404/405),
   and `uvicorn.access` token scrubbing with a token-shape heuristic
   (`request-link` stays unscrubbed). Live-proven: token routes hit on a
   real instance; both services' `.logs/*.log` show `[token]`, zero raw
   token occurrences.

## New items from this plan

4. **familyhub has no token-scoped documents-LIST facade route.** apexflow's
   `GET /internal/instance-by-token/{token}/documents` exists but familyhub
   never proxies it, so the family runtime passes `documents={[]}` and the
   "already uploaded" sublist is always empty (upload itself works; HubPage
   shows item status instead). Small facade+frontend addition; bundle with
   the R2 manual-verification pass (item 2).
   → **CLOSED (code) by hardening wave (2026-08-08)**: `0846b21` (facade
   route, relays the `{"documents": [...]}` wrapper) + `4016b7b`
   (`listDocuments` + RegisterPage wiring; `documents={[]}` gone). Live
   route returns 200 on a real token; the rendered-rows-with-a-real-upload
   check rides with item 2's R2 pass.
5. **DataCore `put_entity` has a transient no-active-row read window.** The
   archive-then-insert sequence (`store.py:344-378`) deletes the active row
   before inserting its replacement; a concurrent reader can see ZERO
   active rows for the entity (observed live twice during the gate —
   reads racing the designer's reactivate returned `{"data": [], "total": 0}`).
   Pre-existing property, now with a written repro. Consider insert-first /
   swap ordering or a small read retry in clients; matters more once
   multi-user channels are real.
   → **CLOSED by hardening wave (2026-08-08)**: DECIDED as insert-before-
   archive (embed → insert new active → archive old, CAS unmoved) —
   `0cdcd63`; the gate's live repro is now a deterministic blocking-embedder
   test, and `get_active_entity` + apexflow `datacore.get_entity` +
   admindash `_get_lead` all pick max-`_version` during the residual
   two-active window (`f614228`). Residuals recorded in task-6-report and
   the wave rulings below.
6. **`registration_application.school_year` lands null on committed
   applications.** The template's application section includes `school_year`
   as an ordinary optional form field; nobody fills it, and the engine does
   NOT stamp it from `context.school_year` (link-field injection only
   covers `{model}_id` names). Template-level nicety: either a
   `set_entity_field` on the committing transition, a context-default
   mechanism for section fields, or drop the field from the section. The
   instance's own `context.school_year` (the process record) is correct.
7. **StaffEntryPage/WorkflowInstanceDrawer have no component-level tests** —
   admindash's vitest config is node-env, `.test.ts`-only. Pure logic is
   covered (92 tests incl. the SQL builders and `settledSection`), but the
   JSX branching is verified only by the browser gate. A jsdom setup is a
   deliberate config decision for admindash's own lane.
8. **Drawer's verify_item item-status 409 shows the transition-refresh
   toast** (Task 11 review Low): `engine.verify_item`'s 409 carries an
   `allowed` key holding item STATUSES; the catch handler reads any
   `detail.allowed` as the transition-advertisement case. Refetch behavior
   is correct; only the toast copy is wrong on a rare race.
9. **Workflows list shows one row per lineage-version** (Task 10
   implementer concern): every draft/published/superseded version is its
   own row, matching the designer's backend list semantics — but AdminDash
   staff probably want lineage-grouped rows. Same grouping question as
   Plan 2 item 6; solve together.
10. **Minor copy/wiring nits from task reviews (deferred verbatim):**
    workflows pages reuse `t('students.loadError')`; `workflows.notPublished`
    copy imprecise for a published-but-broken machine row;
    `useTablePreferences(defaultSortBy: 'name')` never wired into DataTable
    sort props; `_relay`/`_relay_bytes` near-duplication in admindash
    `workflows.py`; StepRenderer's `DocumentsStep` single-flight upload
    state disables all of a step's file inputs during one upload;
    `fr-repeat-*`/`fr-step-renderer` CSS classes referenced but unstyled
    (pre-existing); explicit `payload_ref: ""` yields `payload_ref_invalid`
    not `payload_ref_missing` (unreachable via real clients); fakes.py
    "Known divergences" wrongly claims `_version` stringification on reads
    (native int in real DataCore; coerced either way); `VersionConflictError`
    not re-exported from `datacore/__init__.py`; no dedicated cross-tenant
    test for the allowed-actions route (guard shared via
    `require_staff_tenant`); no test for a retired lineage's config-bundle
    200 (path verified by inspection); usableModels/toItemView row-mapper
    duplication between admindash and familyhub (different wire shapes).
10b. **Final whole-branch review minors (accepted, not fixed this branch).**
    The review's C1/I1 were fixed pre-merge (`ad5f56c`, `e06312e` — see
    `final-review.md`'s fix-wave section in the plan workspace before it was
    cleaned; the substance: familyhub now threads `payload_ref` through
    document completion, and the staff document route derives `sensitive`
    server-side via the same hoisted helper as the token route). Its nine
    minors, verbatim triage:
    - Token document create never validates `item_id` belongs to the
      instance (`internal.py` writes it verbatim) — no privilege impact
      (payload_ref and sensitivity both resolve against the instance's own
      data), but document-by-item grouping can be polluted; add a cheap
      `ctx.items` membership guard.
      → **CLOSED by hardening wave (2026-08-08)**: `f844a8d` — non-null
      foreign `item_id` now 400s; null (ad-hoc) stays allowed.
    - Family resume converts drafts against the PUBLISHED bundle's steps
      while `save_draft` validates against the PINNED steps — a mid-flight
      republish that renames/removes a section makes an old instance's
      autosave 400 persistently. The pinned steps are already in the
      instance bundle; switch the converter to them.
      → **CLOSED by hardening wave (2026-08-08)**: `aa05409` — RegisterPage
      hydration + autosave convert against `instance.definition.steps`
      (pinned); backend regression test builds a real two-version lineage
      (republish-rename, old section ids → 200; renamed ids still 400).
    - `test_workflows_proxy.py` uses `channel: "staff_assisted"` — not a
      real vocabulary value (`Literal["staff","family"]`); harmless under
      respx but documents a wire contract real apexflow would 422.
    - Stale rename residue in docstrings (`test_instance_routes.py:5`,
      `relay.py:17-18`, `blockConfig.ts:17`) and HubPage's now-false
      "nothing writes payload_ref" comment (fixed with C1's commit where it
      was load-bearing; the rest are comment-only).
    - `_derived_sensitive` builds a full EvalContext per presign (2–3 extra
      DataCore round trips per upload) — fine at current scale.
    - StaffEntryPage's 'notFound' conflates network failures with "no
      published version" (deliberate per comment); drawer facts `<dl>` shows
      the pre-action state until the board reload lands (cosmetic);
      `FakeDataCore.SYSTEM_COLUMNS` doc nit.
11. **admindash `entities.py`/`query.py` sync-httpx-in-async debt remains
    open** (Plan 2 item 15's admindash half) — Plan 3 deliberately added
    no new instances (new proxies are plain `def` or threadpool-offloaded),
    but the pre-existing two routes are still unfixed. Standalone ticket.
    → **CLOSED by hardening wave (2026-08-08)**: `5027bab` — awaited
    `httpx.AsyncClient` in both routes, plus the two apexflow regression
    shapes (`..._unreachable_502`, `..._not_serialized_by_the_proxy`)
    ported into admindash's suite (194→198).

## Process notes

12. **The config-facts table held again** — zero port/URL/env bugs in Plan 3
    (second consecutive plan). Keep as standard practice.
13. **Two gate defects were UI-only and invisible to green unit suites**
    (a reserved SQL word only a real DuckDB parse could catch; a missing
    CSS import). The browser gate remains the only net for these — keep it
    coordinator-run and mandatory.
14. **The Task 0 interface map caught two latent end-to-end breaks before
    any code was written** (facade sending `draft_data` instead of
    `section_answers`; `payload_ref` having no write path) — both confirmed
    by the reviewer and fixed by plan amendment (Tasks 3/7). Map-first
    planning continues to pay for itself.

## Hardening wave (2026-08-08) — parked rulings

Recorded by the wave (branch `feat/hardening-wave`, plan
`2026-08-06-hardening-wave.md`); each is a deliberate non-fix with a reason,
not an oversight. Final whole-branch review examined and did not challenge
any of them.

1. **Staff `get_document_url` is tenant-scoped, not instance-scoped**
   (`apexflow/backend/app/api/documents.py:132-141`) — deliberate: any
   staff member may service any instance in their tenant. Asymmetric with
   the family rule by design.
2. **Staff `create_document` doesn't validate `instance_id`/`item_id`
   membership** (acknowledged in its docstring) — staff is trusted within
   tenant; revisit if staff roles narrow.
3. **`derived_document_sensitive` fails open to `False` on unresolvable
   items** (`shared.py`) — with the token-route item_id guard (`f844a8d`)
   the family path can no longer reach it with a foreign id; the staff
   no-item_id path remains fail-open by design (ad-hoc uploads).
4. **Archive-then-insert windows remain in `put_model`, `put_global`, and
   the unguarded search-then-delete shape in `archive_entity` /
   `restore_entity` / `rollback_by_change_id`** — same class as the
   put_entity window the wave closed, far lower concurrency exposure (rare
   admin ops). A future wave item if multi-admin editing becomes real.
   Related: `_trim_entity_versions` deletes by `_version`, not row
   identity (harmless at configured limits).
5. **Three `rows[0]` definition readers tolerate the two-active window
   arbitrarily**: `machine.py:223`, `engine.py:260`
   (`_pinned_definition_row`), `definitions.py:97`
   (`get_published_definition`) — same low-exposure class as ruling 4
   (named per final-review recommendation).
6. **apexflow/familyhub FRONTEND deploys (Workers, `_headers`, wrangler)**
   — out of wave scope; the goal named backends only.
7. **RegisterPage still RENDERS from the published bundle while
   CONVERTING against pinned steps** — render-drift on republish is a UX
   question for a future plan.
8. **`_row_version` duplicated in admindash `leads.py`** (apexflow's copy
   is forced by a circular import; admindash's is not) — cosmetic.
9. **admindash/fly.toml:11-14 comment documents unprefixed
   `ENVIRONMENT`/`CORS_ALLOWED_ORIGINS` secret names** — the DEPLOYED
   secrets are correctly `ADMINDASH_`-prefixed (verified live via
   `fly secrets list -a admindash-api`, 2026-08-08), so this is a comment
   bug only; fix the comment next time that file is touched.

## Deferred: garbage collection for closed workflow data (decided 2026-08-11)

**Decision made, implementation deliberately deferred.** Nothing accumulates
yet — there is no production workflow history to reclaim — so this is not
worth building until real tenants have a year of data behind them.

**Chosen approach: compaction, not deletion.** For a work item closed longer
than the retention window, drop its `workflow_activity` and `workflow_item`
rows and collapse the outcome onto the `workflow_instance` row (final state,
closed date, counts). The instance survives and stays queryable. Detail is
what gets reclaimed, never the record — which is what makes it safe to run
automatically.

**Retention default: 7 years.** These are student enrollment records and the
floor is statutory, not a product preference. Treat 7 years as the default and
confirm per-jurisdiction before shortening it for any tenant.

Rejected for now: an age-based sweep that hard-deletes (no scheduler exists —
Fly machines scale to zero — and timed deletion of the sole copy is the wrong
default for these records), and export-then-purge to R2 (worth revisiting only
if a tenant needs rows genuinely gone while the record survives).

### What a future implementer must know first

1. **There is no hard delete in the platform.** DataCore's `/archive` is a
   SOFT delete — it re-inserts the row with `_status='archived'` and reclaims
   nothing. `store.py::delete_version` does really remove rows but is not
   exposed over HTTP. A purge endpoint on DataCore is the gating dependency
   for any GC work, and it does not exist.
2. **Version history is already bounded** — `_trim_entity_versions` caps rows
   per entity on every write. Repeated edits are NOT the leak; the growing
   count of entities is.
3. **The volume is `workflow_activity`.** One entity row per state change,
   note, and item operation, never removed. It dwarfs instances, items, and
   definitions combined — a GC that only removed archived workflows would
   reclaim almost nothing.
4. **Documents are a separate axis with a real bill.** Deleting a `document`
   row does not delete the R2 object. Compaction must either leave documents
   alone (the safe default, and what the chosen approach implies) or delete
   the object too — otherwise orphaned files accrue storage cost with nothing
   referencing them.

## Bug: DataCore `restore_entity` creates multiple active rows (found 2026-08-12)

`POST /api/entities/{tenant}/{type}/restore` flips **every** archived row for an
entity to `_status='active'`, not just the newest. Restoring one entity with
five historical rows left five active rows.

The function's own docstring says it "Refuses to act if an active version
already exists, which would otherwise leave two active rows for the same
entity_id" — but that guard only covers the case where an active row exists
*before* the restore. The restore itself then produces exactly the state the
guard exists to prevent (`store.py::restore_entity`).

**Impact.** Single-entity reads survive: `get_active_entity` resolves by max
`_version`. Query/list paths do NOT — they filter on `_status='active'` and
return one row per duplicate, so a restored workflow appeared five times in the
ApexFlow list.

**Workaround.** Any subsequent `put_entity` on that entity collapses it:
`put_entity` archives all active rows with `_version < next_version` and inserts
one. In the UI that means one edit (autosave) is enough.

**Fix.** `restore_entity` should restore only the row with the highest
`_version` and leave the rest archived.

Related: `restore` is not reachable from any product UI, so this is currently
only hit by direct API use.
