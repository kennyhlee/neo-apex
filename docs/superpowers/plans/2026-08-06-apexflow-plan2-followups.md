# ApexFlow Plan 2 (Workflow Designer) — follow-ups

Plan 2 lands on `feat/apexflow-plan2-designer`, 26+ commits on top of Plan 1's
base (`cae062b..HEAD`), taking apexflow's backend suite from 350 to 456 (462
after the final-review fix wave below) tests and standing up
`apexflow/frontend` (templates gallery, definitions list, step editor,
machine editor, live preview, publish flow) plus `flow-runtime` (the shared
preview-renderer package). Task 11's live browser gate passed end-to-end
against a real DataCore (login → instantiate → edit → autosave → break
machine → inline validation → fix → publish → verify `status="published"`
by direct DataCore query → deprecate → 409 on familyhub → reactivate →
retire), after two fix waves closed two gate defects and one live-debugged
event-loop bug plus a corrupt-row 500. A final-review pass afterward found
two more Majors in the same two families (query.py's own copy of the
event-loop-blocking bug; the corrupt-row degrade-to-broken catch not
widening to `json.JSONDecodeError`) — both fixed pre-merge in that same
fix wave; see the note at the end of item 15 and item 16 below.

## Full suite gate (Task 12)

| Suite | Command | Result |
|---|---|---|
| datacore | `cd datacore && uv run python -m pytest tests/ -v` | 346 passed |
| apexflow backend | `cd apexflow/backend && uv run python -m pytest tests/ -v` | 456 passed |
| familyhub backend | `cd familyhub/backend && uv run python -m pytest tests/ -v` | 82 passed |
| papermite | `cd papermite && uv run python -m pytest backend/tests/ --ignore=backend/tests/test_auth.py -v` | 113 passed, 2 failed (pre-existing, see below) |
| launchpad backend | `cd launchpad/backend && uv run python -m pytest tests/ -v` | 28 passed |
| admindash backend | `cd admindash && uv run pytest backend/tests/ -v` | 183 passed |
| apexflow frontend | `npm run build` / `npm run lint` | both clean |
| familyhub frontend | `npm run build` / `npm run lint` | both clean |
| admindash frontend | `npm run build` / `npm run lint` | build clean; lint has 5 pre-existing errors, all in files this branch never touched (see below) |
| flow-runtime | `npx tsc --noEmit` | clean |
| `start-services.sh` | `bash -n start-services.sh` | syntax OK |

**Papermite's 2 failures are pre-existing, not introduced by this
branch.** `git diff` from the plan-2 base commit (`cae062b`) to the branch
tip touches zero files under `papermite/`. Confirmed directly: checked out
`cae062b` in a scratch worktree, ran
`uv run python -m pytest backend/tests/test_finalize_api.py -k
"test_renamed_custom_field_is_passed_through_to_datacore or
test_finalize_commit_sends_default_in_datacore_put"` there, and got the
identical failure (`502 Bad Gateway`, `"Failed to read the existing
model"`) before any Plan 2 work began. Root cause not chased further — out
of scope for this branch — but flagged here since Plan 1's follow-up doc
recorded papermite at "115 passed" clean; something between Plan 1 and
Plan 2's base commit broke these two. Needs its own investigation; do not
fold into apexflow/familyhub's `--ignore` list.

**AdminDash frontend lint's 5 pre-existing errors are unrelated to this
branch.** This branch's only admindash change is
`admindash/backend/tests/test_tenancy.py` (+3/-1 lines, the SQL-guard
drift corpus — see item 1 below); `admindash/frontend` has zero diff.
The lint failures (`react-hooks/set-state-in-effect` in
`DynamicForm.tsx:260`, `AuthContext.tsx:27`, and
`react-refresh/only-export-components` in `DynamicForm.tsx`,
`DashboardContext.tsx:82`, `ModelContext.tsx:53`) are upstream and
untouched by Plan 2; not gating this branch's merge, but worth a cleanup
pass in admindash's own lane.

## Deferred plan items (not built this plan, by design)

1. **New-fields-available badge — not built.**
   (`apexflow/frontend/src/pages/DefinitionsPage.tsx:11`, explicit comment:
   "v1 badge set is status/lineage_status/health ONLY — no new-fields
   hint.") The definitions list shows `status`/`lineage_status`/`health`
   badges but never flags "the bound entity model gained fields since this
   definition was last edited" — an author has no in-list signal that a
   draft/published definition could pick up new fields. The backend already
   has the primitive this would build on (`model_impact`, item 6 below);
   this is a frontend badge, not a new endpoint.
2. **Nested `show_if`/`data_condition` UI beyond one level — deliberately
   out of scope, not a gap.**
   (`apexflow/frontend/src/editor/ShowIfBuilder.tsx:1-8`, explicit
   `task-7-brief.md` DECISION documented in the module header.) The schema
   allows arbitrary `ConditionGroup` nesting
   (`apexflow/backend/app/workflows/schema.py`'s
   `ConditionItem = Union[Condition, ConditionGroup]`), and the builder
   edits the top-level group's combinator and immediate leaf `Condition`
   children with structured controls — but an immediate child that is
   itself a nested group renders read-only as JSON with an "Edit as JSON"
   escape hatch, rather than recursing the structured UI another level.
   `ShowIfBuilder` is shared by `StepEditor.tsx`, `GuardEffectComposer.tsx`,
   and `TransitionPanel.tsx`, so fixing this once fixes it everywhere it's
   mounted.
3. **Model-impact surfacing in the editor — the read endpoint exists,
   nothing calls it yet.** `model_impact()`
   (`apexflow/backend/app/workflows/definitions.py:282-289`, routed at
   `apexflow/backend/app/api/definitions.py:59-62` as
   `GET /{tenant_id}/model-impact`) walks every published definition's
   section field-picks, `show_if` sources, and `data_condition` guard
   sources for references to one entity-model field — exactly the "warn
   before destructive edits" primitive spec §3's "Model evolution" section
   calls for. Confirmed via grep: no frontend anywhere in the repo
   (`apexflow/frontend`, `admindash/frontend`, `papermite/frontend`) calls
   it — the only hit for `model-impact`/`model_impact` outside the backend
   is a doc-comment cross-reference in
   `apexflow/frontend/src/utils/numeric.ts:16`. Neither the apexflow
   designer editor nor Papermite/AdminDash's model-setup surfaces (the
   spec's originally-intended caller) consume it. Wiring is future work,
   scope TBD by whichever plan builds model-setup's edit-warning UX.

## Task 1 — SQL-guard drift test

4. **Drift-test failure doesn't name which guard file diverged.**
   (`admindash/backend/tests/test_tenancy.py:318-337`,
   `test_guard_block_is_byte_identical_in_both_services`.) The test now
   correctly compares ALL three `_GUARD_FILES` blocks pairwise (Task 1
   fixed a real bug here — the old version only compared two of three), but
   the failure path (`for b in blocks[1:]: assert b == blocks[0]`, line
   336-337) reports a bare block-mismatch assertion with no file path in
   the message. A maintainer hitting this failure has to manually diff
   `datacore/src/datacore/api/readonly_query.py`,
   `admindash/backend/app/tenancy.py`, and
   `apexflow/backend/app/tenancy.py` (the `_GUARD_FILES` tuple,
   lines 290-294) to find which one drifted. Cheap fix: loop with
   `enumerate` and an f-string naming `_GUARD_FILES[i]` and
   `_GUARD_FILES[0]` in the assertion message.

## Task 5 — definition lifecycle / lineage list

5. **Retired lineages are not backend-immutable — only the frontend hides
   the buttons.** `deprecate_definition`/`reactivate_definition`
   (`apexflow/backend/app/workflows/definitions.py:166-174`) both route
   through `_set_lineage_status` (line 158-163), which calls
   `_require_published_row` (line 137-155). That guard only checks
   `row.get("status") != "published"` — it never checks
   `lineage_status == "retired"`. Retire is documented as terminal
   ("`lineage_status -> retired`... spec §3... is terminal", line
   208-215), but nothing stops a direct API call (or a future UI bug) from
   deprecating or reactivating an already-retired lineage's published row;
   the only thing currently preventing it is
   `apexflow/frontend/src/pages/DefinitionsPage.tsx:449-478` hiding those
   buttons when `row.lineage_status === 'retired'`. Add the same terminal
   check server-side in `_set_lineage_status`.
6. **Lineage grouping in the definitions list is sort-adjacency, not a
   visual grouping.** `apexflow/frontend/src/pages/DefinitionsPage.tsx:
   156-168` sorts `visibleRows` by name/`definition_id` then status order
   (published before draft) so a lineage's rows land next to each other in
   table order, but `DataTable` renders a flat row list — there's no
   header/divider marking where one lineage ends and the next begins. Fine
   for the current typical row counts; worth a real grouped-header
   treatment once a tenant has enough lineages that adjacency alone isn't
   legible.

## Task 7 — step editor

7. **Field picker's committing-transition `set_entity_field` exemption is
   a stricter subset of the backend's.** `apexflow/frontend/src/editor/
   fieldPicker.ts:20-50` mirrors `validate.py`'s `_is_exempt_field`
   `"default" in fdef` / link-and-id exemptions, but explicitly does NOT
   mirror the committing-transition `set_entity_field` exemption also
   present there (`apexflow/backend/app/workflows/validate.py:92-139`,
   `_committing_transition_set_fields`, consumed by `_is_exempt_field` at
   line 139 and the unconditional-coverage branch at lines 718-725). A
   field that's only satisfied via a `set_entity_field` effect on the
   committing transition still shows as required-and-unpicked in the
   picker even though the backend would accept it — UX friction (an author
   sees a false "missing" warning), not a correctness bug; the backend is
   the actual gate. Full parity would need the picker to walk the whole
   machine the same way `_committing_transition_set_fields` does.
8. **Background `validateDefinition` 422 hijacks the full editor view even
   when in-memory local state is currently valid.** `runValidate`
   (`apexflow/frontend/src/editor/draftStore.ts:258-272`) is the debounced,
   typing-triggered validate call; on a 422 with a `parse_error` body
   (meaning the row's *persisted* machine/steps JSON doesn't parse — see
   `extractParseError`, lines 128-139), it calls `setParseError(parseMsg)`,
   and `EditorPage.tsx:60-65` renders that as a full-page "this draft's
   data is invalid" view, replacing the entire editor. But `parseError`
   reflects the SERVER's stored row at the moment `validateDefinition` ran
   — if the in-memory `machine`/`steps` the user is actively editing
   parses and is being typed into right now (e.g., a stale read racing a
   recent autosave), the full-page hijack is wrong: it should be a
   dismissable banner, not a page replacement, whenever local state is
   provably valid. Precise fix: only full-page-hijack when the LOCAL
   `machine`/`steps` also fail to round-trip; otherwise show an inline
   warning banner.
9. **Dangling `show_if`/`data_condition` source after a section delete is
   not flagged — pre-existing backend gap, not new this plan.**
   `_condition_source_field_errors`
   (`apexflow/backend/app/workflows/validate.py:155-182`) walks every
   `"{section_id}.{field}"` source and checks `field` still exists on that
   section's model — but line 173-175
   (`section = section_map.get(prefix); if section is None: continue`)
   silently skips any source whose `section_id` prefix ISN'T a currently
   declared section at all. That's exactly the shape a dangling reference
   takes after a section is deleted: `show_if: {source:
   "old_section.some_field"}` on some OTHER step, where `old_section` no
   longer exists in `section_map`. The check treats "unknown section
   prefix" as out-of-scope (comment: "sources whose prefix isn't a known
   section_id are out of scope here — not a section field reference'"),
   which is right for genuinely free-text/context sources but wrong for a
   source that used to be a real section. `_broken_errors` should
   distinguish "never was a section" from "was a section, now isn't."
10. **Queued-retry discard at a cross-definition nav boundary — understood
    and covered elsewhere, not a live bug.**
    (`apexflow/frontend/src/editor/draftStore.ts:379-391`.) If an autosave
    PUT is in flight when the user navigates to a different definition, and
    a retry got queued for the definition being left (`queuedForEntityRef`
    set), the retry is silently dropped on navigation (`if (queuedFor ===
    currentEntityIdRef.current)` gates re-firing it). The code comment
    (lines 382-387) argues this is safe because the flush-on-unmount effect
    (task review fix #3) already persisted anything genuinely dirty for the
    definition being left before the retry would have needed to fire.
    Recorded here as a documented, accepted trade-off — re-verify if the
    flush-on-unmount effect's own coverage ever changes.

## Task 5 / Task 10 — autosave flush edge case

11. **A third edit landing during the forced-flush PUT itself has a narrow
    residual race.** `flush()`
    (`apexflow/frontend/src/editor/draftStore.ts:588-604`) waits out any
    in-flight save, then — if `dirtyRef.current` is still true (an edit #2
    landed during that wait) — awaits a second, forced `runAutosave()` call
    directly (line 602), bypassing the normal debounce/retry-queue path.
    `editSeqRef` (documented at lines 212-247) correctly keeps `dirty` true
    if yet another edit (#3) lands while THIS forced save's own PUT is in
    flight, so no edit is silently lost — but `flush()` itself has already
    returned by then (it only awaits the one forced call), so a caller like
    the Publish button's pre-open flush can proceed against content that's
    one edit stale if the user keeps typing through the forced-flush
    round-trip. Narrow window (typing during a synchronous flush a user
    themselves triggered by clicking Publish); noted by the Task 10
    re-reviewer as out of scope for that fix round.

## Task 8 — machine editor

12. **`state_id` rename doesn't cascade to referencing
    transitions/`available_in`.** `updateState`
    (`apexflow/frontend/src/editor/MachineEditor.tsx:154-156`) does a plain
    array-splice replace of one state row — renaming a `state_id` does not
    walk `machine.transitions[].from`/`.to` or any step's `available_in` to
    update the old value. `validate.py`'s reachability/undeclared-reference
    checks (`transition.to references undeclared state`, etc.) will catch
    the resulting dangling reference at validate time, so it's not a silent
    data-loss bug — but the author gets a validation error instead of an
    automatic, expected rename cascade. A rename-aware `updateState` (or a
    dedicated rename action distinct from free-text editing) would close
    this.
13. **No duplicate-`state_id` client-side check — the backend doesn't have
    one either.** Two states with the same `state_id` are not caught by
    `MachineEditor.tsx`'s add/update path or by
    `apexflow/backend/app/workflows/validate.py`; this was documented at
    Task 8 time as a known, symmetric gap rather than a frontend-only
    omission. Worth a shared fix (backend validation rule + frontend
    pre-save check) rather than picking one side.

## Task 9 — enrollment template / step validation

14. **Empty `available_in` leaves a step permanently inert with zero
    validation feedback.** `validate.py:621-623` only flags
    `available_in` entries that reference an UNDECLARED state — an empty
    `available_in: []` is syntactically valid and passes every existing
    check, but (confirmed at Task 9: "NO backend consumer filters by
    available_in yet" is false as a general claim — the actual behavior is
    the step becomes unreachable/hidden everywhere, since nothing ever adds
    it to any state's available set) is a silent dead step. Add a
    `validate.py` warning (not necessarily an error — a step CAN be
    legitimately staged/unused temporarily) for `available_in == []` so an
    author sees "this step is never shown" instead of discovering it live.

## Gate findings (Task 11/12)

15. **Sync `httpx.request()`/`httpx.post()` called directly inside
    `async def` route handlers blocks Uvicorn's single event loop — fixed
    in apexflow's `entities.py`, and (final-review fix wave) in
    apexflow's `query.py`, the ONE other apexflow file that actually had
    this bug.** Root cause and fix are in
    `apexflow/backend/app/api/entities.py` (commit `dd1ee6d`, full
    root-cause writeup in
    `.superpowers/sdd/2026-08-06-apexflow-plan2-designer/
    gate-debug-report.md`): a bare, unpooled, blocking `httpx.request()`
    call inside `async def _proxy_to_datacore`, with no
    `run_in_threadpool` wrapper, monopolized the event loop under
    concurrent browser load and produced an intermittent instant 502 that
    a one-shot curl never reproduced. Fixed there with an awaited
    `httpx.AsyncClient`.

    **Corrected classification (final-review fix wave):** the debug
    report's original sweep named four more apexflow files as carrying
    "the identical pattern" — that overstated it. The bug is specifically
    a SYNC httpx call inside an `async def` route with no threadpool
    offload; of the four, only `apexflow/backend/app/api/query.py`'s
    `POST /api/query` route (`async def query(...)` calling sync
    `httpx.post()`) actually had that shape, and it is now fixed the same
    way as `entities.py` (awaited `httpx.AsyncClient`), with the same two
    regression-test shapes (`test_query_returns_502_when_datacore_unreachable`,
    `test_concurrent_queries_are_not_serialized_by_the_proxy`) ported into
    `apexflow/backend/tests/test_query_api.py`. The other three —
    `apexflow/backend/app/api/documents.py`,
    `apexflow/backend/app/api/internal.py`, and
    `apexflow/backend/app/workflows/datacore.py` — call sync `httpx`
    (`httpx.request`) too, but every route that reaches them is a plain
    `def`, not `async def`; FastAPI already dispatches those through
    Starlette's threadpool automatically, so they never block the event
    loop the way `entities.py`/`query.py` did. `apexflow/backend/app/api/
    auth_proxy.py` (`login`/`me`) is the same plain-`def`/threadpooled
    shape. These four are a connection-pooling/style question — no
    unpooled-connection-per-call event-loop-blocking bug, just the general
    cost of a fresh TCP connection per request and worth revisiting for
    that reason alone (`workflows/datacore.py`'s own docstring already
    flags its sync choice as deliberate, "so tests can monkeypatch
    httpx.request," mirroring admindash's `leads.py`) — not the Major this
    item originally implied.
    - **Admindash's `entities.py` has the IDENTICAL blocking pattern**
      (`admindash/backend/app/api/entities.py:11-37`,
      `_proxy_to_datacore`'s `httpx.request(...)` at line 18, same
      `async def` route wrapper with no threadpool offload) — confirmed
      byte-for-byte identical during the gate-debug investigation itself
      (the debug report explicitly notes it checked and found no
      apexflow-vs-admindash divergence in this file). Admindash's own
      routes (`create_entity`, `archive_entities`, `restore_entities`,
      `next_id`, `duplicate_check`, `update_entity`) all funnel through
      the same helper, so they carry the same event-loop-blocking risk
      under concurrent load. Needs its own ticket in admindash's lane —
      same fix shape (awaited `httpx.AsyncClient`), same regression-test
      pattern (`test_concurrent_creates_are_not_serialized_by_the_proxy`
      style) apexflow's fix already established. Out of scope for
      apexflow's final-review fix wave (different service/lane); this
      note stands unchanged.
16. **Corrupt-row list resilience is fixed; the write path that creates
    such rows is not — designer-side quarantine UX is Phase 3.**
    `list_definitions` (`apexflow/backend/app/api/designer.py`, fixed in
    commit `72f3f0f`) now degrades one malformed `workflow_definition` row
    to `health: "broken"` with a `parse_error` detail instead of 500ing the
    entire Workflows list — real, live-verified fix (a genuine corrupt row,
    `machine: "{}"`, discovered during the event-loop debugging above).
    But the generic entities proxy (`app/api/entities.py`) still enforces
    NO schema on `machine`/`steps` at write time — any direct/curl/future-
    integration write through `POST /api/entities/{tenant}/
    workflow_definition` can still create a row the designer UI has no way
    to fix (the editor can't load unparseable machine/steps into
    `MachineEditor`/`StepEditor` either — it would hit the same
    `parseError` full-page path as item 8 above). Today the only recourse
    is direct DataCore access (archive/restore) to make it disappear or
    reappear. A designer-side quarantine flow — see it in the list, see
    why it's broken, and retire/archive it from the UI without needing raw
    DataCore access — is explicitly Phase 3 scope, not this plan's.

    **Follow-up fix (final-review fix wave):** the `72f3f0f` fix above only
    caught `pydantic.ValidationError` — a row with unparseable-but-JSON
    `machine`/`steps` (e.g. `machine: "{}"`). It did NOT catch a row whose
    stored `machine`/`steps` string is not valid JSON at all (e.g.
    `machine: "not json"`), which makes `parse_machine_steps`
    (`app/workflows/definitions.py:46-47`) raise `json.JSONDecodeError` — a
    `ValueError` subclass, not a `ValidationError` — and 500 the list/bundle
    again, the exact same failure mode the original fix was built to close.
    Both call sites (`designer.py`'s `_parse_or_422` and `list_definitions`'s
    inline per-row `try`/`except`) now widen to
    `except (ValidationError, ValueError, TypeError)`, with new tests
    (`test_list_definitions_invalid_json_machine_degrades_to_broken_not_500`,
    `test_bundle_422s_not_500s_on_invalid_json_machine`,
    `test_validate_422s_not_500s_on_invalid_json_machine`) covering the
    invalid-JSON shape the same way the existing tests cover the
    invalid-schema shape.
17. **`POST /api/query`'s raw SQL runs over ALL row versions, not just the
    latest — bit the coordinator once during live verification; worth a
    latest-only query helper.** `unified_query`
    (`datacore/src/datacore/api/unified_routes.py:34-77`) executes
    caller-supplied SQL directly against `QueryEngine.query(...)` with no
    version filtering anywhere in `datacore/src/datacore/query.py` — every
    historical version of every row a tenant has ever written comes back
    unless the caller's own `WHERE` clause filters it out (typically by
    `_version`, DataCore's version-history column). This is correct and
    intentional for `/api/query`'s purpose (raw read access), but it's a
    sharp edge for anyone using it for ad hoc live verification, as the
    Task 11 coordinator gate did — a single autosave produces multiple
    versions of the same `workflow_definition` row, so a naive `SELECT *`
    during verification returns what looks like duplicate/conflicting rows
    unless you know to dedupe by `_version` first (documented after the
    fact in `progress.md`'s Task 11 note). Every OTHER read path in the
    codebase (`dc.list_entities`, the `/api/entities` GET routes, etc.)
    already returns only the live/latest version per row — only the raw
    `/api/query`/`/api/query/readonly` SQL surfaces don't. Consider adding
    a documented `SELECT * FROM data QUALIFY row_number() OVER (PARTITION
    BY entity_id ORDER BY _version DESC) = 1`-style helper (or a
    `latest_only` query param) so ad hoc verification — coordinator gates,
    support debugging, future analytics — doesn't have to rediscover this
    every time.

## Process note

18. **The interface map's config-facts table worked — zero port/URL bugs
    this plan, in contrast to Plan 1.** Plan 1's follow-up doc (item 24,
    `docs/superpowers/plans/2026-08-05-apexflow-plan1-followups.md`)
    recorded a real production-facing bug: a stale `familyhub_base_url`
    default (port 6000 instead of 5620) that survived the `# ADJUST
    (bindings)` discipline because that discipline only ever caught
    stale CODE bindings (function/field names), not stale CONFIGURATION
    literals (ports/URLs), and recommended extending the interface-map
    discipline to cite `services.json`/`CLAUDE.md`'s Service Ports table
    directly for any hard-coded port/URL default. Plan 2's Task 0 report
    (`.superpowers/sdd/2026-08-06-apexflow-plan2-designer/
    task-0-report.md:16-17,37-38`) explicitly adopted that recommendation:
    a "cross-service configuration-facts table with file:line for every
    port/URL/env-var/localStorage-key/services.json entry" (§7 of the map),
    independently re-verified by a second background pass with "findings
    matched almost exactly." Result: this gate found zero port/URL/config
    bugs anywhere in Plan 2's surface (apexflow frontend/backend,
    flow-runtime, the definitions/templates/editor routes) — the
    countermeasure held on its first real test. Worth keeping as standard
    practice in every future plan's interface map, not just a one-off
    reaction to the Plan 1 incident.

---

None of the items above blocked this gate or Task 12's merge decision —
suite results are clean (accounting for the two confirmed-pre-existing
papermite failures and admindash frontend lint's confirmed-pre-existing,
untouched-by-this-branch errors) and the Task 11 browser gate passed
end-to-end. Items 15 (admindash `entities.py` sync-httpx) and 17 (DataCore
raw-query dedupe helper) are the two with the widest blast radius outside
apexflow itself and are the best candidates for standalone follow-up
tickets.
