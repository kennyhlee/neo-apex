"""Tests for the datacore REST API."""

import tempfile

import pytest
from fastapi.testclient import TestClient

from datacore import Store
from datacore.api import create_app


@pytest.fixture
def app_client():
    from unittest.mock import MagicMock
    with tempfile.TemporaryDirectory() as tmp:
        mock_embedder = MagicMock()
        mock_embedder.embed.return_value = [0.0] * 1024
        store = Store(data_dir=tmp, embedder=mock_embedder)
        store.put_entity(
            tenant_id="t1",
            entity_type="tenant",
            entity_id="t1",
            base_data={"tenant_id": "t1", "name": "Test School", "_abbrev": "TES"},
        )
        app = create_app(store)
        yield TestClient(app), store


def test_cors_allows_admindash_origin(app_client):
    client, _ = app_client
    response = client.options(
        "/api/models/t1/student",
        headers={
            "Origin": "http://localhost:5600",
            "Access-Control-Request-Method": "GET",
        },
    )
    assert response.headers.get("access-control-allow-origin") == "http://localhost:5600"


def test_cors_allows_papermite_origin(app_client):
    client, _ = app_client
    response = client.options(
        "/api/models/t1/student",
        headers={
            "Origin": "http://localhost:5700",
            "Access-Control-Request-Method": "GET",
        },
    )
    assert response.headers.get("access-control-allow-origin") == "http://localhost:5700"


def test_create_entity_returns_201(app_client):
    client, store = app_client
    response = client.post(
        "/api/entities/t1/student",
        json={
            "base_data": {"first_name": "Alice", "last_name": "Smith"},
            "custom_fields": {"city": "Springfield"},
        },
    )
    assert response.status_code == 201
    data = response.json()
    assert data["entity_type"] == "student"
    assert "entity_id" in data
    assert len(data["entity_id"]) > 0
    assert data["base_data"]["first_name"] == "Alice"
    assert data["custom_fields"]["city"] == "Springfield"
    assert data["_version"] == 1
    assert data["_status"] == "active"


def test_create_entity_generates_uuid(app_client):
    client, _ = app_client
    r1 = client.post(
        "/api/entities/t1/student",
        json={"base_data": {"first_name": "Alice", "last_name": "Smith"}},
    )
    r2 = client.post(
        "/api/entities/t1/student",
        json={"base_data": {"first_name": "Bob", "last_name": "Jones"}},
    )
    assert r1.status_code == 201
    assert r2.status_code == 201
    assert r1.json()["entity_id"] != r2.json()["entity_id"]


def test_create_entity_without_custom_fields(app_client):
    client, _ = app_client
    response = client.post(
        "/api/entities/t1/student",
        json={"base_data": {"first_name": "Alice", "last_name": "Smith"}},
    )
    assert response.status_code == 201
    data = response.json()
    assert data["custom_fields"] == {}


def test_create_entity_persists_to_store(app_client):
    client, store = app_client
    response = client.post(
        "/api/entities/t1/student",
        json={
            "base_data": {"first_name": "Alice", "last_name": "Smith"},
            "custom_fields": {"city": "Springfield"},
        },
    )
    entity_id = response.json()["entity_id"]

    # Verify it's retrievable from the store
    active = store.get_active_entity("t1", "student", entity_id)
    assert active is not None
    assert active["base_data"]["first_name"] == "Alice"
    assert active["custom_fields"]["city"] == "Springfield"


# --- Query endpoint tests ---


def test_create_entity_without_tenant_returns_400(app_client):
    """POST /api/entities without tenant setup returns 400."""
    client, _ = app_client
    # Use a tenant that has no tenant entity
    resp = client.post(
        "/api/entities/no_tenant/student",
        json={"base_data": {"first_name": "Alice", "last_name": "Smith"}},
    )
    assert resp.status_code == 400
    assert "Tenant not set up" in resp.json()["detail"]


# --- PUT /api/models/{tenant_id} tests ---


def test_put_models_creates_new(app_client):
    client, store = app_client
    response = client.put("/api/models/t1", json={
        "model_definition": {
            "student": {
                "base_fields": [{"name": "first_name", "type": "str", "required": True}],
                "custom_fields": [],
            }
        },
        "source_filename": "test.pdf",
        "created_by": "Jane Admin",
    })
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "finalized"
    assert data["version"] == 1
    assert "student" in data["model_definition"]
    assert data["source_filename"] == "test.pdf"
    assert data["created_by"] == "Jane Admin"


def test_put_models_unchanged(app_client):
    client, store = app_client
    body = {
        "model_definition": {
            "student": {
                "base_fields": [{"name": "first_name", "type": "str", "required": True}],
                "custom_fields": [],
            }
        },
        "source_filename": "test.pdf",
        "created_by": "Jane Admin",
    }
    client.put("/api/models/t1", json=body)
    response = client.put("/api/models/t1", json=body)
    assert response.status_code == 200
    assert response.json()["status"] == "unchanged"


def test_put_models_increments_version(app_client):
    client, store = app_client
    body1 = {
        "model_definition": {
            "student": {
                "base_fields": [{"name": "first_name", "type": "str", "required": True}],
                "custom_fields": [],
            }
        },
        "source_filename": "v1.pdf",
        "created_by": "Jane",
    }
    r1 = client.put("/api/models/t1", json=body1)
    assert r1.json()["version"] == 1

    body2 = {
        "model_definition": {
            "student": {
                "base_fields": [
                    {"name": "first_name", "type": "str", "required": True},
                    {"name": "last_name", "type": "str", "required": True},
                ],
                "custom_fields": [],
            }
        },
        "source_filename": "v2.pdf",
        "created_by": "Jane",
    }
    r2 = client.put("/api/models/t1", json=body2)
    assert r2.json()["version"] == 2
    assert r2.json()["status"] == "finalized"
