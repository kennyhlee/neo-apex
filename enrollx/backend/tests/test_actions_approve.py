"""Approve: family match-or-create, student + enrollment creation, due dates,
enrolled derivation."""
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


def act(client, app_eid, action, **params):
    return client.post(f"/api/registration/acme/applications/{app_eid}/actions",
                       json={"action": action, **params})


DRAFT = {
    "student": {"first_name": "Mia", "last_name": "Lee", "grade_level": "3"},
    "family": {"family_name": "Lee Family", "primary_email": "parent@example.com",
               "primary_phone": "5551234567", "primary_address": "1 Main St"},
}


def submitted_application(client, fake_dc):
    seed_program_and_config(fake_dc)
    resp = client.post("/api/registration/acme/applications", json={
        "program_id": "PR1", "school_year": "2026-2027", "channel": "admin",
        "applicant_email": "parent@example.com"})
    created = resp.json()
    eid = created["application"]["entity_id"]
    act(client, eid, "save_draft", draft_data=DRAFT)
    for item in created["items"]:
        if item["base_data"]["blocking"]:
            act(client, eid, "complete_item", item_id=item["entity_id"])
    act(client, eid, "submit")
    return created


def test_approve_only_from_submitted_or_in_review(client, fake_dc):
    seed_program_and_config(fake_dc)
    resp = client.post("/api/registration/acme/applications", json={
        "program_id": "PR1", "school_year": "2026-2027", "channel": "admin"})
    eid = resp.json()["application"]["entity_id"]
    assert act(client, eid, "approve").status_code == 409  # still draft


def test_approve_creates_family_student_enrollment(client, fake_dc):
    created = submitted_application(client, fake_dc)
    eid = created["application"]["entity_id"]
    resp = act(client, eid, "approve")
    assert resp.status_code == 200
    data = resp.json()
    fam = fake_dc.find("family", primary_email="parent@example.com")
    assert len(fam) == 1 and fam[0]["entity_id"] == data["family_id"]
    student = fake_dc.find("student", first_name="Mia")[0]
    assert student["entity_id"] == data["student_id"]
    assert student["family_id"] == data["family_id"]
    assert student["status"] == "Enrolled"
    assert student["grade_level"] == "3"
    enrollment = fake_dc.find("enrollment", student_id=data["student_id"])[0]
    assert enrollment["program_id"] == "PR1" and enrollment["status"] == "active"
    assert enrollment["entity_id"] == data["enrollment_id"]
    row = fake_dc.get_entity("acme", "registration_application", eid)
    assert row["status"] == "approved"
    assert row["family_id"] == data["family_id"]
    assert row["student_id"] == data["student_id"]
    assert row["decided_at"]
    acts = fake_dc.find("application_activity", application_id=eid)
    assert any(a["type"] == "email_sent" and a["to_value"].startswith("status_change:")
               for a in acts)


def test_approve_matches_existing_family(client, fake_dc):
    existing = fake_dc.dc_create("acme", "family", {
        "family_name": "Lee", "primary_email": "PARENT@example.com"})
    created = submitted_application(client, fake_dc)
    resp = act(client, created["application"]["entity_id"], "approve")
    assert resp.json()["family_id"] == existing["entity_id"]
    assert len(fake_dc.find("family")) == 1


def test_approve_stamps_due_dates_on_unfinished_items(client, fake_dc):
    created = submitted_application(client, fake_dc)
    eid = created["application"]["entity_id"]
    act(client, eid, "approve")
    items = fake_dc.find("application_item", application_id=eid)
    report_card = next(i for i in items if i["title"] == "Report Card")
    assert report_card["due_at"]  # 14 days after approval
    form = next(i for i in items if i["title"] == "Student Info")
    assert not form.get("due_at")


def test_enrolled_derivation_after_all_items_closed(client, fake_dc):
    created = submitted_application(client, fake_dc)
    eid = created["application"]["entity_id"]
    act(client, eid, "approve")
    items = fake_dc.find("application_item", application_id=eid)
    last = None
    for item in items:
        if item["status"] == "submitted":
            last = act(client, eid, "verify_item", item_id=item["entity_id"])
        elif item["status"] not in {"verified", "waived"}:
            last = act(client, eid, "waive_item", item_id=item["entity_id"])
        assert last.status_code == 200
    row = fake_dc.get_entity("acme", "registration_application", eid)
    assert row["status"] == "enrolled"
    acts = fake_dc.find("application_activity", application_id=eid)
    assert any(a["from_value"] == "approved" and a["to_value"] == "enrolled" for a in acts)
