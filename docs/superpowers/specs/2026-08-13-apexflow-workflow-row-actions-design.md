# ApexFlow workflow row actions — lineage drawer

**Date:** 2026-08-13
**Surface:** `apexflow/frontend/src/pages/DefinitionsPage.tsx` (ApexFlow designer home, port 5900)
**Status:** design approved, not implemented

## Problem

The workflows list is hard to act on, for three reasons the operator named directly:

1. **Actions are hidden behind `⋯`.** `RowMenu.tsx` is the only overflow menu in the
   suite — AdminDash, LaunchPad, and Papermite have none. Its contents change per row
   (`active` → Deprecate; `deprecated` → Reactivate + Archive; `archived` → Unarchive),
   so what is available cannot be known without opening it. When a draft row's menu is
   empty the component returns `null`, leaving rows visually ragged.
2. **The primary action is wrong.** On a published row the only visible button is
   **New draft** — a heavyweight authoring action. There is no "Open", and the row is not
   clickable, so reaching the editor for a published version is not possible from the list
   at all.
3. **A workflow occupies two rows.** A lineage with a published v3 and a draft v4 renders
   as two rows carrying different action sets, so "the workflow" has no single place to
   act on.

There is also a latent correctness bug in the same code path — see
[One draft per lineage](#one-draft-per-lineage).

## Cross-module survey

The suite already has a settled pattern; ApexFlow is the outlier.

| Surface | Row interaction | Row buttons |
|---|---|---|
| AdminDash `WorkflowsPage.tsx:220` | `onRowClick` → pipeline board | none |
| AdminDash `StudentsPage.tsx:822,825` | `onRowClick` → detail drawer | one (`Edit`, compact density only) |
| AdminDash `FamiliesPage.tsx:210,211` | `onRowClick` → detail drawer | one (`Edit`, compact density only) |
| AdminDash `WorkflowItemsTable.tsx:169` | — | one (`Cancel`, ghost, conditional) |
| LaunchPad `UserManagementPage.tsx:88` | — | two raw `Edit`/`Delete` (older, unstyled) |
| ApexFlow `DefinitionsPage.tsx:480` | none | one + `⋯` menu |

Two facts drive the design:

- **The hybrid already exists.** Students and Families both open a detail drawer on row
  click *and* carry a single `Edit` button. That is exactly the shape this page needs.
- **The drawer chrome already exists in ApexFlow.** `Modal` supports `variant="drawer"`
  (`components/ui/Modal.tsx:28,141,157`) with complete CSS including a wide variant and
  mobile handling (`styles/modal.css:123-137`). It has never been used here. AdminDash
  uses that same variant in six components. This change builds drawer *content*, not
  drawer *chrome*.

## The data model this rests on

Two independent axes, frequently conflated:

- **`status`** — per **version**: `draft` | `published` | `superseded`. At most one
  `published` row per lineage. This is a convention held by the publish path, not a
  storage constraint: `publish_definition` supersedes the prior published row before
  flipping the new one (`definitions.py:135-142`), and `get_published_definition` filters
  then returns `rows[0]` (`:113-114`) — it assumes uniqueness and would silently pick an
  arbitrary row if two ever existed.
- **`lineage_status`** — per **lineage**: `active` | `deprecated` | `archived`
  (`retired` is a legacy read alias). Deprecating does not deprecate a version; it stops
  the whole workflow accepting new work. It is stored denormalized on every row, but the
  authoritative copy is the one on the **published** row — which is what
  `_require_published_row` (`definitions.py:154-170`) enforces.

**Consequence for the table:** today's two-row rendering prints `Lineage: active` on both
the v3 and v4 rows — the same lineage-level fact twice — and the draft row's copy can be
**stale**, since a new draft copies `lineage_status` verbatim at creation
(`DefinitionsPage.tsx:23-26`) and nothing updates it afterward. Collapsing to one row per
lineage is not only tidier; it stops the table displaying a value that can be wrong.

## Design

### 1. Lineage collapse

New pure module `apexflow/frontend/src/utils/lineage.ts` groups `listDefinitions` output
by `definition_id` into one `LineageRow` carrying:

- the published row, if any
- the draft row, if any
- `open_instances` as the max across versions
- `lineage_status` / `health` / `channel_access` / `family_url` read from the published
  row where one exists, else the draft

Superseded rows stay filtered out, as today.

**This deliberately does not reuse AdminDash's `visibleWorkflows`**
(`admindash/frontend/src/utils/workflowData.ts`), despite being the same grouping. That
function drops archived lineages and never-published ones because AdminDash is an
operations surface where neither has work to process. ApexFlow is the authoring surface:
archived lineages are exactly where `Unarchive` lives, and a never-published draft is
where `Delete` lives. Same shape, opposite retention rule.

### 2. The table

- Row click opens the drawer.
- Exactly one button per row: `Open` (secondary, sm) → `/definitions/{entity_id}`. Fast
  path for the most common action, matching Students/Families. **It opens the draft when
  one exists, else the published row** — on an authoring surface the draft is the thing
  being worked on. The drawer remains the way to reach the other version, and its Versions
  section makes that choice explicit rather than implied.
- `RowMenu.tsx` and `RowMenu.css` are **deleted**. `DefinitionsPage` is their only
  consumer.

Collapsing forces one column change. **Status** (`draft`/`published`) is no longer a row
property, since a lineage can be both at once; it folds into the version cell as `v3` plus
a `v4 draft` chip, and a draft-only lineage reads `— · v1 draft`. Workflow ID, Health,
Open instances, and Channel are unchanged — column count was not a reported problem.

Two things are deliberately **not** copied from AdminDash:

- The clickable count cell. ApexFlow has no work-item list to navigate to, so the number
  stays plain text.
- Hiding archived lineages. ApexFlow must show them; that is where `Unarchive` lives.

### 3. The drawer

`Modal variant="drawer"`, state-driven rather than routed, matching all six AdminDash
drawers. Title is the workflow name, subtitle the `definition_id`. Three sections:

**Versions** — drafts first, then the published row, each with `Open`. `Delete` sits on
draft lines only: it is a per-row action legal solely on `status == "draft"`
(`definitions.py:385`), not a lineage transition, so it does not belong with the lifecycle
controls. `+ New draft` sits below, subject to the rules in §4.

**Facts** — health, channel with the `↗` family link, open work items. For an archived
lineage that count relabels to "frozen work items", which is what those instances are.

**Lifecycle — a ladder, not a menu.** All three rungs always render. The current rung is
marked, the legal move is a live button, the illegal one is greyed *with its reason*
("Available once deprecated"). This is what fixes problem 1: today's menu on an active
lineage contains only "Deprecate" — Archive is not disabled, it is **absent**, so nothing
communicates that archiving exists or that deprecating is the window in which in-flight
work drains. A menu can only hide; a ladder can explain.

For a draft-only lineage the Lifecycle section is replaced by "Lifecycle begins at first
publish", since every lifecycle action requires a published row to target.

### 4. One draft per lineage

**Rule: a lineage may have at most one `draft` row.**

This fixes a live correctness bug. `handleNewDraft` computes
`nextVersion = published.version + 1` (`DefinitionsPage.tsx:285`), so clicking **New
draft** twice produces two rows both at v4. `engine.py:274-282` resolves an instance's
pinned definition by matching `(definition_id, version)` and returning `rows[0]` — once
both v4 rows are eventually published in turn, one is superseded and one is published, and
every running instance pinned to v4 resolves its machine and steps from whichever row
`list_entities` happens to return first. Silent, non-deterministic, and it affects live
work items.

The rule also closes the version collision on its own, with no separate change:
`published.version + 1` is only unsafe when a second draft can occupy the same number, and
`publish_definition` only ever supersedes the *prior published* row, so no superseded row
can sit above the published one.

**UI:** while a draft exists, `+ New draft` is not rendered. The drawer already lists that
draft with its own `Open` and `Delete`, so discarding is an explicit, deliberate step
rather than a side effect of clicking something else. No authored work can disappear
behind a button labelled "New draft".

`+ New draft` also stays hidden for archived lineages, preserving today's rule
(`DefinitionsPage.tsx:535`) — a new draft copies `lineage_status` forward, so drafting off
an archived lineage would carry `archived` onto a fresh row.

**Enforcement — backend, not just UI.** Today `handleNewDraft` calls generic `createEntity`
and bypasses ApexFlow's backend entirely; a UI-only guard would be advisory, and two tabs
open on the same list would both see "no draft" and both create one.

Add `new_draft` as a new action on the **existing** typed-action dispatcher
`POST /{tenant_id}/definitions/{entity_id}/actions` (`api/definitions.py:45-72`) rather
than a new route, matching that endpoint's established convention. A
`defs.new_draft_definition(tenant_id, entity_id, token)` service function:

- requires the target be the lineage's published row
- 409 `{"reason": "draft_exists", "entity_id": <existing draft>}` if the lineage already
  has a `draft` row
- 409 `{"reason": "lineage_archived"}` if the lineage is archived
- computes `version` server-side
- copies `name` / `machine` / `steps` / `channel_access`, and `lineage_status` from the
  published row
- returns the created row

The frontend's `newDraft(tenantId, entityId)` calls it instead of `createEntity`. This
also removes the JSON-encoded-strings-on-the-wire footgun from the frontend
(`DefinitionsPage.tsx:294-295`).

## Testing

**Backend** (`apexflow/backend/tests/test_definitions_api.py`):
- `new_draft` on a published row creates a `draft` at `version + 1` carrying the published
  row's `lineage_status`
- second `new_draft` on the same lineage → 409 `draft_exists`
- `new_draft` on an archived lineage → 409 `lineage_archived`
- `new_draft` on a draft or superseded row → 409

**Frontend, pure logic** (`apexflow/frontend/src/utils/__tests__/lineage.test.ts`):
- published + draft collapse to one row; representative fields come from the published row
- draft-only lineage collapses with no published row
- archived lineage is retained (the case where reusing `visibleWorkflows` would be wrong)
- superseded rows excluded; `open_instances` is the max across versions

Per `feedback_verify_by_mutation`: each test must be shown to fail when the behaviour it
covers is broken, not merely observed green.

## Out of scope

- **Version history.** Superseded rows stay hidden. The drawer is a natural future home
  for them; not needed now.
- **Reconciling stale `lineage_status` on draft rows.** The collapse stops the table
  *displaying* the stale copy by reading from the published row. The denormalized value
  itself is left as-is — the backend already reads the authoritative copy via
  `_require_published_row`.
- **Deduplicating `isArchived` / `canArchive`** across `apexflow/types/designer.ts` and
  `admindash/utils/workflowData.ts`. Real duplication, unrelated to this change.
- **LaunchPad's `UserManagementPage`** raw `Edit`/`Delete` buttons. They are the oldest
  pattern in the suite and inconsistent with the shared `Button`, but converting them is
  its own change.
