"""familyhub-facing internal routes: X-Internal-Key guard, magic-link scope,
parent action subset, revocation, documents filtering."""
import pytest
from fastapi.testclient import TestClient

from app.config import settings
from app.main import app
from app.registration import tokens
from tests.fakes import FakeDataCore, install_fake_datacore, seed_program_and_config

KEY = {"X-Internal-Key": "dev-internal-key-change-in-prod"}


@pytest.fixture
def fake_dc(monkeypatch):
    fdc = FakeDataCore()
    install_fake_datacore(monkeypatch, fdc)
    monkeypatch.setattr(settings, "internal_key", "dev-internal-key-change-in-prod")
    return fdc


@pytest.fixture
def client(fake_dc):
    return TestClient(app)


def start(client, email="parent@example.com"):
    return client.post("/internal/registration/acme/PR1/start", headers=KEY,
                       json={"school_year": "2026-2027", "applicant_email": email})


def test_all_internal_routes_require_key(client, fake_dc):
    seed_program_and_config(fake_dc)
    assert client.post("/internal/registration/acme/PR1/start",
                       json={"school_year": "x", "applicant_email": "a@b.c"}).status_code == 401
    assert client.get("/internal/registration/acme/PR1/config").status_code == 401
    assert client.post("/internal/registration/acme/request-link",
                       json={"email": "a@b.c"}).status_code == 401
    assert client.get("/internal/application-by-token/abc").status_code == 401
    assert client.post("/internal/application-by-token/abc/actions",
                       json={"action": "submit"}).status_code == 401
    assert client.get("/internal/application-by-token/abc/documents").status_code == 401
    bad = {"X-Internal-Key": "wrong"}
    assert client.get("/internal/registration/acme/PR1/config",
                      headers=bad).status_code == 401


def test_start_creates_parent_application_with_token(client, fake_dc):
    seed_program_and_config(fake_dc)
    resp = start(client)
    assert resp.status_code == 201
    data = resp.json()
    assert data["application"]["base_data"]["channel_started"] == "parent"
    assert data["application"]["base_data"]["applicant_email"] == "parent@example.com"
    assert len(data["items"]) == 4
    assert data["token"] and data["link"].endswith(data["token"])
    eid = data["application"]["entity_id"]
    assert tokens.verify_link_token(data["token"], 1) == ("acme", eid)
    acts = fake_dc.find("application_activity", application_id=eid)
    assert any(a["type"] == "email_sent" and a["to_value"].startswith("magic_link:")
               for a in acts)


def test_config_bundle_includes_capacity_state(client, fake_dc):
    seed_program_and_config(fake_dc, capacity=10)
    resp = client.get("/internal/registration/acme/PR1/config", headers=KEY)
    assert resp.status_code == 200
    data = resp.json()
    assert data["config"]["config_id"] == "cfg1"
    assert data["program"]["program_id"] == "PR1"
    assert data["capacity"] == {"capacity": 10, "approved": 0, "enrolled": 0, "full": False}
    assert client.get("/internal/registration/acme/NOPE/config",
                      headers=KEY).status_code == 404


def test_application_by_token_bundle(client, fake_dc):
    seed_program_and_config(fake_dc)
    tok = start(client).json()["token"]
    resp = client.get(f"/internal/application-by-token/{tok}", headers=KEY)
    assert resp.status_code == 200
    data = resp.json()
    assert data["application"]["status"] == "draft"
    assert len(data["items"]) == 4
    assert int(data["config"]["version"]) == 1


def test_revoked_token_is_401(client, fake_dc):
    seed_program_and_config(fake_dc)
    data = start(client).json()
    eid = data["application"]["entity_id"]
    row = fake_dc.get_entity("acme", "registration_application", eid)
    base = {k: v for k, v in row.items()
            if k not in {"entity_id", "entity_type", "_tenant"} and v is not None}
    base["token_version"] = 2
    fake_dc.dc_update("acme", "registration_application", eid, base)
    resp = client.get(f"/internal/application-by-token/{data['token']}", headers=KEY)
    assert resp.status_code == 401


def test_parent_action_subset_enforced(client, fake_dc):
    seed_program_and_config(fake_dc)
    tok = start(client).json()["token"]
    for forbidden in ("approve", "decline", "verify_item", "record_offline_payment",
                      "publish_config", "promote_waitlist"):
        resp = client.post(f"/internal/application-by-token/{tok}/actions",
                           headers=KEY, json={"action": forbidden})
        assert resp.status_code == 403, forbidden


def test_parent_can_complete_and_submit(client, fake_dc):
    seed_program_and_config(fake_dc)
    data = start(client).json()
    tok = data["token"]
    eid = data["application"]["entity_id"]
    assert client.post(f"/internal/application-by-token/{tok}/actions", headers=KEY,
                       json={"action": "save_draft",
                             "draft_data": {"student": {"first_name": "Mia"}}}
                       ).status_code == 200
    for item in data["items"]:
        if item["base_data"]["blocking"]:
            assert client.post(f"/internal/application-by-token/{tok}/actions", headers=KEY,
                               json={"action": "complete_item",
                                     "item_id": item["entity_id"]}).status_code == 200
    assert client.post(f"/internal/application-by-token/{tok}/actions", headers=KEY,
                       json={"action": "submit"}).status_code == 200
    row = fake_dc.get_entity("acme", "registration_application", eid)
    assert row["status"] == "submitted"
    items = fake_dc.find("application_item", application_id=eid)
    assert all(i["completed_by"] == "parent" for i in items if i["status"] == "submitted")


def test_request_link_always_200_and_sends_only_on_match(client, fake_dc):
    seed_program_and_config(fake_dc)
    eid = start(client).json()["application"]["entity_id"]
    before = len([a for a in fake_dc.find("application_activity", application_id=eid)
                  if a["type"] == "email_sent"])
    resp = client.post("/internal/registration/acme/request-link", headers=KEY,
                       json={"email": "stranger@example.com"})
    assert resp.status_code == 200 and resp.json() == {}
    after_miss = len([a for a in fake_dc.find("application_activity", application_id=eid)
                      if a["type"] == "email_sent"])
    assert after_miss == before
    resp = client.post("/internal/registration/acme/request-link", headers=KEY,
                       json={"email": "  PARENT@example.com ", "program_id": "PR1"})
    assert resp.status_code == 200 and resp.json() == {}
    after_hit = len([a for a in fake_dc.find("application_activity", application_id=eid)
                     if a["type"] == "email_sent"])
    assert after_hit == before + 1


def test_documents_route_filters_sensitive_foreign_uploads(client, fake_dc):
    seed_program_and_config(fake_dc)
    started = start(client).json()
    eid = started["application"]["entity_id"]
    tok = started["token"]
    fake_dc.dc_create("acme", "document", {
        "application_id": eid, "item_id": "i-doc", "filename": "own-upload.pdf",
        "content_type": "application/pdf", "size": 100, "storage_key": "k1",
        "sensitive": True, "uploaded_by": f"parent:{eid}", "uploaded_at": "2026-08-03"})
    fake_dc.dc_create("acme", "document", {
        "application_id": eid, "item_id": "i-doc2", "filename": "staff-medical.pdf",
        "content_type": "application/pdf", "size": 100, "storage_key": "k2",
        "sensitive": True, "uploaded_by": "u1", "uploaded_at": "2026-08-03"})
    fake_dc.dc_create("acme", "document", {
        "application_id": eid, "item_id": "i-doc3", "filename": "staff-plain.pdf",
        "content_type": "application/pdf", "size": 100, "storage_key": "k3",
        "sensitive": False, "uploaded_by": "u1", "uploaded_at": "2026-08-03"})
    resp = client.get(f"/internal/application-by-token/{tok}/documents", headers=KEY)
    assert resp.status_code == 200
    docs = resp.json()["documents"]
    names = sorted(d["filename"] for d in docs)
    assert names == ["own-upload.pdf", "staff-plain.pdf"]
    assert set(docs[0]) == {"entity_id", "document_id", "filename", "uploaded_by", "item_id"}


def test_non_sensitive_staff_document_is_visible_to_parent(client, fake_dc):
    """C1 regression. `sensitive: False` reads back as the STRING "false",
    which is truthy, so before the `as_bool` coercion `not d.get("sensitive")`
    was always False and EVERY document not uploaded by this parent was
    hidden — including non-sensitive ones a school uploads for them.
    """
    seed_program_and_config(fake_dc)
    started = start(client).json()
    eid = started["application"]["entity_id"]
    tok = started["token"]
    created = fake_dc.dc_create("acme", "document", {
        "application_id": eid, "item_id": "i-doc", "filename": "staff-handbook.pdf",
        "content_type": "application/pdf", "size": 100, "storage_key": "k1",
        "sensitive": False, "uploaded_by": "u1", "uploaded_at": "2026-08-03"})
    stored = fake_dc.get_entity("acme", "document", created["entity_id"])
    assert stored["sensitive"] == "false" and bool(stored["sensitive"]) is True

    resp = client.get(f"/internal/application-by-token/{tok}/documents", headers=KEY)
    assert resp.status_code == 200
    assert [d["filename"] for d in resp.json()["documents"]] == ["staff-handbook.pdf"]
