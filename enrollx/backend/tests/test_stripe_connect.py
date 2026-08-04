"""Stripe Connect onboarding: link generation and OAuth callback."""
from types import SimpleNamespace
from urllib.parse import parse_qs, urlparse

import pytest
import stripe
from fastapi import HTTPException
from fastapi.testclient import TestClient

from app.auth import require_authenticated_user
from app.config import settings
from app.main import app
from app.stripe_state import make_state


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


# Shaped like a real flattened DataCore row: the five meta columns, the
# encoded base_data/custom_fields columns, and `_abbrev` — which LOOKS like a
# meta column but is base_data (datacore api/routes.py:72-79) and is the
# prefix of every auto-generated entity id in the platform.
TENANT_ROW = {
    "entity_id": "acme",
    "entity_type": "tenant",
    "name": "Acme Afterschool",
    "_abbrev": "AAF",
    "_status": "active",
    "_version": "7",
    "_change_id": "chg_1",
    "_created_at": "2026-01-01T00:00:00+00:00",
    "_updated_at": "2026-02-01T00:00:00+00:00",
    "base_data": "name: Acme Afterschool\n_abbrev: AAF",
    "custom_fields": "",
}


def override_user(tenant="acme", role="admin"):
    def f():
        return {"user_id": "u1", "tenant_id": tenant, "role": role, "_token": "Bearer x"}

    return f


@pytest.fixture
def stripe_settings(monkeypatch):
    monkeypatch.setattr(settings, "link_secret", "test-link-secret", raising=False)
    monkeypatch.setattr(settings, "stripe_client_id", "ca_test_123")
    monkeypatch.setattr(settings, "stripe_secret_key", "sk_test_123")


@pytest.fixture
def as_user(stripe_settings):
    def _as(tenant="acme", role="admin"):
        app.dependency_overrides[require_authenticated_user] = override_user(tenant, role)
        return TestClient(app)

    yield _as
    app.dependency_overrides.clear()


def test_connect_link_requires_auth(stripe_settings):
    resp = TestClient(app).get("/api/stripe/acme/connect-link")
    assert resp.status_code == 401


def test_connect_link_cross_tenant_403(as_user):
    resp = as_user(tenant="acme").get("/api/stripe/globex/connect-link")
    assert resp.status_code == 403


def test_connect_link_parent_role_403(as_user):
    resp = as_user(role="parent").get("/api/stripe/acme/connect-link")
    assert resp.status_code == 403


def test_connect_link_contains_client_id_and_state(as_user):
    resp = as_user().get("/api/stripe/acme/connect-link")
    assert resp.status_code == 200
    url = resp.json()["url"]
    parsed = urlparse(url)
    assert parsed.netloc == "connect.stripe.com"
    qs = parse_qs(parsed.query)
    assert qs["client_id"] == ["ca_test_123"]
    assert qs["response_type"] == ["code"]
    assert qs["scope"] == ["read_write"]
    assert qs["redirect_uri"] == [settings.stripe_redirect_url]
    assert qs["state"][0]  # non-empty signed state


def test_connect_link_503_when_client_id_missing(as_user, monkeypatch):
    monkeypatch.setattr(settings, "stripe_client_id", "")
    resp = as_user().get("/api/stripe/acme/connect-link")
    assert resp.status_code == 503
    assert "ENROLLX_STRIPE_CLIENT_ID" in resp.json()["detail"]


def test_connect_link_503_when_secret_key_missing(as_user, monkeypatch):
    """The client id alone gets an admin all the way through Stripe's OAuth
    flow before the callback fails at token exchange with a generic
    exchange_failed. Guard both halves up front, naming the missing var."""
    monkeypatch.setattr(settings, "stripe_secret_key", "")
    resp = as_user().get("/api/stripe/acme/connect-link")
    assert resp.status_code == 503
    assert "ENROLLX_STRIPE_SECRET_KEY" in resp.json()["detail"]


@pytest.fixture
def callback_env(monkeypatch):
    """Wire the callback's tenant read/write; return the recorded writes.

    dc_update is patched at app.tenant_lookup's namespace — that module owns
    the only sanctioned tenant write, and patching there means these tests
    exercise the real base_data/custom_fields split rather than faking it
    away (which is precisely how the _abbrev loss went unnoticed).
    """
    writes = []

    def _wire(row=None):
        monkeypatch.setattr(
            "app.api.stripe_connect.get_tenant_entity",
            lambda t, tok: dict(row if row is not None else TENANT_ROW),
        )
        monkeypatch.setattr(
            "app.tenant_lookup.dc_update",
            lambda tenant, etype, eid, base, tok, custom_fields=None: writes.append(
                {"tenant": tenant, "entity_type": etype, "entity_id": eid,
                 "base_data": base, "custom_fields": custom_fields}
            ) or {"entity_id": eid},
        )
        return writes

    return _wire


def callback(state=None):
    client = TestClient(app, follow_redirects=False)
    return client.get(
        f"/api/stripe/connect/callback?code=ac_xyz&state={state or make_state('acme')}"
    )


def test_callback_success_stores_account_and_redirects(
    stripe_settings, fake_stripe, callback_env
):
    writes = callback_env()
    resp = callback()
    assert resp.status_code == 303
    assert resp.headers["location"] == (
        f"{settings.frontend_public_url}/settings/payments?stripe_connected=1"
    )
    assert fake_stripe["oauth_token"][0]["code"] == "ac_xyz"
    assert len(writes) == 1
    write = writes[0]
    assert (write["tenant"], write["entity_type"], write["entity_id"]) == (
        "acme", "tenant", "acme",
    )
    assert write["base_data"]["stripe_account_id"] == "acct_test_789"
    assert write["base_data"]["name"] == "Acme Afterschool"  # base_data preserved


def test_callback_preserves_abbrev(stripe_settings, fake_stripe, callback_env):
    """_abbrev is base_data, not a DataCore meta column, and it is locked at
    tenant creation. Losing it on this write silently changes the ID prefix
    of every student/lead/application/document created afterwards, in every
    service (datacore api/routes.py:97,325 fall back to tenant_id[:3].upper()
    — "AAF" would become "ACM")."""
    writes = callback_env()
    assert callback().status_code == 303
    base = writes[0]["base_data"]
    assert base["_abbrev"] == "AAF"  # survives, unchanged


def test_callback_drops_only_datacore_meta_columns(
    stripe_settings, fake_stripe, callback_env
):
    """The five real meta columns (store.py ENTITIES_SCHEMA) and the encoded
    columns must not be echoed back as base_data — only they may be dropped."""
    writes = callback_env()
    assert callback().status_code == 303
    base = writes[0]["base_data"]
    for meta in ("_status", "_version", "_change_id", "_created_at", "_updated_at",
                 "entity_id", "entity_type", "base_data", "custom_fields"):
        assert meta not in base


def test_callback_preserves_custom_fields(stripe_settings, fake_stripe, callback_env):
    """DataCore's PUT replaces custom_fields wholesale, and its query path
    flattens them into columns indistinguishable from base_data ones. Sending
    custom_fields={} while those columns ride along in base_data migrates a
    tenant's custom fields out of custom_fields for good."""
    row = {
        **TENANT_ROW,
        "custom_fields": "district: North\nseats: 30",
        "district": "North",
        "seats": "30",
    }
    writes = callback_env(row)
    assert callback().status_code == 303
    write = writes[0]
    assert write["custom_fields"] == {"district": "North", "seats": "30"}
    # ...and they are NOT silently migrated into base_data (DataCore rejects
    # the overlap outright: store.put_entity raises ValueError -> 400).
    assert "district" not in write["base_data"]
    assert "seats" not in write["base_data"]
    assert write["base_data"]["_abbrev"] == "AAF"


def test_callback_save_failure_redirects_with_error(
    stripe_settings, fake_stripe, monkeypatch
):
    """dc_update raising mid-OAuth-redirect must not hand the admin's browser
    raw JSON — every other branch redirects to the settings page."""
    monkeypatch.setattr(
        "app.api.stripe_connect.get_tenant_entity", lambda t, tok: dict(TENANT_ROW)
    )

    def boom(*a, **k):
        raise HTTPException(502, "DataCore is unreachable")

    monkeypatch.setattr("app.tenant_lookup.dc_update", boom)
    resp = callback()
    assert resp.status_code == 303
    assert "stripe_error=save_failed" in resp.headers["location"]


def test_callback_no_tenant_redirects_with_error(
    stripe_settings, fake_stripe, monkeypatch
):
    monkeypatch.setattr(
        "app.api.stripe_connect.get_tenant_entity", lambda t, tok: None
    )
    resp = callback()
    assert resp.status_code == 303
    assert "stripe_error=no_tenant" in resp.headers["location"]


def test_callback_bad_state_redirects_with_error(stripe_settings, fake_stripe):
    client = TestClient(app, follow_redirects=False)
    resp = client.get("/api/stripe/connect/callback?code=ac_xyz&state=forged")
    assert resp.status_code == 303
    assert "stripe_error=bad_state" in resp.headers["location"]
    assert fake_stripe["oauth_token"] == []  # never exchanged


def test_callback_user_denied_redirects_with_error(stripe_settings, fake_stripe):
    client = TestClient(app, follow_redirects=False)
    resp = client.get("/api/stripe/connect/callback?error=access_denied")
    assert resp.status_code == 303
    assert "stripe_error=denied" in resp.headers["location"]


def test_callback_exchange_failure_redirects_with_error(stripe_settings, monkeypatch):
    def boom(**kwargs):
        raise stripe.StripeError("nope")

    monkeypatch.setattr(stripe.OAuth, "token", boom)
    client = TestClient(app, follow_redirects=False)
    state = make_state("acme")
    resp = client.get(f"/api/stripe/connect/callback?code=ac_xyz&state={state}")
    assert resp.status_code == 303
    assert "stripe_error=exchange_failed" in resp.headers["location"]
