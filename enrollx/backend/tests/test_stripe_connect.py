"""Stripe Connect onboarding: link generation and OAuth callback."""
from types import SimpleNamespace
from urllib.parse import parse_qs, urlparse

import pytest
import stripe
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


TENANT_ROW = {
    "entity_id": "acme",
    "entity_type": "tenant",
    "name": "Acme Afterschool",
    "_status": "active",
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


def test_connect_link_503_when_unconfigured(as_user, monkeypatch):
    monkeypatch.setattr(settings, "stripe_client_id", "")
    resp = as_user().get("/api/stripe/acme/connect-link")
    assert resp.status_code == 503


def test_callback_success_stores_account_and_redirects(
    stripe_settings, fake_stripe, monkeypatch
):
    updates = []
    monkeypatch.setattr(
        "app.api.stripe_connect.get_tenant_entity", lambda t, tok: dict(TENANT_ROW)
    )
    monkeypatch.setattr(
        "app.api.stripe_connect.dc_update",
        lambda tenant, etype, eid, base, tok: updates.append((tenant, etype, eid, base)) or base,
    )
    client = TestClient(app, follow_redirects=False)
    state = make_state("acme")
    resp = client.get(f"/api/stripe/connect/callback?code=ac_xyz&state={state}")
    assert resp.status_code == 303
    assert resp.headers["location"] == (
        f"{settings.frontend_public_url}/settings/payments?stripe_connected=1"
    )
    assert fake_stripe["oauth_token"][0]["code"] == "ac_xyz"
    assert updates == [("acme", "tenant", "acme", pytest.approx(updates[0][3]))]
    assert updates[0][3]["stripe_account_id"] == "acct_test_789"
    assert updates[0][3]["name"] == "Acme Afterschool"  # existing base_data preserved


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
