# AdminDash home page: "Needs you today" and the Lead pipeline — design

**Status:** approved 2026-08-11, pending implementation plan
**Scope:** `admindash` frontend (home page, one new route, one pure module), plus
one additive field in `apexflow`'s activity log. No new backend endpoint in
AdminDash. Consumes `2026-08-09-workflow-item-status-typing-design.md`, which
carried `due_at`, `item_id` and `instance_id` on the wire specifically for this
spec.

## Problem

The AdminDash home page is the only major surface with no spec of its own; two
prior specs defer to "a separate spec" that did not exist. Both of its top
sections read the legacy `lead` entity and know nothing about ApexFlow, which
now runs real enrollment:

- `HomePage.tsx:99` — *"Leads drive both the pipeline spine and the work queue."*
- The section is titled **"Enrollment pipeline"** but counts leads by `stage`.
  Enrollment moved to `workflow_instance` rows; the title now overclaims.
- The work queue's four buckets (untouched / stale / unreachable /
  ready-to-convert) are all derived from lead state and lead age.

Meanwhile the data that actually says "a human is waiting on staff" exists and is
unused. `workflow_item.status = 'submitted'` means a family has sent something in
and staff must verify or reject it. `due_at` is a real deadline. Neither reaches
the home page.

### A defect found while measuring, which constrains the design

**`_created_at` on an active row means *last modified*, not *created*.**
`store.py:378-388`'s `put_entity` builds a fresh record on every write with
`_created_at = now`. Verified against live `acme` data: `workflow_item` rows at
`_version: 3` still have `_created_at == _updated_at`.

Two consequences:

1. The current queue's "stale > 7 days" bucket (`HomePage.tsx:178`) resets
   whenever anyone edits the lead, and "oldest waiting N days" measures the wrong
   thing. Every age on the page today is unreliable.
2. Any new age must come from an append-only source.

`workflow_activity` rows qualify — they are written once (`_version: 1`) and carry
a durable business `at`. Instances carry `opened_at`, a base-data field written at
creation and preserved across writes. A `lead` row carries **no durable timestamp
at all**, and `lead_activity` records only stage transitions with no `at` either.

## Decisions

| Decision | Ruling |
|---|---|
| Pipeline section | Stays lead-driven; renamed **"Lead pipeline"**. Same data, honest name. |
| Work queue source | **Workflows**, across every published definition, **plus** one lead bucket. |
| Queue presentation | **Fixed count cards** (max four), not a row list. Height must not grow with volume. |
| Detail list | A **new `/attention` route**. No cross-definition instance view exists today. |
| Nav | **No nav entry.** Reachable from the Home cards. Nav stays at six items. |
| Data layer | **The generic `POST /api/query`.** No new backend endpoint in AdminDash. |
| Ages | Append-only sources only (`workflow_activity.at`, `opened_at`). Never `_created_at`. |
| Lead staleness | **Dropped, not carried forward wrong.** Cannot be computed honestly. |

### Why a new route rather than a drawer or an existing page

The three workflow cards aggregate across every published definition.
`/workflows` lists definitions; `/workflows/:definitionId` is one definition's
board (`WorkflowPipelinePage.tsx:40`). Nothing in AdminDash can show instances
across definitions, so "show me those 11" has nowhere to land — which is what
rules out reusing existing pages. A drawer was considered and rejected: it is not
bookmarkable, and a registrar working a backlog loses their place on every
navigation.

## Design

### 1. Home page changes

Only the two top sections change. "This week", the weekly schedule and the public
inquiry link are untouched.

**"Needs you today"** renders up to four count cards in the existing
`queue-card` visual language — count, label, one-line detail, one button. A card
renders only when its count exceeds zero, which is today's rule
(`HomePage.tsx:252`), so four is the ceiling rather than the norm and the section
height is bounded by construction. Zero total renders the existing "All clear"
panel. A section-level "See all N ›" links to `/attention`.

**"Enrollment pipeline"** becomes **"Lead pipeline"**. The spine, the stage
derivation via `leadStages`, and the `/leads` link are unchanged. This is a
string change plus its `zh-CN` counterpart.

On narrow viewports the cards reflow to a 2×2 grid and stay within one fold.

### 2. The four buckets

| Card | Rule | Detail line | Destination |
|---|---|---|---|
| **Overdue** | Item active, `due_at` set and in the past, status ∉ `ITEM_DONE_STATUSES`, instance not terminal | days late on the worst | `/attention?bucket=overdue` |
| **Awaiting your review** | Item status = `submitted`, instance not terminal | age of the oldest | `/attention?bucket=review` |
| **Nothing is moving** | Instance not terminal, newest `workflow_activity.at` older than 7 days | how long the quietest has been silent | `/attention?bucket=stalled` |
| **Inquiries to follow up** | Lead open (no `converted_family_id`) and either at the first stage or having neither email nor phone | count never contacted | `/leads` |

Four rulings embedded above:

- **Only the Awaiting-review age depends on the apexflow change below.** "Days
  late" is `now − due_at`, and `due_at` is a durable base-data field on the item
  itself. "How long the quietest has been silent" is an instance-level
  `MAX(at)`, which needs no per-item attribution. Only "age of the oldest
  submitted item" requires knowing *which* item a status change belonged to.
  The two other buckets are exact today.

- **`submitted` counts as done for the Overdue rule.** `ITEM_DONE_STATUSES` is
  `{submitted, verified, waived}` (`shared.py`). The family met the deadline and
  the item is already counted under Awaiting review; counting it as overdue too
  would report one item as both a family failure and a staff backlog.
- **"Nothing is moving" is one instance-level rule, not two.** An item staff
  rejected that the family then ignored produces no activity, so it falls out of
  the silence rule for free without a separate `rejected`-and-aged clause.
- **Retired lineages are included.** `lineage_status = 'retired'` stops new
  instances; the ones already in flight are still real work.

"First stage" for the Inquiries bucket means the first entry of `leadStages`,
the same derivation the current queue uses (`HomePage.tsx:176`); its detail line
counts leads sitting there. Every instance receives a `state_change` activity at
creation (`engine.py:255`), so the silence rule always has at least one row to
measure from and never mistakes a new instance for a silent one.

The 7-day silence threshold is a named constant beside the existing
`STALE_DAYS`, not a literal.

### 3. `/attention`

A route and a component. No server involvement — the path is client-side only.

One list grouped by bucket, with filter chips at the top; `?bucket=` selects a
group so a Home card deep-links to its own section. A row shows the applicant,
the workflow name, what is needed, and the age. Clicking a row opens the existing
`WorkflowInstanceDrawer`, which already renders items and performs verify /
reject / waive, so staff act without leaving the list.

On narrow viewports the workflow chip and the row button drop; applicant name,
what is needed, and age survive, and the row itself becomes the tap target.

### 4. Data layer

A pure module, `admindash/frontend/src/utils/attentionData.ts`, beside
`workflowData.ts` and following its established shape: SQL builders plus pure
grouping functions, no React and no network, exercised directly by vitest under
the node environment.

**Home and `/attention` run the same fetch and the same grouping.** Home renders
each group's length; `/attention` renders its rows. A count is never computed
separately from the list it summarizes, so the two surfaces cannot disagree.

Four queries, independent of how many workflows exist:

1. Every active `workflow_definition` with `status = 'published'` — supplies
   display names for rows, and `machine` for terminal state ids.
2. Items at `submitted`, joined to their instance.
3. Items past `due_at`, joined to their instance.
4. Instances with their newest `workflow_activity.at`.

Plus the existing `listLeads` call already on the page.

Every entity type lives in one flattened `data` table per tenant, so
item → instance → activity is a self-join. `POST /api/query` is raw DuckDB with
`external=True`; joins are permitted and no row cap is applied
(`query.py:44`, `limit=None`). Verified live against `acme`.

**Terminal filtering happens in TypeScript, not SQL.** Terminality is a property
of each definition's machine JSON (`StateDef.kind`), so `(definition_id, state)`
pairs are matched client-side after the fetch, reusing the existing
`parseMachineStates` — which already returns `kind`. Doing it in SQL would need a
compound `NOT IN` over pairs; volumes are small (17 instances in the largest local
tenant).

SQL literals are escaped with the same doubled-quote rule `workflowData.ts` uses.

### 5. The apexflow change

`workflow_activity` rows of type `item_change` record `instance_id` but not which
item changed (`engine.py:407`). With two items in flight on one instance, both
report the same timestamp — demonstrated live on `acme`, where *"Application
Details"* and *"Immunization Record"* both returned
`2026-08-09T01:03:10.695987+00:00`. Per-item age is therefore not derivable
today.

`_log_activity` (`engine.py:119`) gains an `item_id` parameter defaulting to
`""`, written into the row. `_update_item` (`engine.py:400`) passes the item's
DataCore `entity_id` — it already holds the row. `state_change` and `email_sent`
activities leave it empty.

Storing the `entity_id` under the key `item_id` is symmetric with the row's
existing `instance_id`, which likewise holds an `entity_id`; the convention is
documented at `workflowData.ts:148`.

**Accepted consequence:** activity rows written before this ships carry no
`item_id`, so items last touched before then have no derivable age. Those rows
still appear in their bucket with the age **omitted rather than guessed**.

This is the only backend edit in the design, and it is needed by exactly one
number — the Awaiting-review age. The Overdue and Nothing-is-moving buckets are
exact without it, so if this change has to be deferred, the rest of the feature
still ships with two of its three workflow ages intact.

## Error handling

The four fetches run under `Promise.allSettled` and are mapped through
`settledSection` (`workflowData.ts:257`), the helper added after a live-gate
finding where one rejecting query threw before any `setState` ran and blanked
three healthy sections. A failed fetch hides its own card and offers a retry; it
never blanks the section. A definition whose `machine` fails to parse degrades to
"no terminal states" for that definition — `parseMachineStates` already returns
`[]` rather than throwing — so its instances are over-included rather than lost.

## Testing

vitest, against the pure module:

- Bucket classification, including the `submitted`-is-not-overdue boundary.
- Terminal-state exclusion, including a state id shared by two definitions with
  different `kind`.
- Missing-`item_id` degradation: age omitted, row still present.
- SQL builder shape, including literal escaping.
- Counts equal the length of the list `/attention` renders for the same fetch.

pytest, in apexflow: `item_change` writes the item's `entity_id`; `state_change`
does not.

Baselines to hold: apexflow 553, admindash 201, admindash vitest 94, familyhub
89, datacore 354, flow-runtime 59.

New user-facing strings go in `translations.ts` for **both** `en-US` and `zh-CN`;
a missing key renders the raw key with no warning.

## Risks

| Risk | Mitigation |
|---|---|
| Counts and list disagree | Structurally impossible — one fetch, one grouping, Home renders lengths. Pinned by a test. |
| Client-side terminal filtering misses a case | Reuses `parseMachineStates`, already covered; the shared-state-id collision case is pinned by a test. |
| Unbounded row fetch on a large tenant | Accepted for now — no cap exists on `/api/query` and local volumes are tens of rows. Logged as a follow-up, not solved here. |
| Ages read as authoritative when they are absent | Absent age renders as nothing, never as zero or as "today". |
| Adding `item_id` breaks the drawer's activity feed | Additive field; existing rows read `undefined`. |

## Out of scope

- Merging leads and workflow instances into one funnel. The two remain separate
  systems; this spec surfaces both without unifying them.
- Any nav change, and a badge count (which would mean running the count query on
  every page rather than on Home).
- Fixing `_created_at`'s reset-on-write behaviour in DataCore.

## Follow-ups to log

1. **`lead` has no durable creation timestamp.** Lead staleness cannot be
   computed honestly, which is why the Inquiries bucket is state-based and the
   existing "stale > 7 days" bucket is dropped. Fixing it means adding a
   `created_at` base-data field at lead creation.
2. **`_created_at` resets on every write** (`store.py:378-388`). A platform-wide
   trap, not specific to this page — any consumer treating it as a creation time
   is wrong.
3. **`/api/query` applies no row cap.** Fine at current volumes; a real limit
   belongs there before a large tenant arrives.
