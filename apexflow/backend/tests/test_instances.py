"""Instance-creation tests (Task 6): item derivation/fan-out, lineage/health
refusal, and the route.

Written first per TDD (superpowers:test-driven-development):
app.workflows.engine / app.api.instances do not exist yet at the time these
were drafted, so this file was confirmed failing at collection before
engine.py existed.

Auth pattern follows test_definitions_api.py: override
`require_authenticated_user` at the app level rather than minting a real JWT.
"""
import json

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient

from app.auth import require_authenticated_user
from app.main import app
from app.workflows import engine
from app.workflows.definitions import deprecate_definition

TENANT = "acme"


@pytest.fixture
def client(fake_dc):
    app.dependency_overrides[require_authenticated_user] = lambda: {
        "user_id": "u1", "tenant_id": TENANT, "role": "admin", "_token": "Bearer test-token",
    }
    yield TestClient(app)
    app.dependency_overrides.clear()


# --- fixtures ----------------------------------------------------------


def _machine():
    return {
        "states": [
            {"state_id": "draft", "name": "Draft", "kind": "initial"},
            {"state_id": "submitted", "name": "Submitted", "kind": "terminal"},
        ],
        "transitions": [
            {
                "transition_id": "t_submit",
                "from": "draft",
                "to": "submitted",
                "action": "submit",
                "actor": "family",
                "guards": [],
                "effects": [
                    {"primitive": "commit_sections", "params": {"section_ids": ["student_section"]}}
                ],
            }
        ],
    }


def _steps(*, message_ack=True):
    return [
        {
            "step_id": "student_details",
            "type": "form",
            "title": "Student details",
            "required": True,
            "blocking": True,
            "available_in": ["draft"],
            "show_if": None,
            "review": None,
            "config": {
                "sections": [
                    {
                        "section_id": "student_section",
                        "entity_model": "student",
                        "fields": [
                            {"name": "first_name", "required": True},
                            {"name": "last_name", "required": True},
                        ],
                        "mode": "create",
                        "repeat": None,
                    }
                ]
            },
        },
        {
            "step_id": "docs_step",
            "type": "documents",
            "title": "Required documents",
            "required": True,
            "blocking": True,
            "available_in": ["draft"],
            "show_if": None,
            "review": None,
            "config": {
                "docs": [
                    {"name": "Immunization records", "blocking": True},
                    {"name": "Photo ID"},
                ]
            },
        },
        {
            "step_id": "welcome",
            "type": "message",
            "title": "Welcome",
            "required": False,
            "blocking": False,
            "available_in": ["draft"],
            "show_if": None,
            "review": None,
            "config": {"body": "Welcome!", "ack": message_ack},
        },
    ]


def _models():
    return {
        "student": {
            "base_fields": [
                {"name": "student_id", "type": "str", "required": True},
                {"name": "first_name", "type": "str", "required": True},
                {"name": "last_name", "type": "str", "required": True},
            ],
            "custom_fields": [],
        }
    }


def _seed_published(fake_dc, *, definition_id, lineage_status="active", message_ack=True):
    fake_dc.set_model(TENANT, "student", _models()["student"])
    base = {
        "definition_id": definition_id,
        "name": "Enrollment",
        "version": 1,
        "status": "published",
        "lineage_status": lineage_status,
        "channel_access": "family",
        "machine": json.dumps(_machine()),
        "steps": json.dumps(_steps(message_ack=message_ack)),
    }
    created = fake_dc.dc_create(TENANT, "workflow_definition", base)
    return created["entity_id"]


# --- create_instance: item derivation / fan-out -------------------------


def test_create_instance_derives_items_with_document_fanout_and_message_ack(fake_dc):
    _seed_published(fake_dc, definition_id="wd-lineage-1")

    result = engine.create_instance(
        TENANT, "wd-lineage-1", {"school_year": "2026-2027"}, "family",
        applicant_email="parent@example.com",
    )

    instance = result["instance"]
    items = result["items"]
    assert instance["base_data"]["state"] == "draft"
    assert instance["base_data"]["definition_id"] == "wd-lineage-1"
    assert instance["base_data"]["applicant_email"] == "parent@example.com"
    assert instance["base_data"]["token_version"] == 1
    assert json.loads(instance["base_data"]["context"]) == {"school_year": "2026-2027"}

    kinds = sorted(i["base_data"]["kind"] for i in items)
    assert kinds == ["documents", "documents", "form", "message-ack"]

    doc_items = [i for i in items if i["base_data"]["kind"] == "documents"]
    titles = sorted(i["base_data"]["title"] for i in doc_items)
    assert titles == ["Immunization records", "Photo ID"]
    for doc_item in doc_items:
        assert doc_item["base_data"]["payload_ref"] == ""
        assert doc_item["base_data"]["blocking"] is True  # explicit True, and step-fallback True

    form_item = next(i for i in items if i["base_data"]["kind"] == "form")
    assert form_item["base_data"]["title"] == "Student details"
    assert form_item["base_data"]["status"] == "not_started"

    activities = fake_dc.find("workflow_activity", instance_id=instance["entity_id"])
    assert len(activities) == 1
    assert activities[0]["type"] == "state_change"
    assert activities[0]["from_value"] == ""
    assert activities[0]["to_value"] == "draft"
    assert activities[0]["actor"] == "family"


def test_create_instance_message_step_without_ack_produces_no_item(fake_dc):
    _seed_published(fake_dc, definition_id="wd-lineage-2", message_ack=False)

    result = engine.create_instance(TENANT, "wd-lineage-2", {}, "staff")

    kinds = sorted(i["base_data"]["kind"] for i in result["items"])
    assert kinds == ["documents", "documents", "form"]


# --- 404 / 409 refusals --------------------------------------------------


def test_create_instance_no_published_definition_404s(fake_dc):
    with pytest.raises(HTTPException) as exc:
        engine.create_instance(TENANT, "wd-does-not-exist", {}, "staff")
    assert exc.value.status_code == 404


def test_create_instance_deprecated_lineage_409s(fake_dc):
    _seed_published(fake_dc, definition_id="wd-lineage-3", lineage_status="deprecated")

    with pytest.raises(HTTPException) as exc:
        engine.create_instance(TENANT, "wd-lineage-3", {}, "staff")
    assert exc.value.status_code == 409
    assert exc.value.detail["reason"] == "lineage_not_active"


def test_create_instance_retired_lineage_409s(fake_dc):
    _seed_published(fake_dc, definition_id="wd-lineage-3b", lineage_status="retired")

    with pytest.raises(HTTPException) as exc:
        engine.create_instance(TENANT, "wd-lineage-3b", {}, "staff")
    assert exc.value.status_code == 409


def test_create_instance_stale_definition_409s(fake_dc):
    """Model evolves after publish: a new required field the section doesn't
    cover -> definition_health == "stale" -> creation refuses."""
    _seed_published(fake_dc, definition_id="wd-lineage-4")

    stale_model = dict(_models()["student"])
    stale_model["base_fields"] = stale_model["base_fields"] + [
        {"name": "grade", "type": "str", "required": True}
    ]
    fake_dc.set_model(TENANT, "student", stale_model)

    with pytest.raises(HTTPException) as exc:
        engine.create_instance(TENANT, "wd-lineage-4", {}, "staff")
    assert exc.value.status_code == 409
    assert exc.value.detail == {"reason": "definition_stale"}


def test_create_instance_broken_definition_409s(fake_dc):
    """Model evolves after publish: a section-picked field is removed from
    the model entirely -> definition_health == "broken" -> refuses."""
    _seed_published(fake_dc, definition_id="wd-lineage-4b")

    broken_model = {
        "base_fields": [{"name": "student_id", "type": "str", "required": True}],
        "custom_fields": [],
    }
    fake_dc.set_model(TENANT, "student", broken_model)

    with pytest.raises(HTTPException) as exc:
        engine.create_instance(TENANT, "wd-lineage-4b", {}, "staff")
    assert exc.value.status_code == 409
    assert exc.value.detail == {"reason": "definition_broken"}


def test_deprecate_then_create_instance_409s_cross_task(fake_dc):
    """Cross-task test noted in Task 5's report: deprecate the lineage via
    the definitions service, then create_instance must refuse."""
    eid = _seed_published(fake_dc, definition_id="wd-lineage-5")
    deprecate_definition(TENANT, eid)

    with pytest.raises(HTTPException) as exc:
        engine.create_instance(TENANT, "wd-lineage-5", {}, "staff")
    assert exc.value.status_code == 409
    assert exc.value.detail["reason"] == "lineage_not_active"


# --- route ----------------------------------------------------------------


def test_create_instance_route_201(client, fake_dc):
    _seed_published(fake_dc, definition_id="wd-route-1")

    resp = client.post(
        f"/api/workflows/{TENANT}/definitions/wd-route-1/instances",
        json={"context": {"school_year": "2026-2027"}, "channel": "family",
              "applicant_email": "p@example.com"},
    )
    assert resp.status_code == 201
    body = resp.json()
    # Flattened row shape (not the create envelope) -- code-review follow-up
    # to Task 8: the route now re-fetches + runs run_system_transitions
    # before responding, so "instance" matches the actions route's shape.
    assert body["instance"]["state"] == "draft"
    assert len(body["items"]) == 4


def test_create_instance_route_404_unknown_lineage(client, fake_dc):
    resp = client.post(
        f"/api/workflows/{TENANT}/definitions/nope/instances",
        json={"context": {}, "channel": "staff"},
    )
    assert resp.status_code == 404


def test_create_instance_route_409_deprecated_lineage(client, fake_dc):
    _seed_published(fake_dc, definition_id="wd-route-2", lineage_status="deprecated")

    resp = client.post(
        f"/api/workflows/{TENANT}/definitions/wd-route-2/instances",
        json={"context": {}, "channel": "staff"},
    )
    assert resp.status_code == 409
    assert resp.json()["detail"]["reason"] == "lineage_not_active"


def test_create_instance_route_rejects_bad_channel_422(client, fake_dc):
    _seed_published(fake_dc, definition_id="wd-route-3")

    resp = client.post(
        f"/api/workflows/{TENANT}/definitions/wd-route-3/instances",
        json={"context": {}, "channel": "parent"},
    )
    assert resp.status_code == 422


# --- route: system auto-advance fires at creation time (code-review follow-up) --


def _auto_confirm_machine():
    return {
        "states": [
            {"state_id": "draft", "name": "Draft", "kind": "initial"},
            {"state_id": "confirmed", "name": "Confirmed", "kind": "terminal"},
        ],
        "transitions": [
            {
                "transition_id": "t_auto_confirm",
                "from": "draft", "to": "confirmed", "action": "auto_confirm", "actor": "system",
                "guards": [{
                    "primitive": "data_condition",
                    "params": {"condition": {
                        "all": [{"source": "context.auto_confirm", "op": "eq", "value": True}]
                    }},
                }],
                "effects": [],
            },
        ],
    }


def _seed_auto_confirm_definition(fake_dc, *, definition_id):
    base = {
        "definition_id": definition_id,
        "name": "Auto confirm",
        "version": 1,
        "status": "published",
        "lineage_status": "active",
        "channel_access": "staff_only",
        "machine": json.dumps(_auto_confirm_machine()),
        "steps": json.dumps([]),
    }
    fake_dc.dc_create(TENANT, "workflow_definition", base)


def test_create_instance_route_runs_system_transitions_at_creation(client, fake_dc):
    """Code-review follow-up (Task 8): a system transition already
    satisfiable at the INITIAL state (guarded on a context value set at
    creation time) must fire before the create route responds -- not sit
    un-advanced until the first item mutation triggers
    `run_system_transitions` from inside `execute_action`."""
    _seed_auto_confirm_definition(fake_dc, definition_id="wd-auto-confirm-1")

    resp = client.post(
        f"/api/workflows/{TENANT}/definitions/wd-auto-confirm-1/instances",
        json={"context": {"auto_confirm": True}, "channel": "staff"},
    )
    assert resp.status_code == 201
    body = resp.json()
    assert body["instance"]["state"] == "confirmed"
    assert body["instance"]["closed_at"]  # terminal-landing closed_at (machine.py decision 5)

    activities = fake_dc.find("workflow_activity", instance_id=body["instance"]["entity_id"])
    types_in_order = [a["type"] for a in activities]
    assert types_in_order == ["state_change", "state_change"]  # create's own, then the auto-advance hop


def test_create_instance_route_no_advance_when_guard_unsatisfied(fake_dc, client):
    """Sanity check for the same fixture: without the context flag, the
    instance is returned still in its initial state."""
    _seed_auto_confirm_definition(fake_dc, definition_id="wd-auto-confirm-2")

    resp = client.post(
        f"/api/workflows/{TENANT}/definitions/wd-auto-confirm-2/instances",
        json={"context": {}, "channel": "staff"},
    )
    assert resp.status_code == 201
    assert resp.json()["instance"]["state"] == "draft"


def test_create_instance_response_items_carry_only_contract_fields(client, fake_dc):
    """Same wire contract as `/internal/instance-by-token` — the staff-
    assisted entry path must not hand back a different item shape."""
    _seed_published(fake_dc, definition_id="wd-route-wire")

    resp = client.post(
        f"/api/workflows/{TENANT}/definitions/wd-route-wire/instances",
        json={"context": {"school_year": "2026-2027"}, "channel": "staff"},
    )
    assert resp.status_code == 201, resp.text
    for item in resp.json()["items"]:
        assert set(item) == {
            "entity_id", "item_id", "instance_id", "step_id", "kind", "title",
            "status", "blocking", "payload_ref", "due_at", "completed_by",
            "_version",
        }
