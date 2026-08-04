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


# ── I5: the link-verified address outranks parent free text ───────────────

def test_draft_email_cannot_override_present_applicant_email(client, fake_dc):
    """I5 regression. `draft.family.primary_email` is free text a parent can
    change via save_draft; `applicant_email` is the address the magic link was
    actually delivered to. Preferring the draft value let a parent type another
    family's email and have their student silently attached to that family.
    """
    victim = fake_dc.dc_create("acme", "family", {
        "family_name": "Other Family", "primary_email": "victim@example.com"})

    seed_program_and_config(fake_dc)
    resp = client.post("/api/registration/acme/applications", json={
        "program_id": "PR1", "school_year": "2026-2027", "channel": "admin",
        "applicant_email": "parent@example.com"})
    created = resp.json()
    eid = created["application"]["entity_id"]
    # Parent claims someone else's email in the draft.
    hostile = {**DRAFT, "family": {**DRAFT["family"],
                                   "primary_email": "victim@example.com"}}
    act(client, eid, "save_draft", draft_data=hostile)
    for item in created["items"]:
        if item["base_data"]["blocking"]:
            act(client, eid, "complete_item", item_id=item["entity_id"])
    act(client, eid, "submit")

    data = act(client, eid, "approve").json()
    assert data["family_id"] != victim["entity_id"], \
        "draft email hijacked an existing family"
    matched = fake_dc.get_entity("acme", "family", data["family_id"])
    assert matched["primary_email"] == "parent@example.com"


def test_draft_email_is_used_when_no_applicant_email(client, fake_dc):
    """The draft value stays a FALLBACK — staff-created applications with no
    applicant_email still match on it."""
    existing = fake_dc.dc_create("acme", "family", {
        "family_name": "Lee", "primary_email": "draft-only@example.com"})
    seed_program_and_config(fake_dc)
    created = client.post("/api/registration/acme/applications", json={
        "program_id": "PR1", "school_year": "2026-2027", "channel": "admin"}).json()
    eid = created["application"]["entity_id"]
    act(client, eid, "save_draft", draft_data={
        **DRAFT, "family": {**DRAFT["family"],
                            "primary_email": "draft-only@example.com"}})
    for item in created["items"]:
        if item["base_data"]["blocking"]:
            act(client, eid, "complete_item", item_id=item["entity_id"])
    act(client, eid, "submit")
    assert act(client, eid, "approve").json()["family_id"] == existing["entity_id"]


def test_approve_logs_which_family_it_matched_or_created(client, fake_dc):
    """I5: the family linkage was invisible in the audit trail."""
    created = submitted_application(client, fake_dc)
    eid = created["application"]["entity_id"]
    data = act(client, eid, "approve").json()
    acts = fake_dc.find("application_activity", application_id=eid)
    notes = [a["to_value"] for a in acts if a["type"] == "note"]
    assert f"family_created:{data['family_id']}" in notes

    # A second application matching the same family logs `family_matched`.
    second = submitted_application(client, fake_dc)
    second_eid = second["application"]["entity_id"]
    second_data = act(client, second_eid, "approve").json()
    assert second_data["family_id"] == data["family_id"]
    second_notes = [a["to_value"] for a in
                    fake_dc.find("application_activity", application_id=second_eid)
                    if a["type"] == "note"]
    assert f"family_matched:{data['family_id']}" in second_notes


# ── I8: approvals with no identifying data must not mint junk ─────────────

def _submitted_with_draft(client, fake_dc, draft, applicant_email=None):
    seed_program_and_config(fake_dc)
    body = {"program_id": "PR1", "school_year": "2026-2027", "channel": "admin"}
    if applicant_email:
        body["applicant_email"] = applicant_email
    created = client.post("/api/registration/acme/applications", json=body).json()
    eid = created["application"]["entity_id"]
    if draft is not None:
        act(client, eid, "save_draft", draft_data=draft)
    for item in created["items"]:
        if item["base_data"]["blocking"]:
            act(client, eid, "complete_item", item_id=item["entity_id"])
    assert act(client, eid, "submit").status_code == 200
    return eid


def test_approve_422_when_no_family_identifying_data(client, fake_dc):
    """I8. A staff-created application with no applicant_email and empty items
    used to approve into a brand-new family literally named "Family", one per
    approval."""
    eid = _submitted_with_draft(client, fake_dc, None)
    resp = act(client, eid, "approve")
    assert resp.status_code == 422
    detail = resp.json()["detail"]
    assert "no family-identifying data" in detail["error"]
    assert any("primary_email" in m for m in detail["missing"])
    # Nothing was created.
    assert fake_dc.find("family") == []
    assert fake_dc.find("student") == []
    assert fake_dc.find("enrollment") == []
    assert fake_dc.get_entity("acme", "registration_application",
                              eid)["status"] == "submitted"


def test_approve_422_when_student_has_no_name(client, fake_dc):
    """I8, second half: family data present but the student is nameless."""
    eid = _submitted_with_draft(client, fake_dc, {
        "family": {"primary_email": "someone@example.com"},
        "student": {"first_name": "  ", "last_name": ""}})
    resp = act(client, eid, "approve")
    assert resp.status_code == 422
    assert "no student name" in resp.json()["detail"]["error"]
    assert fake_dc.find("student") == []
    # The family guard passed, so no family should have been minted either —
    # the student check runs before any write.
    assert fake_dc.find("family") == []


def test_approve_succeeds_with_only_a_phone_signature(client, fake_dc):
    """The guard accepts any of the three signature forms, not just email."""
    eid = _submitted_with_draft(client, fake_dc, {
        "family": {"primary_phone": "(555) 987-6543"},
        "student": {"first_name": "Ana", "last_name": "Diaz"}})
    resp = act(client, eid, "approve")
    assert resp.status_code == 200
    assert fake_dc.find("student", first_name="Ana")


def test_approve_succeeds_with_only_a_family_name(client, fake_dc):
    """The I8 guard must reject only the genuinely-empty case.

    A family_name yields NO match signature (signature_key needs email, phone,
    or name+address), but it is perfectly good identifying data — family.py's
    documented solo rule handles it by always creating, never deduping. An
    earlier, broader guard keyed on signature_key alone made that documented
    path unreachable through _approve while
    test_no_signature_creates_solo_family still asserted it.
    """
    eid = _submitted_with_draft(client, fake_dc, {
        "family": {"family_name": "Okonkwo"},
        "student": {"first_name": "Chidi", "last_name": "Okonkwo"}})
    resp = act(client, eid, "approve")
    assert resp.status_code == 200, resp.json()

    fam = fake_dc.find("family", family_name="Okonkwo")
    assert len(fam) == 1
    assert fam[0]["entity_id"] == resp.json()["family_id"]
    # Named from the draft, NOT the "Family" last-resort fallback.
    assert fam[0]["family_name"] == "Okonkwo"
    assert fake_dc.find("student", first_name="Chidi")


def test_solo_family_rule_is_reachable_through_approve(client, fake_dc):
    """Companion to test_no_signature_creates_solo_family: two name-only
    approvals produce two families, because a name alone is not a dedupe
    signature. This pins that _approve does not forbid the path that unit
    test asserts."""
    for i in range(2):
        eid = _submitted_with_draft(client, fake_dc, {
            "family": {"family_name": "Okonkwo"},
            "student": {"first_name": f"Kid{i}", "last_name": "Okonkwo"}})
        assert act(client, eid, "approve").status_code == 200
    assert len(fake_dc.find("family", family_name="Okonkwo")) == 2
