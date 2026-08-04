"""Webhook: signature check, tenant/account mapping, idempotency, settlement.

Corrected fakes per task-6-corrections.md (C1-C6) — the brief's fakes encode
wrong arities for settle_payment_item and send_application_email, and its
_already_processed re-introduces the sparse-column binder bug Plan 2 already
fixed. See task-6-corrections.md for the authoritative arities.
"""
import hashlib
import hmac
import json
import time

import pytest
import stripe
from fastapi import HTTPException
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
    #
    # F6: assert the `where` clause itself, not just that the fake returns
    # something. Without this a regression to
    # f"application_id = '{sql_literal(application_id)}'" — the exact
    # ''RA260001'' double-quoting hazard C5 warns about, since sql_literal
    # already returns the surrounding quotes — would keep the suite green.
    def fake_list_entities(t, et, where, tok):
        if et == "payment":
            assert where == "application_id = 'RA260001'"
            return list(rec["dedupe_rows"])
        return []

    monkeypatch.setattr("app.api.stripe_webhook.list_entities", fake_list_entities)

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


def real_signature_header(payload: bytes, secret: str, timestamp: int | None = None) -> str:
    """Compute a genuine Stripe webhook signature header (t=<ts>,v1=<hex>)
    over the exact payload bytes — pure local HMAC-SHA256, no network. Used
    by F5's tests, which leave stripe.Webhook.construct_event UNSTUBBED so
    the real signature-verification code path (secret, raw bytes, header
    format) is actually exercised, not just asserted-away by a monkeypatch."""
    ts = timestamp if timestamp is not None else int(time.time())
    signed_payload = f"{ts}.".encode() + payload
    sig = hmac.new(secret.encode(), signed_payload, hashlib.sha256).hexdigest()
    return f"t={ts},v1={sig}"


def real_stripe_event_payload(kind="full", account="acct_test_789",
                              session_id="cs_test_abc123", item_id="AI260007") -> bytes:
    """A realistic Stripe event body — including the `object` discriminator
    fields (`"object": "event"` / `"object": "checkout.session"`) that
    stripe.Webhook.construct_event's real implementation requires to build a
    stripe.Event, unlike the plain dicts the other tests hand it via
    stub_event."""
    return json.dumps({
        "id": "evt_test_real_1",
        "object": "event",
        "type": "checkout.session.completed",
        "account": account,
        "data": {
            "object": {
                "id": session_id,
                "object": "checkout.session",
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
    }).encode()


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


def test_account_mismatch_200_not_handled_and_no_writes(client, webhook_env, monkeypatch):
    """A connected-account mismatch can never succeed on retry, so it must
    NOT be non-2xx: Stripe retries a failing delivery for three days and
    disables an endpoint that keeps failing, which would stop settlement for
    every tenant on the platform. The security property is unchanged and
    non-negotiable — NOTHING is written."""
    stub_event(monkeypatch, completed_event(account="acct_attacker"))
    resp = post(client)
    assert resp.status_code == 200
    assert resp.json()["handled"] is False
    assert resp.json()["reason"] == "account_mismatch"
    assert webhook_env["settled"] == []
    assert webhook_env["emails"] == []


def test_duplicate_event_noops(client, webhook_env, monkeypatch):
    webhook_env["dedupe_rows"].append({"entity_id": "PY260001", "provider_ref": "cs_test_abc123"})
    stub_event(monkeypatch, completed_event())
    resp = post(client)
    assert resp.status_code == 200
    body = resp.json()
    assert body["duplicate"] is True
    # `handled` is total across every response — a consumer never has to
    # infer it from absence.
    assert body["handled"] is False
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


def test_successful_settlement_is_logged(client, webhook_env, monkeypatch, caplog):
    """The money path's single most important event. It used to produce no
    log line at all — the webhook logged only its rejections."""
    stub_event(monkeypatch, completed_event(kind="full"))
    with caplog.at_level("INFO", logger="enrollx.stripe_webhook"):
        assert post(client).status_code == 200
    record = next(r for r in caplog.records if "payment settled" in r.getMessage())
    message = record.getMessage()
    for fragment in ("'acme'", "'RA260001'", "'AI260007'", "'cs_test_abc123'",
                     "'full'", "50000", "'usd'", "'PY260001'"):
        assert fragment in message


def test_missing_metadata_200_not_handled(client, webhook_env, monkeypatch):
    """Permanent condition -> 200 handled:false (see the status-code policy
    in the module docstring), and — unchanged — no writes."""
    event = completed_event()
    event["data"]["object"]["metadata"] = {}
    stub_event(monkeypatch, event)
    resp = post(client)
    assert resp.status_code == 200
    assert resp.json()["handled"] is False
    assert resp.json()["reason"] == "missing_metadata"
    assert webhook_env["settled"] == []
    assert webhook_env["emails"] == []


def test_unknown_item_id_200_not_handled(client, webhook_env, monkeypatch):
    """Metadata names an item id that get_items does not return. Permanent,
    so 200 handled:false; must not settle (C1's mandated new test)."""
    stub_event(monkeypatch, completed_event(item_id="AI999999"))
    resp = post(client)
    assert resp.status_code == 200
    assert resp.json()["handled"] is False
    assert resp.json()["reason"] == "unknown_item"
    assert webhook_env["settled"] == []


def test_invalid_kind_200_not_handled(client, webhook_env, monkeypatch):
    """An unrecognized `kind` would record a payment of unknown kind and
    silently skip the deposit->balance obligation, so it is rejected rather
    than defaulted — permanently, hence 200 handled:false."""
    stub_event(monkeypatch, completed_event(kind="subscription"))
    resp = post(client)
    assert resp.status_code == 200
    assert resp.json()["handled"] is False
    assert resp.json()["reason"] == "invalid_kind"
    assert webhook_env["settled"] == []


def test_settlement_conflict_200_not_handled_and_no_second_payment(
    client, webhook_env, monkeypatch
):
    """The C2 trigger: a SECOND payment against the same item (staff
    double-click, parent paying in two tabs, or a parent paying online while
    staff records an offline payment). Its provider_ref differs, so the
    dedupe misses and settle_payment_item raises 409 "already verified".
    Uncaught that 409 is retried by Stripe for three days and then disables
    the endpoint for every tenant on the platform."""
    def conflicting_settle(tenant_id, application_id, item_row, **kwargs):
        raise HTTPException(409, "Payment item is already verified")

    monkeypatch.setattr("app.api.stripe_webhook.settle_payment_item", conflicting_settle)
    stub_event(monkeypatch, completed_event(session_id="cs_test_second"))
    resp = post(client)
    assert resp.status_code == 200
    assert resp.json()["handled"] is False
    assert resp.json()["reason"] == "settlement_rejected"
    assert webhook_env["settled"] == []
    assert webhook_env["emails"] == []


def test_settlement_5xx_propagates_for_retry(client, webhook_env, monkeypatch):
    """The other half of the policy: a genuine 5xx (DataCore unreachable) IS
    transient, so it must keep propagating and let Stripe retry. Swallowing
    it as 200 would silently drop a real payment."""
    def unreachable(tenant_id, application_id, item_row, **kwargs):
        raise HTTPException(502, "DataCore is unreachable")

    monkeypatch.setattr("app.api.stripe_webhook.settle_payment_item", unreachable)
    stub_event(monkeypatch, completed_event())
    resp = post(client)
    assert resp.status_code == 502
    assert webhook_env["emails"] == []


def test_account_and_stored_both_absent_200_not_handled(client, webhook_env, monkeypatch):
    """F1: a tenant that hasn't finished Connect onboarding has no stored
    stripe_account_id, and a platform-level (non-Connect) event has no
    `account` at all. Two ABSENT values are not an equality of Stripe
    account ids and must not fall through the guard."""
    monkeypatch.setattr(
        "app.api.stripe_webhook.get_tenant_entity",
        lambda t, tok: {**TENANT_ROW, "stripe_account_id": None},
    )
    stub_event(monkeypatch, completed_event(account=None))
    resp = post(client)
    assert resp.status_code == 200
    assert resp.json()["handled"] is False
    assert resp.json()["reason"] == "account_mismatch"
    assert webhook_env["settled"] == []


def test_already_settled_replay_sends_no_second_email(client, webhook_env, monkeypatch):
    """F2: settle_payment_item's own provider_ref dedupe (a residual race
    window distinct from _already_processed) can return already_settled=True
    on THIS call — meaning an earlier delivery already settled and already
    emailed. The webhook must not send a second receipt for one payment."""
    def fake_settle_already_settled(tenant_id, application_id, item_row, **kwargs):
        webhook_env["settled"].append({"tenant_id": tenant_id, "application_id": application_id,
                                       "item_row": item_row, **kwargs})
        return {"payment": {"entity_id": "PY260001"}, "item": dict(item_row),
                "already_settled": True}

    monkeypatch.setattr("app.api.stripe_webhook.settle_payment_item", fake_settle_already_settled)
    stub_event(monkeypatch, completed_event())
    resp = post(client)
    assert resp.status_code == 200
    assert resp.json()["handled"] is True
    assert resp.json()["payment_id"] == "PY260001"
    assert webhook_env["emails"] == []


def test_real_signature_reaches_settlement(client, webhook_env, monkeypatch):
    """F5: leaves stripe.Webhook.construct_event UNSTUBBED, computing a
    genuine signature over the exact payload bytes with
    settings.stripe_webhook_secret. Pure local HMAC-SHA256 — no network — so
    this exercises the real secret/payload/header-format contract that every
    other test bypasses via stub_event."""
    payload = real_stripe_event_payload()
    header = real_signature_header(payload, settings.stripe_webhook_secret)
    resp = client.post(
        "/api/webhooks/stripe",
        content=payload,
        headers={"stripe-signature": header, "content-type": "application/json"},
    )
    assert resp.status_code == 200
    assert resp.json()["handled"] is True
    assert len(webhook_env["settled"]) == 1
    assert webhook_env["settled"][0]["provider_ref"] == "cs_test_abc123"


def test_real_signature_tampered_payload_400(client, webhook_env, monkeypatch):
    """F5: sign one payload, send a DIFFERENT (tampered) one — the real
    construct_event must reject it, unstubbed."""
    signed_payload = real_stripe_event_payload()
    header = real_signature_header(signed_payload, settings.stripe_webhook_secret)
    tampered_payload = real_stripe_event_payload(session_id="cs_attacker_swapped")
    resp = client.post(
        "/api/webhooks/stripe",
        content=tampered_payload,
        headers={"stripe-signature": header, "content-type": "application/json"},
    )
    assert resp.status_code == 400
    assert webhook_env["settled"] == []
