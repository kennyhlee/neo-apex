"""Deposit settlement creates the balance item + reminder exactly once.

This file carries its OWN copy of the webhook_env fixture (it does not
inherit test_stripe_webhook.py's), so Task 6's fixture corrections
(task-6-corrections.md C1-C6) are re-applied here per task-7-corrections.md
C4: get_items returns a payment-kind ITEM_ROW, list_entities (not a dc_query
provider_ref predicate) drives dedupe, settle_payment_item's fake returns the
{"payment", "item", "already_settled"} wrapper, and send_application_email
takes the `kind` argument. dc_query is still used for the "Balance payment"
title lookup — that predicate is safe to leave in SQL (C5) since
application_id/title are written by every application_item row.
"""
import json
from datetime import datetime, timedelta, timezone

import pytest
import stripe
from fastapi.testclient import TestClient

from app.config import settings
from app.main import app


TENANT_ROW = {
    "entity_id": "acme",
    "entity_type": "tenant",
    "name": "Acme Afterschool",
    "stripe_account_id": "acct_test_789",
}

APPLICATION_ROW = {
    "entity_id": "RA260001",
    "program_id": "PR26001",
    "config_version": 3,
    "status": "submitted",
    "applicant_email": "parent@example.com",
    "token_version": 1,
}

# C4: settle_payment_item raises 400 unless the item row's kind == "payment".
ITEM_ROW = {
    "entity_id": "AI260007",
    "application_id": "RA260001",
    "kind": "payment",
    "title": "Payment",
    "status": "not_started",
}

PLAN_BLOCK = {
    "block_id": "b-plan",
    "type": "payment_plan",
    "title": "Payment plan",
    "required": True,
    "blocking": True,
    "config": {
        "currency": "usd",
        "amount_full": 50000,
        "plans": [
            {"type": "pay_in_full"},
            {"type": "deposit", "deposit_amount": 10000},
        ],
    },
}


def deposit_event():
    return {
        "id": "evt_test_2",
        "type": "checkout.session.completed",
        "account": "acct_test_789",
        "data": {
            "object": {
                "id": "cs_test_dep1",
                "amount_total": 10000,
                "currency": "usd",
                "payment_status": "paid",
                "metadata": {
                    "tenant_id": "acme",
                    "application_id": "RA260001",
                    "item_id": "AI260007",
                    "kind": "deposit",
                },
            }
        },
    }


@pytest.fixture
def client():
    return TestClient(app)


@pytest.fixture
def webhook_env(monkeypatch):
    monkeypatch.setattr(settings, "stripe_webhook_secret", "whsec_test")
    monkeypatch.setattr(settings, "balance_due_days", 30)
    rec = {
        "settled": [],
        "emails": [],
        "created_items": [],
        "balance_items": [],
        "dedupe_rows": [],
        # F1: parameterized rather than hardcoded, so a test can flip it to
        # True and exercise the already_settled=True + kind="deposit" replay
        # path that correction C8 exists to guard (the deposit branch must
        # sit inside the already_settled gate; a regression that moved it
        # back outside would NameError on `application` here).
        "already_settled": False,
    }

    monkeypatch.setattr(
        "app.api.stripe_webhook.get_tenant_entity", lambda t, tok: dict(TENANT_ROW)
    )
    monkeypatch.setattr(
        "app.api.stripe_webhook.get_application", lambda t, a, tok: dict(APPLICATION_ROW)
    )
    # C4: settle_payment_item takes the item ROW, not an item_id.
    monkeypatch.setattr(
        "app.api.stripe_webhook.get_items", lambda t, a, tok: [dict(ITEM_ROW)]
    )
    # C4: dedupe is list_entities narrowed by application_id, filtered on
    # provider_ref in Python -- not a dc_query SQL predicate on provider_ref.
    monkeypatch.setattr(
        "app.api.stripe_webhook.list_entities",
        lambda t, et, where, tok: list(rec["dedupe_rows"]) if et == "payment" else [],
    )
    monkeypatch.setattr(
        "app.api.stripe_webhook.get_payment_plan_block",
        lambda t, application, tok: json.loads(json.dumps(PLAN_BLOCK)),
    )

    # C5: the "Balance payment" title lookup stays a dc_query SQL predicate
    # (application_id/title are written by every application_item row, so
    # this is safe, unlike the provider_ref predicate above).
    def fake_dc_query(tenant, sql, token, table="entities"):
        if "Balance payment" in sql:
            return list(rec["balance_items"])
        return []

    monkeypatch.setattr("app.api.stripe_webhook.dc_query", fake_dc_query)

    # C3: settle_payment_item's fake must return the wrapper shape, not the
    # bare payment dict.
    def fake_settle(tenant_id, application_id, item_row, **kwargs):
        rec["settled"].append(
            {"tenant_id": tenant_id, "application_id": application_id,
             "item_row": item_row, **kwargs}
        )
        return {
            "payment": {"entity_id": "PY260002"},
            "item": dict(item_row),
            "already_settled": rec["already_settled"],
        }

    monkeypatch.setattr("app.api.stripe_webhook.settle_payment_item", fake_settle)

    # C2: send_application_email needs the `kind` argument.
    monkeypatch.setattr(
        "app.api.stripe_webhook.send_application_email",
        lambda tenant_id, application_id, kind, to, subject, body_html, token=None:
            rec["emails"].append(
                {"kind": kind, "to": to, "subject": subject, "html": body_html}
            ),
    )

    # C1: create_application_item takes a DICT of item fields, not keyword
    # fields, and does not accept item_id/application_id/status in that dict.
    def fake_create_item(tenant_id, application_id, item_fields, token=None):
        rec["created_items"].append(
            {"tenant_id": tenant_id, "application_id": application_id, **item_fields}
        )
        return {"entity_id": "AI260099"}

    monkeypatch.setattr("app.api.stripe_webhook.create_application_item", fake_create_item)
    monkeypatch.setattr(
        "app.api.stripe_webhook.make_link_token", lambda t, a, v: "tok_parent"
    )
    return rec


def post_deposit(client, monkeypatch):
    monkeypatch.setattr(
        stripe.Webhook, "construct_event", lambda payload, sig, secret: deposit_event()
    )
    return client.post(
        "/api/webhooks/stripe",
        content="{}",
        headers={"stripe-signature": "t=1,v1=sig", "content-type": "application/json"},
    )


def test_deposit_creates_nonblocking_balance_item(client, webhook_env, monkeypatch):
    resp = post_deposit(client, monkeypatch)
    assert resp.status_code == 200
    item = webhook_env["created_items"][0]
    assert item["kind"] == "payment"
    assert item["title"] == "Balance payment"
    assert item["blocking"] is False
    assert item["block_id"] == "b-plan"
    due = datetime.fromisoformat(item["due_at"])
    expected = datetime.now(timezone.utc) + timedelta(days=30)
    assert abs((due - expected).total_seconds()) < 120


def test_deposit_sends_balance_reminder_with_hub_link(client, webhook_env, monkeypatch):
    resp = post_deposit(client, monkeypatch)
    assert resp.status_code == 200
    # emails[0] is the receipt; emails[1] is the balance reminder
    assert len(webhook_env["emails"]) == 2
    receipt, reminder = webhook_env["emails"]
    # C2: the kind makes ordering a real assertion instead of a weak one.
    assert receipt["kind"] == "payment_receipt"
    assert reminder["kind"] == "balance_reminder"
    assert reminder["to"] == "parent@example.com"
    assert f"{settings.familyhub_public_url}/application/tok_parent" in reminder["html"]
    assert "400.00" in reminder["html"]  # 50000 - 10000 cents


def test_existing_balance_item_is_not_duplicated(client, webhook_env, monkeypatch):
    webhook_env["balance_items"].append({"entity_id": "AI260099"})
    resp = post_deposit(client, monkeypatch)
    assert resp.status_code == 200
    assert webhook_env["created_items"] == []
    assert len(webhook_env["emails"]) == 1  # receipt only


def test_full_payment_creates_no_balance_item(client, webhook_env, monkeypatch):
    event = deposit_event()
    event["data"]["object"]["metadata"]["kind"] = "full"
    event["data"]["object"]["amount_total"] = 50000
    monkeypatch.setattr(
        stripe.Webhook, "construct_event", lambda payload, sig, secret: event
    )
    resp = client.post(
        "/api/webhooks/stripe",
        content="{}",
        headers={"stripe-signature": "t=1,v1=sig", "content-type": "application/json"},
    )
    assert resp.status_code == 200
    assert webhook_env["created_items"] == []


def test_replayed_deposit_already_settled_skips_balance_obligation(client, webhook_env, monkeypatch):
    """F1: settle_payment_item returning already_settled=True for a
    kind="deposit" event is exactly the replay scenario C8 exists to guard
    -- the brief's original one-line deposit branch at the marker would
    NameError here, since `application` was bound inside the same `try` the
    receipt email lives in and that whole gate is skipped when already
    settled. The shipped code nests the deposit branch inside
    `if not result.get("already_settled")`, so on a replay neither the
    balance item nor the reminder email nor any reference to `application`
    is reached -- this test would fail (raise, or wrongly create the item /
    send the email) if a future edit moved the deposit branch back outside
    that gate."""
    webhook_env["already_settled"] = True
    resp = post_deposit(client, monkeypatch)
    assert resp.status_code == 200
    body = resp.json()
    assert body["handled"] is True
    assert body["payment_id"] == "PY260002"
    assert webhook_env["created_items"] == []
    assert webhook_env["emails"] == []


def test_non_positive_balance_skips_and_warns(client, webhook_env, monkeypatch, caplog):
    """A misconfigured plan (deposit >= amount_full) short-circuits before
    the balance item and the reminder. Skipping both in total silence leaves
    the school believing the parent owes nothing, so it has to be visible."""
    bad_block = json.loads(json.dumps(PLAN_BLOCK))
    bad_block["config"]["plans"][1]["deposit_amount"] = 50000
    monkeypatch.setattr(
        "app.api.stripe_webhook.get_payment_plan_block",
        lambda t, application, tok: bad_block,
    )
    with caplog.at_level("WARNING", logger="enrollx.stripe_webhook"):
        resp = post_deposit(client, monkeypatch)
    assert resp.status_code == 200
    assert webhook_env["created_items"] == []
    assert len(webhook_env["emails"]) == 1  # receipt only, no balance reminder
    assert any(
        "balance obligation skipped" in r.getMessage() for r in caplog.records
    )


def test_currency_lowercased_before_reminder_html(client, webhook_env, monkeypatch):
    """F2: the plan block's config carries an UPPERCASE currency code, which
    C6 requires be lowercased before it's handed to balance_reminder_html.
    PLAN_BLOCK's own "usd" is already lowercase, so a regression that
    dropped `.lower()` in _ensure_balance_obligation would pass every other
    test in this file -- this test intercepts the exact argument passed to
    balance_reminder_html instead of inspecting the rendered HTML (whose
    display formatting re-uppercases the code regardless via
    payment_emails._fmt, so asserting on the HTML text can't distinguish
    the two code paths)."""
    plan_block_upper = json.loads(json.dumps(PLAN_BLOCK))
    plan_block_upper["config"]["currency"] = "USD"
    monkeypatch.setattr(
        "app.api.stripe_webhook.get_payment_plan_block",
        lambda t, application, tok: plan_block_upper,
    )
    captured = {}

    def fake_balance_reminder_html(tenant_name, balance_cents, currency, due_date, hub_url):
        captured["currency"] = currency
        return "<p>reminder</p>"

    monkeypatch.setattr(
        "app.api.stripe_webhook.balance_reminder_html", fake_balance_reminder_html
    )
    resp = post_deposit(client, monkeypatch)
    assert resp.status_code == 200
    assert captured["currency"] == "usd"
