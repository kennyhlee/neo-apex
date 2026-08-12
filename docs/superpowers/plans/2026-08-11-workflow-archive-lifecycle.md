# Workflow Archive Lifecycle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a school administrator archive a workflow out of circulation and later unarchive it, gated on every work item being in an end state, with force-archive abandoning open work items and per-item administrator-driven restore.

**Architecture:** `lineage_status` gains a reversible `archived` value (legacy `retired` reads as archived via one shared `is_archived` helper). Force-archive drives each open `workflow_instance` into a new synthetic terminal state `abandoned` that records `archived_from_state`; a staff-only `restore_instance` action returns one instance to exactly that state. Service logic lives in apexflow-backend; the management UI lives in AdminDash, with ApexFlow's designer buttons rewired to the same actions.

**Tech Stack:** Python 3 / FastAPI / pydantic v2 / pytest (apexflow, admindash backends); React 19 + TypeScript + Vite / vitest (admindash, apexflow frontends). DataCore (LanceDB) via `app.workflows.datacore`.

**Spec:** `docs/superpowers/specs/2026-08-11-workflow-archive-lifecycle-design.md`

> **STATUS: executed, then superseded in part.** All 12 tasks below shipped, but
> the requirements changed immediately afterwards — archive is now gated on the
> lineage being `deprecated`, freezes in-flight work instead of blocking on it,
> and drafts can be deleted. Read the **Amendment** at the top of the spec
> before treating any task here as current; the follow-up work is not written
> up as tasks because it landed directly.

## Global Constraints

- **Vocabulary:** "workflow" = definition **lineage** (`definition_id`); "work item" = one **`workflow_instance`**. A `workflow_item` row is a step inside an instance and is NOT touched by this plan.
- **Never SQL-filter on a new column.** A DataCore `where` predicate naming a column absent from a tenant's table is a DuckDB binder error (400), not an empty result. `archived_from_state` and `archived_at` are new, so every filter on them happens in Python/TypeScript over a fetched set. Follow the existing `rows_matching` pattern in `definitions.py` and `workflowData.ts`.
- **Flattened rows stringify every scalar.** `int(row["token_version"])`, never `row["token_version"] == 2`. Bools read back as the strings `"true"`/`"false"` — use `app.workflows.shared.as_bool`.
- **`entity_base_data` drops `None` values.** To CLEAR a field on a full-replace PUT, set it to `""`, never `None` — `""` is what the existing code treats as "open" (`list_open_instances` tests `not r.get("closed_at")`).
- **Writes are version-preconditioned.** Every `dc_update` on an instance passes `expected_version=engine.row_version(ctx.instance)` and refreshes `ctx.instance["_version"]` from the returned envelope. Copy `machine._write_state` exactly.
- **No import cycles.** `machine.py` imports `definitions.py`; a `definitions.py → machine.py` import would close a cycle. Cross-module collaborators are dependency-injected from the API layer, exactly as `retire_definition`'s existing `cancel_instance_fn` is.
- **Legacy alias has exactly one definition per side.** Backend: `definitions.is_archived`. Frontend: one `isArchived()` helper per frontend. Never string-compare `'retired'` or `'archived'` inline.
- **New user-facing strings go in `src/i18n/translations.ts` for BOTH `en-US` and `zh-CN`.** A missing key renders the raw key with no warning.
- **Verify every test by mutation.** Break the implementation, watch the test fail, restore it. A green suite has been meaningless in this repo four times; watch for stale `__pycache__` faking a pass.

**Test commands:**
- apexflow backend: `cd apexflow && uv run pytest backend/tests/ -v`
- admindash backend: `cd admindash && uv run pytest backend/tests/ -v`
- admindash frontend: `cd admindash/frontend && npm run build && npm run lint`
- apexflow frontend: `cd apexflow/frontend && npm run build && npm run lint`

---

## File Structure

**apexflow/backend**
- `app/workflows/definitions.py` — add `is_archived`, `archive_definition`, `unarchive_definition`; delete `retire_definition`.
- `app/workflows/machine.py` — add `abandon_instance`, `restore_instance`; teach `_is_terminal_state` about `abandoned`.
- `app/api/definitions.py` — route `archive`/`unarchive`/`retire`-alias; swap the injected collaborator to abandon.
- `app/api/instances.py` — add the lineage instance-list read route.
- `tests/test_definitions_api.py`, `tests/test_instances.py` — extend.
- `tests/test_archive_lifecycle.py` — **new**, owns the cross-cutting archive/abandon/restore behaviour.

**admindash/backend**
- `app/api/workflows.py` — add a definition-actions proxy and a lineage instance-list proxy.
- `backend/tests/test_workflows_proxy.py` — extend.

**admindash/frontend/src**
- `api/workflows.ts` — client fns + `isArchived`.
- `utils/workflowData.ts` — `allInstancesSql`, `filterInstances`.
- `pages/WorkflowsPage.tsx` — archive/unarchive controls, archived toggle.
- `components/ArchiveWorkflowModal.tsx` (+`.css`) — **new**, gate-aware confirm.
- `pages/WorkflowItemsTable.tsx` (+`.css`) — **new**, the R6 management surface.
- `i18n/translations.ts` — new keys, both locales.

**apexflow/frontend/src**
- `api/designer.ts`, `pages/DefinitionsPage.tsx`, `types/designer.ts` — rewire to archive/unarchive.

---

## Task 1: `archived` status + `is_archived` legacy alias

**Files:**
- Modify: `apexflow/backend/app/workflows/definitions.py`
- Test: `apexflow/backend/tests/test_archive_lifecycle.py` (create)

**Interfaces:**
- Consumes: nothing.
- Produces: `definitions.is_archived(row: dict) -> bool` — True when `row["lineage_status"]` is `"archived"` or the legacy `"retired"`. `definitions.ARCHIVED_STATUSES: frozenset[str]`.

- [ ] **Step 1: Write the failing test**

Create `apexflow/backend/tests/test_archive_lifecycle.py`:

```python
"""Archive/unarchive lineage lifecycle + instance abandon/restore.

Owns the cross-cutting behaviour that spans definitions.py and machine.py;
per-route wiring assertions stay in test_definitions_api.py / test_instances.py.

Spec: docs/superpowers/specs/2026-08-11-workflow-archive-lifecycle-design.md
"""
import pytest

from app.workflows.definitions import is_archived


@pytest.mark.parametrize("lineage_status,expected", [
    ("archived", True),
    ("retired", True),      # legacy rows written before the rename
    ("active", False),
    ("deprecated", False),
    ("", False),
])
def test_is_archived_covers_archived_and_legacy_retired(lineage_status, expected):
    assert is_archived({"lineage_status": lineage_status}) is expected


def test_is_archived_on_row_with_no_lineage_status_column():
    """A tenant whose table predates the column reads back a row with the key
    absent entirely — that must be False, not a KeyError."""
    assert is_archived({}) is False
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apexflow && uv run pytest backend/tests/test_archive_lifecycle.py -v`
Expected: FAIL — `ImportError: cannot import name 'is_archived'`

- [ ] **Step 3: Write minimal implementation**

In `apexflow/backend/app/workflows/definitions.py`, after the `parse_machine_steps` function:

```python
# `retired` was this value's name before archive/unarchive made the state
# reversible (spec D1). Rows written under the old name are still valid and
# are NOT migrated — every read goes through `is_archived`, so the alias has
# exactly one definition. Never string-compare either value at a call site.
ARCHIVED_STATUSES: frozenset[str] = frozenset({"archived", "retired"})


def is_archived(row: dict) -> bool:
    """True when this definition row's lineage is out of circulation.

    Tolerates a row with no `lineage_status` key at all — a tenant whose
    table predates the column reads back sparse, and `.get` returning None
    must be False rather than a KeyError (same tolerance the recent
    `due_at` fix established for flattened rows generally)."""
    return row.get("lineage_status") in ARCHIVED_STATUSES
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apexflow && uv run pytest backend/tests/test_archive_lifecycle.py -v`
Expected: 6 passed

- [ ] **Step 5: Verify by mutation**

Change `ARCHIVED_STATUSES` to `frozenset({"archived"})`, re-run, confirm the `("retired", True)` case FAILS. Restore. If it still passes, delete `apexflow/backend/**/__pycache__` and re-run — stale bytecode has faked a pass in this repo before.

- [ ] **Step 6: Commit**

```bash
git add apexflow/backend/app/workflows/definitions.py apexflow/backend/tests/test_archive_lifecycle.py
git commit -m "feat(apexflow): add archived lineage status with legacy retired alias"
```

---

## Task 2: `abandoned` is a terminal state that blocks all progress

**Files:**
- Modify: `apexflow/backend/app/workflows/machine.py:286-294` (`_is_terminal_state`)
- Test: `apexflow/backend/tests/test_archive_lifecycle.py`

**Interfaces:**
- Consumes: `definitions.is_archived` (Task 1) — not used here, but the module is now importable.
- Produces: `machine.ABANDONED_STATE = "abandoned"`. `_is_terminal_state(ctx)` returns True for it.

This task ships the *blocking* half before the *writing* half, so the guarantee "no more progress can be made" is proven independently of how an instance got there.

- [ ] **Step 1: Write the failing test**

Append to `apexflow/backend/tests/test_archive_lifecycle.py`. Add these imports at the top of the file:

```python
import json

from fastapi.testclient import TestClient

from app.auth import require_authenticated_user
from app.main import app
from app.workflows import machine

TENANT = "acme"
```

Add the shared fixtures and builders (mirrors `test_definitions_api.py`'s, which this file deliberately does not import — that file has no `conftest` export and cross-test-file imports are not a pattern in this suite):

```python
@pytest.fixture
def client(fake_dc):
    app.dependency_overrides[require_authenticated_user] = lambda: {
        "user_id": "u1", "tenant_id": TENANT, "role": "admin", "_token": "Bearer test-token",
    }
    yield TestClient(app)
    app.dependency_overrides.clear()


def _machine():
    return {
        "states": [
            {"state_id": "draft", "name": "Draft", "kind": "initial"},
            {"state_id": "submitted", "name": "Submitted", "kind": "active"},
            {"state_id": "enrolled", "name": "Enrolled", "kind": "terminal"},
        ],
        "transitions": [
            {"transition_id": "t_submit", "from": "draft", "to": "submitted",
             "action": "submit", "actor": "staff", "guards": [], "effects": []},
            {"transition_id": "t_approve", "from": "submitted", "to": "enrolled",
             "action": "approve", "actor": "staff", "guards": [], "effects": []},
        ],
    }


def _steps():
    return [{
        "step_id": "student_details", "type": "form", "title": "Student details",
        "required": True, "blocking": True, "available_in": ["draft"],
        "show_if": None, "review": None,
        "config": {"sections": [{
            "section_id": "student_section", "entity_model": "student",
            "fields": [{"name": "first_name", "required": True}],
            "mode": "create", "repeat": None,
        }]},
    }]


def _models():
    return {"base_fields": [
        {"name": "student_id", "type": "str", "required": True},
        {"name": "first_name", "type": "str", "required": True},
    ], "custom_fields": []}


def _seed_definition(fake_dc, *, definition_id, version=1, status="published",
                     lineage_status="active"):
    base = {
        "definition_id": definition_id, "name": "Enrollment", "version": version,
        "status": status, "lineage_status": lineage_status,
        "channel_access": "staff_only",
        "machine": json.dumps(_machine()), "steps": json.dumps(_steps()),
    }
    return fake_dc.dc_create(TENANT, "workflow_definition", base)["entity_id"]


def _seed_instance(fake_dc, *, definition_id, state="draft", closed_at="",
                   archived_from_state=""):
    base = {
        "instance_id": fake_dc.next_id(TENANT, "workflow_instance"),
        "definition_id": definition_id, "definition_version": 1,
        "state": state, "channel_started": "staff",
        "opened_at": "2026-08-01T00:00:00+00:00", "closed_at": closed_at,
        "token_version": 1, "archived_from_state": archived_from_state,
    }
    return fake_dc.dc_create(TENANT, "workflow_instance", base)["entity_id"]


def _ctx(fake_dc, instance_eid, actor="u1"):
    row = fake_dc.get_entity(TENANT, "workflow_instance", instance_eid)
    return machine.build_eval_context(TENANT, row, actor=actor, token=None)
```

Then the test:

```python
def test_abandoned_state_is_terminal(fake_dc):
    fake_dc.set_model(TENANT, "student", _models())
    _seed_definition(fake_dc, definition_id="wd-abandoned-terminal")
    eid = _seed_instance(fake_dc, definition_id="wd-abandoned-terminal",
                         state="abandoned", closed_at="2026-08-05T00:00:00+00:00")

    ctx = _ctx(fake_dc, eid)
    assert machine._is_terminal_state(ctx) is True
    assert machine.allowed_actions(ctx) == []


def test_abandoned_instance_refuses_transitions_and_item_builtins(client, fake_dc):
    fake_dc.set_model(TENANT, "student", _models())
    _seed_definition(fake_dc, definition_id="wd-abandoned-blocks")
    eid = _seed_instance(fake_dc, definition_id="wd-abandoned-blocks",
                         state="abandoned", closed_at="2026-08-05T00:00:00+00:00")

    for body in ({"action": "submit"},
                 {"action": "complete_item", "item_id": "wi-1"},
                 {"action": "save_draft", "section_answers": {}}):
        resp = client.post(
            f"/api/workflows/{TENANT}/instances/{eid}/actions", json=body)
        assert resp.status_code == 409, body

    row = fake_dc.get_entity(TENANT, "workflow_instance", eid)
    assert row["state"] == "abandoned"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apexflow && uv run pytest backend/tests/test_archive_lifecycle.py -v -k abandoned`
Expected: FAIL — `_is_terminal_state` returns False for `"abandoned"` (it only special-cases `"cancelled"`), so `allowed_actions` returns a non-empty list and `submit` returns 200.

- [ ] **Step 3: Write minimal implementation**

In `apexflow/backend/app/workflows/machine.py`, add the constant next to `_PINNED_STATUSES`:

```python
# Synthetic terminal states — never declared `state_id`s in an authored
# machine. `cancelled` is a deliberate staff cancellation; `abandoned` is
# force-archive fallout and is the ONLY one `restore_instance` will reverse
# (spec D3 — keeping them distinct is what makes a real cancellation
# non-restorable).
CANCELLED_STATE = "cancelled"
ABANDONED_STATE = "abandoned"
_SYNTHETIC_TERMINAL_STATES = frozenset({CANCELLED_STATE, ABANDONED_STATE})
```

Replace `_is_terminal_state`'s body:

```python
def _is_terminal_state(ctx: EvalContext) -> bool:
    """True for the synthetic `cancelled`/`abandoned` states (never declared
    `state_id`s, always terminal-legal) or any declared state whose
    `kind == "terminal"`.

    Because every progress path in this module funnels through this check,
    teaching it `abandoned` is the whole of "no more progress can be made"
    (spec R3) — item built-ins, explicit transitions, and system
    auto-advance all refuse an abandoned instance with no further change."""
    current = ctx.instance.get("state")
    if current in _SYNTHETIC_TERMINAL_STATES:
        return True
    state_def = next((s for s in ctx.definition["machine"].states if s.state_id == current), None)
    return state_def is not None and state_def.kind == "terminal"
```

Replace the two `"cancelled"` literals elsewhere in the module (`cancel_instance`'s `base["state"] = "cancelled"`, `ctx.instance["state"] = "cancelled"`, and its `_log_activity(ctx, "state_change", from_state, "cancelled")`) with `CANCELLED_STATE`.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apexflow && uv run pytest backend/tests/test_archive_lifecycle.py -v`
Expected: all passed

- [ ] **Step 5: Run the whole suite for regressions**

Run: `cd apexflow && uv run pytest backend/tests/ -v`
Expected: all passed — `run_system_transitions` must not have started refusing anything it previously allowed.

- [ ] **Step 6: Verify by mutation**

Remove `ABANDONED_STATE` from `_SYNTHETIC_TERMINAL_STATES`, re-run, confirm both new tests FAIL. Restore.

- [ ] **Step 7: Commit**

```bash
git add apexflow/backend/app/workflows/machine.py apexflow/backend/tests/test_archive_lifecycle.py
git commit -m "feat(apexflow): treat abandoned as a terminal state blocking all progress"
```

---

## Task 3: `abandon_instance` records the pre-archive state

**Files:**
- Modify: `apexflow/backend/app/workflows/machine.py`
- Test: `apexflow/backend/tests/test_archive_lifecycle.py`

**Interfaces:**
- Consumes: `machine.ABANDONED_STATE`, `_is_terminal_state` (Task 2).
- Produces: `machine.abandon_instance(ctx: EvalContext) -> dict` — writes `state="abandoned"`, `archived_from_state=<prior>`, `archived_at=<iso>`, `closed_at=<iso>`, `token_version += 1`; returns `ctx.instance`. Raises 409 if already terminal, 403 for a family actor.

- [ ] **Step 1: Write the failing test**

Append to `apexflow/backend/tests/test_archive_lifecycle.py`:

```python
def test_abandon_instance_records_prior_state_and_closes(fake_dc):
    fake_dc.set_model(TENANT, "student", _models())
    _seed_definition(fake_dc, definition_id="wd-abandon-writes")
    eid = _seed_instance(fake_dc, definition_id="wd-abandon-writes", state="submitted")

    ctx = _ctx(fake_dc, eid)
    machine.abandon_instance(ctx)

    row = fake_dc.get_entity(TENANT, "workflow_instance", eid)
    assert row["state"] == "abandoned"
    assert row["archived_from_state"] == "submitted"
    assert row["archived_at"]
    assert row["closed_at"]
    assert int(row["token_version"]) == 2

    activities = fake_dc.find("workflow_activity", instance_id=eid)
    assert activities[-1]["type"] == "state_change"
    assert activities[-1]["from_value"] == "submitted"
    assert activities[-1]["to_value"] == "abandoned"


def test_abandon_instance_refuses_an_already_terminal_instance(fake_dc):
    fake_dc.set_model(TENANT, "student", _models())
    _seed_definition(fake_dc, definition_id="wd-abandon-terminal")
    eid = _seed_instance(fake_dc, definition_id="wd-abandon-terminal",
                         state="enrolled", closed_at="2026-08-02T00:00:00+00:00")

    ctx = _ctx(fake_dc, eid)
    with pytest.raises(HTTPException) as exc:
        machine.abandon_instance(ctx)
    assert exc.value.status_code == 409

    row = fake_dc.get_entity(TENANT, "workflow_instance", eid)
    assert row["state"] == "enrolled"
    assert not row.get("archived_from_state")


def test_abandon_instance_refuses_a_family_actor(fake_dc):
    fake_dc.set_model(TENANT, "student", _models())
    _seed_definition(fake_dc, definition_id="wd-abandon-family")
    eid = _seed_instance(fake_dc, definition_id="wd-abandon-family", state="submitted")

    ctx = _ctx(fake_dc, eid, actor="family:tok")
    with pytest.raises(HTTPException) as exc:
        machine.abandon_instance(ctx)
    assert exc.value.status_code == 403
```

Add `from fastapi import HTTPException` to the file's imports.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apexflow && uv run pytest backend/tests/test_archive_lifecycle.py -v -k abandon_instance`
Expected: FAIL — `AttributeError: module 'app.workflows.machine' has no attribute 'abandon_instance'`

- [ ] **Step 3: Write minimal implementation**

In `apexflow/backend/app/workflows/machine.py`, directly below `cancel_instance`:

```python
def abandon_instance(ctx: EvalContext) -> dict:
    """Force-archive fallout: drive one open instance to the synthetic
    `abandoned` state, recording the state it held so `restore_instance` can
    put it back exactly (spec R3/R5).

    NOT routed as a staff action (spec D2/D3): abandoning a single work item
    by hand is what `cancel_instance` is for, and offering an administrator
    both would present two controls that look identical and differ only in
    whether the result can later be restored. The only caller is
    `archive_definition`'s force path, via the collaborator injected by
    `app/api/definitions.py`.

    Mirrors `cancel_instance`'s write shape exactly — including the
    `token_version` bump that revokes any outstanding magic link, since an
    abandoned instance must stop accepting family traffic immediately — and
    adds the two archive-provenance columns.
    """
    if is_family_actor(ctx.actor):
        raise HTTPException(403, "family actor may not abandon an instance")
    if _is_terminal_state(ctx):
        raise HTTPException(409, {
            "error": "instance is already terminal",
            "state": ctx.instance.get("state"),
        })

    from_state = ctx.instance.get("state")
    try:
        token_version = int(ctx.instance.get("token_version") or 1)
    except (TypeError, ValueError):
        token_version = 1

    base = entity_base_data(ctx.instance)
    base["state"] = ABANDONED_STATE
    base["archived_from_state"] = from_state
    base["archived_at"] = ctx.now.isoformat()
    base["closed_at"] = ctx.now.isoformat()
    base["token_version"] = token_version + 1
    updated = dc.dc_update(ctx.tenant_id, "workflow_instance", ctx.instance["entity_id"], base,
                           ctx.token, expected_version=engine.row_version(ctx.instance))
    ctx.instance.update({
        "state": ABANDONED_STATE,
        "archived_from_state": base["archived_from_state"],
        "archived_at": base["archived_at"],
        "closed_at": base["closed_at"],
        "token_version": base["token_version"],
    })
    if "_version" in updated:
        ctx.instance["_version"] = updated["_version"]

    _log_activity(ctx, "state_change", from_state, ABANDONED_STATE)
    return ctx.instance
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apexflow && uv run pytest backend/tests/test_archive_lifecycle.py -v`
Expected: all passed

- [ ] **Step 5: Verify by mutation**

Delete the `base["archived_from_state"] = from_state` line, re-run, confirm `test_abandon_instance_records_prior_state_and_closes` FAILS. Restore.

- [ ] **Step 6: Commit**

```bash
git add apexflow/backend/app/workflows/machine.py apexflow/backend/tests/test_archive_lifecycle.py
git commit -m "feat(apexflow): add abandon_instance recording pre-archive state"
```

---

## Task 4: `archive_definition` / `unarchive_definition`

**Files:**
- Modify: `apexflow/backend/app/workflows/definitions.py` (replace `retire_definition`)
- Modify: `apexflow/backend/app/api/definitions.py`
- Test: `apexflow/backend/tests/test_archive_lifecycle.py`, `apexflow/backend/tests/test_definitions_api.py`

**Interfaces:**
- Consumes: `is_archived` (Task 1), `machine.abandon_instance` (Task 3) via injection.
- Produces:
  - `definitions.archive_definition(tenant_id, entity_id, force=False, *, actor=None, token=None, abandon_instance_fn=None) -> dict`
  - `definitions.unarchive_definition(tenant_id, entity_id, token=None) -> dict`
  - API actions `archive` (param `force: bool`), `unarchive`, and `retire` as a one-release alias of `archive` (its legacy `force_cancel` param maps to `force`).

- [ ] **Step 1: Write the failing test**

Append to `apexflow/backend/tests/test_archive_lifecycle.py`:

```python
def _act(client, entity_id, action, **params):
    return client.post(
        f"/api/workflows/{TENANT}/definitions/{entity_id}/actions",
        json={"action": action, **params},
    )


def test_archive_refused_while_any_work_item_is_open(client, fake_dc):
    fake_dc.set_model(TENANT, "student", _models())
    eid = _seed_definition(fake_dc, definition_id="wd-gate")
    _seed_instance(fake_dc, definition_id="wd-gate", state="submitted", closed_at="")
    _seed_instance(fake_dc, definition_id="wd-gate", state="enrolled",
                   closed_at="2026-08-02T00:00:00+00:00")

    resp = _act(client, eid, "archive")
    assert resp.status_code == 409
    assert resp.json()["detail"]["open_instances"] == 1

    assert fake_dc.get_entity(TENANT, "workflow_definition", eid)["lineage_status"] == "active"


def test_archive_succeeds_once_every_work_item_is_in_an_end_state(client, fake_dc):
    """The *iff* direction of R2, asserted explicitly: with nothing open, the
    gate must not block."""
    fake_dc.set_model(TENANT, "student", _models())
    eid = _seed_definition(fake_dc, definition_id="wd-gate-open")
    _seed_instance(fake_dc, definition_id="wd-gate-open", state="enrolled",
                   closed_at="2026-08-02T00:00:00+00:00")
    _seed_instance(fake_dc, definition_id="wd-gate-open", state="cancelled",
                   closed_at="2026-08-03T00:00:00+00:00")

    resp = _act(client, eid, "archive")
    assert resp.status_code == 200
    assert fake_dc.get_entity(TENANT, "workflow_definition", eid)["lineage_status"] == "archived"


def test_force_archive_abandons_open_items_and_leaves_closed_ones_alone(client, fake_dc):
    fake_dc.set_model(TENANT, "student", _models())
    eid = _seed_definition(fake_dc, definition_id="wd-force")
    open_eid = _seed_instance(fake_dc, definition_id="wd-force", state="submitted")
    cancelled_eid = _seed_instance(fake_dc, definition_id="wd-force", state="cancelled",
                                   closed_at="2026-08-02T00:00:00+00:00")

    resp = _act(client, eid, "archive", force=True)
    assert resp.status_code == 200
    assert fake_dc.get_entity(TENANT, "workflow_definition", eid)["lineage_status"] == "archived"

    abandoned = fake_dc.get_entity(TENANT, "workflow_instance", open_eid)
    assert abandoned["state"] == "abandoned"
    assert abandoned["archived_from_state"] == "submitted"

    # A deliberate cancellation is already closed, so it is not in the open set
    # and must NOT be rewritten as archive fallout — that distinction is what
    # keeps it non-restorable.
    untouched = fake_dc.get_entity(TENANT, "workflow_instance", cancelled_eid)
    assert untouched["state"] == "cancelled"
    assert not untouched.get("archived_from_state")


def test_archived_workflow_refuses_new_work_items(client, fake_dc):
    fake_dc.set_model(TENANT, "student", _models())
    eid = _seed_definition(fake_dc, definition_id="wd-no-new")
    assert _act(client, eid, "archive").status_code == 200

    resp = client.post(
        f"/api/workflows/{TENANT}/definitions/wd-no-new/instances",
        json={"context": {}, "channel": "staff"},
    )
    assert resp.status_code == 409
    assert resp.json()["detail"]["reason"] == "lineage_not_active"


def test_unarchive_returns_lineage_to_active_and_revives_nothing(client, fake_dc):
    """R5: unarchive is a lineage-level action only. Abandoned work items stay
    abandoned until an administrator restores each one."""
    fake_dc.set_model(TENANT, "student", _models())
    eid = _seed_definition(fake_dc, definition_id="wd-unarchive")
    open_eid = _seed_instance(fake_dc, definition_id="wd-unarchive", state="submitted")
    assert _act(client, eid, "archive", force=True).status_code == 200

    resp = _act(client, eid, "unarchive")
    assert resp.status_code == 200
    assert fake_dc.get_entity(TENANT, "workflow_definition", eid)["lineage_status"] == "active"

    still_abandoned = fake_dc.get_entity(TENANT, "workflow_instance", open_eid)
    assert still_abandoned["state"] == "abandoned"
    assert still_abandoned["closed_at"]


def test_retire_action_is_accepted_as_a_legacy_alias_of_archive(client, fake_dc):
    fake_dc.set_model(TENANT, "student", _models())
    eid = _seed_definition(fake_dc, definition_id="wd-legacy-retire")
    _seed_instance(fake_dc, definition_id="wd-legacy-retire", state="submitted")

    resp = _act(client, eid, "retire", force_cancel=True)
    assert resp.status_code == 200
    assert fake_dc.get_entity(TENANT, "workflow_definition", eid)["lineage_status"] == "archived"


def test_publishing_a_new_version_keeps_the_lineage_archived(client, fake_dc):
    fake_dc.set_model(TENANT, "student", _models())
    v1 = _seed_definition(fake_dc, definition_id="wd-archived-publish", version=1)
    assert _act(client, v1, "archive").status_code == 200

    v2 = _seed_definition(fake_dc, definition_id="wd-archived-publish",
                          version=2, status="draft")
    resp = _act(client, v2, "publish")
    assert resp.status_code == 200
    assert resp.json()["base_data"]["lineage_status"] == "archived"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apexflow && uv run pytest backend/tests/test_archive_lifecycle.py -v -k "archive or retire or publishing"`
Expected: FAIL — `archive` hits `raise HTTPException(400, f"Unknown action: ...")`, returning 400 not 409/200.

- [ ] **Step 3: Write the implementation**

In `apexflow/backend/app/workflows/definitions.py`, **replace** `retire_definition` entirely with:

```python
def archive_definition(tenant_id: str, entity_id: str, force: bool = False, *,
                       actor: str | None = None, token: str | None = None,
                       abandon_instance_fn: Callable[[str, dict, str, str | None], None] | None = None,
                       ) -> dict:
    """lineage_status -> archived, gated on zero open work items.

    409 `{"open_instances": N}` when any work item is still outside an end
    state and `force` is not set (spec R2). With `force=True`, each open
    instance is abandoned via `abandon_instance_fn(tenant_id, instance_row,
    actor, token)` before the lineage flips (spec R3).

    Reversible, unlike the `retire_definition` this replaces — see
    `unarchive_definition`.

    `abandon_instance_fn` is dependency-injected by `app.api.definitions`
    rather than imported here: `machine.py` imports THIS module, so a
    `definitions.py -> machine.py` import back would close a cycle. Callers
    passing `force=True` must supply both it and a real `actor` — a
    RuntimeError, not an HTTPException, if either is missing while open
    instances exist, since that is the API layer failing to wire its
    collaborator, not a bad request. (An `assert` would strip under
    `python -O` and silently archive with the instances never abandoned.)
    """
    row = _require_published_row(tenant_id, entity_id, token, "archive")
    lineage_id = row.get("definition_id")
    open_rows = list_open_instances(tenant_id, lineage_id, token)
    if open_rows:
        if not force:
            raise HTTPException(409, {"open_instances": len(open_rows)})
        if abandon_instance_fn is None or not actor:
            raise RuntimeError(
                "archive_definition(force=True) requires both actor and abandon_instance_fn"
            )
        for instance_row in open_rows:
            abandon_instance_fn(tenant_id, instance_row, actor, token)

    base = entity_base_data(row)
    base["lineage_status"] = "archived"
    return dc.dc_update(tenant_id, "workflow_definition", entity_id, base, token)


def unarchive_definition(tenant_id: str, entity_id: str, token: str | None = None) -> dict:
    """lineage_status -> active. Inverse of `archive_definition`.

    Deliberately touches NO instances (spec R5): work items abandoned by a
    force-archive stay abandoned until an administrator restores each one via
    `machine.restore_instance`. Reviving them here would silently reopen work
    families had been told was closed.
    """
    return _set_lineage_status(tenant_id, entity_id, "active", "unarchive", token)
```

Note `_require_published_row`'s `action` argument is only used in its 409 message, so passing `"archive"` needs no other change.

In `apexflow/backend/app/api/definitions.py`, rename the collaborator and route the actions:

```python
def _abandon_one(tenant_id: str, instance_row: dict, actor: str, token: str | None) -> None:
    """`archive_definition`'s `abandon_instance_fn` collaborator — lives at the
    API layer (not in `app.workflows.definitions`) specifically to avoid a
    `definitions.py -> machine.py` import cycle; see that function's docstring."""
    ctx = machine.build_eval_context(tenant_id, instance_row, actor=actor, token=token)
    machine.abandon_instance(ctx)
```

Replace the `retire` branch in `definition_action` with:

```python
    if body.action in ("archive", "retire"):
        # `retire` is retained for one release as an alias so an unmigrated
        # caller does not break mid-deploy; its legacy `force_cancel` param
        # maps onto `force`. Remove both once no caller sends it.
        force = bool(params.get("force") or params.get("force_cancel"))
        return defs.archive_definition(
            tenant_id, entity_id, force=force,
            actor=actor, token=token, abandon_instance_fn=_abandon_one)
    if body.action == "unarchive":
        return defs.unarchive_definition(tenant_id, entity_id, token)
```

Delete the now-unused `_cancel_one`.

- [ ] **Step 4: Update the superseded tests in `test_definitions_api.py`**

The three `test_retire_*` tests assert the old terminal `retired` value. Replace their bodies' expectations: `act(client, eid, "retire")` → `act(client, eid, "archive")`, `force_cancel=True` → `force=True`, `lineage_status == "retired"` → `== "archived"`, and in the force test `state == "cancelled"` → `state == "abandoned"`. Rename each `test_retire_*` to `test_archive_*`. The legacy-alias coverage now lives in `test_archive_lifecycle.py`, so do not keep a duplicate here.

Also update the `test_lifecycle_actions_require_published_row` case (around line 272) if it names `retire` — change to `archive`.

- [ ] **Step 5: Run the whole suite**

Run: `cd apexflow && uv run pytest backend/tests/ -v`
Expected: all passed

- [ ] **Step 6: Verify by mutation**

Change `if not force:` to `if False:` in `archive_definition`, re-run, confirm `test_archive_refused_while_any_work_item_is_open` FAILS. Restore. Then delete the `for instance_row in open_rows:` loop body, re-run, confirm `test_force_archive_abandons_open_items_and_leaves_closed_ones_alone` FAILS. Restore.

- [ ] **Step 7: Commit**

```bash
git add apexflow/backend/app/workflows/definitions.py apexflow/backend/app/api/definitions.py apexflow/backend/tests/
git commit -m "feat(apexflow): replace retire with reversible archive/unarchive"
```

---

## Task 5: `restore_instance`

**Files:**
- Modify: `apexflow/backend/app/workflows/machine.py`
- Modify: `apexflow/backend/app/api/instances.py` (dispatch only — `execute_action` handles it)
- Test: `apexflow/backend/tests/test_archive_lifecycle.py`

**Interfaces:**
- Consumes: `ABANDONED_STATE` (Task 2), `defs.is_archived` + `defs.get_published_definition` (Task 1/existing).
- Produces: `machine.restore_instance(ctx: EvalContext) -> dict`, reachable as `{"action": "restore_instance"}` on the instances actions route.

- [ ] **Step 1: Write the failing test**

Append to `apexflow/backend/tests/test_archive_lifecycle.py`:

```python
def _instance_act(client, instance_eid, action, **params):
    return client.post(
        f"/api/workflows/{TENANT}/instances/{instance_eid}/actions",
        json={"action": action, **params},
    )


def test_restore_returns_the_work_item_to_its_state_before_archiving(client, fake_dc):
    fake_dc.set_model(TENANT, "student", _models())
    def_eid = _seed_definition(fake_dc, definition_id="wd-restore")
    inst_eid = _seed_instance(fake_dc, definition_id="wd-restore", state="submitted")

    assert _act(client, def_eid, "archive", force=True).status_code == 200
    assert _act(client, def_eid, "unarchive").status_code == 200

    resp = _instance_act(client, inst_eid, "restore_instance")
    assert resp.status_code == 200

    row = fake_dc.get_entity(TENANT, "workflow_instance", inst_eid)
    assert row["state"] == "submitted"
    assert not row["closed_at"]
    assert not row["archived_from_state"]

    activities = fake_dc.find("workflow_activity", instance_id=inst_eid)
    assert activities[-1]["to_value"] == "submitted"


def test_restore_is_refused_while_the_workflow_is_still_archived(client, fake_dc):
    fake_dc.set_model(TENANT, "student", _models())
    def_eid = _seed_definition(fake_dc, definition_id="wd-restore-blocked")
    inst_eid = _seed_instance(fake_dc, definition_id="wd-restore-blocked", state="submitted")
    assert _act(client, def_eid, "archive", force=True).status_code == 200

    resp = _instance_act(client, inst_eid, "restore_instance")
    assert resp.status_code == 409
    assert resp.json()["detail"]["reason"] == "lineage_archived"

    assert fake_dc.get_entity(TENANT, "workflow_instance", inst_eid)["state"] == "abandoned"


def test_restore_is_refused_on_a_cancelled_work_item(client, fake_dc):
    """Spec D3: a deliberate staff cancellation is not archive fallout and
    must not be restorable."""
    fake_dc.set_model(TENANT, "student", _models())
    _seed_definition(fake_dc, definition_id="wd-restore-cancelled")
    inst_eid = _seed_instance(fake_dc, definition_id="wd-restore-cancelled",
                              state="cancelled", closed_at="2026-08-02T00:00:00+00:00")

    resp = _instance_act(client, inst_eid, "restore_instance")
    assert resp.status_code == 409
    assert resp.json()["detail"]["reason"] == "not_abandoned"


def test_restore_is_refused_on_a_naturally_terminal_work_item(client, fake_dc):
    fake_dc.set_model(TENANT, "student", _models())
    _seed_definition(fake_dc, definition_id="wd-restore-enrolled")
    inst_eid = _seed_instance(fake_dc, definition_id="wd-restore-enrolled",
                              state="enrolled", closed_at="2026-08-02T00:00:00+00:00")

    resp = _instance_act(client, inst_eid, "restore_instance")
    assert resp.status_code == 409
    assert resp.json()["detail"]["reason"] == "not_abandoned"


def test_restore_is_refused_when_the_prior_state_is_no_longer_declared(client, fake_dc):
    fake_dc.set_model(TENANT, "student", _models())
    _seed_definition(fake_dc, definition_id="wd-restore-gone")
    inst_eid = _seed_instance(fake_dc, definition_id="wd-restore-gone",
                              state="abandoned", closed_at="2026-08-02T00:00:00+00:00",
                              archived_from_state="a_state_the_machine_never_declared")

    resp = _instance_act(client, inst_eid, "restore_instance")
    assert resp.status_code == 409
    assert resp.json()["detail"]["reason"] == "state_unavailable"


def test_restored_work_item_can_make_progress_again(client, fake_dc):
    fake_dc.set_model(TENANT, "student", _models())
    def_eid = _seed_definition(fake_dc, definition_id="wd-restore-progress")
    inst_eid = _seed_instance(fake_dc, definition_id="wd-restore-progress", state="submitted")
    assert _act(client, def_eid, "archive", force=True).status_code == 200
    assert _act(client, def_eid, "unarchive").status_code == 200
    assert _instance_act(client, inst_eid, "restore_instance").status_code == 200

    resp = _instance_act(client, inst_eid, "approve")
    assert resp.status_code == 200
    assert fake_dc.get_entity(TENANT, "workflow_instance", inst_eid)["state"] == "enrolled"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apexflow && uv run pytest backend/tests/test_archive_lifecycle.py -v -k restore`
Expected: FAIL — `restore_instance` falls through to `_run_transition_action` and 409s with an `{"allowed": [...]}` body, so `detail["reason"]` raises `KeyError`.

- [ ] **Step 3: Write the implementation**

In `apexflow/backend/app/workflows/machine.py`, below `abandon_instance`:

```python
def restore_instance(ctx: EvalContext) -> dict:
    """Staff-only: return ONE abandoned work item to the state it held before
    its workflow was force-archived (spec R5).

    Three refusals, each a 409 with a machine-readable `reason` the UI shows
    verbatim:

    - `not_abandoned` — the instance is not in the synthetic `abandoned`
      state. This is what makes a deliberate `cancel_instance` and a natural
      terminal state non-restorable, and it is the entire reason `abandoned`
      is a state of its own rather than a reuse of `cancelled` (spec D3).
    - `lineage_archived` — the workflow is still out of circulation. Restoring
      work into it would produce an instance nobody can act on, since every
      progress path is gated on the lineage being active.
    - `state_unavailable` — `archived_from_state` names a state the pinned
      machine does not declare (the definition was edited in place after the
      abandon). There is nothing coherent to restore into.

    A pinned definition version that no longer resolves never reaches here:
    `build_eval_context` raises 404 first.

    Clears `closed_at`/`archived_at`/`archived_from_state` by writing `""`,
    not `None` — `entity_base_data` drops `None` values from the full-replace
    PUT body, and `""` is already what the open-instance query treats as open.
    Bumps `token_version` so any magic link issued before the abandon stays
    dead and the reopened instance gets a fresh one.
    """
    if is_family_actor(ctx.actor):
        raise HTTPException(403, "family actor may not restore an instance")

    if ctx.instance.get("state") != ABANDONED_STATE:
        raise HTTPException(409, {
            "reason": "not_abandoned",
            "state": ctx.instance.get("state"),
        })

    lineage_id = ctx.instance.get("definition_id")
    published = defs.get_published_definition(ctx.tenant_id, lineage_id, ctx.token)
    if published is not None and defs.is_archived(published):
        raise HTTPException(409, {"reason": "lineage_archived"})

    to_state = ctx.instance.get("archived_from_state") or ""
    declared = {s.state_id for s in ctx.definition["machine"].states}
    if to_state not in declared:
        raise HTTPException(409, {
            "reason": "state_unavailable",
            "archived_from_state": to_state,
        })

    try:
        token_version = int(ctx.instance.get("token_version") or 1)
    except (TypeError, ValueError):
        token_version = 1

    base = entity_base_data(ctx.instance)
    base["state"] = to_state
    base["closed_at"] = ""
    base["archived_at"] = ""
    base["archived_from_state"] = ""
    base["token_version"] = token_version + 1
    updated = dc.dc_update(ctx.tenant_id, "workflow_instance", ctx.instance["entity_id"], base,
                           ctx.token, expected_version=engine.row_version(ctx.instance))
    ctx.instance.update({
        "state": to_state,
        "closed_at": "",
        "archived_at": "",
        "archived_from_state": "",
        "token_version": base["token_version"],
    })
    if "_version" in updated:
        ctx.instance["_version"] = updated["_version"]

    _log_activity(ctx, "state_change", ABANDONED_STATE, to_state)
    return ctx.instance
```

In `execute_action`, add the dispatch branch beside `cancel_instance`:

```python
    elif action_name == "restore_instance":
        restore_instance(ctx)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apexflow && uv run pytest backend/tests/ -v`
Expected: all passed

- [ ] **Step 5: Verify by mutation**

Change the `not_abandoned` guard to `if False:`, re-run, confirm `test_restore_is_refused_on_a_cancelled_work_item` FAILS. Restore. Then change `base["closed_at"] = ""` to `base["closed_at"] = ctx.now.isoformat()`, re-run, confirm `test_restore_returns_the_work_item_to_its_state_before_archiving` FAILS on `assert not row["closed_at"]`. Restore.

- [ ] **Step 6: Commit**

```bash
git add apexflow/backend/app/workflows/machine.py apexflow/backend/tests/test_archive_lifecycle.py
git commit -m "feat(apexflow): add restore_instance returning a work item to its pre-archive state"
```

---

## Task 6: Lineage work-item list route

**Files:**
- Modify: `apexflow/backend/app/api/instances.py`
- Test: `apexflow/backend/tests/test_instances.py`

**Interfaces:**
- Consumes: nothing new.
- Produces: `GET /api/workflows/{tenant_id}/definitions/{definition_id}/instances` → `{"instances": [...]}`. Each entry: `entity_id`, `instance_id`, `state`, `definition_version`, `channel_started`, `applicant_email`, `opened_at`, `closed_at`, `archived_from_state`.

- [ ] **Step 1: Write the failing test**

Append to `apexflow/backend/tests/test_instances.py` (reuse that file's existing fixtures and seeding helpers — do not re-declare them):

```python
def test_lineage_instance_list_returns_open_and_closed_work_items(client, fake_dc):
    """The management surface needs the WHOLE set — the pipeline board already
    covers open-only, so a list that hid closed/abandoned items would leave
    the administrator no way to reach them (spec R6)."""
    fake_dc.set_model(TENANT, "student", _valid_models()["student"])
    _seed_definition(fake_dc, definition_id="wd-list", status="published")
    _seed_instance(fake_dc, definition_id="wd-list", closed_at="")
    _seed_instance(fake_dc, definition_id="wd-list", closed_at="2026-08-02T00:00:00+00:00")
    _seed_instance(fake_dc, definition_id="wd-other-lineage", closed_at="")

    resp = client.get(f"/api/workflows/{TENANT}/definitions/wd-list/instances")
    assert resp.status_code == 200
    instances = resp.json()["instances"]
    assert len(instances) == 2
    assert {i["closed_at"] for i in instances} == {"", "2026-08-02T00:00:00+00:00"}
    assert all("archived_from_state" in i for i in instances)


def test_lineage_instance_list_tolerates_a_tenant_without_the_archive_columns(client, fake_dc):
    """A tenant whose table predates `archived_from_state` reads back rows with
    the key absent. The route must default it, never KeyError, and must never
    put it in a SQL where-clause (that would be a binder error, not an empty
    result)."""
    fake_dc.set_model(TENANT, "student", _valid_models()["student"])
    _seed_definition(fake_dc, definition_id="wd-legacy-cols", status="published")
    fake_dc.dc_create(TENANT, "workflow_instance", {
        "instance_id": "wi-legacy", "definition_id": "wd-legacy-cols",
        "definition_version": 1, "state": "draft", "channel_started": "staff",
        "opened_at": "2026-08-01T00:00:00+00:00", "closed_at": "",
    })

    resp = client.get(f"/api/workflows/{TENANT}/definitions/wd-legacy-cols/instances")
    assert resp.status_code == 200
    assert resp.json()["instances"][0]["archived_from_state"] == ""
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apexflow && uv run pytest backend/tests/test_instances.py -v -k lineage_instance_list`
Expected: FAIL — 404, the route does not exist.

- [ ] **Step 3: Write the implementation**

In `apexflow/backend/app/api/instances.py`:

```python
@router.get("/{tenant_id}/definitions/{definition_id}/instances")
def list_lineage_instances_route(tenant_id: str, definition_id: str,
                                 user: dict = Depends(require_staff_tenant)):
    """Every work item of one lineage — open AND closed, including abandoned.

    Backs AdminDash's work-item management surface (spec R6). Deliberately
    wider than the pipeline board's own query, which is open-only: an
    administrator managing a workflow needs to reach the closed and abandoned
    items too, and restore is only ever offered on an abandoned one.

    Lineage matching is done in Python rather than a SQL `where` for the same
    reason `definitions.get_published_definition` does it: on a tenant whose
    table has not materialized every column yet, a `where` predicate naming an
    unmaterialized column is a DuckDB binder error (400), not an empty result.
    `archived_from_state` is exactly such a column on any tenant predating
    this feature, so it is read with `.get(..., "")` and never filtered on
    server-side.
    """
    token = user.get("_token")
    rows = dc.list_entities(tenant_id, "workflow_instance", "", token)
    rows = [r for r in rows if str(r.get("definition_id", "")) == str(definition_id)]
    return {"instances": [{
        "entity_id": r.get("entity_id"),
        "instance_id": r.get("instance_id", ""),
        "state": r.get("state", ""),
        "definition_version": r.get("definition_version", ""),
        "channel_started": r.get("channel_started", ""),
        "applicant_email": r.get("applicant_email", ""),
        "opened_at": r.get("opened_at", ""),
        "closed_at": r.get("closed_at", "") or "",
        "archived_from_state": r.get("archived_from_state", "") or "",
    } for r in rows]}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apexflow && uv run pytest backend/tests/ -v`
Expected: all passed

- [ ] **Step 5: Verify by mutation**

Change the lineage filter to `rows = rows`, re-run, confirm the first test FAILS on `len(instances) == 2`. Restore.

- [ ] **Step 6: Commit**

```bash
git add apexflow/backend/app/api/instances.py apexflow/backend/tests/test_instances.py
git commit -m "feat(apexflow): add lineage work-item list route"
```

---

## Task 7: AdminDash backend proxy routes

**Files:**
- Modify: `admindash/backend/app/api/workflows.py`
- Test: `admindash/backend/tests/test_workflows_proxy.py`

**Interfaces:**
- Consumes: the apexflow routes from Tasks 4-6.
- Produces:
  - `POST /api/workflows/{tenant_id}/definitions/{entity_id}/actions`
  - `GET /api/workflows/{tenant_id}/definitions/{definition_id}/instances`

Both relay status/body/content-type verbatim and 502 with `"ApexFlow is unreachable"`, exactly like the existing routes. Read the file's existing `_relay` helper and route bodies first and copy their shape — do not invent a new one.

- [ ] **Step 1: Write the failing test**

Append to `admindash/backend/tests/test_workflows_proxy.py`. That file uses `respx` against `BASE = "http://localhost:5910"` with a `_stub_auth(respx)` helper — both already defined at the top of the file. Add `import json` to its imports.

```python
@respx.mock
def test_definition_action_proxies_archive_verbatim(client):
    _stub_auth(respx)
    route = respx.post(f"{BASE}/api/workflows/t1/definitions/wd-1/actions").mock(
        return_value=httpx.Response(409, json={"detail": {"open_instances": 3}})
    )
    resp = client.post(
        "/api/workflows/t1/definitions/wd-1/actions",
        json={"action": "archive", "force": False},
        headers={"Authorization": "Bearer good"},
    )
    assert resp.status_code == 409
    assert resp.json()["detail"]["open_instances"] == 3
    assert route.called
    # the body is relayed verbatim, so a future action needs no proxy change
    assert json.loads(route.calls.last.request.content) == {
        "action": "archive", "force": False,
    }
    assert route.calls.last.request.headers["authorization"] == "Bearer good"


@respx.mock
def test_lineage_instances_proxies(client):
    _stub_auth(respx)
    route = respx.get(f"{BASE}/api/workflows/t1/definitions/wd-1/instances").mock(
        return_value=httpx.Response(
            200, json={"instances": [{"entity_id": "wi-1", "state": "abandoned"}]}
        )
    )
    resp = client.get(
        "/api/workflows/t1/definitions/wd-1/instances",
        headers={"Authorization": "Bearer good"},
    )
    assert resp.status_code == 200
    assert resp.json()["instances"][0]["state"] == "abandoned"
    assert route.called
    assert route.calls.last.request.headers["authorization"] == "Bearer good"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd admindash && uv run pytest backend/tests/test_workflows_proxy.py -v -k "archive or lineage_instances"`
Expected: FAIL — 404 or 405, the routes do not exist.

- [ ] **Step 3: Write the implementation**

In `admindash/backend/app/api/workflows.py`, mirroring the existing `instance_action` route's signature and body handling exactly:

```python
@router.post("/workflows/{tenant_id}/definitions/{entity_id}/actions")
async def definition_action(
    tenant_id: str, entity_id: str, request: Request, user=Depends(require_tenant_match)
) -> Response:
    """Lineage lifecycle actions — publish / deprecate / reactivate /
    archive / unarchive. Body relayed verbatim so a new action needs no change
    here."""
    body = await request.json()
    return _relay(
        "POST", f"/api/workflows/{tenant_id}/definitions/{entity_id}/actions",
        user["_token"], json_body=body,
    )


@router.get("/workflows/{tenant_id}/definitions/{definition_id}/instances")
def lineage_instances(
    tenant_id: str, definition_id: str, user=Depends(require_tenant_match)
) -> Response:
    """Every work item of one lineage, open and closed — backs the work-item
    management table."""
    return _relay(
        "GET", f"/api/workflows/{tenant_id}/definitions/{definition_id}/instances",
        user["_token"],
    )
```

**Route-ordering check:** the existing `POST /workflows/{tenant_id}/definitions/{definition_id}/instances` (create) and the new `GET` of the same path differ by method, so they coexist. Confirm the new POST actions route does not shadow it by running the full proxy suite in Step 4.

- [ ] **Step 4: Run the suite**

Run: `cd admindash && uv run pytest backend/tests/ -v`
Expected: all passed

- [ ] **Step 5: Verify by mutation**

Change the actions route's relayed path to `.../definitions/{entity_id}/wrong`, re-run, confirm the archive proxy test FAILS. Restore.

- [ ] **Step 6: Commit**

```bash
git add admindash/backend/app/api/workflows.py admindash/backend/tests/test_workflows_proxy.py
git commit -m "feat(admindash): proxy definition actions and lineage work-item list"
```

---

## Task 8: AdminDash API client + `isArchived` + instance filtering

**Files:**
- Modify: `admindash/frontend/src/api/workflows.ts`
- Modify: `admindash/frontend/src/utils/workflowData.ts`
- Test: `admindash/frontend/src/utils/__tests__/workflowData.test.ts`

**Interfaces:**
- Produces:
  - `isArchived(lineageStatus: string): boolean`
  - `postDefinitionAction(tenantId, entityId, body: {action: string; force?: boolean}): Promise<Record<string, unknown>>`
  - `listLineageInstances(tenantId, definitionId): Promise<{instances: LineageInstance[]}>`
  - `interface LineageInstance { entity_id, instance_id, state, definition_version, channel_started, applicant_email, opened_at, closed_at, archived_from_state }` — all `string` except `definition_version: number`.
  - `filterInstances(rows: LineageInstance[], f: InstanceFilter): LineageInstance[]`, `interface InstanceFilter { state?: string; openness?: 'all' | 'open' | 'closed' | 'abandoned' }`

- [ ] **Step 1: Write the failing test**

Append to `admindash/frontend/src/utils/__tests__/workflowData.test.ts`:

```ts
import { filterInstances, type LineageInstance } from '../workflowData.ts';

const row = (over: Partial<LineageInstance>): LineageInstance => ({
  entity_id: 'wi-1', instance_id: 'WI-1', state: 'draft', definition_version: 1,
  channel_started: 'staff', applicant_email: '', opened_at: '', closed_at: '',
  archived_from_state: '', ...over,
});

describe('filterInstances', () => {
  const rows = [
    row({ entity_id: 'open', state: 'submitted', closed_at: '' }),
    row({ entity_id: 'closed', state: 'enrolled', closed_at: '2026-08-02T00:00:00Z' }),
    row({ entity_id: 'gone', state: 'abandoned', closed_at: '2026-08-02T00:00:00Z',
          archived_from_state: 'submitted' }),
  ];

  it('returns everything by default', () => {
    expect(filterInstances(rows, {})).toHaveLength(3);
  });

  it('open means no closed_at', () => {
    expect(filterInstances(rows, { openness: 'open' }).map((r) => r.entity_id))
      .toEqual(['open']);
  });

  it('closed includes abandoned items', () => {
    expect(filterInstances(rows, { openness: 'closed' }).map((r) => r.entity_id))
      .toEqual(['closed', 'gone']);
  });

  it('abandoned narrows to the archive fallout only', () => {
    expect(filterInstances(rows, { openness: 'abandoned' }).map((r) => r.entity_id))
      .toEqual(['gone']);
  });

  it('state filter composes with openness', () => {
    expect(filterInstances(rows, { state: 'enrolled', openness: 'closed' })
      .map((r) => r.entity_id)).toEqual(['closed']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd admindash/frontend && npx vitest run src/utils/__tests__/workflowData.test.ts`
Expected: FAIL — `filterInstances` is not exported.

- [ ] **Step 3: Write the implementation**

In `admindash/frontend/src/utils/workflowData.ts`:

```ts
/** One `workflow_instance` as the lineage work-item list route returns it.
 * Every scalar arrives as a string off DataCore's flattened rows except
 * `definition_version`, which the API client coerces with `asNumber`. */
export interface LineageInstance {
  entity_id: string;
  instance_id: string;
  state: string;
  definition_version: number;
  channel_started: string;
  applicant_email: string;
  opened_at: string;
  closed_at: string;
  archived_from_state: string;
}

export interface InstanceFilter {
  state?: string;
  openness?: 'all' | 'open' | 'closed' | 'abandoned';
}

/** Client-side because the server cannot filter on `archived_from_state`: a
 * DataCore `where` naming a column a tenant's table has not materialized is a
 * binder error, not an empty result. Same reason the pipeline board's own
 * grouping happens here rather than in SQL. */
export function filterInstances(
  rows: LineageInstance[],
  { state, openness = 'all' }: InstanceFilter,
): LineageInstance[] {
  return rows.filter((r) => {
    if (state && r.state !== state) return false;
    if (openness === 'open') return !r.closed_at;
    if (openness === 'closed') return Boolean(r.closed_at);
    if (openness === 'abandoned') return r.state === 'abandoned';
    return true;
  });
}
```

In `admindash/frontend/src/api/workflows.ts`:

```ts
/** `retired` is the pre-archive name for the same lineage state; rows written
 * under it are never migrated. One definition, mirroring the backend's
 * `definitions.is_archived` — never string-compare either value inline. */
export function isArchived(lineageStatus: string): boolean {
  return lineageStatus === 'archived' || lineageStatus === 'retired';
}

/** POST /api/workflows/{tenant_id}/definitions/{entity_id}/actions.
 * A blocked archive comes back 409 with `detail.open_instances` — callers
 * catch `WorkflowApiError` and read that off `.body`. */
export async function postDefinitionAction(
  tenantId: string,
  entityId: string,
  body: { action: string; force?: boolean },
): Promise<Record<string, unknown>> {
  const resp = await fetch(
    `${API_BASE}/api/workflows/${tenantId}/definitions/${entityId}/actions`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify(body),
    },
  );
  return parseOrThrow(resp);
}

/** GET /api/workflows/{tenant_id}/definitions/{definition_id}/instances —
 * every work item of the lineage, open and closed. */
export async function listLineageInstances(
  tenantId: string,
  definitionId: string,
): Promise<{ instances: LineageInstance[] }> {
  const resp = await fetch(
    `${API_BASE}/api/workflows/${tenantId}/definitions/${definitionId}/instances`,
    { headers: authHeaders() },
  );
  const data = await parseOrThrow<{ instances: LineageInstance[] }>(resp);
  return {
    instances: data.instances.map((i) => ({
      ...i,
      definition_version: asNumber(i.definition_version),
    })),
  };
}
```

Add `import type { LineageInstance } from '../utils/workflowData.ts';` and re-export it: `export type { LineageInstance };`

- [ ] **Step 4: Run test to verify it passes**

Run: `cd admindash/frontend && npx vitest run src/utils/__tests__/workflowData.test.ts && npm run build`
Expected: tests pass, build clean

- [ ] **Step 5: Verify by mutation**

Change `openness === 'abandoned'` to compare `r.state === 'cancelled'`, re-run, confirm the abandoned test FAILS. Restore.

- [ ] **Step 6: Commit**

```bash
git add admindash/frontend/src/api/workflows.ts admindash/frontend/src/utils/
git commit -m "feat(admindash): add archive API client, isArchived, and work-item filtering"
```

---

## Task 9: Archive/unarchive controls on WorkflowsPage

**Files:**
- Create: `admindash/frontend/src/components/ArchiveWorkflowModal.tsx`, `.css`
- Modify: `admindash/frontend/src/pages/WorkflowsPage.tsx`
- Modify: `admindash/frontend/src/i18n/translations.ts`

**Interfaces:**
- Consumes: `postDefinitionAction`, `isArchived` (Task 8).
- Produces: `<ArchiveWorkflowModal open onClose onArchived tenant entityId workflowName />`.

- [ ] **Step 1: Add the i18n keys, both locales**

In `admindash/frontend/src/i18n/translations.ts`, add to `en-US`:

```ts
    'workflows.showArchived': 'Show archived',
    'workflows.archive': 'Archive',
    'workflows.unarchive': 'Unarchive',
    'workflows.archived': 'Archived',
    'workflows.archiveTitle': 'Archive this workflow?',
    'workflows.archiveBody': 'An archived workflow cannot be used to start new work items. You can unarchive it later.',
    'workflows.archiveBlocked': 'This workflow still has {count} work item(s) that are not finished.',
    'workflows.archiveForce': 'Archive anyway and abandon them',
    'workflows.archiveForceWarning': 'Abandoned work items stop immediately and make no further progress. After unarchiving, an administrator must restore each one individually.',
    'workflows.archiveFailed': 'Could not archive this workflow. Please try again.',
    'workflows.unarchiveFailed': 'Could not unarchive this workflow. Please try again.',
    'workflows.archivedToast': 'Workflow archived.',
    'workflows.unarchivedToast': 'Workflow unarchived. Abandoned work items were not restored.',
```

Add the same keys to `zh-CN` with translated values:

```ts
    'workflows.showArchived': '显示已归档',
    'workflows.archive': '归档',
    'workflows.unarchive': '取消归档',
    'workflows.archived': '已归档',
    'workflows.archiveTitle': '归档此工作流？',
    'workflows.archiveBody': '已归档的工作流无法用于创建新的工作项。您之后可以取消归档。',
    'workflows.archiveBlocked': '此工作流仍有 {count} 个未完成的工作项。',
    'workflows.archiveForce': '仍然归档并放弃这些工作项',
    'workflows.archiveForceWarning': '被放弃的工作项将立即停止，无法继续推进。取消归档后，管理员须逐个恢复。',
    'workflows.archiveFailed': '无法归档此工作流，请重试。',
    'workflows.unarchiveFailed': '无法取消归档此工作流，请重试。',
    'workflows.archivedToast': '工作流已归档。',
    'workflows.unarchivedToast': '工作流已取消归档。被放弃的工作项未被恢复。',
```

- [ ] **Step 2: Build the modal**

Create `admindash/frontend/src/components/ArchiveWorkflowModal.tsx`. Use `components/ui/Modal.tsx` — never a bespoke overlay — and `components/ui/Button.tsx`.

Behaviour, in order:
1. On open, POST `{action: 'archive', force: false}`.
2. On 200: call `onArchived()`, toast `workflows.archivedToast`, close.
3. On `WorkflowApiError` with `status === 409` and a numeric `body.detail.open_instances`: switch the modal to the blocked view showing `workflows.archiveBlocked` (interpolate the count), `workflows.archiveForceWarning`, and a `danger`-variant `workflows.archiveForce` button that re-POSTs with `force: true`. Force is **never** the default action and never the autofocused control.
4. Any other error: show `workflows.archiveFailed`, keep the modal open.

Read `admindash/frontend/src/components/DuplicateWarningModal.tsx` first and match its structure — it is the closest existing two-stage confirm.

- [ ] **Step 3: Wire WorkflowsPage**

In `admindash/frontend/src/pages/WorkflowsPage.tsx`:

- Add `const [showArchived, setShowArchived] = useState(false);`
- Filter before paging: `const visible = useMemo(() => definitions.filter((d) => showArchived || !isArchived(d.lineage_status)), [definitions, showArchived]);` — then page over `visible`, and use `visible.length` for both the header count and `DataTable`'s `total`. Reset `page` to 1 when `showArchived` changes, or a filtered-down list can strand the user on an empty page.
- Add a labelled checkbox for `workflows.showArchived` in the page header. It needs a bound `<label htmlFor>`/`id` pair.
- Add `rowActions` to `DataTable`: Archive when `!isArchived(row.lineage_status)`, Unarchive when it is. Unarchive POSTs `{action: 'unarchive'}` directly (no gate, nothing destructive), toasts `workflows.unarchivedToast` — whose wording must state that abandoned work items were not restored — and reloads.
- Both actions act on `row.entity_id` (the published row), not `row.definition_id`. Only rows with `status === 'published'` get lifecycle actions, matching the backend's `_require_published_row`.

- [ ] **Step 4: Verify build and lint**

Run: `cd admindash/frontend && npm run build && npm run lint`
Expected: both clean

- [ ] **Step 5: Verify in the running app**

Start the services, open `http://localhost:5600/workflows`, and confirm by hand:
- a workflow with an open work item shows the blocked view with a real count, and force-archive is a secondary, clearly-warned choice
- an archived workflow disappears from the list until "Show archived" is checked
- unarchive returns it, and its toast says abandoned work items were not restored

- [ ] **Step 6: Commit**

```bash
git add admindash/frontend/src/
git commit -m "feat(admindash): archive/unarchive controls on the workflows list"
```

---

## Task 10: Work-item management table

**Files:**
- Create: `admindash/frontend/src/pages/WorkflowItemsTable.tsx`, `.css`
- Modify: `admindash/frontend/src/pages/WorkflowPipelinePage.tsx`
- Modify: `admindash/frontend/src/i18n/translations.ts`

**Interfaces:**
- Consumes: `listLineageInstances`, `filterInstances`, `postInstanceAction` (Tasks 6/8).
- Produces: `<WorkflowItemsTable tenant definitionId states />` where `states: MachineStateDef[]` supplies the state filter's options.

- [ ] **Step 1: Add the i18n keys, both locales**

`en-US`:

```ts
    'workflows.itemsTab': 'Work items',
    'workflows.boardTab': 'Pipeline',
    'workflows.itemsEmpty': 'No work items yet',
    'workflows.filterState': 'State',
    'workflows.filterOpenness': 'Show',
    'workflows.filterAll': 'All',
    'workflows.filterOpen': 'Open',
    'workflows.filterClosed': 'Closed',
    'workflows.filterAbandoned': 'Abandoned',
    'workflows.restore': 'Restore',
    'workflows.restoreTo': 'Restore to {state}',
    'workflows.restored': 'Work item restored.',
    'workflows.restoreFailedLineageArchived': 'Unarchive the workflow before restoring its work items.',
    'workflows.restoreFailedNotAbandoned': 'Only abandoned work items can be restored.',
    'workflows.restoreFailedStateUnavailable': "This work item's previous state no longer exists in the workflow.",
    'workflows.restoreFailed': 'Could not restore this work item. Please try again.',
    'workflows.bulkRestore': 'Restore selected',
    'workflows.bulkCancel': 'Cancel selected',
    'workflows.bulkPartial': '{ok} of {total} succeeded. {failed} failed.',
```

`zh-CN`:

```ts
    'workflows.itemsTab': '工作项',
    'workflows.boardTab': '流程看板',
    'workflows.itemsEmpty': '暂无工作项',
    'workflows.filterState': '状态',
    'workflows.filterOpenness': '显示',
    'workflows.filterAll': '全部',
    'workflows.filterOpen': '进行中',
    'workflows.filterClosed': '已结束',
    'workflows.filterAbandoned': '已放弃',
    'workflows.restore': '恢复',
    'workflows.restoreTo': '恢复到{state}',
    'workflows.restored': '工作项已恢复。',
    'workflows.restoreFailedLineageArchived': '请先取消归档该工作流，然后再恢复其工作项。',
    'workflows.restoreFailedNotAbandoned': '只有被放弃的工作项才能恢复。',
    'workflows.restoreFailedStateUnavailable': '该工作项之前的状态在工作流中已不存在。',
    'workflows.restoreFailed': '无法恢复此工作项，请重试。',
    'workflows.bulkRestore': '恢复所选',
    'workflows.bulkCancel': '取消所选',
    'workflows.bulkPartial': '{total} 项中 {ok} 项成功，{failed} 项失败。',
```

- [ ] **Step 2: Build the table**

Create `admindash/frontend/src/pages/WorkflowItemsTable.tsx` using `components/DataTable.tsx`.

- Columns: instance id (`primary: true`), state (`StatusBadge`), opened, closed, applicant email, channel, definition version.
- Filters above the table: a state `<select>` populated from `states`, and an openness `<select>` (`all`/`open`/`closed`/`abandoned`). Both need bound labels. Filtering runs through `filterInstances` — never a refetch.
- Row actions: Restore, shown **only** when `row.state === 'abandoned'`, labelled with `workflows.restoreTo` interpolating `row.archived_from_state` so the administrator sees where it lands before clicking. Cancel, shown only when `!row.closed_at`.
- Restore POSTs `{action: 'restore_instance'}` via `postInstanceAction`. On `WorkflowApiError` 409, map `body.detail.reason` to its specific message key (`lineage_archived` / `not_abandoned` / `state_unavailable`), falling back to `workflows.restoreFailed`. Showing the raw reason string would leak wire vocabulary into the UI.
- `selectable` with bulk Restore / bulk Cancel. Run the requests sequentially and **count outcomes rather than aborting**: one work item whose prior state no longer exists must not stop the other forty. Report with `workflows.bulkPartial`, and reload once at the end.

- [ ] **Step 3: Add the tab to the pipeline page**

In `WorkflowPipelinePage.tsx`, add a two-tab switch (`workflows.boardTab` / `workflows.itemsTab`) above the existing board. The board is unchanged and stays the default — it answers "what needs attention", the table answers "manage everything". Tabs are `<button>`s with `aria-selected`, not `<div onClick>`.

- [ ] **Step 4: Verify build and lint**

Run: `cd admindash/frontend && npm run build && npm run lint`
Expected: both clean

- [ ] **Step 5: Verify in the running app**

At `http://localhost:5600/workflows/<definitionId>`, confirm: abandoned items appear under the Abandoned filter; Restore names the target state; restoring while the workflow is still archived shows the specific "unarchive first" message, not a generic failure; a bulk restore with one bad item reports a partial count rather than failing wholesale.

- [ ] **Step 6: Commit**

```bash
git add admindash/frontend/src/
git commit -m "feat(admindash): add work-item management table with restore and bulk actions"
```

---

## Task 11: Rewire the ApexFlow designer + confirm FamilyHub

**Files:**
- Modify: `apexflow/frontend/src/types/designer.ts`, `api/designer.ts`, `pages/DefinitionsPage.tsx`
- Test: `familyhub/backend/tests/test_workflow_routes.py`

**Interfaces:**
- Consumes: the API actions from Task 4.
- Produces: `isArchived(status: LineageStatus): boolean` in `apexflow/frontend/src/types/designer.ts`.

Without this task the designer still calls `retire` and renders a control the school-ops surface contradicts. The alias keeps it working, but the two surfaces would disagree about what the state is called.

- [ ] **Step 1: Confirm FamilyHub needs no code change**

Add to `familyhub/backend/tests/test_workflow_routes.py`, using that file's existing `BUNDLE`, `TENANT`, `DEFINITION_ID` constants and its `fake_http.add(...)` / `FakeResponse` helpers:

```python
def test_workflow_bundle_relays_archived_lineage_status(client, fake_http):
    """FamilyHub needs no code change for archive: RegisterPage already renders
    the closed state for any lineage_status != 'active'. Asserted rather than
    assumed."""
    fake_http.add("GET", f"/internal/workflows/{TENANT}/{DEFINITION_ID}/config",
                  FakeResponse(200, {**BUNDLE, "lineage_status": "archived"}))

    resp = client.get(f"/api/workflows/{TENANT}/{DEFINITION_ID}")

    assert resp.status_code == 200
    assert resp.json()["lineage_status"] == "archived"
```

Run: `cd familyhub && uv run pytest backend/tests/test_workflow_routes.py -v`
Expected: PASS immediately — this is a characterization test, not a driver.

- [ ] **Step 2: Add `LineageStatus` and the helper**

In `apexflow/frontend/src/types/designer.ts`, add `'archived'` to the `LineageStatus` union (keep `'retired'` — legacy rows still return it) and add:

```ts
/** Mirrors the backend's `definitions.is_archived`. `retired` is the
 * pre-archive name for the same state and is never migrated, so both values
 * must read as archived — one definition, never an inline comparison. */
export function isArchived(status: LineageStatus): boolean {
  return status === 'archived' || status === 'retired';
}
```

- [ ] **Step 3: Rewire DefinitionsPage**

In `apexflow/frontend/src/pages/DefinitionsPage.tsx`:
- Replace all three `lineage_status !== 'retired'` / `=== 'retired'` comparisons (around lines 475, 486, 504, plus the new-draft gate commented at lines 21-24) with `isArchived(row.lineage_status)`.
- The Retire button becomes Archive, posting `{action: 'archive', force}`; add an Unarchive button shown when `isArchived(...)`, posting `{action: 'unarchive'}`.
- Update `badgeLabel('lineageStatus', ...)` so `archived` has a label; leave the `retired` label in place for legacy rows.
- The new-draft gate at lines 21-24 currently hides "new version" for retired lineages because a fresh draft copies `lineage_status` forward. That reasoning still holds for `archived`, and routing it through `isArchived` preserves it — update the comment to say archived.

- [ ] **Step 4: Verify build and lint**

Run: `cd apexflow/frontend && npm run build && npm run lint`
Expected: both clean

- [ ] **Step 5: Verify by mutation**

Make `isArchived` return `status === 'archived'` only, load a lineage with a legacy `retired` row, confirm the Unarchive button wrongly disappears. Restore.

- [ ] **Step 6: Commit**

```bash
git add apexflow/frontend/src/ familyhub/backend/tests/test_workflow_routes.py
git commit -m "feat(apexflow): rewire designer lifecycle controls to archive/unarchive"
```

---

## Task 12: Documentation

**Files:**
- Modify: `CLAUDE.md` (root), `admindash/CLAUDE.md`

- [ ] **Step 1: Update the root CLAUDE.md**

In the **apexflow** bullet under Project Overview, note that lineage lifecycle is `active | deprecated | archived` with `retired` as a legacy alias, and that archive is gated on open work items with a force path that abandons them.

In the **admindash** bullet, note that the Workflows area now includes archive/unarchive and a work-item management table alongside the pipeline board.

- [ ] **Step 2: Update admindash/CLAUDE.md**

In the API endpoints paragraph, add the two new proxied routes: `POST /api/workflows/{tenant_id}/definitions/{entity_id}/actions` and `GET /api/workflows/{tenant_id}/definitions/{definition_id}/instances`.

Also fix a stale line while you are in the file: under Commands → Frontend it says "No test framework is configured for the frontend." That is no longer true — `package.json` defines `test: vitest run` and `src/utils/__tests__/` already holds suites, which Tasks 8 and 10 extend. Replace it with the `npm test` command.

- [ ] **Step 3: Run every suite one final time**

```bash
cd apexflow && uv run pytest backend/tests/ -v
cd ../admindash && uv run pytest backend/tests/ -v
cd frontend && npm run build && npm run lint
cd ../../apexflow/frontend && npm run build && npm run lint
cd ../../familyhub && uv run pytest backend/tests/ -v
```

Expected: all green. Paste the actual summary lines into the final report — do not claim green without the output.

- [ ] **Step 4: Commit**

```bash
git add CLAUDE.md admindash/CLAUDE.md
git commit -m "docs: record the workflow archive lifecycle"
```

---

## Self-Review

**Spec coverage:**

| Spec requirement | Task |
|---|---|
| R1 archive, unavailable for use | 4 (`archive_definition`; `create_instance`'s existing gate proven by `test_archived_workflow_refuses_new_work_items`), 9 (hidden from list) |
| R2 gated on all work items in an end state | 4 (both directions) |
| R3 force archive abandons, no further progress | 2 (blocking), 3 (writing), 4 (bulk path) |
| R4 unarchive | 4, 9, 11 |
| R5 no auto-revive; per-item restore to prior state | 4 (`test_unarchive_..._revives_nothing`), 5 (`restore_instance`) |
| R6 manage all work items | 6 (route), 7 (proxy), 8 (filtering), 10 (UI) |
| D1 `archived` + `retired` alias | 1, 4, 8, 11 |
| D2 AdminDash primary, ApexFlow rewired | 9, 10, 11 |
| D3 `abandoned` distinct from `cancelled` | 2, 3, 5 |
| Error-handling table | 4 (gate 409, published-row 409), 2 (terminal 409), 5 (three reasons) |
| Testing section | every task's mutation step; Task 12 final run |

**Type consistency checked:** `is_archived` (Python) / `isArchived` (both frontends); `abandon_instance_fn` named identically in `archive_definition`'s signature and the `_abandon_one` injection site; `LineageInstance` fields identical between the Task 6 route response, the Task 8 interface, and the Task 10 columns; `force` is the parameter name everywhere, with `force_cancel` accepted only in the legacy-alias branch.

**No placeholders:** the only deliberate "match the existing fixture" instructions are in Task 7 Step 1 and Task 11 Step 1, both of which name the file to read and say explicitly that the shown names stand in for whatever that file already uses.
