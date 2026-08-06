"""Route-level tests for the actions API (Task 8): `POST
/api/workflows/{tenant_id}/instances/{instance_entity_id}/actions`.

Written first per TDD: the route does not exist on `app.api.instances` yet
at the time these were drafted. Auth pattern follows
test_definitions_api.py/test_instances.py: override
`require_authenticated_user` at the app level rather than minting a real JWT.
Unit-level machine-execution coverage (guard branching, actor gating, auto-
advance, cancel, effect failures) lives in test_machine.py — this file only
exercises the HTTP wiring: request/response shape, 404 for an unknown
instance, and that `execute_action`'s exceptions propagate as the expected
status codes through the route.
"""
import json

import pytest
from fastapi.testclient import TestClient

from app.auth import require_authenticated_user
from app.main import app
from app.workflows import engine

TENANT = "acme"


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
            {"state_id": "approved", "name": "Approved", "kind": "terminal"},
        ],
        "transitions": [
            {"transition_id": "t_approve", "from": "draft", "to": "approved", "action": "approve",
             "actor": "staff", "guards": [], "effects": []},
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


def _student_model():
    return {
        "base_fields": [
            {"name": "student_id", "type": "str", "required": True},
            {"name": "first_name", "type": "str", "required": False},
        ],
        "custom_fields": [],
    }


def _seed_definition(fake_dc, *, definition_id, steps=None):
    fake_dc.set_model(TENANT, "student", _student_model())
    base = {
        "definition_id": definition_id,
        "name": "Actions route fixture",
        "version": 1,
        "status": "published",
        "lineage_status": "active",
        "channel_access": "staff_only",
        "machine": json.dumps(_machine()),
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


# --- transitions -------------------------------------------------------


def test_transition_action_returns_200_with_instance(client, fake_dc):
    _seed_definition(fake_dc, definition_id="wd-route-1")
    instance_eid, _ = _create_instance(fake_dc, "wd-route-1")

    resp = act(client, instance_eid, "approve")
    assert resp.status_code == 200
    body = resp.json()
    assert body["instance"]["state"] == "approved"
    assert "item" not in body


def test_unknown_action_returns_409_with_allowed_list(client, fake_dc):
    _seed_definition(fake_dc, definition_id="wd-route-2")
    instance_eid, _ = _create_instance(fake_dc, "wd-route-2")

    resp = act(client, instance_eid, "nope")
    assert resp.status_code == 409
    assert resp.json()["detail"]["allowed"] == [
        "approve", "save_draft", "complete_item", "verify_item", "reject_item", "waive_item",
    ]


def test_unknown_instance_404s(client, fake_dc):
    resp = act(client, "does-not-exist", "approve")
    assert resp.status_code == 404


def test_cross_tenant_instance_404s(client, fake_dc):
    """An instance belonging to another tenant must never be reachable
    through this tenant's route, even with a known entity_id."""
    fake_dc.set_model("globex", "student", _student_model())
    base = {
        "definition_id": "wd-other", "name": "Other", "version": 1, "status": "published",
        "lineage_status": "active", "channel_access": "staff_only",
        "machine": json.dumps(_machine()), "steps": json.dumps([]),
    }
    fake_dc.dc_create("globex", "workflow_definition", base)
    from app.workflows.engine import create_instance as create_instance_fn
    result = create_instance_fn("globex", "wd-other", {}, "staff")
    other_instance_eid = result["instance"]["entity_id"]

    resp = act(client, other_instance_eid, "approve")
    assert resp.status_code == 404


# --- item built-ins ------------------------------------------------------


def test_item_builtin_action_returns_200_with_instance_and_item(client, fake_dc):
    _seed_definition(fake_dc, definition_id="wd-route-3", steps=_form_steps())
    instance_eid, items = _create_instance(fake_dc, "wd-route-3")
    item_eid = items[0]["entity_id"]

    resp = act(client, instance_eid, "complete_item", item_id=item_eid)
    assert resp.status_code == 200
    body = resp.json()
    assert body["instance"]["state"] == "draft"  # complete_item alone doesn't advance the machine
    assert body["item"]["base_data"]["status"] == "submitted"


def test_save_draft_action_returns_200_with_instance_only(client, fake_dc):
    _seed_definition(fake_dc, definition_id="wd-route-4", steps=_form_steps())
    instance_eid, _ = _create_instance(fake_dc, "wd-route-4")

    resp = act(client, instance_eid, "save_draft", section_answers={"s1": {"first_name": "Ada"}})
    assert resp.status_code == 200
    body = resp.json()
    assert "item" not in body
    assert json.loads(body["instance"]["draft_data"]) == {"s1": {"first_name": "Ada"}}


# --- cancel_instance -------------------------------------------------------


def test_cancel_instance_action_returns_200(client, fake_dc):
    _seed_definition(fake_dc, definition_id="wd-route-5")
    instance_eid, _ = _create_instance(fake_dc, "wd-route-5")

    resp = act(client, instance_eid, "cancel_instance")
    assert resp.status_code == 200
    assert resp.json()["instance"]["state"] == "cancelled"


# --- allowed-actions (Plan 3 Task 3) ----------------------------------------


def test_allowed_actions_route_matches_409_advertisement(client, fake_dc):
    _seed_definition(fake_dc, definition_id="wd-route-6")
    instance_eid, _ = _create_instance(fake_dc, "wd-route-6")

    ok = client.get(f"/api/workflows/{TENANT}/instances/{instance_eid}/allowed-actions")
    assert ok.status_code == 200
    body = ok.json()
    assert body["state"] == "draft"

    bogus = act(client, instance_eid, "definitely_not_an_action")
    assert bogus.status_code == 409
    assert bogus.json()["detail"]["allowed"] == body["allowed"]


def test_allowed_actions_route_404_on_unknown_instance(client, fake_dc):
    resp = client.get(f"/api/workflows/{TENANT}/instances/nope/allowed-actions")
    assert resp.status_code == 404
