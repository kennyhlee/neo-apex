"""Archive/unarchive lineage lifecycle, freeze/thaw, and draft delete.

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


def _seed_instance(fake_dc, *, definition_id, state="draft", closed_at=""):
    base = {
        "instance_id": fake_dc.next_id(TENANT, "workflow_instance"),
        "definition_id": definition_id, "definition_version": 1,
        "state": state, "channel_started": "staff",
        "opened_at": "2026-08-01T00:00:00+00:00", "closed_at": closed_at,
        "token_version": 1,
    }
    return fake_dc.dc_create(TENANT, "workflow_instance", base)["entity_id"]


def _ctx(fake_dc, instance_eid, actor="u1"):
    row = fake_dc.get_entity(TENANT, "workflow_instance", instance_eid)
    return machine.build_eval_context(TENANT, row, actor=actor, token=None)






# --- archive / unarchive ----------------------------------------------------


def _act(client, entity_id, action, **params):
    return client.post(
        f"/api/workflows/{TENANT}/definitions/{entity_id}/actions",
        json={"action": action, **params},
    )


def test_archive_succeeds_once_every_work_item_is_in_an_end_state(client, fake_dc):
    """Nothing left in flight, so the archive has nothing to freeze."""
    fake_dc.set_model(TENANT, "student", _models())
    eid = _seed_definition(fake_dc, definition_id="wd-gate-open")
    _seed_instance(fake_dc, definition_id="wd-gate-open", state="enrolled",
                   closed_at="2026-08-02T00:00:00+00:00")
    _seed_instance(fake_dc, definition_id="wd-gate-open", state="cancelled",
                   closed_at="2026-08-03T00:00:00+00:00")

    assert _act(client, eid, "deprecate").status_code == 200
    resp = _act(client, eid, "archive")
    assert resp.status_code == 200
    assert fake_dc.get_entity(TENANT, "workflow_definition", eid)["lineage_status"] == "archived"




def test_archived_workflow_refuses_new_work_items(client, fake_dc):
    fake_dc.set_model(TENANT, "student", _models())
    eid = _seed_definition(fake_dc, definition_id="wd-no-new")
    assert _act(client, eid, "deprecate").status_code == 200
    assert _act(client, eid, "archive").status_code == 200

    resp = client.post(
        f"/api/workflows/{TENANT}/definitions/wd-no-new/instances",
        json={"context": {}, "channel": "staff"},
    )
    assert resp.status_code == 409
    assert resp.json()["detail"]["reason"] == "lineage_not_active"


def test_retire_action_is_accepted_as_a_legacy_alias_of_archive(client, fake_dc):
    fake_dc.set_model(TENANT, "student", _models())
    eid = _seed_definition(fake_dc, definition_id="wd-legacy-retire")
    _seed_instance(fake_dc, definition_id="wd-legacy-retire", state="submitted")

    assert _act(client, eid, "deprecate").status_code == 200
    resp = _act(client, eid, "retire", force_cancel=True)
    assert resp.status_code == 200
    assert fake_dc.get_entity(TENANT, "workflow_definition", eid)["lineage_status"] == "archived"


def test_publishing_a_new_version_keeps_the_lineage_archived(client, fake_dc):
    fake_dc.set_model(TENANT, "student", _models())
    v1 = _seed_definition(fake_dc, definition_id="wd-archived-publish", version=1)
    assert _act(client, v1, "deprecate").status_code == 200
    assert _act(client, v1, "archive").status_code == 200

    v2 = _seed_definition(fake_dc, definition_id="wd-archived-publish",
                          version=2, status="draft")
    resp = _act(client, v2, "publish")
    assert resp.status_code == 200
    assert resp.json()["base_data"]["lineage_status"] == "archived"


# --- revised model: deprecated gate, freeze/unfreeze, delete ----------------
#
# Archive is now reachable ONLY from `deprecated`, so the ladder is
# active -> deprecated -> archived and back. Deprecating first is what gives
# mid-flight work its chance to finish; archiving then FREEZES whatever is
# still running rather than destroying it, and unarchive thaws it.


def _instance_act(client, instance_eid, action, **params):
    return client.post(
        f"/api/workflows/{TENANT}/instances/{instance_eid}/actions",
        json={"action": action, **params},
    )


def test_archive_is_refused_while_the_lineage_is_still_active(client, fake_dc):
    """The deprecate step is mandatory, not advisory: it is the window in which
    mid-flight work is allowed to finish."""
    fake_dc.set_model(TENANT, "student", _models())
    eid = _seed_definition(fake_dc, definition_id="wd-must-deprecate")

    resp = _act(client, eid, "archive")
    assert resp.status_code == 409
    assert resp.json()["detail"]["reason"] == "not_deprecated"
    assert fake_dc.get_entity(TENANT, "workflow_definition", eid)["lineage_status"] == "active"


def test_archive_from_deprecated_freezes_mid_flight_work(client, fake_dc):
    fake_dc.set_model(TENANT, "student", _models())
    eid = _seed_definition(fake_dc, definition_id="wd-freeze")
    open_eid = _seed_instance(fake_dc, definition_id="wd-freeze", state="submitted")
    done_eid = _seed_instance(fake_dc, definition_id="wd-freeze", state="enrolled",
                              closed_at="2026-08-02T00:00:00+00:00")

    assert _act(client, eid, "deprecate").status_code == 200
    assert _act(client, eid, "archive").status_code == 200
    assert fake_dc.get_entity(TENANT, "workflow_definition", eid)["lineage_status"] == "archived"

    frozen = fake_dc.get_entity(TENANT, "workflow_instance", open_eid)
    assert frozen["frozen_at"]
    # Freezing SUSPENDS: the state is untouched and the item is not closed, so
    # there is no prior state to record and nothing to restore on thaw.
    assert frozen["state"] == "submitted"
    assert not frozen["closed_at"]

    # already-finished work is not in the open set and is left alone
    untouched = fake_dc.get_entity(TENANT, "workflow_instance", done_eid)
    assert not untouched.get("frozen_at")


def test_frozen_work_item_refuses_all_progress(client, fake_dc):
    fake_dc.set_model(TENANT, "student", _models())
    eid = _seed_definition(fake_dc, definition_id="wd-frozen-blocks")
    inst_eid = _seed_instance(fake_dc, definition_id="wd-frozen-blocks", state="submitted")
    assert _act(client, eid, "deprecate").status_code == 200
    assert _act(client, eid, "archive").status_code == 200

    for body in ({"action": "approve"},
                 {"action": "save_draft", "section_answers": {}},
                 {"action": "complete_item", "item_id": "wi-1"}):
        resp = _instance_act(client, inst_eid, body.pop("action"), **body)
        assert resp.status_code == 409, body
        assert resp.json()["detail"]["reason"] == "frozen"

    assert fake_dc.get_entity(TENANT, "workflow_instance", inst_eid)["state"] == "submitted"


def test_unarchive_thaws_frozen_work_and_returns_lineage_to_deprecated(client, fake_dc):
    fake_dc.set_model(TENANT, "student", _models())
    eid = _seed_definition(fake_dc, definition_id="wd-thaw")
    inst_eid = _seed_instance(fake_dc, definition_id="wd-thaw", state="submitted")
    assert _act(client, eid, "deprecate").status_code == 200
    assert _act(client, eid, "archive").status_code == 200

    resp = _act(client, eid, "unarchive")
    assert resp.status_code == 200
    # back to where archive was entered from, NOT to active — the operator
    # never asked to reopen intake.
    assert fake_dc.get_entity(TENANT, "workflow_definition", eid)["lineage_status"] == "deprecated"

    thawed = fake_dc.get_entity(TENANT, "workflow_instance", inst_eid)
    assert not thawed["frozen_at"]
    assert thawed["state"] == "submitted"

    # and it can make progress again
    assert _instance_act(client, inst_eid, "approve").status_code == 200
    assert fake_dc.get_entity(TENANT, "workflow_instance", inst_eid)["state"] == "enrolled"




# --- delete an unpublished workflow -----------------------------------------


def test_draft_workflow_can_be_deleted(client, fake_dc):
    fake_dc.set_model(TENANT, "student", _models())
    eid = _seed_definition(fake_dc, definition_id="wd-deletable", status="draft")

    resp = _act(client, eid, "delete")
    assert resp.status_code == 200
    assert fake_dc.get_entity(TENANT, "workflow_definition", eid) is None


def test_published_workflow_cannot_be_deleted(client, fake_dc):
    """History matters once a workflow has gone live, and instances pin to it."""
    fake_dc.set_model(TENANT, "student", _models())
    eid = _seed_definition(fake_dc, definition_id="wd-not-deletable", status="published")

    resp = _act(client, eid, "delete")
    assert resp.status_code == 409
    assert resp.json()["detail"]["reason"] == "not_draft"
    assert fake_dc.get_entity(TENANT, "workflow_definition", eid) is not None


def test_superseded_workflow_cannot_be_deleted(client, fake_dc):
    """A superseded row is the pinned definition for every instance still
    running on that version — deleting it would strand them."""
    fake_dc.set_model(TENANT, "student", _models())
    eid = _seed_definition(fake_dc, definition_id="wd-superseded", status="superseded")

    resp = _act(client, eid, "delete")
    assert resp.status_code == 409
    assert resp.json()["detail"]["reason"] == "not_draft"
    assert fake_dc.get_entity(TENANT, "workflow_definition", eid) is not None


def test_deleting_a_draft_leaves_the_published_version_untouched(client, fake_dc):
    fake_dc.set_model(TENANT, "student", _models())
    pub = _seed_definition(fake_dc, definition_id="wd-mixed", version=1, status="published")
    draft = _seed_definition(fake_dc, definition_id="wd-mixed", version=2, status="draft")

    assert _act(client, draft, "delete").status_code == 200
    assert fake_dc.get_entity(TENANT, "workflow_definition", draft) is None
    assert fake_dc.get_entity(TENANT, "workflow_definition", pub)["status"] == "published"
