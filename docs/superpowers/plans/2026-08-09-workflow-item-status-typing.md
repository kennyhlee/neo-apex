# Workflow Item Status Typing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `workflow_item.status` a typed, single-sourced vocabulary end-to-end — one Python `StrEnum`, typed engine writes, publish-time validation of authored references, a typed runtime row model with an explicit wire boundary, and a generated TypeScript constant so no frontend hardcodes the list.

**Architecture:** `ItemStatus(StrEnum)` in `apexflow/backend/app/workflows/shared.py` becomes the single authority. Derived sets (`ITEM_DONE_STATUSES`, `COMPLETABLE_STATUSES`) are computed from it rather than re-spelled. A mutable `WorkflowItem` pydantic model replaces `EvalContext.items: list[dict]`, giving typed reads and letting the API serialize a narrow payload instead of ~200-key sparse rows. A generator emits a TypeScript module into `flow-runtime` (the shared package all three frontends already consume), with a Python drift test.

**Tech Stack:** Python 3.11+ (StrEnum), pydantic v2, FastAPI, pytest; TypeScript/React for the consumers; vitest for admindash frontend.

**Spec:** `docs/superpowers/specs/2026-08-09-workflow-item-status-typing-design.md`

## Global Constraints

- **The five statuses, and only these:** `not_started`, `submitted`, `verified`, `waived`, `rejected`. `in_progress` is **dropped everywhere** (Plan 1 follow-up #23).
- **`StrEnum`, not `Enum`.** Members must compare and hash equal to their plain string values so existing comparisons and raw DataCore strings keep working. Never use `.value` at comparison sites; never `str()`-wrap for equality.
- **Derived sets are derived.** `ITEM_DONE_STATUSES = frozenset({SUBMITTED, VERIFIED, WAIVED})`, `COMPLETABLE_STATUSES = frozenset({NOT_STARTED, SUBMITTED, REJECTED})`. Do not re-spell literals.
- **The `WorkflowItem` model must stay MUTABLE** (no `frozen=True`). `primitives.py:607-609` mutates items in place so later guards/effects in the SAME action observe `due_at`/`_version` without a re-fetch — a documented invariant.
- **`_version` requires an alias.** Pydantic v2 treats leading-underscore names as private attributes. Declare `version: int | None = Field(default=None, alias="_version")` with `model_config = ConfigDict(populate_by_name=True, extra="ignore")`. Getting this wrong silently disables CAS preconditions — a lost-update risk, not a type nit.
- **Consumer contract that must not break** (measured, not assumed): `entity_id`, `step_id`, `kind`, `title`, `status`, `blocking` (`flow-runtime/src/types.ts::WorkflowItemView`, `admindash .../workflowData.ts::toItemView`), plus `payload_ref` (FamilyHub `HubPage`). Carry `due_at`, `item_id`, `instance_id` for the home-page spec.
- **Test baselines (must not regress):** apexflow **510**, familyhub **89**, admindash **201**, datacore **354**, admindash vitest **92**.
- Suite commands: `cd apexflow && uv run pytest backend/tests/ -q`; `cd familyhub && uv run pytest backend/tests/ -q`; `cd admindash && uv run pytest backend/tests/ -q`; `cd admindash/frontend && npx vitest run`.
- Frontend builds: `cd <module>/frontend && npm run build && npm run lint` for admindash, apexflow, familyhub. **`cd flow-runtime && npm ci` first** — its `react` types must resolve from its own `node_modules`, or `tsc -b` fails with TS2307 (a green local build can be an artifact of a stray `~/node_modules`).
- Branch: work on `feat/item-status-typing`, cut from `docs/registration-flow-design` (**not** `main`, which lacks the Plan 3 merge).
- Conventional commits; one task may make several.

### Plan amendment vs the spec (deliberate, flag if you disagree)

The spec said the generated artifact would be a **root-level JSON** imported by TS "the way `services.json` is." This plan instead generates a **TypeScript module inside `flow-runtime`** (`flow-runtime/src/itemStatus.generated.ts`).

Reason: a root-level JSON would be imported across a package boundary through npm's **symlinked `file:` dep** — the exact resolution path that already broke the CI frontend build (`TS2307: Cannot find module 'react'`, fixed by installing `flow-runtime`'s own deps). A generated `.ts` inside the package is a plain intra-package import with no cross-directory or `fs.allow` concerns, and `flow-runtime/src/types.ts` is already the canonical home of the TS `ItemStatus` union and `DONE_ITEM_STATUSES`. Same single-source property, strictly less resolution risk.

---

### Task 1: `ItemStatus` enum and derived sets

**Files:**
- Modify: `apexflow/backend/app/workflows/shared.py:41` (ITEM_DONE_STATUSES)
- Modify: `apexflow/backend/app/workflows/engine.py:64` (COMPLETABLE_STATUSES) and its docstrings at `:501`, `:551`
- Test: `apexflow/backend/tests/test_item_status.py` (new)

**Interfaces:**
- Produces: `ItemStatus` StrEnum with members `NOT_STARTED`, `SUBMITTED`, `VERIFIED`, `WAIVED`, `REJECTED`; `ITEM_DONE_STATUSES` and `COMPLETABLE_STATUSES` as frozensets of members. All later tasks import `ItemStatus` from `app.workflows.shared`.

- [ ] **Step 1: Write the failing test** — `apexflow/backend/tests/test_item_status.py`:

```python
from app.workflows.shared import ITEM_DONE_STATUSES, ItemStatus
from app.workflows.engine import COMPLETABLE_STATUSES


def test_vocabulary_is_exactly_the_five_written_statuses():
    assert {s.value for s in ItemStatus} == {
        "not_started", "submitted", "verified", "waived", "rejected",
    }


def test_in_progress_is_gone():
    """Plan 1 follow-up #23: declared legal, never written, never tested."""
    assert "in_progress" not in {s.value for s in ItemStatus}
    assert "in_progress" not in COMPLETABLE_STATUSES


def test_members_compare_equal_to_plain_strings():
    """StrEnum, not Enum -- raw DataCore strings must keep comparing."""
    assert ItemStatus.SUBMITTED == "submitted"
    assert "submitted" in ITEM_DONE_STATUSES
    assert {"status": "verified"}.get("status") in ITEM_DONE_STATUSES


def test_derived_sets():
    assert ITEM_DONE_STATUSES == frozenset(
        {ItemStatus.SUBMITTED, ItemStatus.VERIFIED, ItemStatus.WAIVED}
    )
    assert COMPLETABLE_STATUSES == frozenset(
        {ItemStatus.NOT_STARTED, ItemStatus.SUBMITTED, ItemStatus.REJECTED}
    )
```

- [ ] **Step 2: Run it, confirm it fails**

Run: `cd apexflow && uv run pytest backend/tests/test_item_status.py -q`
Expected: FAIL — `ImportError: cannot import name 'ItemStatus'`.

- [ ] **Step 3: Add the enum in `shared.py`**, replacing line 41's literal set:

```python
from enum import StrEnum


class ItemStatus(StrEnum):
    """The closed vocabulary of `workflow_item.status`.

    StrEnum (not Enum) is load-bearing: DataCore returns flattened rows whose
    status arrives as a plain string, and authored `items_in_status` guards
    carry plain strings too. Members compare and hash equal to their values,
    so every existing comparison keeps working.
    """

    NOT_STARTED = "not_started"
    SUBMITTED = "submitted"
    VERIFIED = "verified"
    WAIVED = "waived"
    REJECTED = "rejected"


# Statuses treated as "done" for blocking-completeness checks.
ITEM_DONE_STATUSES = frozenset(
    {ItemStatus.SUBMITTED, ItemStatus.VERIFIED, ItemStatus.WAIVED}
)
```

- [ ] **Step 4: Rewrite `COMPLETABLE_STATUSES` in `engine.py:64`**, importing `ItemStatus` from `shared`:

```python
COMPLETABLE_STATUSES = frozenset(
    {ItemStatus.NOT_STARTED, ItemStatus.SUBMITTED, ItemStatus.REJECTED}
)
```

Then update the two docstrings that still enumerate `in_progress` (`engine.py:501`, `:551`) to list `not_started`/`submitted`/`rejected`.

- [ ] **Step 5: Run the new test and the full apexflow suite**

Run: `cd apexflow && uv run pytest backend/tests/ -q`
Expected: 510 prior + 4 new = **514 passing**. If any existing test fails, a comparison site is using `.value` or `str()` where it should compare directly — fix the site, not the enum.

- [ ] **Step 6: Commit**

```bash
git add apexflow/backend/app/workflows/shared.py apexflow/backend/app/workflows/engine.py apexflow/backend/tests/test_item_status.py
git commit -m "feat(apexflow): ItemStatus StrEnum as the single status vocabulary; drop in_progress"
```

---

### Task 2: Typed engine writes

**Files:**
- Modify: `apexflow/backend/app/workflows/engine.py` — item creation (`:171`), `complete_item` ternary (`:540`), `verify_item` (`:562`), `reject_item` (`:572`), `waive_item` (`:586`)
- Test: `apexflow/backend/tests/test_item_status.py` (extend)

**Interfaces:**
- Consumes: `ItemStatus` from Task 1.
- Produces: no behavior change — written values are byte-identical strings.

- [ ] **Step 1: Write the failing test** (append):

```python
import inspect
from app.workflows import engine


def test_engine_writes_no_bare_status_literals():
    """Every status the engine assigns comes from ItemStatus, so a typo is an
    AttributeError at import rather than a silently wrong row."""
    src = inspect.getsource(engine)
    for literal in ('"not_started"', '"submitted"', '"verified"',
                    '"waived"', '"rejected"'):
        assert f'"status": {literal}' not in src, (
            f"engine.py still writes a bare status literal {literal}"
        )
        assert f'changes["status"] = {literal}' not in src
```

- [ ] **Step 2: Run it, confirm it fails**

Run: `cd apexflow && uv run pytest backend/tests/test_item_status.py -q`
Expected: FAIL — creation site still writes `"status": "not_started"`.

- [ ] **Step 3: Replace the five write sites.** Item creation (`engine.py:171`):

```python
    base = {
        "item_id": item_id,
        "workflow_item_id": item_id,
        "instance_id": instance_entity_id,
        "status": ItemStatus.NOT_STARTED,
        **fields,
    }
```

`complete_item`'s ternary (`:540`):

```python
    changes["status"] = (
        ItemStatus.VERIFIED if effective_review == "auto" else ItemStatus.SUBMITTED
    )
```

And the three item verbs: `{"status": ItemStatus.VERIFIED}` (`verify_item`), `{"status": ItemStatus.REJECTED}` (`reject_item`), `{"status": ItemStatus.WAIVED}` (`waive_item`).

- [ ] **Step 4: Verify the wire value is unchanged**

Run: `cd apexflow && uv run python -c "
from app.workflows.shared import ItemStatus
import json
print(json.dumps({'status': ItemStatus.NOT_STARTED}))"`
Expected: `{"status": "not_started"}` — StrEnum serializes as its value, so stored rows are identical.

- [ ] **Step 5: Full suite**

Run: `cd apexflow && uv run pytest backend/tests/ -q` — **515 passing**.

- [ ] **Step 6: Commit**

```bash
git commit -am "refactor(apexflow): engine writes item status via ItemStatus members"
```

---

### Task 3: Publish-time validation of authored status references

**Files:**
- Modify: `apexflow/backend/app/workflows/validate.py:309-333` (`_guard_params_items_in_status`)
- Test: `apexflow/backend/tests/test_validate.py` (extend; if the file is named differently, use the existing validator test module)

**Interfaces:**
- Consumes: `ItemStatus`.
- Produces: `validate_definition` returns an error for any `items_in_status` status value outside the vocabulary. This also flows into `definition_health` (`api/designer.py`), so a stored definition with a bad value reads as unhealthy — intended.

- [ ] **Step 1: Write the failing tests:**

```python
def test_items_in_status_rejects_unknown_status():
    errors = _guard_params_items_in_status({"status": "verifyed"})
    assert any("verifyed" in e for e in errors)


def test_items_in_status_rejects_unknown_in_a_list():
    errors = _guard_params_items_in_status({"status": ["submitted", "bogus"]})
    assert any("bogus" in e for e in errors)


def test_items_in_status_accepts_every_real_template_value():
    """The enrollment template's actual guard params must still pass."""
    for value in ("rejected", ["submitted", "verified"], ["verified", "waived"]):
        assert _guard_params_items_in_status({"status": value}) == []
```

- [ ] **Step 2: Run, confirm failure** — the first two currently return `[]`.

- [ ] **Step 3: Add the vocabulary check.** In `_guard_params_items_in_status`, after the existing string/list shape checks pass, validate each value:

```python
        values = status if isinstance(status, list) else [status]
        unknown = [v for v in values if isinstance(v, str) and v not in set(ItemStatus)]
        if unknown:
            errors.append(
                f"'items_in_status' param 'status' has unknown value(s) "
                f"{sorted(unknown)}; valid: {sorted(s.value for s in ItemStatus)}"
            )
```

Place it so it only runs when the shape checks produced no error, to avoid double-reporting a malformed param.

- [ ] **Step 4: Confirm the real template still publishes**

Run: `cd apexflow && uv run pytest backend/tests/ -q -k "validate or template or publish"`
Expected: all pass — the enrollment template uses only in-vocabulary values.

- [ ] **Step 5: Full suite** — **518 passing**.

- [ ] **Step 6: Commit**

```bash
git commit -am "feat(apexflow): reject unknown item statuses in items_in_status guard params"
```

---

### Task 4: `WorkflowItem` model and the typed read boundary

This is the largest task. Read `apexflow/backend/app/workflows/primitives.py:104-145` (EvalContext) and `machine.py:226+` (`build_eval_context`) fully before starting.

**Files:**
- Create: `apexflow/backend/app/workflows/rows.py`
- Modify: `apexflow/backend/app/workflows/primitives.py` (EvalContext.items type; the in-place mutation at `:607-609`)
- Modify: `apexflow/backend/app/workflows/machine.py` (`build_eval_context` parses rows)
- Modify: `apexflow/backend/app/workflows/engine.py` (`row_version` usage on items, `_item_base_data`)
- Test: `apexflow/backend/tests/test_workflow_item_model.py` (new)

**Interfaces:**
- Produces: `WorkflowItem` pydantic model — `entity_id`, `item_id`, `instance_id`, `step_id`, `kind`, `title`, `status: ItemStatus`, `blocking: bool`, `payload_ref: str | None`, `due_at: str | None`, `completed_by: str | None`, `version: int | None` (alias `_version`). `EvalContext.items: list[WorkflowItem]`.
- A new module `rows.py` is used rather than `schema.py` because `schema.py` models **authored definition artifacts**; these are **runtime rows**.

- [ ] **Step 1: Write the failing tests:**

```python
from app.workflows.rows import WorkflowItem
from app.workflows.shared import ItemStatus


def _row(**over):
    row = {
        "entity_id": "it-1", "item_id": "ACM-WT1", "instance_id": "inst-1",
        "step_id": "application_form", "kind": "form", "title": "Application",
        "status": "not_started", "blocking": "true", "_version": "3",
        # a wide sparse row: DataCore returns every column in the tenant table
        "tuition_fall_semester_K": "", "chinese_track": "", "accreditation": "",
    }
    row.update(over)
    return row


def test_parses_flattened_row_and_types_status():
    item = WorkflowItem.model_validate(_row())
    assert item.status is ItemStatus.NOT_STARTED
    assert item.blocking is True          # "true" string -> bool
    assert item.version == 3              # "_version" alias, string -> int


def test_unrelated_sparse_columns_are_dropped():
    item = WorkflowItem.model_validate(_row())
    assert not hasattr(item, "tuition_fall_semester_K")
    assert "chinese_track" not in item.model_dump()


def test_is_mutable_for_same_action_effects():
    """primitives.start_due_clocks mutates in place so later guards in the
    SAME action see it without a re-fetch."""
    item = WorkflowItem.model_validate(_row())
    item.due_at = "2026-09-01T00:00:00+00:00"
    item.version = 4
    assert item.due_at == "2026-09-01T00:00:00+00:00"


def test_version_round_trips_for_cas():
    """row_version feeds expected_version; losing it silently disables CAS."""
    item = WorkflowItem.model_validate(_row(_version="7"))
    assert item.version == 7
    assert item.model_dump(by_alias=True)["_version"] == 7


def test_unknown_status_is_rejected():
    import pytest
    with pytest.raises(Exception):
        WorkflowItem.model_validate(_row(status="verifyed"))
```

- [ ] **Step 2: Run, confirm failure** (`ModuleNotFoundError: app.workflows.rows`).

- [ ] **Step 3: Create `rows.py`:**

```python
"""Runtime row models.

Distinct from `schema.py`, which models AUTHORED definition artifacts
(machine/steps). These model rows as DataCore returns them: flattened, sparse
(every column in the tenant's table appears), and with every scalar stringified
on the wire.
"""
from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.workflows.shared import ItemStatus, as_bool


class WorkflowItem(BaseModel):
    """One `workflow_item` row.

    MUTABLE by design: `primitives._effect_start_due_clocks` updates `due_at`
    and `version` in place so later guards/effects in the SAME action observe
    the change without a re-fetch (EvalContext's documented contract).
    """

    model_config = ConfigDict(populate_by_name=True, extra="ignore")

    entity_id: str
    item_id: str = ""
    instance_id: str = ""
    step_id: str = ""
    kind: str = "form"
    title: str = ""
    status: ItemStatus = ItemStatus.NOT_STARTED
    blocking: bool = False
    payload_ref: str | None = None
    due_at: str | None = None
    completed_by: str | None = None
    # Leading underscores are private attrs in pydantic v2 -> alias.
    version: int | None = Field(default=None, alias="_version")

    @field_validator("blocking", mode="before")
    @classmethod
    def _coerce_blocking(cls, v: object) -> bool:
        return as_bool(v)

    @field_validator("version", mode="before")
    @classmethod
    def _coerce_version(cls, v: object) -> int | None:
        if v in (None, ""):
            return None
        try:
            return int(v)
        except (TypeError, ValueError):
            return None
```

- [ ] **Step 4: Parse at the boundary.** In `machine.build_eval_context`, wrap the fetched item rows: `items=[WorkflowItem.model_validate(r) for r in item_rows]`. Change `EvalContext.items` to `list[WorkflowItem]`.

- [ ] **Step 5: Port every attribute access.** Replace `item.get("status")` → `item.status`, `item["entity_id"]` → `item.entity_id`, etc. across `primitives.py`, `engine.py`, `machine.py`, `shared.py`. Two sites need care:

  - `primitives.py:607-609` — becomes `item.due_at = due_at` and `item.version = updated["_version"]`.
  - `engine.py` item updates — `expected_version=row_version(item_row)` must become `expected_version=item.version` when the argument is a model. **Do not** delete the precondition; a missing `expected_version` silently disables CAS.

- [ ] **Step 6: Add the CAS regression test** to `test_workflow_item_model.py`:

```python
def test_item_update_still_sends_expected_version(monkeypatch):
    """CAS precondition must survive the dict -> model port."""
    seen = {}

    def fake_update(tenant, etype, eid, base, token, expected_version=None):
        seen["expected_version"] = expected_version
        return {**base, "_version": (expected_version or 0) + 1}

    # wire fake_update in place of dc.dc_update, run verify_item on a
    # version-3 item, then:
    assert seen["expected_version"] == 3
```
Flesh this out against the suite's existing fake-DataCore fixture (`fakes.py` / `install_fake_datacore`) rather than hand-rolling a monkeypatch if one already fits.

- [ ] **Step 7: Full suite** — every prior test must still pass. Expect **518 + 6 = 524**. Failures here are almost always a missed `.get("x")` → `.x` port; fix the access, don't loosen the model.

- [ ] **Step 8: Commit**

```bash
git commit -am "refactor(apexflow): typed WorkflowItem rows with ItemStatus; preserve in-place effect mutation and CAS"
```

---

### Task 5: Narrow the wire payload

**Files:**
- Modify: `apexflow/backend/app/api/internal.py:349` (`"items": ctx.items`)
- Modify: `apexflow/backend/app/api/instances.py` (create-instance response items)
- Test: `apexflow/backend/tests/test_internal_api.py` (extend)

**Interfaces:**
- Produces: item objects on the wire carry exactly the `WorkflowItem` field set. `_version` is emitted under its alias.

- [ ] **Step 1: Write the failing test:**

```python
def test_instance_items_carry_only_contract_fields(client, ...):
    resp = client.get(f"/internal/instance-by-token/{token}",
                      headers=INTERNAL_HEADERS)
    item = resp.json()["items"][0]
    assert set(item) == {
        "entity_id", "item_id", "instance_id", "step_id", "kind", "title",
        "status", "blocking", "payload_ref", "due_at", "completed_by",
        "_version",
    }
    # the consumer contract specifically
    for required in ("entity_id", "step_id", "kind", "title", "status",
                     "blocking", "payload_ref"):
        assert required in item
    # unrelated tenant columns no longer leak to the family client
    assert "tuition_fall_semester_K" not in item
```

- [ ] **Step 2: Run, confirm failure** — today the payload has ~200 keys.

- [ ] **Step 3: Serialize the model** at both exits: `[i.model_dump(by_alias=True) for i in ctx.items]`.

- [ ] **Step 4: Verify consumers still build**

```bash
cd flow-runtime && npm ci
cd ../familyhub/frontend && npm run build && npm run lint
cd ../../admindash/frontend && npm run build && npm run lint && npx vitest run
```
Expected: clean; vitest **92**.

- [ ] **Step 5: Full apexflow + familyhub suites** — apexflow **525**, familyhub **89**.

- [ ] **Step 6: Commit**

```bash
git commit -am "feat(apexflow): serialize items through WorkflowItem, narrowing the wire payload"
```

---

### Task 6: Generated TypeScript vocabulary and drift test

**Files:**
- Create: `apexflow/backend/scripts/generate_item_status_ts.py`
- Create: `flow-runtime/src/itemStatus.generated.ts` (committed, generated)
- Modify: `flow-runtime/src/types.ts:4,17-18` (union + `DONE_ITEM_STATUSES`, and the stale `in_progress` comment at `:118`)
- Modify: `familyhub/frontend/src/pages/HubPage.tsx:28,34`; `admindash/frontend/src/utils/workflowData.ts:219`
- Test: `apexflow/backend/tests/test_item_status.py` (drift test)

**Interfaces:**
- Produces: `ITEM_STATUSES`, `ITEM_DONE_STATUSES`, and the `ItemStatus` union type, generated from Python. All TS consumers import from `flow-runtime` instead of hardcoding.

- [ ] **Step 1: Write the failing drift test:**

```python
from pathlib import Path


def test_generated_ts_matches_the_enum():
    repo = Path(__file__).resolve().parents[3]
    generated = (repo / "flow-runtime/src/itemStatus.generated.ts").read_text()
    for s in ItemStatus:
        assert f"'{s.value}'" in generated, f"{s.value} missing from generated TS"
    assert "in_progress" not in generated
```

- [ ] **Step 2: Run, confirm failure** (file does not exist).

- [ ] **Step 3: Write the generator** — `apexflow/backend/scripts/generate_item_status_ts.py` emits, with a "generated, do not edit" banner naming the generator and `shared.py`:

```ts
export type ItemStatus =
  | 'not_started' | 'submitted' | 'verified' | 'waived' | 'rejected';

export const ITEM_STATUSES: readonly ItemStatus[] = [
  'not_started', 'submitted', 'verified', 'waived', 'rejected',
];

export const ITEM_DONE_STATUSES: readonly ItemStatus[] = [
  'submitted', 'verified', 'waived',
];
```

Run it: `cd apexflow/backend && uv run python scripts/generate_item_status_ts.py`

- [ ] **Step 4: Re-point the TS consumers.** `flow-runtime/src/types.ts` re-exports from the generated module instead of declaring its own union and `DONE_ITEM_STATUSES`; delete the stale `in_progress` from the `:118` comment. `HubPage.tsx` imports `ITEM_STATUSES` for `ALL_ITEM_STATUSES` and drops `in_progress` from `OUTSTANDING`. `workflowData.ts:219` becomes `verify: status === 'submitted'`.

- [ ] **Step 5: Verify everything**

```bash
cd apexflow && uv run pytest backend/tests/ -q            # 526
cd flow-runtime && npm ci
cd ../admindash/frontend && npm run build && npm run lint && npx vitest run
cd ../../familyhub/frontend && npm run build && npm run lint
cd ../../apexflow/frontend && npm run build && npm run lint
```

- [ ] **Step 6: Confirm the drift test actually bites** — temporarily add a sixth member to `ItemStatus`, re-run the drift test, confirm FAIL, then revert. Record that you did this.

- [ ] **Step 7: Commit**

```bash
git commit -am "feat: generate the TS item-status vocabulary from Python; drop in_progress from all TS consumers"
```

---

### Task 7: Close the follow-up and record what changed

**Files:**
- Modify: `docs/superpowers/plans/2026-08-05-apexflow-plan1-followups.md` (item 23)
- Modify: `docs/superpowers/specs/2026-08-09-workflow-item-status-typing-design.md` (note the generated-`.ts` amendment)

- [ ] **Step 1: Mark follow-up #23 CLOSED** with the commit that dropped `in_progress`, noting it was removed from `COMPLETABLE_STATUSES`, two engine docstrings, and four TypeScript sites.

- [ ] **Step 2: Record the amendment** in the spec — generated `.ts` inside `flow-runtime` rather than root JSON, with the symlinked-`file:`-dep resolution rationale.

- [ ] **Step 3: Commit**

```bash
git commit -am "docs: close Plan 1 follow-up #23; record the generated-TS amendment"
```

---

## Self-review notes

- Every spec requirement maps to a task: vocabulary (1), typed writes (2), authored validation (3), typed reads + `_version`/CAS (4), wire narrowing (5), TS sharing + `in_progress` removal (6), bookkeeping (7).
- Type consistency: `ItemStatus` imported from `app.workflows.shared` everywhere; `WorkflowItem` from `app.workflows.rows`; TS imports from `flow-runtime`.
- The riskiest step is Task 4 Step 5 (porting dict access to attributes). It is deliberately paired with the CAS regression test in Step 6, because that is the failure mode that would otherwise pass tests and lose data silently.
