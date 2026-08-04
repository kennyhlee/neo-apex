"""A `form` block with entity_type=registration_application writes its answers
onto the application entity's own base_data (spec §4 rule 2)."""
import json

import pytest
from fastapi.testclient import TestClient

from app.auth import require_authenticated_user
from app.main import app
from tests.fakes import FakeDataCore, install_fake_datacore

APP_FORM_BLOCKS = [
    {"block_id": "b1", "type": "form", "title": "Agreement", "required": True,
     "blocking": True, "config": {"entity_type": "registration_application"}},
    {"block_id": "b9", "type": "review", "title": "Review", "required": True,
     "blocking": False, "config": {}},
]


def seed(fdc, blocks):
    fdc.dc_create("acme", "registration_config", {
        "config_id": "cfg1", "version": 1, "status": "published",
        "blocks": json.dumps(blocks)})


@pytest.fixture
def fake_dc(monkeypatch):
    fdc = FakeDataCore()
    install_fake_datacore(monkeypatch, fdc)
    seed(fdc, APP_FORM_BLOCKS)
    return fdc


@pytest.fixture
def client(fake_dc):
    app.dependency_overrides[require_authenticated_user] = lambda: {
        "user_id": "u1", "tenant_id": "acme", "role": "admin", "_token": "Bearer x"}
    yield TestClient(app)
    app.dependency_overrides.clear()


def create(client):
    return client.post("/api/registration/acme/applications", json={
        "school_year": "2026-2027", "channel": "admin"}).json()


def act(client, eid, **payload):
    return client.post(f"/api/registration/acme/applications/{eid}/actions", json=payload)


def test_custom_field_answer_lands_on_application_base_data(client, fake_dc):
    created = create(client)
    eid = created["application"]["entity_id"]
    item = created["items"][0]
    act(client, eid, action="save_draft", draft_data={
        "b1": {"agreement_signed_by": "Wei Chen", "initials": "WC"}})
    resp = act(client, eid, action="complete_item", item_id=item["entity_id"])
    assert resp.status_code == 200
    row = fake_dc.get_entity("acme", "registration_application", eid)
    assert row["agreement_signed_by"] == "Wei Chen"
    assert row["initials"] == "WC"


def test_answer_survives_submit_and_approval(client, fake_dc):
    created = create(client)
    eid = created["application"]["entity_id"]
    act(client, eid, action="save_draft", draft_data={
        "b1": {"agreement_signed_by": "Wei Chen"},
        "student": {"first_name": "Mia", "last_name": "Chen"},
        "family": {"family_name": "Chen"}})
    act(client, eid, action="complete_item", item_id=created["items"][0]["entity_id"])
    assert act(client, eid, action="submit").status_code == 200
    assert act(client, eid, action="approve").status_code == 200
    row = fake_dc.get_entity("acme", "registration_application", eid)
    assert row["agreement_signed_by"] == "Wei Chen"
    assert row["status"] in {"approved", "enrolled"}


def test_submit_applies_answers_even_after_the_item_was_completed(client, fake_dc):
    """`_submit` re-applies every application-model block, so an answer the
    parent revised after completing the step still reaches the application."""
    created = create(client)
    eid = created["application"]["entity_id"]
    act(client, eid, action="save_draft", draft_data={"b1": {"initials": "WC"}})
    act(client, eid, action="complete_item", item_id=created["items"][0]["entity_id"])
    act(client, eid, action="save_draft", draft_data={"b1": {"initials": "XY"}})
    assert act(client, eid, action="submit").status_code == 200
    row = fake_dc.get_entity("acme", "registration_application", eid)
    assert row["initials"] == "XY"


def test_complete_item_still_records_its_status_change(client, fake_dc):
    """Ordering regression: the field write happens after the status write and
    from a re-fetched row. Applying it from the stale row would rebuild
    base_data and silently drop the status change."""
    created = create(client)
    eid = created["application"]["entity_id"]
    act(client, eid, action="save_draft", draft_data={"b1": {"initials": "WC"}})
    act(client, eid, action="complete_item", item_id=created["items"][0]["entity_id"])
    act(client, eid, action="submit")
    act(client, eid, action="reject_item", item_id=created["items"][0]["entity_id"])
    assert fake_dc.get_entity(
        "acme", "registration_application", eid)["status"] == "pending_items"
    act(client, eid, action="save_draft", draft_data={"b1": {"initials": "ZZ"}})
    resp = act(client, eid, action="complete_item",
               item_id=created["items"][0]["entity_id"])
    assert resp.status_code == 200
    row = fake_dc.get_entity("acme", "registration_application", eid)
    assert row["status"] == "in_review"   # the status write survived
    assert row["initials"] == "ZZ"        # and so did the field write


@pytest.mark.parametrize("field", ["status", "config_version", "application_id",
                                   "token_version", "draft_data"])
def test_engine_owned_field_write_is_rejected_400(client, fake_dc, field):
    created = create(client)
    eid = created["application"]["entity_id"]
    act(client, eid, action="save_draft", draft_data={"b1": {field: "hacked"}})
    resp = act(client, eid, action="complete_item",
               item_id=created["items"][0]["entity_id"])
    assert resp.status_code == 400
    assert field in resp.json()["detail"]["fields"]
    row = fake_dc.get_entity("acme", "registration_application", eid)
    assert row["status"] == "draft"  # nothing was written


def test_engine_owned_field_write_is_rejected_at_submit_too(client, fake_dc):
    created = create(client)
    eid = created["application"]["entity_id"]
    act(client, eid, action="save_draft", draft_data={"b1": {"initials": "WC"}})
    act(client, eid, action="complete_item", item_id=created["items"][0]["entity_id"])
    act(client, eid, action="save_draft", draft_data={"b1": {"status": "approved"}})
    resp = act(client, eid, action="submit")
    assert resp.status_code == 400
    assert fake_dc.get_entity(
        "acme", "registration_application", eid)["status"] == "draft"


def test_a_student_form_block_does_not_touch_the_application(client, fake_dc):
    """Only entity_type=registration_application blocks write to the
    application; a student block's answers stay in draft_data staging until
    approval materializes the student row."""
    fake_dc.rows = [r for r in fake_dc.rows if r["entity_type"] != "registration_config"]
    seed(fake_dc, [
        {"block_id": "s1", "type": "form", "title": "Student", "required": True,
         "blocking": True, "config": {"entity_type": "student"}},
        {"block_id": "b9", "type": "review", "title": "Review", "required": True,
         "blocking": False, "config": {}}])
    created = create(client)
    eid = created["application"]["entity_id"]
    act(client, eid, action="save_draft", draft_data={"s1": {"first_name": "Mia"}})
    act(client, eid, action="complete_item", item_id=created["items"][0]["entity_id"])
    row = fake_dc.get_entity("acme", "registration_application", eid)
    assert "first_name" not in row
    assert json.loads(row["draft_data"])["s1"] == {"first_name": "Mia"}
