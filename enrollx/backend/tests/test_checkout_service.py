"""Checkout session creation: plan-derived amounts on the connected account."""
import json
from types import SimpleNamespace

import pytest
import stripe
from fastapi import HTTPException

from app.config import settings


# --- fake stripe fixture (repeated in every stripe-touching test file) ----
@pytest.fixture
def fake_stripe(monkeypatch):
    """Replace every stripe network call with in-memory fakes.

    No test may ever hit Stripe's network. `calls` records kwargs so tests
    can assert on what would have been sent.
    """
    calls = {"session_create": [], "oauth_token": []}

    def fake_session_create(**kwargs):
        calls["session_create"].append(kwargs)
        return SimpleNamespace(
            id="cs_test_abc123",
            url="https://checkout.stripe.com/c/pay/cs_test_abc123",
        )

    def fake_oauth_token(**kwargs):
        calls["oauth_token"].append(kwargs)
        return {"stripe_user_id": "acct_test_789", "livemode": False}

    monkeypatch.setattr(stripe.checkout.Session, "create", fake_session_create)
    monkeypatch.setattr(stripe.OAuth, "token", fake_oauth_token)
    return calls
# --------------------------------------------------------------------------


BLOCKS = json.dumps(
    [
        {
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
        },
        {
            "block_id": "b-pay",
            "type": "payment",
            "title": "Payment",
            "required": True,
            "blocking": True,
            "config": {"collects": "derived"},
        },
    ]
)


# Numeric fields are STRINGS here on purpose: DataCore's query path flattens
# every column to a string (query.py::_scalar_to_str), so a canned row that
# carries native ints never exercises the int() coercions the real code
# depends on.
def application_row(selection="pay_in_full", status="submitted"):
    return {
        "entity_id": "RA260001",
        "entity_type": "registration_application",
        "program_id": "PR26001",
        "config_version": "3",
        "status": status,
        "applicant_email": "parent@example.com",
        "token_version": "1",
        "draft_data": json.dumps({"payment_plan_selection": selection}),
        "_status": "active",
    }


CONFIG_ROW = {
    "entity_id": "RC26001", "program_id": "PR26001", "version": "3", "blocks": BLOCKS,
}
ITEM_ROW = {
    "entity_id": "AI260007",
    "application_id": "RA260001",
    "kind": "payment",
    "block_id": "b-pay",
    "title": "Payment",
    "status": "not_started",
    "blocking": True,
}
TENANT_ROW = {
    "entity_id": "acme",
    "entity_type": "tenant",
    "name": "Acme Afterschool",
    "stripe_account_id": "acct_test_789",
}


def make_fake_dc_query(rows_by_marker):
    """Dispatch canned rows by a substring of the SQL text."""

    def fake(tenant, sql, token, table="entities"):
        for marker, rows in rows_by_marker.items():
            if marker in sql:
                return [dict(r) for r in rows]
        return []

    return fake


@pytest.fixture
def wire(monkeypatch):
    """Wire canned DataCore rows + connected tenant + stripe key.

    registration_config no longer comes through dc_query: it goes through
    engine.rows_matching (list_entities, which scopes to _status='active'),
    so it is stubbed at app.checkout_service's own namespace — patching
    app.registration.engine.rows_matching would not be seen by the
    already-bound import here.
    """
    monkeypatch.setattr(settings, "stripe_secret_key", "sk_test_123")

    def _wire(application, deposit_paid=False, tenant=TENANT_ROW, item=ITEM_ROW,
              configs=(CONFIG_ROW,)):
        rows = {
            "entity_type = 'registration_application'": [application],
            "entity_type = 'application_item'": [item] if item else [],
            "entity_type = 'payment'": (
                [{"entity_id": "PY260001", "kind": "deposit", "status": "paid"}]
                if deposit_paid
                else []
            ),
        }
        monkeypatch.setattr("app.checkout_service.dc_query", make_fake_dc_query(rows))

        def fake_rows_matching(tenant_id, entity_type, token=None, **equals):
            if entity_type != "registration_config":
                return []
            # Mirrors rows_matching: string comparison, _status='active' rows
            # only (the caller's `configs` stands in for that scoping).
            return [
                dict(r) for r in configs
                if r.get("_status", "active") == "active"
                and all(str(r.get(k, "")) == str(v) for k, v in equals.items())
            ]

        monkeypatch.setattr("app.checkout_service.rows_matching", fake_rows_matching)
        monkeypatch.setattr(
            "app.checkout_service.get_tenant_entity",
            lambda t, tok: dict(tenant) if tenant else None,
        )

    return _wire


def create(item_id=None):
    from app.checkout_service import create_checkout_session

    return create_checkout_session(
        "acme",
        "RA260001",
        item_id,
        success_url="https://x/success",
        cancel_url="https://x/cancel",
        token=None,
    )


def test_pay_in_full_charges_amount_full(wire, fake_stripe):
    wire(application_row("pay_in_full"))
    out = create()
    assert out == {
        "checkout_url": "https://checkout.stripe.com/c/pay/cs_test_abc123",
        "session_id": "cs_test_abc123",
        "kind": "full",
        "amount": 50000,
        "currency": "usd",
    }
    sent = fake_stripe["session_create"][0]
    assert sent["stripe_account"] == "acct_test_789"
    assert sent["api_key"] == "sk_test_123"
    assert sent["mode"] == "payment"
    assert sent["line_items"][0]["price_data"]["unit_amount"] == 50000
    assert sent["metadata"] == {
        "tenant_id": "acme",
        "application_id": "RA260001",
        "item_id": "AI260007",
        "kind": "full",
    }
    assert sent["success_url"] == "https://x/success"
    assert sent["cancel_url"] == "https://x/cancel"


def test_session_restricted_to_card(wire, fake_stripe):
    """Without an explicit method list the connected account's dashboard
    settings decide, and a delayed-notification method (ACH/SEPA/Bacs/boleto)
    completes the session with payment_status "unpaid" — the webhook would
    then verify the item, write a paid payment row, email a receipt and, for
    a deposit, invite the parent to pay the remainder, for money that has not
    arrived."""
    wire(application_row("pay_in_full"))
    create()
    assert fake_stripe["session_create"][0]["payment_method_types"] == ["card"]


def test_stripe_error_becomes_502_not_bare_500(wire, monkeypatch):
    """Every Stripe-side failure — account not enabled for charges,
    capability revoked, deauthorized, invalid key, rate limit, outage — used
    to propagate as a bare 500 to a family trying to pay a school."""
    wire(application_row("pay_in_full"))

    def boom(**kwargs):
        raise stripe.StripeError("account cannot currently make charges")

    monkeypatch.setattr(stripe.checkout.Session, "create", boom)
    with pytest.raises(HTTPException) as exc:
        create()
    assert exc.value.status_code == 502
    assert "Stripe" in exc.value.detail


def test_deposit_plan_first_payment_is_deposit(wire, fake_stripe):
    wire(application_row("deposit"))
    out = create()
    assert out["kind"] == "deposit"
    assert out["amount"] == 10000


def test_deposit_plan_second_payment_is_balance(wire, fake_stripe):
    wire(application_row("deposit"), deposit_paid=True)
    out = create()
    assert out["kind"] == "balance"
    assert out["amount"] == 40000


def test_tenant_not_connected_409(wire, fake_stripe):
    wire(application_row(), tenant={"entity_id": "acme", "name": "Acme"})
    with pytest.raises(HTTPException) as exc:
        create()
    assert exc.value.status_code == 409
    assert fake_stripe["session_create"] == []


def test_no_open_payment_item_409(wire, fake_stripe):
    wire(application_row(), item=None)
    with pytest.raises(HTTPException) as exc:
        create()
    assert exc.value.status_code == 409


def test_declined_application_409(wire, fake_stripe):
    wire(application_row(status="declined"))
    with pytest.raises(HTTPException) as exc:
        create()
    assert exc.value.status_code == 409


def test_unknown_application_404(wire, fake_stripe, monkeypatch):
    wire(application_row())
    monkeypatch.setattr(
        "app.checkout_service.dc_query", make_fake_dc_query({})
    )
    with pytest.raises(HTTPException) as exc:
        create()
    assert exc.value.status_code == 404


def test_unconfigured_stripe_503(wire, fake_stripe, monkeypatch):
    wire(application_row())
    monkeypatch.setattr(settings, "stripe_secret_key", "")
    with pytest.raises(HTTPException) as exc:
        create()
    assert exc.value.status_code == 503


# ── config revision selection ─────────────────────────────────────────────

def config_row(entity_id, amount_full, version="3", status="active"):
    blocks = json.loads(BLOCKS)
    blocks[0]["config"]["amount_full"] = amount_full
    return {
        "entity_id": entity_id,
        "program_id": "PR26001",
        "version": version,
        "_status": status,
        "blocks": json.dumps(blocks),
    }


def test_archived_config_revision_is_not_charged(wire, fake_stripe):
    """Superseded revisions live in the same table with _status='archived',
    and rollback (actions.py:427-437) re-publishes an archived config KEEPING
    its original version number — so two rows can share program_id/version
    and carry different amount_full. The archived one is listed first here,
    so a query without the active filter would take it as rows[0] and charge
    the wrong amount."""
    wire(
        application_row("pay_in_full"),
        configs=(
            config_row("RC26000", 99900, status="archived"),
            config_row("RC26001", 50000, status="active"),
        ),
    )
    assert create()["amount"] == 50000


def test_config_version_matched_numerically_against_a_string_column(wire, fake_stripe):
    """`version` is a STRING column like every other flattened field, and the
    application's config_version is a string too — the match has to be an
    int() comparison, not a SQL `version = 3` predicate (which would make
    DuckDB cast the whole column and blow up on any non-numeric version
    written by another service into the same tenant table)."""
    wire(
        application_row("pay_in_full"),
        configs=(
            config_row("RC26002", 99900, version="4"),
            config_row("RC26001", 50000, version="3"),
        ),
    )
    assert create()["amount"] == 50000


def test_no_config_for_this_version_409(wire, fake_stripe):
    """Strict — no fallback to the currently-published config, which would
    silently charge a different amount than the application was quoted."""
    wire(application_row(), configs=(config_row("RC26002", 99900, version="4"),))
    with pytest.raises(HTTPException) as exc:
        create()
    assert exc.value.status_code == 409
    assert fake_stripe["session_create"] == []
