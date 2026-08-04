"""Webhook: signature check, tenant/account mapping, idempotency, settlement.

Corrected fakes per task-6-corrections.md (C1-C6) — the brief's fakes encode
wrong arities for settle_payment_item and send_application_email, and its
_already_processed re-introduces the sparse-column binder bug Plan 2 already
fixed. See task-6-corrections.md for the authoritative arities.
"""
import json

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

# C1: settle_payment_item takes the item ROW, not an item_id, and reads
# item_row["entity_id"] / item_row.get("kind") == "payment" / item_row.get("status").
ITEM_ROW = {
    "entity_id": "AI260007",
    "application_id": "RA260001",
    "kind": "payment",
    "title": "Payment",
    "status": "not_started",
}


def completed_event(kind="full", account="acct_test_789", session_id="cs_test_abc123",
                    item_id="AI260007"):
    return {
        "id": "evt_test_1",
        "type": "checkout.session.completed",
        "account": account,
        "data": {
            "object": {
                "id": session_id,
                "amount_total": 50000,
                "currency": "usd",
                "payment_status": "paid",
                "metadata": {
                    "tenant_id": "acme",
                    "application_id": "RA260001",
                    "item_id": item_id,
                    "kind": kind,
                },
            }
        },
    }


@pytest.fixture
def client():
    return TestClient(app)


@pytest.fixture
def webhook_env(monkeypatch):
    """Stub every collaborator; return the recorders."""
    monkeypatch.setattr(settings, "stripe_webhook_secret", "whsec_test")
    rec = {"settled": [], "emails": [], "dedupe_rows": []}

    monkeypatch.setattr(
        "app.api.stripe_webhook.get_tenant_entity", lambda t, tok: dict(TENANT_ROW)
    )
    monkeypatch.setattr(
        "app.api.stripe_webhook.get_application", lambda t, a, tok: dict(APPLICATION_ROW)
    )
    monkeypatch.setattr(
        "app.api.stripe_webhook.get_items", lambda t, a, tok: [dict(ITEM_ROW)]
    )

    # C4: dedupe is `list_entities` narrowed by application_id, filtered on
    # provider_ref in PYTHON — not a `dc_query` SQL predicate on provider_ref
    # (that column doesn't exist in a tenant with no prior Stripe payment and
    # DuckDB binder-errors on it).
    monkeypatch.setattr(
        "app.api.stripe_webhook.list_entities",
        lambda t, et, where, tok: list(rec["dedupe_rows"]) if et == "payment" else [],
    )

    # C1/C2: settle_payment_item takes the item ROW (third positional) and
    # returns {"payment": ..., "item": ..., "already_settled": bool}.
    def fake_settle(tenant_id, application_id, item_row, **kwargs):
        rec["settled"].append({"tenant_id": tenant_id, "application_id": application_id,
                               "item_row": item_row, **kwargs})
        return {"payment": {"entity_id": "PY260001"}, "item": dict(item_row),
                "already_settled": False}

    monkeypatch.setattr("app.api.stripe_webhook.settle_payment_item", fake_settle)

    # C3: send_application_email takes a `kind` argument (email kind, distinct
    # from the payment kind) and the body parameter is `body_html`, not `html`.
    monkeypatch.setattr(
        "app.api.stripe_webhook.send_application_email",
        lambda tenant_id, application_id, kind, to, subject, body_html, token=None:
            rec["emails"].append({"kind": kind, "to": to, "subject": subject, "html": body_html}),
    )

    # Task 7 collaborators — stubbed as no-ops until Task 7 wires them.
    monkeypatch.setattr(
        "app.api.stripe_webhook.create_application_item",
        lambda *a, **k: rec.setdefault("created_items", []).append(k) or {"entity_id": "AI260099"},
    )
    monkeypatch.setattr(
        "app.api.stripe_webhook.make_link_token", lambda t, a, v: "tok_parent"
    )
    return rec


def stub_event(monkeypatch, event):
    monkeypatch.setattr(
        stripe.Webhook, "construct_event", lambda payload, sig, secret: event
    )


def post(client, body=None):
    return client.post(
        "/api/webhooks/stripe",
        content=json.dumps(body or {}),
        headers={"stripe-signature": "t=1,v1=sig", "content-type": "application/json"},
    )


def test_bad_signature_400(client, webhook_env, monkeypatch):
    def raise_bad(payload, sig, secret):
        raise stripe.SignatureVerificationError("bad sig", "t=1,v1=sig")

    monkeypatch.setattr(stripe.Webhook, "construct_event", raise_bad)
    resp = post(client)
    assert resp.status_code == 400
    assert webhook_env["settled"] == []


def test_unconfigured_secret_503(client, webhook_env, monkeypatch):
    monkeypatch.setattr(settings, "stripe_webhook_secret", "")
    resp = post(client)
    assert resp.status_code == 503


def test_other_event_types_ignored(client, webhook_env, monkeypatch):
    stub_event(monkeypatch, {"type": "payment_intent.succeeded", "data": {"object": {}}})
    resp = post(client)
    assert resp.status_code == 200
    assert resp.json()["handled"] is False
    assert webhook_env["settled"] == []


def test_account_mismatch_400_and_no_writes(client, webhook_env, monkeypatch):
    stub_event(monkeypatch, completed_event(account="acct_attacker"))
    resp = post(client)
    assert resp.status_code == 400
    assert webhook_env["settled"] == []


def test_duplicate_event_noops(client, webhook_env, monkeypatch):
    webhook_env["dedupe_rows"].append({"entity_id": "PY260001", "provider_ref": "cs_test_abc123"})
    stub_event(monkeypatch, completed_event())
    resp = post(client)
    assert resp.status_code == 200
    assert resp.json()["duplicate"] is True
    assert webhook_env["settled"] == []
    assert webhook_env["emails"] == []


def test_dedupe_row_with_different_session_id_settles(client, webhook_env, monkeypatch):
    """A dedupe row exists, but its provider_ref is a DIFFERENT session id —
    proves the Python filter actually filters rather than the fake simply
    returning a non-empty list."""
    webhook_env["dedupe_rows"].append({"entity_id": "PY000000", "provider_ref": "cs_some_other_session"})
    stub_event(monkeypatch, completed_event(session_id="cs_test_abc123"))
    resp = post(client)
    assert resp.status_code == 200
    assert resp.json()["handled"] is True
    assert "duplicate" not in resp.json()
    assert len(webhook_env["settled"]) == 1
    assert webhook_env["settled"][0]["provider_ref"] == "cs_test_abc123"


def test_completed_session_settles_and_sends_receipt(client, webhook_env, monkeypatch):
    stub_event(monkeypatch, completed_event(kind="full"))
    resp = post(client)
    assert resp.status_code == 200
    assert resp.json()["handled"] is True
    assert resp.json()["payment_id"] == "PY260001"
    settled = webhook_env["settled"][0]
    assert settled["tenant_id"] == "acme"
    assert settled["application_id"] == "RA260001"
    assert settled["item_row"]["entity_id"] == "AI260007"
    assert settled["kind"] == "full"
    assert settled["amount"] == 50000
    assert settled["currency"] == "usd"
    assert settled["provider"] == "stripe"
    assert settled["provider_ref"] == "cs_test_abc123"
    assert settled["recorded_by"] == "stripe:webhook"
    receipt = webhook_env["emails"][0]
    assert receipt["kind"] == "payment_receipt"
    assert receipt["to"] == "parent@example.com"
    assert "50" in receipt["html"] or "500.00" in receipt["html"]


def test_missing_metadata_400(client, webhook_env, monkeypatch):
    event = completed_event()
    event["data"]["object"]["metadata"] = {}
    stub_event(monkeypatch, event)
    resp = post(client)
    assert resp.status_code == 400
    assert webhook_env["settled"] == []


def test_unknown_item_id_400(client, webhook_env, monkeypatch):
    """Metadata names an item id that get_items does not return -> 400,
    must not settle (C1's mandated new test)."""
    stub_event(monkeypatch, completed_event(item_id="AI999999"))
    resp = post(client)
    assert resp.status_code == 400
    assert webhook_env["settled"] == []
