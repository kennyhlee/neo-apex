"""Tests for DataCore auth API endpoints."""
import tempfile

import pytest
from fastapi.testclient import TestClient
from unittest.mock import MagicMock

from datacore import Store
from datacore.api import create_app
from datacore.auth.passwords import hash_password


@pytest.fixture
def auth_client():
    with tempfile.TemporaryDirectory() as tmp:
        mock_embedder = MagicMock()
        mock_embedder.embed.return_value = [0.0] * 1024
        store = Store(data_dir=tmp, embedder=mock_embedder)

        # Seed a test user in the global registry table
        store.put_global("registry", "user:u-001", {
            "user_id": "u-001",
            "name": "Jane Admin",
            "email": "jane@acme.edu",
            "password_hash": hash_password("admin123"),
            "tenant_id": "acme",
            "tenant_name": "Acme Afterschool",
            "role": "admin",
            "created_at": "2026-01-01T00:00:00+00:00",
        })
        app = create_app(store)
        yield TestClient(app), store


def test_login_success(auth_client):
    client, _ = auth_client
    resp = client.post("/auth/login", json={"email": "jane@acme.edu", "password": "admin123"})
    assert resp.status_code == 200
    data = resp.json()
    assert "token" in data
    assert data["user"]["email"] == "jane@acme.edu"
    assert "password_hash" not in data["user"]


def test_login_wrong_password(auth_client):
    client, _ = auth_client
    resp = client.post("/auth/login", json={"email": "jane@acme.edu", "password": "wrong"})
    assert resp.status_code == 401


def test_login_unknown_email(auth_client):
    client, _ = auth_client
    resp = client.post("/auth/login", json={"email": "nobody@acme.edu", "password": "admin123"})
    assert resp.status_code == 401


def test_me_with_valid_token(auth_client):
    client, _ = auth_client
    login_resp = client.post("/auth/login", json={"email": "jane@acme.edu", "password": "admin123"})
    token = login_resp.json()["token"]
    resp = client.get("/auth/me", headers={"Authorization": f"Bearer {token}"})
    assert resp.status_code == 200
    assert resp.json()["email"] == "jane@acme.edu"
    assert "password_hash" not in resp.json()


def test_me_without_token(auth_client):
    client, _ = auth_client
    resp = client.get("/auth/me")
    assert resp.status_code == 401


def test_me_with_invalid_token(auth_client):
    client, _ = auth_client
    resp = client.get("/auth/me", headers={"Authorization": "Bearer bad-token"})
    assert resp.status_code == 401


def test_exchange_and_redeem(auth_client):
    client, _ = auth_client
    login_resp = client.post("/auth/login", json={"email": "jane@acme.edu", "password": "admin123"})
    token = login_resp.json()["token"]

    exchange_resp = client.post(
        "/auth/exchange-code",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert exchange_resp.status_code == 200
    code = exchange_resp.json()["code"]

    redeem_resp = client.post("/auth/redeem-code", json={"code": code})
    assert redeem_resp.status_code == 200
    assert "token" in redeem_resp.json()

    me_resp = client.get(
        "/auth/me",
        headers={"Authorization": f"Bearer {redeem_resp.json()['token']}"},
    )
    assert me_resp.status_code == 200
    assert me_resp.json()["email"] == "jane@acme.edu"


def test_redeem_code_single_use(auth_client):
    client, _ = auth_client
    login_resp = client.post("/auth/login", json={"email": "jane@acme.edu", "password": "admin123"})
    token = login_resp.json()["token"]
    exchange_resp = client.post(
        "/auth/exchange-code",
        headers={"Authorization": f"Bearer {token}"},
    )
    code = exchange_resp.json()["code"]

    client.post("/auth/redeem-code", json={"code": code})
    resp = client.post("/auth/redeem-code", json={"code": code})
    assert resp.status_code == 401


def test_redeem_invalid_code(auth_client):
    client, _ = auth_client
    resp = client.post("/auth/redeem-code", json={"code": "nonexistent"})
    assert resp.status_code == 401
