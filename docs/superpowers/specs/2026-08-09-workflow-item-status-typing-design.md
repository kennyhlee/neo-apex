# Workflow item status: end-to-end typed vocabulary — design

**Status:** approved 2026-08-09, pending implementation plan
**Scope:** `apexflow` backend (engine + schema + validator), plus a generated
contract file consumed by TypeScript. Does **not** include the AdminDash home
page, which is a separate spec that consumes this one.

## Problem

`workflow_item.status` is a closed vocabulary in practice but nothing in the
system says so. It is spelled as bare string literals at every site, which has
already produced three distinct defects:

1. **A phantom status.** `engine.py:64` declares
   `COMPLETABLE_STATUSES = frozenset({"not_started", "in_progress", "submitted", "rejected"})`,
   but **no code path ever writes `in_progress`** — not `engine.py`, not
   `primitives.py`, not `machine.py` — and no test references it. It is also
   documented as legal in two engine docstrings and in
   `flow-runtime/src/types.ts:118`'s comment. Logged as Plan 1 follow-up #23:
   "a dead-but-declared status is a minor trap for a future guard author who
   assumes it's reachable."

2. **Authored references are unvalidated.** The `items_in_status` guard takes a
   status as a parameter from the definition JSON
   (`enrollment.py` uses `["submitted","verified"]`, `"rejected"`,
   `["verified","waived"]`). `validate.py::_guard_params_items_in_status` only
   checks the parameter is a string or list of strings. A definition containing
   `status: "verifyed"` therefore **publishes cleanly and produces a guard that
   silently never fires** — a workflow that quietly never advances, with no
   error anywhere.

3. **No shared source for consumers.** AdminDash and FamilyHub need the
   vocabulary and can only hardcode it, which is the duplication this work
   exists to remove.

A fourth issue surfaced while measuring the wire contract: item rows are
returned to clients as **~200-key sparse rows** — the union of every column in
the tenant's flattened table, including unrelated entities' fields
(`tuition_fall_semester_K`, `chinese_track`, `accreditation`). The
family-facing client receives all of it.

## Decisions

| Decision | Ruling |
|---|---|
| `in_progress` | **Dropped.** Nothing writes it, nothing tests it; `not_started → submitted` already covers the lifecycle. Keeping it would make the enum document a lie. Closes Plan 1 follow-up #23. |
| Enum type | **`StrEnum`** (Python ≥3.11; Dockerfile is 3.11-slim, local 3.12). Members compare and hash equal to their plain strings, so existing comparisons and raw DataCore strings keep working untouched. |
| Model mutability | **Mutable, not frozen.** `primitives.py:607-609` deliberately mutates items in place so later guards/effects in the SAME action observe `due_at`/`_version` without a re-fetch. That invariant is preserved and pinned by a test. |
| Reads | **Typed** via a parse boundary in `build_eval_context`. |
| Wire payload | **Narrowed** to real item fields. |
| Frontend sharing | **Generated JSON + drift test**, not a runtime API call. |

## The vocabulary

Exactly five statuses, all of which the engine actually writes:

| Status | Written by |
|---|---|
| `not_started` | item creation, `engine.py:171` |
| `submitted` | `complete_item` when review is staff-gated, `engine.py:540` |
| `verified` | `complete_item` when review is `auto` (`:540`), and `verify_item` (`:562`) |
| `rejected` | `reject_item`, `engine.py:572` |
| `waived` | `waive_item`, `engine.py:586` |

Derived sets, defined once in terms of the enum rather than re-spelled:

- `ITEM_DONE_STATUSES = {SUBMITTED, VERIFIED, WAIVED}` (today `shared.py:41`)
- `COMPLETABLE_STATUSES = {NOT_STARTED, SUBMITTED, REJECTED}` (today `engine.py:64`, minus the dropped `in_progress`)

## Design

### 1. `ItemStatus` — one vocabulary

A `StrEnum` in `app/workflows/shared.py`, beside the existing
`ITEM_DONE_STATUSES`. `shared.py` is chosen because `primitives.py` and
`engine.py` already import it, so no new import edges or cycles.

Both derived frozensets are computed from enum members.

### 2. Typed writes

The five `engine.py` write sites use `ItemStatus.X` instead of bare literals. A
typo becomes an `AttributeError` at import rather than a silently wrong row.

### 3. `WorkflowItem` — typed reads and an explicit wire boundary

A pydantic model parsed once in `machine.build_eval_context`, replacing
`EvalContext.items: list[dict]`.

Field set, derived from what consumers actually read (see Consumer contract):

```
entity_id, item_id, instance_id, step_id, kind, title,
status: ItemStatus, blocking: bool, payload_ref, due_at,
completed_by, _version
```

`kind` stays a plain `str` in this change — it is a second closed vocabulary
(`form | documents | message-ack`) and typing it is deliberately deferred so
this change stays about status.

**`_version` needs an alias.** Pydantic v2 treats leading-underscore names as
private attributes, so `_version` cannot be a plain field. It must be declared
as `version: int | None = Field(alias="_version")` with
`populate_by_name=True` — the same `ConfigDict(populate_by_name=True)` pattern
`schema.py`'s existing models already use for `from_`/`from`. This matters
beyond cosmetics: `engine.py:73 row_version(row)` reads `row.get("_version")`
to supply `expected_version` for CAS, and `primitives.py:609` writes
`item["_version"]` back after an update. Both must be ported to the model's
accessor, or the CAS preconditions the wave hardened silently degrade to
"no precondition" — a real lost-update risk, not a type nit.

**Wire boundary.** `api/internal.py:349` (`"items": ctx.items`) and the create
response in `api/instances.py` serialize the model. This narrows the payload
from ~200 keys to the field set above and stops leaking unrelated tenant
columns to the family-facing client.

### 4. `Literal`-validated authored references

`_guard_params_items_in_status` validates each status value against
`ItemStatus`, so a typo fails at publish with a clear error. This is a
**tightening**: `validate_definition` also backs `definition_health`
(`designer.py`), so a stored definition with a bad status value flips to
unhealthy on next read. That is the intended effect — it surfaces a latent bug
that is currently invisible.

### 5. Generated contract for TypeScript

A committed JSON artifact generated from `ItemStatus`, imported by TS at build
time the way `services.json` already is. A Python test asserts the committed
file matches the enum, so the two cannot diverge without CI failing.

Python remains authoritative and never reads the JSON at runtime: `services.json`
is **not** copied into any Fly image, and the engine's correctness must not
depend on a file that can be absent.

Fixing `flow-runtime/src/types.ts:118`'s stale `in_progress` comment is part of
this step.

## Consumer contract (must not break)

Measured, not assumed:

- `flow-runtime/src/types.ts::WorkflowItemView` — `entity_id`, `step_id`,
  `kind`, `title`, `status`, `blocking`. Shared by AdminDash and FamilyHub.
- `admindash/frontend/src/utils/workflowData.ts::toItemView` — the same six.
- FamilyHub `HubPage` additionally reads `payload_ref`.
- `due_at`, `item_id`, `instance_id` are carried for the AdminDash home-page
  spec that consumes this work.

## Risks

| Risk | Mitigation |
|---|---|
| Narrowing the wire breaks a consumer reading an unlisted field | Field set derived by measurement above; FamilyHub + AdminDash builds and the browser gate re-run before merge. |
| Strict parsing rejects a legacy row | All stored statuses across all seven local tenants are `not_started`/`submitted`/`waived`; production apexflow has zero instances. Verified 2026-08-09. |
| Losing same-action mutation visibility | Model stays mutable; a test pins that `start_due_clocks` mutations are visible to later guards in the same action. |
| `_version` alias mishandled, silently disabling CAS | `row_version` and the `primitives.py:609` write-back are ported together; a test asserts `expected_version` is still supplied on item updates, so a regression fails rather than degrading quietly. |
| Validator tightening flips a definition unhealthy | Intended. Only the enrollment template exists and it is clean. |

## Testing

- Enum/derived-set unit tests, including that `COMPLETABLE_STATUSES` no longer
  contains `in_progress`.
- Validator: `items_in_status` with a bad status fails publish; all real
  template values still pass.
- Same-action mutation visibility regression test.
- Wire-shape test asserting the serialized item carries exactly the contract
  fields.
- Drift test: committed JSON matches `ItemStatus`.
- Baselines hold: apexflow 510, familyhub 89, admindash 201, datacore 354,
  admindash vitest 92.

## Out of scope

- Typing `kind`, instance `state`, definition `status`, or lineage status.
- The AdminDash home page (separate spec, consumes this one).
- Exposing the vocabulary over HTTP.
- `services.json`'s own documentation defect: CLAUDE.md claims backends read it
  at startup, but it is absent from every Fly image and Python falls back to
  env vars. Noted for a docs fix, not changed here.
