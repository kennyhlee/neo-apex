"""Tests for DataCore registry API endpoints — user CRUD and onboarding."""
import copy
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


# ---------------------------------------------------------------------------
# User CRUD
# ---------------------------------------------------------------------------

def test_query_users_by_tenant(reg_client):
    client, store = reg_client
    store.put_global("registry", "user:u-001", {
        "user_id": "u-001", "name": "Alice", "email": "alice@acme.edu",
        "password_hash": hash_password("pw"), "tenant_id": "acme",
        "tenant_name": "Acme", "role": "admin", "created_at": "2026-01-01T00:00:00+00:00",
    })
    store.put_global("registry", "user:u-002", {
        "user_id": "u-002", "name": "Bob", "email": "bob@acme.edu",
        "password_hash": hash_password("pw"), "tenant_id": "acme",
        "tenant_name": "Acme", "role": "staff", "created_at": "2026-01-01T00:00:00+00:00",
    })
    store.put_global("registry", "user:u-003", {
        "user_id": "u-003", "name": "Carol", "email": "carol@xyz.edu",
        "password_hash": hash_password("pw"), "tenant_id": "xyz",
        "tenant_name": "XYZ", "role": "admin", "created_at": "2026-01-01T00:00:00+00:00",
    })

    resp = client.get("/api/registry/users?tenant_id=acme")
    assert resp.status_code == 200
    users = resp.json()
    assert len(users) == 2
    for u in users:
        assert u["tenant_id"] == "acme"
        assert "password_hash" not in u


def test_query_users_by_email(reg_client):
    client, store = reg_client
    store.put_global("registry", "user:u-001", {
        "user_id": "u-001", "name": "Alice", "email": "alice@acme.edu",
        "password_hash": hash_password("pw"), "tenant_id": "acme",
        "tenant_name": "Acme", "role": "admin", "created_at": "2026-01-01T00:00:00+00:00",
    })

    resp = client.get("/api/registry/users?email=alice@acme.edu")
    assert resp.status_code == 200
    users = resp.json()
    assert len(users) == 1
    assert users[0]["email"] == "alice@acme.edu"
    assert "password_hash" not in users[0]


def test_query_users_empty(reg_client):
    client, _ = reg_client
    resp = client.get("/api/registry/users?tenant_id=nonexistent")
    assert resp.status_code == 200
    assert resp.json() == []


def test_create_user(reg_client):
    client, _ = reg_client
    resp = client.post("/api/registry/users", json={
        "name": "New User",
        "email": "newuser@acme.edu",
        "password": "secret123",
        "tenant_id": "acme",
        "tenant_name": "Acme",
        "role": "staff",
    })
    assert resp.status_code == 201
    data = resp.json()
    assert data["user_id"].startswith("u-")
    assert data["email"] == "newuser@acme.edu"
    assert "password_hash" not in data


def test_create_user_duplicate_email(reg_client):
    client, store = reg_client
    store.put_global("registry", "user:u-001", {
        "user_id": "u-001", "name": "Alice", "email": "alice@acme.edu",
        "password_hash": hash_password("pw"), "tenant_id": "acme",
        "tenant_name": "Acme", "role": "admin", "created_at": "2026-01-01T00:00:00+00:00",
    })

    resp = client.post("/api/registry/users", json={
        "name": "Alice Clone",
        "email": "alice@acme.edu",
        "password": "pw",
        "tenant_id": "acme",
        "tenant_name": "Acme",
        "role": "staff",
    })
    assert resp.status_code == 409


def test_get_user_by_id(reg_client):
    client, store = reg_client
    store.put_global("registry", "user:u-001", {
        "user_id": "u-001", "name": "Alice", "email": "alice@acme.edu",
        "password_hash": hash_password("pw"), "tenant_id": "acme",
        "tenant_name": "Acme", "role": "admin", "created_at": "2026-01-01T00:00:00+00:00",
    })

    resp = client.get("/api/registry/users/u-001")
    assert resp.status_code == 200
    data = resp.json()
    assert data["user_id"] == "u-001"
    assert data["name"] == "Alice"
    assert data["email"] == "alice@acme.edu"
    assert "password_hash" not in data


def test_get_user_not_found(reg_client):
    client, _ = reg_client
    resp = client.get("/api/registry/users/u-nonexistent")
    assert resp.status_code == 404


def test_update_user(reg_client):
    client, store = reg_client
    store.put_global("registry", "user:u-001", {
        "user_id": "u-001", "name": "Alice", "email": "alice@acme.edu",
        "password_hash": hash_password("pw"), "tenant_id": "acme",
        "tenant_name": "Acme", "role": "admin", "created_at": "2026-01-01T00:00:00+00:00",
    })

    resp = client.put("/api/registry/users/u-001", json={"name": "Alice Updated"})
    assert resp.status_code == 200
    data = resp.json()
    assert data["name"] == "Alice Updated"
    assert "password_hash" not in data


def test_update_user_not_found(reg_client):
    client, _ = reg_client
    resp = client.put("/api/registry/users/u-nonexistent", json={"name": "Ghost"})
    assert resp.status_code == 404


def test_delete_user(reg_client):
    client, store = reg_client
    store.put_global("registry", "user:u-001", {
        "user_id": "u-001", "name": "Alice", "email": "alice@acme.edu",
        "password_hash": hash_password("pw"), "tenant_id": "acme",
        "tenant_name": "Acme", "role": "admin", "created_at": "2026-01-01T00:00:00+00:00",
    })

    del_resp = client.delete("/api/registry/users/u-001")
    assert del_resp.status_code == 200
    assert del_resp.json() == {"status": "deleted"}

    get_resp = client.get("/api/registry/users/u-001")
    assert get_resp.status_code == 404


def test_delete_user_not_found(reg_client):
    client, _ = reg_client
    resp = client.delete("/api/registry/users/u-nonexistent")
    assert resp.status_code == 404


# ---------------------------------------------------------------------------
# Onboarding
# ---------------------------------------------------------------------------

def test_get_onboarding(reg_client):
    client, store = reg_client
    store.put_global("registry", "onboarding:acme", {
        "tenant_id": "acme",
        "steps": [
            {"id": "model_setup", "label": "Set Up Model", "completed": False},
            {"id": "tenant_details", "label": "Tenant Details", "completed": False},
        ],
        "is_complete": False,
    })

    resp = client.get("/api/registry/onboarding/acme")
    assert resp.status_code == 200
    data = resp.json()
    assert data["tenant_id"] == "acme"
    assert len(data["steps"]) == 2
    assert data["is_complete"] is False


def test_get_onboarding_not_found(reg_client):
    client, _ = reg_client
    resp = client.get("/api/registry/onboarding/nonexistent")
    assert resp.status_code == 404


def test_complete_onboarding_step(reg_client):
    client, store = reg_client
    store.put_global("registry", "onboarding:acme", {
        "tenant_id": "acme",
        "steps": [
            {"id": "model_setup", "label": "Set Up Model", "completed": False},
            {"id": "tenant_details", "label": "Tenant Details", "completed": False},
        ],
        "is_complete": False,
    })

    resp = client.post("/api/registry/onboarding/acme/complete-step", json={"step_id": "model_setup"})
    assert resp.status_code == 200
    data = resp.json()

    model_step = next(s for s in data["steps"] if s["id"] == "model_setup")
    assert model_step["completed"] is True
    assert data["is_complete"] is False


def test_complete_all_steps_marks_complete(reg_client):
    client, store = reg_client
    store.put_global("registry", "onboarding:acme", {
        "tenant_id": "acme",
        "steps": [
            {"id": "model_setup", "label": "Set Up Model", "completed": False},
            {"id": "tenant_details", "label": "Tenant Details", "completed": False},
        ],
        "is_complete": False,
    })

    client.post("/api/registry/onboarding/acme/complete-step", json={"step_id": "model_setup"})
    resp = client.post("/api/registry/onboarding/acme/complete-step", json={"step_id": "tenant_details"})
    assert resp.status_code == 200
    data = resp.json()
    assert data["is_complete"] is True


def test_complete_step_no_onboarding(reg_client):
    client, _ = reg_client
    resp = client.post("/api/registry/onboarding/nonexistent/complete-step", json={"step_id": "model_setup"})
    assert resp.status_code == 404
