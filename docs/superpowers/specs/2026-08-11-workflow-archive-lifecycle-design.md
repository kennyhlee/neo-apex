# Workflow Archive Lifecycle — Design

Date: 2026-08-11
Status: Implemented, with the amendment below
Scope: apexflow backend (service + API), admindash (backend proxy + frontend), apexflow frontend (button rewiring)

## Amendment — 2026-08-11, after the first implementation landed

The requirements changed once the first version was working. Where this
amendment and the body below disagree, **the amendment wins**; the body is kept
because its reasoning about identity, wire shapes, and the binder-error
constraint is all still load-bearing.

1. **Archive is reachable only from `deprecated`.** The lifecycle is a ladder:
   `active --deprecate-> deprecated --archive-> archived`. Deprecating is the
   window in which mid-flight work is allowed to drain, so it is a required
   step rather than an alternative. Archiving from `active` is 409
   `{"reason": "not_deprecated"}`.

2. **The open-work-item gate (R2) is gone**, replaced by that ordering.
   Archiving no longer refuses when work is in flight — it **freezes** it.

3. **Freeze replaces the R2 gate as the normal path.** A frozen work item is
   suspended: `frozen_at` is stamped and `state` is left ALONE, so thawing has
   nothing to restore and cannot drift. It is not closed (`closed_at` stays
   empty), because the work genuinely is unfinished. Every action returns 409
   `{"reason": "frozen"}` while suspended. Magic links are deliberately NOT
   revoked — a reversible pause should not cost a link re-issue.

4. **`unarchive` thaws every frozen item and returns the lineage to
   `deprecated`**, not `active`. That is provably where the archive was entered
   from; landing on `active` would silently reopen intake nobody asked to
   reopen. `reactivate` remains the separate, deliberate step for that.

5. **Force archive is REMOVED, and with it R5.** There is no destructive
   archive variant at all: archive always freezes, unarchive always thaws, and
   the `abandoned` state, `archived_from_state`, `restore_instance`, and the
   restore UI are all deleted. Keeping the state set small and every path
   either reversible or explicitly final was worth more than the escape hatch.
   `cancel_instance` remains the one way to end a single work item outside its
   machine's terminal states — visible, per-item, and not restorable.

6. **New: a `draft` definition can be deleted.** `delete_definition` 409s
   `{"reason": "not_draft"}` on a `published` or `superseded` row — the latter
   is the pinned definition for every instance still running on that version,
   so deleting it would strand them. Implemented via DataCore's row-level
   `/archive` soft delete, which is **unrelated** to this document's lineage
   `archived` status despite the shared word.

The consequence for the error table near the end: "archive with open items, no
force → 409 `{open_instances: N}`" no longer happens, and every row mentioning
abandon or restore is void. Add "archive from a
non-deprecated lineage → 409 `{reason: not_deprecated}`", "any action on a
frozen work item → 409 `{reason: frozen}`", and "delete a non-draft row → 409
`{reason: not_draft}`".

## Problem

A tenant administrator has no way to take a workflow out of circulation and
later bring it back. ApexFlow's lineage lifecycle today is
`active → deprecated → retired`, where `retired` is **terminal by design** —
`retire_definition` has no inverse. Administrators accumulate workflows they
no longer run (last year's registration, a cancelled program's signup) with
no way to clear them from the working set without losing them permanently.

Separately, there is no surface for managing the *work items* of a workflow in
bulk. AdminDash's pipeline board shows open instances arranged by state, but
offers no way to see closed/cancelled ones, filter across the whole set, or
act on more than one at a time.

## Vocabulary

The user-facing terms map onto ApexFlow concepts as follows. This mapping is
binding on the whole document.

| User term | ApexFlow concept | Identity |
|---|---|---|
| workflow | definition **lineage** — every version sharing one `definition_id` | `workflow_definition.definition_id` |
| work item | one **instance** — a single family's/student's run | `workflow_instance.entity_id` |
| end state | a machine state with `kind: "terminal"`, plus the synthetic `cancelled`/`abandoned` states | `closed_at` is set |

A `workflow_item` row (one form or document step *inside* an instance) is
**not** what "work item" means here. Those have statuses, not machine end
states, and this design does not change them.

## Requirements

R1. An administrator can **archive** a workflow. An archived workflow is not
available for use: no new work items may be started from it, and it is out of
the default working set in every listing surface.

R2. Archive is **gated**: a workflow may be archived only if every one of its
work items is in an end state. Otherwise the attempt fails and reports how
many are still open.

R3. **Force archive** overrides the gate. Every open work item is *abandoned*:
it can make no further progress, and its prior state is recorded.

R4. An administrator can **unarchive** a workflow, returning it to use.

R5. Unarchiving **does not** revive abandoned work items. They stay abandoned
until an administrator restores each one individually, which returns it to the
exact state it held before archiving.

R6. There is a surface for **managing all work items** of a workflow —
viewing the full set (not only the open ones), filtering it, and acting on
items individually and in bulk.

### Interpretation note (R2)

The requirement as originally stated read "any workflow with unfinished
workitem can not be archived if and only if all the workitem are in it's end
state," which inverts itself: read literally, the block applies precisely when
nothing is unfinished. R2 above implements the evident intent — **archivable
iff every work item is in an end state** — and the gate test asserts that
direction explicitly.

## Decisions

These three were assumptions made in the absence of a decision, and are the
places to push back first.

### D1 — `archived` is a new `lineage_status` value; `retired` becomes a read alias

`lineage_status` gains a fourth value, `archived`. `retire_definition` is
replaced by `archive_definition`; `retired` is still **accepted on read** and
treated as archived everywhere, so existing rows need no migration and no
consumer breaks.

Rejected alternatives:

- *Make `retired` reversible and just relabel it in the UI.* Smallest diff, but
  leaves a wire value named "retired" that can be un-retired — the vocabulary
  actively misleads the next reader.
- *Replace `retired` outright.* Cleanest vocabulary, but forces a data
  migration and breaks any consumer that string-matches `'retired'`
  (`apexflow/frontend/src/pages/DefinitionsPage.tsx` does, in three places).

`deprecated` is **unchanged and still distinct**: it stops new work items while
letting in-flight ones run to completion. Archive is the harder action —
out of circulation entirely, with the open-item gate.

### D2 — Service in ApexFlow, management UI in AdminDash, ApexFlow buttons rewired

The school administrator's home is AdminDash, so the work-item management
surface and the archive/unarchive controls land there. ApexFlow's
`DefinitionsPage` already renders deprecate/reactivate/retire controls; leaving
those pointed at a removed action would produce two surfaces that disagree, so
they are rewired to `archive`/`unarchive` in the same change. ApexFlow does
not get the bulk work-item surface — that is school-ops work, not authoring.

### D3 — `abandoned` is its own terminal state, not a reuse of `cancelled`

Force-archive lands open instances in a new synthetic terminal state,
`abandoned`, alongside the existing synthetic `cancelled`.

Keeping them distinct is load-bearing rather than cosmetic: R5 requires
abandoned items to be restorable to their prior state, and a deliberate staff
cancellation must **not** be. Folding both into `cancelled` would make
"restore" either wrongly available on genuine cancellations or unable to tell
the two apart at all. It also keeps archive fallout separable from real
cancellations in any later reporting.

## Architecture

### Instance row fields (new)

Both are written only by abandon, cleared only by restore. `workflow_instance`
rows are schemaless at the storage layer, so no model definition changes.

| Field | Meaning |
|---|---|
| `archived_from_state` | the `state` the instance held immediately before being abandoned |
| `archived_at` | ISO timestamp of the abandon |

**Constraint:** a DataCore SQL `where` predicate naming a column that does not
yet exist in a tenant's table is a DuckDB binder error (400), not an empty
result — the same failure mode as the recent `due_at` fix. Every read that
filters on these fields therefore filters **in Python/TypeScript over a fetched
set**, never in SQL. This matches the existing `rows_matching` pattern in
`definitions.py` and `workflowData.ts`.

### Backend — `apexflow/backend/app/workflows/`

`machine.py` gains `abandon_instance(ctx)` and `restore_instance(ctx)`, and
`_is_terminal_state` learns `abandoned`:

- **`abandon_instance(ctx)`** — **internal**: reachable only as force-archive
  fallout, never exposed as a staff action. Abandoning a single work item by
  hand is what the existing `cancel_instance` is for; offering both to an
  administrator would present two controls that look the same and differ only
  in whether the result can later be restored. From any non-terminal state:
  writes `state="abandoned"`, `archived_from_state=<prior state>`,
  `archived_at=now`, `closed_at=now`, and increments `token_version` (revoking
  any outstanding magic link). Logs a `state_change` activity. 409 if the
  instance is already terminal.
- **`restore_instance(ctx)`** — staff only. Requires `state == "abandoned"`
  (409 otherwise — this is what makes a `cancelled` or naturally-terminal
  instance non-restorable). Writes `state = archived_from_state`, clears
  `archived_from_state`/`archived_at`/`closed_at`, increments `token_version`.
  Logs a `state_change` activity. Two further 409s:
  - the lineage is still archived — you cannot restore work into a workflow
    that is out of circulation;
  - `archived_from_state` is not a declared state in the pinned machine, so
    there is nothing coherent to restore *into*.

  A pinned definition version that no longer resolves as published/superseded
  never reaches this function: `build_eval_context` raises 404 first. That is
  existing behaviour and is left alone rather than duplicated here.

Because `_is_terminal_state` returns true for `abandoned`, every existing
progress path — item built-ins, explicit transitions, system auto-advance —
already refuses to act on an abandoned instance with no further changes. That
is what satisfies "no more progress can be made" (R3), and it is the reason
`abandoned` is modelled as a state rather than a flag.

`definitions.py`:

- `archive_definition(tenant_id, entity_id, force=False, ...)` replaces
  `retire_definition`. Same open-instance gate (`list_open_instances`), same
  409 `{"open_instances": N}` shape. With `force=True`, each open instance is
  abandoned via an injected `abandon_instance_fn` — the same
  dependency-injection shape `retire_definition` already uses for
  `cancel_instance_fn`, and for the same reason (a
  `definitions.py → machine.py` import would close a cycle).
- `unarchive_definition(tenant_id, entity_id, ...)` sets `lineage_status`
  back to `active`. It deliberately touches **no instances** — that is R5.
- `is_archived(row)` — the single place that treats `archived` and legacy
  `retired` as equivalent. Every consumer goes through it rather than
  string-matching, so the alias has exactly one definition.

`publish_definition` already carries `lineage_status` forward across a publish,
so publishing a new version of an archived lineage keeps it archived. That
existing behaviour is correct here and is covered by a test rather than changed.

### API

`POST /api/workflows/{tenant_id}/definitions/{entity_id}/actions` gains two
actions on the existing typed-action envelope:

- `{"action": "archive", "force": false}` → 200 row, or 409 `{"open_instances": N}`
- `{"action": "unarchive"}` → 200 row

`retire` is retained for one release as an alias of `archive`, so an
unmigrated caller does not break mid-deploy.

`POST /api/workflows/{tenant_id}/instances/{instance_entity_id}/actions` gains
`restore_instance` only, dispatched through `execute_action` alongside the
existing `cancel_instance`. `abandon_instance` is deliberately **not** routed
(see above) — it is called by `archive_definition`'s force path via the
injected collaborator, and a request naming it falls through to the transition
dispatcher and 409s like any other unknown action.

New read, backing the management surface:

`GET /api/workflows/{tenant_id}/definitions/{definition_id}/instances`
→ `{"instances": [...]}` — **all** instances of the lineage, open and closed,
including abandoned. Returns the fields the table renders plus
`archived_from_state`, so the UI can show "will return to *submitted*" on the
restore control without a second fetch.

### AdminDash

Backend: `app/api/workflows.py` proxies the new instance-list route and relays
the two new instance actions — no new pattern, these are the same verbatim
status/body relays as the existing routes.

Frontend:

- **`WorkflowsPage`** — archived lineages are hidden by default behind a
  "Show archived" toggle. Row actions gain Archive / Unarchive. Archive opens
  a confirm that names the open-item count and offers force-archive as an
  explicit second choice, never as a default. "Start staff entry" is hidden
  for archived lineages.
- **Work items view** (R6) — a table alongside the existing pipeline board on
  `WorkflowPipelinePage`, showing every instance of the lineage: state,
  opened, closed, applicant email, channel, definition version. Filters
  (state, open/closed, abandoned-only) apply client-side over the fetched set,
  per the binder-error constraint above. Row actions: open drawer, cancel,
  restore (abandoned only). Bulk select drives bulk cancel / bulk restore,
  reporting per-row failures rather than failing the batch as a unit — one
  instance whose pinned version no longer resolves must not block the other
  forty.

The board stays as-is; it answers "what needs attention", the new table
answers "manage everything". Both read the same lineage.

### ApexFlow frontend

`DefinitionsPage`'s retire control becomes Archive/Unarchive against the same
actions. Its `lineage_status !== 'retired'` string checks route through a
shared `isArchived()` helper mirroring the backend's, so the legacy alias has
one definition per side rather than three inline comparisons.

### FamilyHub

No change required. `RegisterPage` already renders the closed state for any
`lineage_status !== 'active'`, which covers `archived` for free. This is
asserted by a test rather than assumed.

## Error handling

Every failure is a 409 with a machine-readable body, matching the existing
`{"open_instances": N}` / `{"allowed": [...]}` convention:

| Attempt | Result |
|---|---|
| archive with open items, no force | 409 `{"open_instances": N}` |
| archive a draft/superseded row | 409 — lifecycle acts on the published row only (existing `_require_published_row`) |
| any action on an abandoned instance | 409 — `_is_terminal_state` |
| restore a `cancelled` or naturally-terminal instance | 409 `{"reason": "not_abandoned", "state": ...}` |
| restore into a still-archived lineage | 409 `{"reason": "lineage_archived"}` |
| restore where the prior state is no longer declared in the pinned machine | 409 `{"reason": "state_unavailable"}` |
| restore where the pinned version no longer resolves | 404 — existing `build_eval_context` behaviour, not re-implemented |
| start a work item on an archived workflow | 409 `{"reason": "lineage_not_active"}` — already implemented |

## Testing

Backend (`apexflow/backend/tests/`), pytest:

- archive is refused while any instance is open, and the 409 body carries the count
- archive succeeds once every instance is closed — the *iff* direction of R2, asserted explicitly
- force-archive abandons every open instance, and records each one's prior state
- force-archive leaves already-closed instances untouched (a `cancelled` instance does not become `abandoned`)
- an abandoned instance refuses item built-ins, explicit transitions, and system auto-advance
- unarchive restores the lineage to `active` and revives **nothing**
- restore returns an instance to exactly `archived_from_state` and reopens it
- restore is refused on a cancelled instance, on a naturally-terminal instance, and while the lineage is still archived
- a legacy `retired` row reads as archived through `is_archived`
- publishing a new version of an archived lineage keeps it archived
- familyhub's bundle relays `archived` and the closed state renders

Frontend: `workflowData` filter/grouping helpers are unit-tested (existing
vitest setup under `admindash/frontend/src/utils/__tests__/`). Bulk-action
partial-failure reporting is tested at the helper level.

Per the project's standing verification rule, each test is confirmed by
mutation — break the implementation, watch the test fail — rather than trusted
because the suite is green.

## Out of scope

- Archiving at the *version* level. Archive acts on a lineage; individual
  draft/superseded rows keep the existing `status` field.
- Bulk archive across multiple workflows at once.
- Auto-restore policies (restore-all-on-unarchive). R5 is explicit that
  restore is per-item and administrator-driven; a bulk-restore *control* over
  a filtered selection is in scope, an automatic policy is not.
- Retention or purge of abandoned instances.
