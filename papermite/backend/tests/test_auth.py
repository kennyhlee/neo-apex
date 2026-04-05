"""Tests for auth endpoints and get_current_user dependency."""
import bcrypt
from unittest.mock import MagicMock

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.models.registry import UserRecord
from app.storage import get_registry_store

client = TestClient(app)

_HASHED = bcrypt.hashpw(b"correct-pass", bcrypt.gensalt(rounds=4)).decode()

FAKE_USER = UserRecord(
    user_id="u-abc123",
    name="Jane Admin",
    email="jane@acme.edu",
    password_hash=_HASHED,
    tenant_id="acme",
    tenant_name="Acme School",
    role="admin",
    created_at="2026-01-01T00:00:00+00:00",
)


def _registry_returning(user):
    """Mock RegistryStore that returns `user` for all lookups."""
    mock = MagicMock()
    mock.get_user_by_email.return_value = user
    mock.get_user_by_id.return_value = user
    return mock


@pytest.fixture(autouse=True)
def clear_overrides():
    yield
    app.dependency_overrides.clear()


def test_login_success():
    app.dependency_overrides[get_registry_store] = lambda: _registry_returning(FAKE_USER)
    resp = client.post("/api/login", json={"email": "jane@acme.edu", "password": "correct-pass"})
    assert resp.status_code == 200
    data = resp.json()
    assert "token" in data
    assert data["user"]["email"] == "jane@acme.edu"
    assert "password_hash" not in data["user"]


def test_login_unknown_email():
    app.dependency_overrides[get_registry_store] = lambda: _registry_returning(None)
    resp = client.post("/api/login", json={"email": "nobody@acme.edu", "password": "pass"})
    assert resp.status_code == 401


def test_login_wrong_password():
    app.dependency_overrides[get_registry_store] = lambda: _registry_returning(FAKE_USER)
    resp = client.post("/api/login", json={"email": "jane@acme.edu", "password": "wrong-pass"})
    assert resp.status_code == 401


def test_get_me_returns_profile_without_password_hash():
    from app.api.auth import get_current_user
    app.dependency_overrides[get_current_user] = lambda: FAKE_USER
    resp = client.get("/api/me", headers={"Authorization": "Bearer dummy"})
    assert resp.status_code == 200
    data = resp.json()
    assert data["email"] == "jane@acme.edu"
    assert "password_hash" not in data
