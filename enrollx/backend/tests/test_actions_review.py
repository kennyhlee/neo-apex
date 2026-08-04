"""Staff review actions on the single action endpoint."""
import pytest
from fastapi.testclient import TestClient

from app.auth import require_authenticated_user
from app.main import app
from app.registration import tokens
from tests.fakes import FakeDataCore, install_fake_datacore, seed_config


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


def submitted_application(client, fake_dc, capacity=None):
    seed_config(fake_dc, capacity=capacity)
    resp = client.post("/api/registration/acme/applications", json={
        "school_year": "2026-2027", "channel": "admin",
        "applicant_email": "parent@example.com"})
    created = resp.json()
    eid = created["application"]["entity_id"]
    for item in created["items"]:
        if item["base_data"]["blocking"]:
            act(client, eid, "complete_item", item_id=item["entity_id"])
    act(client, eid, "submit")
    return created


def item_by_title(created, title):
    return next(i for i in created["items"] if i["base_data"]["title"] == title)


# ── verify_item ─────────────────────────────────────────────────────────

def test_verify_item_requires_submitted_state(client, fake_dc):
    created = submitted_application(client, fake_dc)
    eid = created["application"]["entity_id"]
    report_card = item_by_title(created, "Report Card")  # non-blocking, not_started
    assert act(client, eid, "verify_item", item_id=report_card["entity_id"]).status_code == 409


def test_verify_item_happy(client, fake_dc):
    created = submitted_application(client, fake_dc)
    eid = created["application"]["entity_id"]
    form = item_by_title(created, "Student Info")
    assert act(client, eid, "verify_item", item_id=form["entity_id"]).status_code == 200
    assert fake_dc.get_entity("acme", "application_item", form["entity_id"])["status"] == "verified"


def test_verify_item_wrong_application_404(client, fake_dc):
    a = submitted_application(client, fake_dc)
    b = submitted_application(client, fake_dc)
    a_eid = a["application"]["entity_id"]
    b_form = item_by_title(b, "Student Info")
    # Item belongs to application B; try to act on it via application A's path.
    resp = act(client, a_eid, "verify_item", item_id=b_form["entity_id"])
    assert resp.status_code == 404


# ── reject_item ─────────────────────────────────────────────────────────

def test_reject_item_flips_to_pending_items_and_emails(client, fake_dc):
    created = submitted_application(client, fake_dc)
    eid = created["application"]["entity_id"]
    doc = item_by_title(created, "Immunization Record")
    resp = act(client, eid, "reject_item", item_id=doc["entity_id"], reason="blurry scan")
    assert resp.status_code == 200
    assert fake_dc.get_entity("acme", "application_item", doc["entity_id"])["status"] == "rejected"
    assert fake_dc.get_entity("acme", "registration_application", eid)["status"] == "pending_items"
    acts = fake_dc.find("application_activity", application_id=eid)
    assert any(a["type"] == "email_sent" and a["to_value"].startswith("action_needed:")
               for a in acts)


def test_complete_rejected_item_returns_to_in_review(client, fake_dc):
    created = submitted_application(client, fake_dc)
    eid = created["application"]["entity_id"]
    doc = item_by_title(created, "Immunization Record")
    act(client, eid, "reject_item", item_id=doc["entity_id"])
    assert act(client, eid, "complete_item", item_id=doc["entity_id"]).status_code == 200
    assert fake_dc.get_entity("acme", "registration_application", eid)["status"] == "in_review"


def test_reject_item_on_approved_application_leaves_status_approved(client, fake_dc):
    # approved -> pending_items is deliberately not a legal transition; reject_item
    # must still reject the item and email, but must not touch application status.
    created = submitted_application(client, fake_dc)
    eid = created["application"]["entity_id"]
    # Simulate a later-task approve() having run: mutate the row in place
    # (get_entity/list_entities return copies, so this must touch fdc.rows itself).
    for row in fake_dc.rows:
        if row["entity_type"] == "registration_application" and row["entity_id"] == eid:
            row["status"] = "approved"
    doc = item_by_title(created, "Immunization Record")
    resp = act(client, eid, "reject_item", item_id=doc["entity_id"])
    assert resp.status_code == 200
    assert fake_dc.get_entity("acme", "application_item", doc["entity_id"])["status"] == "rejected"
    assert fake_dc.get_entity("acme", "registration_application", eid)["status"] == "approved"


def test_reject_item_wrong_application_404(client, fake_dc):
    a = submitted_application(client, fake_dc)
    b = submitted_application(client, fake_dc)
    a_eid = a["application"]["entity_id"]
    b_doc = item_by_title(b, "Immunization Record")
    resp = act(client, a_eid, "reject_item", item_id=b_doc["entity_id"])
    assert resp.status_code == 404


# ── waive_item ──────────────────────────────────────────────────────────

def test_waive_item(client, fake_dc):
    created = submitted_application(client, fake_dc)
    eid = created["application"]["entity_id"]
    report_card = item_by_title(created, "Report Card")
    assert act(client, eid, "waive_item", item_id=report_card["entity_id"]).status_code == 200
    assert fake_dc.get_entity("acme", "application_item",
                              report_card["entity_id"])["status"] == "waived"


def test_waive_item_already_final_409(client, fake_dc):
    created = submitted_application(client, fake_dc)
    eid = created["application"]["entity_id"]
    form = item_by_title(created, "Student Info")
    assert act(client, eid, "verify_item", item_id=form["entity_id"]).status_code == 200
    # verified is a final item status; waiving it again is not a legal transition.
    assert act(client, eid, "waive_item", item_id=form["entity_id"]).status_code == 409


# ── request_changes ─────────────────────────────────────────────────────

def test_request_changes_with_note(client, fake_dc):
    created = submitted_application(client, fake_dc)
    eid = created["application"]["entity_id"]
    resp = act(client, eid, "request_changes", note="please redo the form")
    assert resp.status_code == 200
    assert fake_dc.get_entity("acme", "registration_application", eid)["status"] == "pending_items"
    acts = fake_dc.find("application_activity", application_id=eid)
    assert any(a["type"] == "note" and a["to_value"] == "please redo the form" for a in acts)


def test_request_changes_illegal_transition_409(client, fake_dc):
    created = submitted_application(client, fake_dc)
    eid = created["application"]["entity_id"]
    assert act(client, eid, "decline").status_code == 200
    # declined has no outgoing transitions, including to pending_items.
    assert act(client, eid, "request_changes", note="x").status_code == 409


# ── decline ─────────────────────────────────────────────────────────────

def test_decline_stamps_decided_at_and_emails(client, fake_dc):
    created = submitted_application(client, fake_dc)
    eid = created["application"]["entity_id"]
    assert act(client, eid, "decline").status_code == 200
    row = fake_dc.get_entity("acme", "registration_application", eid)
    assert row["status"] == "declined"
    assert row["decided_at"]
    acts = fake_dc.find("application_activity", application_id=eid)
    assert any(a["type"] == "email_sent" and a["to_value"].startswith("status_change:")
               for a in acts)


def test_decline_illegal_transition_409(client, fake_dc):
    seed_config(fake_dc)
    resp = client.post("/api/registration/acme/applications", json={
        "school_year": "2026-2027", "channel": "admin",
        "applicant_email": "parent@example.com"})
    eid = resp.json()["application"]["entity_id"]
    # Still in draft: draft -> declined is not an allowed transition.
    assert act(client, eid, "decline").status_code == 409


# ── promote_waitlist ────────────────────────────────────────────────────

def test_promote_waitlist(client, fake_dc):
    # capacity=1 with one seat already taken for THIS school year forces the
    # waitlist. (capacity=0 no longer works for this: spec §2 defines an
    # absent or zero tenant capacity as unlimited, not as "full".)
    fake_dc.dc_create("acme", "registration_application", {
        "application_id": "A0", "school_year": "2026-2027", "status": "approved"})
    created = submitted_application(client, fake_dc, capacity=1)
    eid = created["application"]["entity_id"]
    assert fake_dc.get_entity("acme", "registration_application", eid)["status"] == "waitlisted"
    assert act(client, eid, "promote_waitlist").status_code == 200
    assert fake_dc.get_entity("acme", "registration_application", eid)["status"] == "in_review"


def test_promote_waitlist_illegal_transition_409(client, fake_dc):
    created = submitted_application(client, fake_dc)
    eid = created["application"]["entity_id"]
    # declined has no outgoing transitions at all, including to in_review.
    assert act(client, eid, "decline").status_code == 200
    assert act(client, eid, "promote_waitlist").status_code == 409


# ── resend_link ─────────────────────────────────────────────────────────

def test_resend_link_returns_link_and_logs(client, fake_dc):
    created = submitted_application(client, fake_dc)
    eid = created["application"]["entity_id"]
    resp = act(client, eid, "resend_link")
    assert resp.status_code == 200
    assert "/application/" in resp.json()["link"]
    acts = fake_dc.find("application_activity", application_id=eid)
    assert any(a["type"] == "email_sent" and a["to_value"].startswith("magic_link:")
               for a in acts)


def test_resend_link_email_subject_keeps_the_school_label(client, fake_dc):
    """M1 regression. _resend_link rebound app_row to
    engine.update_application's return value, which is a
    {entity_id, entity_type, base_data} ENVELOPE rather than a flattened row.
    _school_label(envelope) then lost the school_year, silently dropping half
    the label from the resend email subject.
    """
    sent = []
    monkey = __import__("app.registration.emails", fromlist=["emails"])
    original = monkey.send_email
    monkey.send_email = lambda to, subject, body_html: (
        sent.append((to, subject, body_html)) or original(to, subject, body_html))
    try:
        created = submitted_application(client, fake_dc)
        eid = created["application"]["entity_id"]
        sent.clear()
        assert act(client, eid, "resend_link").status_code == 200
    finally:
        monkey.send_email = original

    assert sent, "no email was sent"
    to, subject, body_html = sent[-1]
    assert subject == "Your registration link \u2014 Acme Afterschool 2026-2027"
    assert "Acme Afterschool 2026-2027" in body_html


def test_resend_link_400_without_email(client, fake_dc):
    seed_config(fake_dc)
    resp = client.post("/api/registration/acme/applications", json={
        "school_year": "2026-2027", "channel": "admin"})
    eid = resp.json()["application"]["entity_id"]
    assert act(client, eid, "resend_link").status_code == 400


def test_resend_link_invalidates_previous_token(client, fake_dc):
    created = submitted_application(client, fake_dc)
    eid = created["application"]["entity_id"]

    row_before = fake_dc.get_entity("acme", "registration_application", eid)
    version_before = int(row_before.get("token_version") or 1)
    old_token = tokens.make_link_token("acme", eid, version_before)
    # Old token verifies against the pre-resend version.
    assert tokens.verify_link_token(old_token, version_before) == ("acme", eid)

    resp = act(client, eid, "resend_link")
    assert resp.status_code == 200

    row_after = fake_dc.get_entity("acme", "registration_application", eid)
    version_after = int(row_after.get("token_version") or 1)
    assert version_after != version_before

    # The old token, checked against the NEW stored token_version, must fail.
    with pytest.raises(tokens.TokenError):
        tokens.verify_link_token(old_token, version_after)

    # The freshly returned link embeds a token that verifies against the new version.
    new_link = resp.json()["link"]
    new_token = new_link.rsplit("/application/", 1)[1]
    assert tokens.verify_link_token(new_token, version_after) == ("acme", eid)


# ── record_offline_payment ──────────────────────────────────────────────

def test_record_offline_payment(client, fake_dc):
    created = submitted_application(client, fake_dc)
    eid = created["application"]["entity_id"]
    payment_item = item_by_title(created, "Payment")
    resp = act(client, eid, "record_offline_payment",
               item_id=payment_item["entity_id"], amount=10000, kind="deposit")
    assert resp.status_code == 200
    pay = fake_dc.find("payment", application_id=eid)[0]
    assert pay["provider"] == "offline" and int(pay["amount"]) == 10000
    assert pay["recorded_by"] == "u1" and pay["kind"] == "deposit"
    assert fake_dc.get_entity("acme", "application_item",
                              payment_item["entity_id"])["status"] == "verified"


def test_record_offline_payment_requires_int_amount_and_payment_item(client, fake_dc):
    created = submitted_application(client, fake_dc)
    eid = created["application"]["entity_id"]
    payment_item = item_by_title(created, "Payment")
    form_item = item_by_title(created, "Student Info")
    assert act(client, eid, "record_offline_payment",
               item_id=payment_item["entity_id"], amount="100.50").status_code == 400
    assert act(client, eid, "record_offline_payment",
               item_id=form_item["entity_id"], amount=100).status_code == 400


def test_record_offline_payment_wrong_application_404(client, fake_dc):
    a = submitted_application(client, fake_dc)
    b = submitted_application(client, fake_dc)
    a_eid = a["application"]["entity_id"]
    b_payment_item = item_by_title(b, "Payment")
    resp = act(client, a_eid, "record_offline_payment",
               item_id=b_payment_item["entity_id"], amount=10000)
    assert resp.status_code == 404
