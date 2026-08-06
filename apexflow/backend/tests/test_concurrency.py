# apexflow/backend/tests/test_concurrency.py
"""Concurrency tests (Plan 3 Task 2): the CAS `expected_version` precondition
on every write that round-trips a previously-read `workflow_instance`/
`workflow_item` row.

Task 1 (merged, `61e4de8`) added an opt-in `?expected_version=N` query param
to DataCore's `PUT /api/entities/{tenant_id}/{entity_type}/{entity_id}`,
409ing `{"error": "version_conflict", "expected": N, "actual": M}` on
mismatch (`datacore/src/datacore/store.py::VersionConflictError`, checked
before any mutation). This task wires apexflow's workflow engine to pass
that precondition on every instance/item round-trip write, and to surface a
conflict as `HTTPException(409, {"error": "conflict", "entity_type": ...,
"entity_id": ...})` — the shape both the actions route and the internal
(family-token) route already let propagate as-is.

Fixture pattern (auth override, seeding helpers) copied from
test_actions_api.py / test_machine.py, per task-2-brief.md's
`# ADJUST(bindings)` note — there is no `client_with_staff` fixture in this
suite; `client` (locally defined, auth-overridden) is the actual pattern
every other route-level test file uses.
"""
import json

import pytest
from fastapi.testclient import TestClient

from app.auth import require_authenticated_user
from app.main import app
from app.workflows import datacore as dc
from app.workflows import engine, machine

TENANT = "acme"


@pytest.fixture
def client(fake_dc):
    app.dependency_overrides[require_authenticated_user] = lambda: {
        "user_id": "u1", "tenant_id": TENANT, "role": "admin", "_token": "Bearer test-token",
    }
    yield TestClient(app)
    app.dependency_overrides.clear()


# --- fixture builders --------------------------------------------------


def _machine():
    return {
        "states": [
            {"state_id": "draft", "name": "Draft", "kind": "initial"},
            {"state_id": "approved", "name": "Approved", "kind": "terminal"},
        ],
        "transitions": [
            {"transition_id": "t_approve", "from": "draft", "to": "approved", "action": "approve",
             "actor": "staff", "guards": [], "effects": []},
        ],
    }


def _set_context_machine():
    """A transition whose effects write the instance row (`set_context`)
    BEFORE the state write also writes it — the intra-transition sequencing
    hazard fixture task-2-brief.md's mandated test needs: the state write
    must use the version `set_context`'s own write left behind, not the
    stale version from context-assembly time, or this 409s on the engine's
    own sequential writes."""
    return {
        "states": [
            {"state_id": "draft", "name": "Draft", "kind": "initial"},
            {"state_id": "approved", "name": "Approved", "kind": "terminal"},
        ],
        "transitions": [
            {"transition_id": "t_approve", "from": "draft", "to": "approved", "action": "approve",
             "actor": "staff", "guards": [],
             "effects": [{"primitive": "set_context", "params": {"key": "note", "value": "seen"}}]},
        ],
    }


def _form_steps():
    return [
        {
            "step_id": "form_step", "type": "form", "title": "Form", "required": True,
            "blocking": True, "available_in": ["draft"], "show_if": None, "review": "staff",
            "config": {"sections": [{
                "section_id": "s1", "entity_model": "student", "mode": "create",
                "fields": [{"name": "first_name", "required": False}], "repeat": None,
            }]},
        }
    ]


def _seed_definition(fake_dc, *, definition_id, machine_def=None, steps=None):
    fake_dc.set_model(TENANT, "student", {
        "base_fields": [{"name": "student_id", "type": "str", "required": True},
                        {"name": "first_name", "type": "str", "required": False}],
        "custom_fields": [],
    })
    base = {
        "definition_id": definition_id,
        "name": "Concurrency fixture",
        "version": 1,
        "status": "published",
        "lineage_status": "active",
        "channel_access": "staff_only",
        "machine": json.dumps(machine_def if machine_def is not None else _machine()),
        "steps": json.dumps(steps if steps is not None else []),
    }
    created = fake_dc.dc_create(TENANT, "workflow_definition", base)
    return created["entity_id"]


def _create_instance(fake_dc, definition_id):
    result = engine.create_instance(TENANT, definition_id, {}, "staff")
    return result["instance"]["entity_id"], result["items"]


def act(client, instance_entity_id, action, **params):
    return client.post(
        f"/api/workflows/{TENANT}/instances/{instance_entity_id}/actions",
        json={"action": action, **params},
    )


# --- unit: the real dc_update client appends/omits the query param ---------


def test_dc_update_passes_expected_version_as_query_param(monkeypatch):
    """Unit: the real dc_update appends ?expected_version=N."""
    captured = {}

    def fake_request(method, url, **kwargs):
        captured["url"] = url

        class R:
            status_code = 200

            @staticmethod
            def json():
                return {}
        return R()

    monkeypatch.setattr("app.workflows.datacore.httpx.request", fake_request)
    dc.dc_update("t1", "workflow_instance", "e1", {"state": "draft"}, expected_version=4)
    assert "expected_version=4" in captured["url"]


def test_dc_update_omits_query_param_when_expected_version_none(monkeypatch):
    captured = {}

    def fake_request(method, url, **kwargs):
        captured["url"] = url

        class R:
            status_code = 200

            @staticmethod
            def json():
                return {}
        return R()

    monkeypatch.setattr("app.workflows.datacore.httpx.request", fake_request)
    dc.dc_update("t1", "workflow_instance", "e1", {"state": "draft"})
    assert "expected_version" not in captured["url"]


def test_dc_update_translates_409_to_conflict_shape(monkeypatch):
    """The client-level 409 -> HTTPException translation, independent of
    FakeDataCore (which stands in for the whole function in other tests)."""
    def fake_request(method, url, **kwargs):
        class R:
            status_code = 409
            text = "version conflict"
        return R()

    monkeypatch.setattr("app.workflows.datacore.httpx.request", fake_request)
    with pytest.raises(Exception) as exc_info:
        dc.dc_update("t1", "workflow_instance", "e1", {"state": "draft"}, expected_version=1)
    assert exc_info.value.status_code == 409
    assert exc_info.value.detail == {
        "error": "conflict", "entity_type": "workflow_instance", "entity_id": "e1",
    }


# --- state-write / item-write conflict propagates 409 ----------------------
#
# # ADJUST(bindings): the brief's own test skeleton force-bumps the row's
# version BEFORE issuing the HTTP request. That does not actually construct
# a race against `app/api/instances.py::instance_action_route` as it exists
# on this branch: the route does ONE synchronous `dc.get_entity` fetch
# immediately before dispatching to `machine.execute_action`, so a bump that
# happens strictly before the request is already reflected in that fetch —
# the row read is never stale, and the subsequent write's
# `expected_version` matches the (already-bumped) current version, so it
# succeeds instead of 409ing (confirmed: run against the brief's literal
# arrangement first, got 200, not 409). A genuine race needs the bump to
# land in the WINDOW between this reader's read and this reader's write —
# which, for a same-process synchronous test, means intercepting the seam
# between them. Both tests below do that by wrapping the exact function
# whose return value becomes the row `dc.dc_update` is preconditioned
# against (`machine.build_eval_context` for the instance row,
# `engine._require_item` for the item row): call through to get the real
# row, THEN force-bump the row's version (simulating another writer's
# commit landing right after this reader's read), THEN return the
# now-stale row to the caller exactly as it would have read it. This is
# the same effect the brief's `force_bump_version`-before-request framing
# was going for, adapted to where the actual race window is in this route.


def test_state_write_conflict_propagates_409(fake_dc, client, monkeypatch):
    """A stale instance row loses the race: execute_action surfaces 409
    conflict."""
    _seed_definition(fake_dc, definition_id="wd-conc-1")
    instance_eid, _ = _create_instance(fake_dc, "wd-conc-1")

    original_build_eval_context = machine.build_eval_context

    def racing_build_eval_context(*args, **kwargs):
        ctx = original_build_eval_context(*args, **kwargs)
        fake_dc.force_bump_version(TENANT, "workflow_instance", instance_eid)
        return ctx

    monkeypatch.setattr(machine, "build_eval_context", racing_build_eval_context)

    resp = act(client, instance_eid, "approve")
    assert resp.status_code == 409
    assert resp.json()["detail"]["error"] == "conflict"


def test_item_write_conflict_propagates_409(fake_dc, client, monkeypatch):
    """Same shape via complete_item with a force-bumped workflow_item row."""
    _seed_definition(fake_dc, definition_id="wd-conc-2", steps=_form_steps())
    instance_eid, items = _create_instance(fake_dc, "wd-conc-2")
    item_eid = items[0]["entity_id"]

    original_require_item = engine._require_item

    def racing_require_item(*args, **kwargs):
        item = original_require_item(*args, **kwargs)
        fake_dc.force_bump_version(TENANT, "workflow_item", item_eid)
        return item

    monkeypatch.setattr(engine, "_require_item", racing_require_item)

    resp = act(client, instance_eid, "complete_item", item_id=item_eid)
    assert resp.status_code == 409
    assert resp.json()["detail"]["error"] == "conflict"


# --- happy path: an unmodified row still writes successfully ---------------


def test_normal_transition_still_succeeds_with_no_race(fake_dc, client):
    _seed_definition(fake_dc, definition_id="wd-conc-3")
    instance_eid, _ = _create_instance(fake_dc, "wd-conc-3")

    resp = act(client, instance_eid, "approve")
    assert resp.status_code == 200
    assert resp.json()["instance"]["state"] == "approved"


# --- intra-transition sequencing hazard (mandated test) --------------------


def test_effect_write_then_state_write_same_transition_no_false_409(fake_dc):
    """A transition whose effects include set_context (writes the instance
    row) followed by the state write (also writes the instance row) must
    succeed with no false 409 from the engine's own sequential writes."""
    _seed_definition(fake_dc, definition_id="wd-conc-4", machine_def=_set_context_machine())
    created = engine.create_instance(TENANT, "wd-conc-4", {}, "staff")["instance"]
    instance_row = fake_dc.get_entity(TENANT, "workflow_instance", created["entity_id"])

    ctx = machine.build_eval_context(TENANT, instance_row, actor="staff-u1")
    updated = machine.execute_action(ctx, "approve", {})

    assert updated["state"] == "approved"
    persisted = fake_dc.get_entity(TENANT, "workflow_instance", instance_row["entity_id"])
    assert persisted["state"] == "approved"
    assert json.loads(persisted["context"])["note"] == "seen"
