"""Checkout route guards and success/cancel URL construction."""
import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient

from app.auth import require_authenticated_user
from app.config import settings
from app.main import app


def override_user(tenant="acme", role="admin"):
    def f():
        return {"user_id": "u1", "tenant_id": tenant, "role": role, "_token": "Bearer x"}

    return f


@pytest.fixture
def captured(monkeypatch):
    """Capture create_checkout_session calls at the route module's namespace."""
    calls = []

    def fake_create(tenant_id, application_id, item_id, success_url, cancel_url, token):
        calls.append(
            {
                "tenant_id": tenant_id,
                "application_id": application_id,
                "item_id": item_id,
                "success_url": success_url,
                "cancel_url": cancel_url,
                "token": token,
            }
        )
        return {
            "checkout_url": "https://checkout.stripe.com/c/pay/cs_test_abc123",
            "session_id": "cs_test_abc123",
            "kind": "full",
            "amount": 50000,
            "currency": "usd",
        }

    monkeypatch.setattr("app.api.checkout.create_checkout_session", fake_create)
    return calls


@pytest.fixture
def as_user():
    def _as(tenant="acme", role="admin"):
        app.dependency_overrides[require_authenticated_user] = override_user(tenant, role)
        return TestClient(app)

    yield _as
    app.dependency_overrides.clear()


def test_staff_checkout_requires_auth(captured):
    resp = TestClient(app).post(
        "/api/registration/acme/applications/RA260001/checkout", json={}
    )
    assert resp.status_code == 401


def test_staff_checkout_cross_tenant_403(captured, as_user):
    resp = as_user(tenant="acme").post(
        "/api/registration/globex/applications/RA260001/checkout", json={}
    )
    assert resp.status_code == 403
    assert captured == []


def test_staff_checkout_parent_role_403(captured, as_user):
    resp = as_user(role="parent").post(
        "/api/registration/acme/applications/RA260001/checkout", json={}
    )
    assert resp.status_code == 403


def test_staff_checkout_urls_point_at_enrollx_frontend(captured, as_user):
    resp = as_user().post(
        "/api/registration/acme/applications/RA260001/checkout",
        json={"item_id": "AI260007"},
    )
    assert resp.status_code == 200
    assert resp.json()["session_id"] == "cs_test_abc123"
    call = captured[0]
    base = f"{settings.frontend_public_url}/applications/RA260001"
    assert call["success_url"] == f"{base}?payment=success"
    assert call["cancel_url"] == f"{base}?payment=cancelled"
    assert call["item_id"] == "AI260007"
    assert call["token"] == "Bearer x"


def test_internal_checkout_requires_internal_key(captured, monkeypatch):
    monkeypatch.setattr(settings, "internal_key", "test-internal-key", raising=False)
    resp = TestClient(app).post(
        "/internal/application-by-token/tok123/checkout", json={}
    )
    assert resp.status_code in (401, 403)
    assert captured == []


def test_internal_checkout_urls_point_at_familyhub(captured, monkeypatch):
    monkeypatch.setattr(settings, "internal_key", "test-internal-key", raising=False)
    monkeypatch.setattr(
        "app.api.checkout.resolve_token",
        lambda tok: ("acme", {"entity_id": "RA260001"}),
    )
    resp = TestClient(app).post(
        "/internal/application-by-token/tok123/checkout",
        json={},
        headers={"X-Internal-Key": "test-internal-key"},
    )
    assert resp.status_code == 200
    call = captured[0]
    assert call["tenant_id"] == "acme"
    assert call["application_id"] == "RA260001"
    base = f"{settings.familyhub_public_url}/application/tok123"
    assert call["success_url"] == f"{base}?payment=success"
    assert call["cancel_url"] == f"{base}?payment=cancelled"
    assert call["token"] is None


def test_internal_checkout_invalid_token_401(captured, monkeypatch):
    monkeypatch.setattr(settings, "internal_key", "test-internal-key", raising=False)

    def boom(tok):
        raise HTTPException(401, "Invalid link")

    monkeypatch.setattr("app.api.checkout.resolve_token", boom)
    resp = TestClient(app).post(
        "/internal/application-by-token/tok123/checkout",
        json={},
        headers={"X-Internal-Key": "test-internal-key"},
    )
    assert resp.status_code == 401
    assert captured == []
