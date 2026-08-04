"""Engine core: creation with item derivation, capacity boundary, status
writes with activity logging, payment settlement."""
import pytest
from fastapi import HTTPException

from app.registration import engine
from tests.fakes import FakeDataCore, install_fake_datacore, seed_program_and_config


@pytest.fixture
def fake_dc(monkeypatch):
    fdc = FakeDataCore()
    install_fake_datacore(monkeypatch, fdc)
    return fdc


def test_create_application_derives_items_and_logs(fake_dc):
    seed_program_and_config(fake_dc)
    result = engine.create_application("acme", "PR1", "2026-2027", "admin",
                                       "parent@example.com", actor="u1")
    app_bd = result["application"]["base_data"]
    assert app_bd["status"] == "draft"
    assert app_bd["config_version"] == 1
    assert app_bd["token_version"] == 1
    assert app_bd["channel_started"] == "admin"
    assert app_bd["applicant_email"] == "parent@example.com"
    assert app_bd["application_id"] == app_bd["registration_application_id"]
    assert len(result["items"]) == 4
    eid = result["application"]["entity_id"]
    items = fake_dc.find("application_item", application_id=eid)
    assert len(items) == 4
    assert all(i["status"] == "not_started" for i in items)
    acts = fake_dc.find("application_activity", application_id=eid)
    assert [a["type"] for a in acts] == ["status_change"]
    assert acts[0]["to_value"] == "draft"


def test_create_application_404_without_published_config(fake_dc):
    with pytest.raises(HTTPException) as exc:
        engine.create_application("acme", "PRX", "2026-2027", "admin", None, actor="u1")
    assert exc.value.status_code == 404


def test_capacity_boundary(fake_dc):
    seed_program_and_config(fake_dc, capacity=2)
    fake_dc.dc_create("acme", "registration_application",
                      {"application_id": "A1", "program_id": "PR1", "status": "approved"})
    fake_dc.dc_create("acme", "enrollment",
                      {"program_id": "PR1", "student_id": "s1", "status": "active"})
    state = engine.capacity_state("acme", "PR1")
    assert state == {"capacity": 2, "approved": 1, "enrolled": 1, "full": True}
    assert engine.is_capacity_full("acme", "PR1") is True


def test_capacity_open_below_limit_and_without_capacity(fake_dc):
    seed_program_and_config(fake_dc, capacity=5)
    assert engine.is_capacity_full("acme", "PR1") is False
    seed_program_and_config(fake_dc, program_id="PR2")  # no capacity field
    assert engine.is_capacity_full("acme", "PR2") is False


def test_set_application_status_guards_and_logs(fake_dc):
    created = fake_dc.dc_create("acme", "registration_application",
                                {"application_id": "A1", "program_id": "PR1",
                                 "status": "draft", "school_year": "2026-2027"})
    row = fake_dc.get_entity("acme", "registration_application", created["entity_id"])
    with pytest.raises(HTTPException) as exc:
        engine.set_application_status("acme", row, "approved", actor="u1")
    assert exc.value.status_code == 409
    engine.set_application_status("acme", row, "submitted", actor="u1",
                                  extra_changes={"submitted_at": engine.now_iso()})
    updated = fake_dc.get_entity("acme", "registration_application", created["entity_id"])
    assert updated["status"] == "submitted"
    assert updated["submitted_at"]
    assert updated["school_year"] == "2026-2027"  # untouched fields preserved
    acts = fake_dc.find("application_activity", application_id=created["entity_id"])
    assert acts and acts[-1]["from_value"] == "draft" and acts[-1]["to_value"] == "submitted"


def test_blocking_items_complete_table():
    cases = [
        ([], True),
        ([{"blocking": True, "status": "submitted"}], True),
        ([{"blocking": True, "status": "verified"}], True),
        ([{"blocking": True, "status": "waived"}], True),
        ([{"blocking": True, "status": "not_started"}], False),
        ([{"blocking": True, "status": "rejected"}], False),
        ([{"blocking": False, "status": "not_started"}], True),
        ([{"blocking": True, "status": "submitted"},
          {"blocking": True, "status": "in_progress"}], False),
    ]
    for items, expected in cases:
        assert engine.blocking_items_complete(items) is expected, items


def test_settle_payment_item(fake_dc):
    app = fake_dc.dc_create("acme", "registration_application",
                            {"application_id": "A1", "program_id": "PR1", "status": "submitted"})
    item = fake_dc.dc_create("acme", "application_item", {
        "item_id": "i1", "application_id": app["entity_id"], "block_id": "b4",
        "kind": "payment", "title": "Payment", "status": "not_started", "blocking": True})
    item_row = fake_dc.get_entity("acme", "application_item", item["entity_id"])
    result = engine.settle_payment_item(
        "acme", app["entity_id"], item_row, provider="offline", kind="full",
        amount=50000, recorded_by="u1", actor="u1")
    pay = fake_dc.find("payment", application_id=app["entity_id"])[0]
    assert pay["amount"] == 50000 and pay["provider"] == "offline"
    assert pay["status"] == "paid" and pay["recorded_by"] == "u1"
    updated_item = fake_dc.get_entity("acme", "application_item", item["entity_id"])
    assert updated_item["status"] == "verified"
    assert updated_item["payload_ref"] == result["payment"]["entity_id"]
    acts = fake_dc.find("application_activity", application_id=app["entity_id"])
    assert any(a["type"] == "item_change" for a in acts)


def test_settle_payment_item_idempotent_on_provider_ref(fake_dc):
    """Simulates a retried Stripe webhook delivery: the second call reuses
    the SAME stale item_row snapshot (still 'not_started') the first call
    used, the way two concurrent/retried deliveries both fetching before
    either writes would. Fixes double-settlement on retry."""
    app = fake_dc.dc_create("acme", "registration_application",
                            {"application_id": "A1", "program_id": "PR1", "status": "submitted"})
    item = fake_dc.dc_create("acme", "application_item", {
        "item_id": "i1", "application_id": app["entity_id"], "block_id": "b4",
        "kind": "payment", "title": "Payment", "status": "not_started", "blocking": True})
    stale_item_row = fake_dc.get_entity("acme", "application_item", item["entity_id"])

    result1 = engine.settle_payment_item(
        "acme", app["entity_id"], stale_item_row, provider="stripe", kind="full",
        amount=50000, provider_ref="cs_test_123", actor="webhook")
    assert result1["already_settled"] is False

    result2 = engine.settle_payment_item(
        "acme", app["entity_id"], stale_item_row, provider="stripe", kind="full",
        amount=50000, provider_ref="cs_test_123", actor="webhook")
    assert result2["already_settled"] is True
    assert result2["payment"]["entity_id"] == result1["payment"]["entity_id"]

    payments = fake_dc.find("payment", application_id=app["entity_id"], provider_ref="cs_test_123")
    assert len(payments) == 1

    updated_item = fake_dc.get_entity("acme", "application_item", item["entity_id"])
    assert updated_item["status"] == "verified"

    acts = fake_dc.find("application_activity", application_id=app["entity_id"], type="item_change")
    assert len(acts) == 1


def test_settle_payment_item_different_provider_refs_create_two_rows(fake_dc):
    app = fake_dc.dc_create("acme", "registration_application",
                            {"application_id": "A1", "program_id": "PR1", "status": "submitted"})
    item1 = fake_dc.dc_create("acme", "application_item", {
        "item_id": "i1", "application_id": app["entity_id"], "block_id": "b4",
        "kind": "payment", "title": "Payment A", "status": "not_started", "blocking": True})
    item2 = fake_dc.dc_create("acme", "application_item", {
        "item_id": "i2", "application_id": app["entity_id"], "block_id": "b4b",
        "kind": "payment", "title": "Payment B", "status": "not_started", "blocking": True})

    engine.settle_payment_item(
        "acme", app["entity_id"],
        fake_dc.get_entity("acme", "application_item", item1["entity_id"]),
        provider="stripe", kind="full", amount=50000,
        provider_ref="cs_test_A", actor="webhook")
    engine.settle_payment_item(
        "acme", app["entity_id"],
        fake_dc.get_entity("acme", "application_item", item2["entity_id"]),
        provider="stripe", kind="full", amount=25000,
        provider_ref="cs_test_B", actor="webhook")

    payments = fake_dc.find("payment", application_id=app["entity_id"])
    assert len(payments) == 2
    assert {p["provider_ref"] for p in payments} == {"cs_test_A", "cs_test_B"}


def test_settle_payment_item_rejects_non_payment_and_double_pay(fake_dc):
    app = fake_dc.dc_create("acme", "registration_application",
                            {"application_id": "A1", "program_id": "PR1", "status": "submitted"})
    form = fake_dc.dc_create("acme", "application_item", {
        "item_id": "i1", "application_id": app["entity_id"], "block_id": "b1",
        "kind": "form", "title": "Form", "status": "submitted", "blocking": True})
    with pytest.raises(HTTPException) as exc:
        engine.settle_payment_item("acme", app["entity_id"],
                                   fake_dc.get_entity("acme", "application_item", form["entity_id"]),
                                   provider="offline", kind="full", amount=1)
    assert exc.value.status_code == 400
    paid = fake_dc.dc_create("acme", "application_item", {
        "item_id": "i2", "application_id": app["entity_id"], "block_id": "b4",
        "kind": "payment", "title": "Payment", "status": "verified", "blocking": True})
    with pytest.raises(HTTPException) as exc:
        engine.settle_payment_item("acme", app["entity_id"],
                                   fake_dc.get_entity("acme", "application_item", paid["entity_id"]),
                                   provider="offline", kind="full", amount=1)
    assert exc.value.status_code == 409
