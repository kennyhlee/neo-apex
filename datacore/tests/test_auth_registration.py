"""Tests for DataCore auth registration endpoints."""
import tempfile

import pytest
from fastapi.testclient import TestClient
from unittest.mock import MagicMock

from datacore import Store
from datacore.api import create_app
from datacore.auth.passwords import hash_password


@pytest.fixture
def reg_client():
    with tempfile.TemporaryDirectory() as tmp:
        mock_embedder = MagicMock()
        mock_embedder.embed.return_value = [0.0] * 1024
        store = Store(data_dir=tmp, embedder=mock_embedder)
        app = create_app(store)
        yield TestClient(app), store


def test_register_creates_user(reg_client):
    client, _ = reg_client
    resp = client.post("/auth/register", json={
        "name": "Jane Admin",
        "email": "jane@acme.edu",
        "password": "admin123",
        "tenant_name": "Acme Afterschool",
        "tenant_id": "acme",
    })
    assert resp.status_code == 200
    data = resp.json()
    assert "token" in data
    assert data["user"]["email"] == "jane@acme.edu"
    assert data["user"]["role"] == "admin"
    assert "password_hash" not in data["user"]


def test_register_duplicate_email(reg_client):
    client, store = reg_client
    store.put_global("registry", "user:u-001", {
        "user_id": "u-001",
        "name": "Jane",
        "email": "jane@acme.edu",
        "password_hash": hash_password("pw"),
        "tenant_id": "acme",
        "tenant_name": "Acme",
        "role": "admin",
        "created_at": "2026-01-01T00:00:00+00:00",
    })
    resp = client.post("/auth/register", json={
        "name": "Jane 2",
        "email": "jane@acme.edu",
        "password": "pw2",
        "tenant_name": "Other",
        "tenant_id": "other",
    })
    assert resp.status_code == 409


def test_register_duplicate_tenant_id(reg_client):
    client, store = reg_client
    store.put_global("registry", "onboarding:acme", {
        "tenant_id": "acme",
        "steps": [],
        "is_complete": False,
    })
    resp = client.post("/auth/register", json={
        "name": "Jane",
        "email": "jane@acme.edu",
        "password": "pw",
        "tenant_name": "Acme",
        "tenant_id": "acme",
    })
    assert resp.status_code == 409


def test_register_invalid_tenant_id(reg_client):
    client, _ = reg_client
    resp = client.post("/auth/register", json={
        "name": "Jane",
        "email": "jane@acme.edu",
        "password": "pw",
        "tenant_name": "Acme",
        "tenant_id": "AB",
    })
    assert resp.status_code == 422


def test_check_email_new_tenant(reg_client):
    client, _ = reg_client
    resp = client.post("/auth/register/check-email", json={"email": "jane@acme.edu"})
    assert resp.status_code == 200
    assert resp.json()["status"] == "new_tenant"


def test_check_email_common_provider(reg_client):
    client, _ = reg_client
    resp = client.post("/auth/register/check-email", json={"email": "jane@gmail.com"})
    assert resp.status_code == 200
    assert resp.json()["status"] == "new_tenant"


def test_check_email_org_exists(reg_client):
    client, store = reg_client
    store.put_global("registry", "user:u-001", {
        "user_id": "u-001",
        "name": "Jane",
        "email": "jane@acme.edu",
        "password_hash": hash_password("pw"),
        "tenant_id": "acme",
        "tenant_name": "Acme",
        "role": "admin",
        "created_at": "2026-01-01T00:00:00+00:00",
    })
    resp = client.post("/auth/register/check-email", json={"email": "bob@acme.edu"})
    assert resp.status_code == 200
    assert resp.json()["status"] == "org_exists"
    assert resp.json()["admin_email_hint"] is not None


def test_suggest_ids(reg_client):
    client, _ = reg_client
    resp = client.post("/auth/register/suggest-ids", json={
        "email": "jane@acme.edu",
        "tenant_name": "Acme Afterschool",
    })
    assert resp.status_code == 200
    assert len(resp.json()["suggestions"]) > 0
