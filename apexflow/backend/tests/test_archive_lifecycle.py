"""Archive/unarchive lineage lifecycle + instance abandon/restore.

Owns the cross-cutting behaviour that spans definitions.py and machine.py;
per-route wiring assertions stay in test_definitions_api.py / test_instances.py.

Spec: docs/superpowers/specs/2026-08-11-workflow-archive-lifecycle-design.md
"""
import json

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient

from app.auth import require_authenticated_user
from app.main import app
from app.workflows import machine
from app.workflows.definitions import is_archived

TENANT = "acme"


# --- is_archived ------------------------------------------------------------


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


# --- fixtures and builders --------------------------------------------------
#
# Mirrors test_definitions_api.py's, deliberately not imported from it: this
# suite has no cross-test-file import pattern, and these fixtures differ (the
# machine below is staff-actor throughout so transitions can be driven from
# the staff route without a family token).


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


# --- abandoned is terminal --------------------------------------------------


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
