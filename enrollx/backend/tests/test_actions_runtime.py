"""Runtime actions: save_draft, complete_item, submit (incl. capacity)."""
import json

import pytest
from fastapi.testclient import TestClient

from app.auth import require_authenticated_user
from app.main import app
from tests.fakes import FakeDataCore, install_fake_datacore, seed_program_and_config


@pytest.fixture
def fake_dc(monkeypatch):
    fdc = FakeDataCore()
    install_fake_datacore(monkeypatch, fdc)
    return fdc


@pytest.fixture
def client(fake_dc):
    app.dependency_overrides[require_authenticated_user] = lambda: {
        "user_id": "u1", "tenant_id": "acme", "role": "admin", "_token": "Bearer x"}
    yield TestClient(app)
    app.dependency_overrides.clear()


def create_application(client, fake_dc, capacity=None):
    seed_program_and_config(fake_dc, capacity=capacity)
    resp = client.post("/api/registration/acme/applications", json={
        "program_id": "PR1", "school_year": "2026-2027", "channel": "admin",
        "applicant_email": "parent@example.com"})
    assert resp.status_code == 201
    return resp.json()


def act(client, app_eid, action, **params):
    return client.post(f"/api/registration/acme/applications/{app_eid}/actions",
                       json={"action": action, **params})


def complete_all_blocking(client, created):
    eid = created["application"]["entity_id"]
    for item in created["items"]:
        if item["base_data"]["blocking"]:
            assert act(client, eid, "complete_item",
                       item_id=item["entity_id"]).status_code == 200


def test_unknown_action_is_400(client, fake_dc):
    created = create_application(client, fake_dc)
    resp = act(client, created["application"]["entity_id"], "explode")
    assert resp.status_code == 400
    assert "save_draft" in str(resp.json()["detail"])


def test_unknown_application_is_404(client, fake_dc):
    seed_program_and_config(fake_dc)
    resp = act(client, "nope", "save_draft", draft_data={})
    assert resp.status_code == 404


def test_save_draft_merges_top_level_keys(client, fake_dc):
    created = create_application(client, fake_dc)
    eid = created["application"]["entity_id"]
    assert act(client, eid, "save_draft",
               draft_data={"student": {"first_name": "Mia"}}).status_code == 200
    assert act(client, eid, "save_draft",
               draft_data={"payment_plan_selection": {"plan": "deposit"}}).status_code == 200
    row = fake_dc.get_entity("acme", "registration_application", eid)
    draft = json.loads(row["draft_data"])
    assert draft["student"] == {"first_name": "Mia"}
    assert draft["payment_plan_selection"] == {"plan": "deposit"}


def test_save_draft_rejects_non_object(client, fake_dc):
    created = create_application(client, fake_dc)
    resp = act(client, created["application"]["entity_id"], "save_draft", draft_data=[1])
    assert resp.status_code == 400


def test_complete_item_sets_submitted_and_actor(client, fake_dc):
    created = create_application(client, fake_dc)
    eid = created["application"]["entity_id"]
    item = created["items"][0]
    resp = act(client, eid, "complete_item", item_id=item["entity_id"], payload_ref="form:b1")
    assert resp.status_code == 200
    row = fake_dc.get_entity("acme", "application_item", item["entity_id"])
    assert row["status"] == "submitted"
    assert row["completed_by"] == "u1"
    assert row["payload_ref"] == "form:b1"


def test_complete_item_of_other_application_404(client, fake_dc):
    a = create_application(client, fake_dc)
    other = fake_dc.dc_create("acme", "application_item", {
        "item_id": "x", "application_id": "other-app", "block_id": "b1",
        "kind": "form", "title": "F", "status": "not_started", "blocking": True})
    resp = act(client, a["application"]["entity_id"], "complete_item",
               item_id=other["entity_id"])
    assert resp.status_code == 404


def test_submit_blocked_until_blocking_items_done(client, fake_dc):
    created = create_application(client, fake_dc)
    resp = act(client, created["application"]["entity_id"], "submit")
    assert resp.status_code == 409
    assert "Student Info" in str(resp.json()["detail"])


def test_submit_happy_path_emails_and_logs(client, fake_dc):
    created = create_application(client, fake_dc)
    eid = created["application"]["entity_id"]
    complete_all_blocking(client, created)
    resp = act(client, eid, "submit")
    assert resp.status_code == 200
    row = fake_dc.get_entity("acme", "registration_application", eid)
    assert row["status"] == "submitted"
    assert row["submitted_at"]
    acts = fake_dc.find("application_activity", application_id=eid)
    assert any(a["type"] == "status_change" and a["to_value"] == "submitted" for a in acts)
    assert any(a["type"] == "email_sent" and a["to_value"].startswith("submission_receipt:")
               for a in acts)


def test_submit_waitlists_when_program_full(client, fake_dc):
    created = create_application(client, fake_dc, capacity=1)
    fake_dc.dc_create("acme", "registration_application", {
        "application_id": "A9", "program_id": "PR1", "status": "approved"})
    complete_all_blocking(client, created)
    eid = created["application"]["entity_id"]
    assert act(client, eid, "submit").status_code == 200
    row = fake_dc.get_entity("acme", "registration_application", eid)
    assert row["status"] == "waitlisted"
    acts = fake_dc.find("application_activity", application_id=eid)
    assert any(a["type"] == "email_sent" and a["to_value"].startswith("status_change:")
               for a in acts)


def test_double_submit_409(client, fake_dc):
    created = create_application(client, fake_dc)
    complete_all_blocking(client, created)
    eid = created["application"]["entity_id"]
    assert act(client, eid, "submit").status_code == 200
    assert act(client, eid, "submit").status_code == 409


# ── auth boundary ────────────────────────────────────────────────────────

def test_action_requires_auth(fake_dc):
    seed_program_and_config(fake_dc)
    resp = TestClient(app).post(
        "/api/registration/acme/applications/anything/actions",
        json={"action": "save_draft", "draft_data": {}})
    assert resp.status_code == 401


def test_action_cross_tenant_403(client, fake_dc):
    created = create_application(client, fake_dc)
    eid = created["application"]["entity_id"]
    resp = client.post(f"/api/registration/globex/applications/{eid}/actions",
                       json={"action": "save_draft", "draft_data": {}})
    assert resp.status_code == 403


def test_action_parent_role_403(fake_dc):
    seed_program_and_config(fake_dc)
    app.dependency_overrides[require_authenticated_user] = lambda: {
        "user_id": "p1", "tenant_id": "acme", "role": "parent", "_token": "Bearer x"}
    try:
        resp = TestClient(app).post(
            "/api/registration/acme/applications/anything/actions",
            json={"action": "save_draft", "draft_data": {}})
        assert resp.status_code == 403
    finally:
        app.dependency_overrides.clear()


# ── dispatcher rejection semantics ─────────────────────────────────────────

def test_publish_config_rejects_application_id_as_not_a_config(client, fake_dc):
    # publish_config's {application_id} path segment carries a
    # registration_config entity_id (contract note 1) — an application
    # entity_id passed there is simply not a known config, hence 404.
    created = create_application(client, fake_dc)
    eid = created["application"]["entity_id"]
    assert act(client, eid, "publish_config").status_code == 404


# ── C1 regression: booleans read back from DataCore are STRINGS ────────────

def test_non_blocking_item_does_not_block_submit(client, fake_dc):
    """C1 regression. `blocking: False` reads back from DataCore's query path
    as the STRING "false", which is truthy in Python. Before the `as_bool`
    coercion, `_submit` treated EVERY item as blocking, so an application
    carrying a post-approval item (BLOCKS' "Report Card", blocking=False,
    due_days_after_approval=14) could never be submitted — a permanent 409
    naming an item the parent is not meant to complete yet.
    """
    created = create_application(client, fake_dc)
    eid = created["application"]["entity_id"]

    report_card = next(i for i in created["items"]
                       if i["base_data"]["title"] == "Report Card")
    assert report_card["base_data"]["blocking"] is False
    # It really is stored/read as the truthy string.
    stored = fake_dc.get_entity("acme", "application_item", report_card["entity_id"])
    assert stored["blocking"] == "false" and bool(stored["blocking"]) is True

    complete_all_blocking(client, created)
    resp = act(client, eid, "submit")
    assert resp.status_code == 200, resp.json()
    assert fake_dc.get_entity("acme", "registration_application",
                              eid)["status"] == "submitted"
    # And it is still open, deliberately — it is a post-approval item.
    assert stored["status"] == "not_started"


def test_item_update_keeps_blocking_a_real_bool_in_stored_base_data(client, fake_dc):
    """C1 write-side drift regression. `entity_base_data` copies the flattened
    row into the next PUT, so without coercion the first `_update_item` would
    permanently rewrite `blocking` from bool False to the string "false" in
    stored base_data, contradicting the `"type": "bool"` declared in
    base_model.json.
    """
    created = create_application(client, fake_dc)
    eid = created["application"]["entity_id"]
    report_card = next(i for i in created["items"]
                       if i["base_data"]["title"] == "Report Card")

    resp = act(client, eid, "complete_item", item_id=report_card["entity_id"])
    assert resp.status_code == 200
    # The PUT envelope is what DataCore would persist as base_data.
    assert resp.json()["item"]["base_data"]["blocking"] is False

    form = next(i for i in created["items"]
                if i["base_data"]["title"] == "Student Info")
    resp = act(client, eid, "complete_item", item_id=form["entity_id"])
    assert resp.json()["item"]["base_data"]["blocking"] is True
