# ApexFlow Plan 3 (Channels) — follow-ups

Plan 3 lands on `feat/apexflow-plan3-channels` (Tasks 0–16; datacore 346→352,
apexflow backend 462→481, familyhub backend 82→74 (facade suite reshaped —
coverage-parity PASS verified by the Task 6 review's direct baseline
measurement), admindash backend 183→194, admindash frontend vitest 0→92,
plus `apexflow/frontend`/`familyhub/frontend`/`flow-runtime` builds clean).
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
    StepRenderer without importing `@neoapex/flow-runtime/src/flow-runtime.css`
    (apexflow's PreviewPane precedent). Fixed (`cdb3056`); live re-verified
    styled.

## Blocking-ish — before apexflow/familyhub/admindash go near production

1. **[Transferred, unchanged] `TRUST_ALL_IPS` must be unset in production;
   familyhub/apexflow behind Cloudflare.** Unchanged from Plans 1–2;
   `start-services.sh` still sets it for local dev.
2. **[Transferred, unchanged] Document-authorization seam never exercised
   end-to-end.** `DATACORE_R2_*` still absent; Plan 3 built NEW upload
   surfaces that extend the deferred manual checklist:
   - [ ] Staff upload via admindash proxy (`POST /api/workflows/{tenant}/documents`
         → apexflow `/api/documents/{tenant}`) — presign → PUT → then
         `complete_item` with `payload_ref`; confirm the engine's
         `payload_ref` validation (`payload_ref_invalid` on cross-instance
         ids) against real uploads, and `uploaded_by` = staff user_id.
   - [ ] Family upload via `POST /api/instance/{token}/documents` — confirm
         server-DERIVED `sensitive` (Task 4) lands on the document row
         (client-supplied value ignored), `uploaded_by` = `family:{eid}`.
   - [ ] The drawer's document download link via the url proxy.
3. **[Transferred] Referrer-Policy/log scrubbing for token URLs** — still
   absent from familyhub/apexflow backends; unchanged risk.

## New items from this plan

4. **familyhub has no token-scoped documents-LIST facade route.** apexflow's
   `GET /internal/instance-by-token/{token}/documents` exists but familyhub
   never proxies it, so the family runtime passes `documents={[]}` and the
   "already uploaded" sublist is always empty (upload itself works; HubPage
   shows item status instead). Small facade+frontend addition; bundle with
   the R2 manual-verification pass (item 2).
5. **DataCore `put_entity` has a transient no-active-row read window.** The
   archive-then-insert sequence (`store.py:344-378`) deletes the active row
   before inserting its replacement; a concurrent reader can see ZERO
   active rows for the entity (observed live twice during the gate —
   reads racing the designer's reactivate returned `{"data": [], "total": 0}`).
   Pre-existing property, now with a written repro. Consider insert-first /
   swap ordering or a small read retry in clients; matters more once
   multi-user channels are real.
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
11. **admindash `entities.py`/`query.py` sync-httpx-in-async debt remains
    open** (Plan 2 item 15's admindash half) — Plan 3 deliberately added
    no new instances (new proxies are plain `def` or threadpool-offloaded),
    but the pre-existing two routes are still unfixed. Standalone ticket.

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
