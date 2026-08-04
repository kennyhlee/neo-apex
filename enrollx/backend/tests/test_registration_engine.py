"""Engine core: creation with item derivation, single per-tenant config
lineage, school-wide capacity per school_year, status writes with activity
logging, payment settlement."""
import json

import pytest
from fastapi import HTTPException

from app.registration import engine
from tests.fakes import BLOCKS, FakeDataCore, install_fake_datacore, seed_config


@pytest.fixture
def fake_dc(monkeypatch):
    fdc = FakeDataCore()
    install_fake_datacore(monkeypatch, fdc)
    return fdc


def seed_tenant(fdc, tenant="acme", capacity=None, name="Acme Afterschool"):
    """The tenant entity's entity_id IS the tenant_id (platform invariant)."""
    base = {"name": name, "display_name": name}
    if capacity is not None:
        base["capacity"] = capacity
    fdc.rows.append(FakeDataCore._store_row(tenant, "tenant", tenant, base))


def test_create_application_derives_items_and_logs(fake_dc):
    seed_config(fake_dc)
    result = engine.create_application("acme", "2026-2027", "admin",
                                       "parent@example.com", actor="u1")
    app_bd = result["application"]["base_data"]
    assert app_bd["status"] == "draft"
    assert app_bd["config_version"] == 1
    assert app_bd["token_version"] == 1
    assert app_bd["channel_started"] == "admin"
    assert app_bd["applicant_email"] == "parent@example.com"
    assert app_bd["application_id"] == app_bd["registration_application_id"]
    assert "program_id" not in app_bd
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
        engine.create_application("acme", "2026-2027", "admin", None, actor="u1")
    assert exc.value.status_code == 404
    assert exc.value.detail == "No published registration config for this tenant"


# ── config lookup: one lineage per tenant ─────────────────────────────────

def test_published_config_is_found_without_a_program(fake_dc):
    seed_config(fake_dc)
    cfg = engine.get_published_config("acme")
    assert cfg is not None and cfg["config_id"] == "cfg1"


def test_config_for_application_resolves_the_pinned_version(fake_dc):
    seed_config(fake_dc)
    fake_dc.dc_create("acme", "registration_config", {
        "config_id": "cfg0", "version": 1, "status": "archived",
        "blocks": json.dumps(BLOCKS)})
    # cfg1 (seeded) becomes version 2 published; cfg0 is version 1 archived.
    fake_dc.dc_update("acme", "registration_config",
                      fake_dc.find("registration_config", config_id="cfg1")[0]["entity_id"],
                      {"config_id": "cfg1", "version": 2, "status": "published",
                       "blocks": json.dumps(BLOCKS)})
    pinned = engine.get_config_for_application("acme", {"config_version": 1})
    assert pinned["config_id"] == "cfg0"


def test_get_program_is_gone(fake_dc):
    """Programs play no role in registration any more (spec §1 decision table)."""
    assert not hasattr(engine, "get_program")


# ── capacity: school-wide, per school_year, applications only ─────────────

def test_capacity_state_counts_applications_for_that_school_year_only(fake_dc):
    seed_tenant(fake_dc, capacity=2)
    fake_dc.dc_create("acme", "registration_application", {
        "application_id": "A1", "school_year": "2026-2027", "status": "approved"})
    fake_dc.dc_create("acme", "registration_application", {
        "application_id": "A2", "school_year": "2026-2027", "status": "enrolled"})
    fake_dc.dc_create("acme", "registration_application", {
        "application_id": "A3", "school_year": "2027-2028", "status": "approved"})
    assert engine.capacity_state("acme", "2026-2027") == {
        "capacity": 2, "admitted": 2, "full": True}
    assert engine.is_capacity_full("acme", "2026-2027") is True
    assert engine.capacity_state("acme", "2027-2028") == {
        "capacity": 2, "admitted": 1, "full": False}


def test_capacity_ignores_enrollment_rows(fake_dc):
    """Registration no longer creates enrollment rows, and an enrollment left
    over from the activity-assignment workflow must not consume a seat."""
    seed_tenant(fake_dc, capacity=1)
    fake_dc.dc_create("acme", "enrollment", {
        "student_id": "s1", "program_id": "PR1", "status": "active"})
    assert engine.capacity_state("acme", "2026-2027")["full"] is False


def test_absent_or_zero_tenant_capacity_means_unlimited(fake_dc):
    seed_tenant(fake_dc)  # no capacity at all
    fake_dc.dc_create("acme", "registration_application", {
        "application_id": "A1", "school_year": "2026-2027", "status": "approved"})
    assert engine.capacity_state("acme", "2026-2027") == {
        "capacity": None, "admitted": 1, "full": False}

    fake_dc.rows.clear()
    seed_tenant(fake_dc, capacity=0)
    assert engine.capacity_state("acme", "2026-2027")["capacity"] is None
    assert engine.is_capacity_full("acme", "2026-2027") is False


# ── tenant label + default school year ────────────────────────────────────

def test_tenant_label_prefers_display_name_then_name_then_id(fake_dc):
    seed_tenant(fake_dc, name="Acme Afterschool")
    assert engine.tenant_label("acme") == "Acme Afterschool"
    assert engine.tenant_label("nosuchtenant") == "nosuchtenant"


@pytest.mark.parametrize("month,expected", [(7, "2026-2027"), (6, "2025-2026")])
def test_default_school_year_rolls_over_in_july(month, expected):
    import datetime
    assert engine.default_school_year(datetime.date(2026, month, 1)) == expected


def test_set_application_status_guards_and_logs(fake_dc):
    created = fake_dc.dc_create("acme", "registration_application",
                                {"application_id": "A1",
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
                            {"application_id": "A1", "status": "submitted"})
    item = fake_dc.dc_create("acme", "application_item", {
        "item_id": "i1", "application_id": app["entity_id"], "block_id": "b4",
        "kind": "payment", "title": "Payment", "status": "not_started", "blocking": True})
    item_row = fake_dc.get_entity("acme", "application_item", item["entity_id"])
    result = engine.settle_payment_item(
        "acme", app["entity_id"], item_row, provider="offline", kind="full",
        amount=50000, recorded_by="u1", actor="u1")
    pay = fake_dc.find("payment", application_id=app["entity_id"])[0]
    assert int(pay["amount"]) == 50000 and pay["provider"] == "offline"
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
                            {"application_id": "A1", "status": "submitted"})
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
                            {"application_id": "A1", "status": "submitted"})
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
                            {"application_id": "A1", "status": "submitted"})
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


# ── I6: predicates on sparsely-written fields ─────────────────────────────

def test_first_stripe_payment_in_a_tenant_settles(fake_dc):
    """I6 regression. `provider_ref` is written ONLY by settle_payment_item,
    so in a tenant with no prior Stripe payment the column does not exist and
    a SQL predicate on it is a DuckDB binder error -> 400 -> 500 out of
    enrollx. Stripe would retry that same failure forever, so the FIRST
    payment in every tenant could never settle. Blocks Plan 3's webhook.
    """
    app = fake_dc.dc_create("acme", "registration_application",
                            {"application_id": "A1", "status": "submitted"})
    item = fake_dc.dc_create("acme", "application_item", {
        "item_id": "i1", "application_id": app["entity_id"], "block_id": "b4",
        "kind": "payment", "title": "Payment", "status": "not_started",
        "blocking": True})
    # No payment row exists anywhere in this tenant yet.
    assert fake_dc.find("payment") == []

    result = engine.settle_payment_item(
        "acme", app["entity_id"],
        fake_dc.get_entity("acme", "application_item", item["entity_id"]),
        provider="stripe", kind="full", amount=50000,
        provider_ref="cs_first_ever", actor="webhook")
    assert result["already_settled"] is False
    assert len(fake_dc.find("payment")) == 1


def test_capacity_state_on_a_tenant_with_no_rows_at_all(fake_dc):
    """I6, and now genuinely reachable: this is a parent's very FIRST visit to
    a brand-new tenant's `/register/{tenant_id}`, where neither `school_year`
    nor `status` exists as a column on registration_application and the tenant
    row itself may be absent. A SQL predicate here binder-errors into a 500 on
    the one request that must not fail."""
    assert fake_dc.find("registration_application") == []
    assert engine.capacity_state("brandnew", "2026-2027") == {
        "capacity": None, "admitted": 0, "full": False}


def test_capacity_state_with_a_tenant_row_but_no_applications(fake_dc):
    seed_config(fake_dc, capacity=10)
    assert fake_dc.find("registration_application") == []
    assert engine.capacity_state("acme", "2026-2027") == {
        "capacity": 10, "admitted": 0, "full": False}


def test_published_config_lookup_on_empty_tenant(fake_dc):
    assert engine.get_published_config("emptytenant") is None


# ── entity_base_data boolean coercion is scoped BY ENTITY TYPE ─────────────

def test_boolean_coercion_only_applies_to_types_declaring_the_field():
    """A flattened row carries the tenant's CUSTOM field columns too, so
    coercing on field NAME alone rewrote a tenant custom field named
    `sensitive` holding "confidential" into bool False on the next write —
    silent tenant-data loss. Only application_item.blocking and
    document.sensitive are declared bool in base_model.json.
    """
    # Types that do NOT declare these fields: values pass through untouched.
    assert engine.entity_base_data({
        "entity_type": "student", "sensitive": "confidential",
        "blocking": "maybe", "size": "100"}) == {
        "sensitive": "confidential", "blocking": "maybe", "size": "100"}

    # The declaring types DO get coerced.
    assert engine.entity_base_data({
        "entity_type": "document", "sensitive": "false",
        "filename": "x.pdf"}) == {"sensitive": False, "filename": "x.pdf"}
    assert engine.entity_base_data({
        "entity_type": "application_item", "blocking": "true"}) == {"blocking": True}

    # application_item declares `blocking` but NOT `sensitive` — a custom
    # field of that name on an item survives.
    assert engine.entity_base_data({
        "entity_type": "application_item", "blocking": "false",
        "sensitive": "confidential"}) == {"blocking": False,
                                          "sensitive": "confidential"}

    # No entity_type: coerce nothing rather than guess.
    assert engine.entity_base_data({
        "sensitive": "confidential", "blocking": "false"}) == {
        "sensitive": "confidential", "blocking": "false"}


def test_custom_field_named_sensitive_survives_a_status_write(fake_dc):
    """End-to-end: a tenant custom field named `sensitive` on an entity type
    that does not declare it as bool must round-trip through a status write
    untouched."""
    created = fake_dc.dc_create("acme", "registration_application", {
        "application_id": "A1", "status": "draft",
        "school_year": "2026-2027", "sensitive": "confidential"})
    row = fake_dc.get_entity("acme", "registration_application",
                             created["entity_id"])
    engine.set_application_status("acme", row, "submitted", actor="u1")

    after = fake_dc.get_entity("acme", "registration_application",
                               created["entity_id"])
    assert after["status"] == "submitted"
    assert after["sensitive"] == "confidential"  # not rewritten to False
