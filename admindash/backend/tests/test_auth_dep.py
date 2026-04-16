"""Tests for the require_authenticated_user dependency."""
import httpx
import pytest
import respx
from fastapi import Depends, FastAPI
from fastapi.testclient import TestClient


@pytest.fixture
def dep_app():
    """Build a tiny FastAPI app that exposes the dependency for testing."""
    from app.auth import require_authenticated_user

    app = FastAPI()

    @app.get("/protected")
    def protected(user=Depends(require_authenticated_user)):
        return {"user_id": user.get("id")}

    return TestClient(app)


def test_missing_authorization_header_returns_401(dep_app):
    resp = dep_app.get("/protected")
    assert resp.status_code == 401


def test_malformed_authorization_header_returns_401(dep_app):
    resp = dep_app.get("/protected", headers={"Authorization": "NotBearer xyz"})
    assert resp.status_code == 401


@respx.mock
def test_valid_token_passes_dependency(dep_app):
    respx.get("http://localhost:5800/auth/me").mock(
        return_value=httpx.Response(200, json={"id": "u1", "tenant_id": "t1"})
    )
    resp = dep_app.get("/protected", headers={"Authorization": "Bearer good"})
    assert resp.status_code == 200
    assert resp.json() == {"user_id": "u1"}


@respx.mock
def test_datacore_rejects_token_returns_401(dep_app):
    respx.get("http://localhost:5800/auth/me").mock(
        return_value=httpx.Response(401, json={"detail": "expired"})
    )
    resp = dep_app.get("/protected", headers={"Authorization": "Bearer bad"})
    assert resp.status_code == 401


@respx.mock
def test_datacore_unreachable_returns_502(dep_app):
    respx.get("http://localhost:5800/auth/me").mock(
        side_effect=httpx.ConnectError("Connection refused")
    )
    resp = dep_app.get("/protected", headers={"Authorization": "Bearer good"})
    assert resp.status_code == 502
    assert "DataCore is unreachable" in resp.json()["detail"]


@respx.mock
def test_datacore_returns_invalid_json_returns_502(dep_app):
    respx.get("http://localhost:5800/auth/me").mock(
        return_value=httpx.Response(200, content=b"not json at all")
    )
    resp = dep_app.get("/protected", headers={"Authorization": "Bearer good"})
    assert resp.status_code == 502
    assert "invalid response" in resp.json()["detail"].lower()
