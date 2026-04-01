"""Tests for the datacore REST API."""

import tempfile

import pytest
from fastapi.testclient import TestClient

from datacore import Store
from datacore.api import create_app


@pytest.fixture
def app_client():
    with tempfile.TemporaryDirectory() as tmp:
        store = Store(data_dir=tmp)
        app = create_app(store)
        yield TestClient(app), store


def test_cors_allows_admindash_origin(app_client):
    client, _ = app_client
    response = client.options(
        "/api/models/t1/student",
        headers={
            "Origin": "http://localhost:5174",
            "Access-Control-Request-Method": "GET",
        },
    )
    assert response.headers.get("access-control-allow-origin") == "http://localhost:5174"


def test_cors_allows_papermite_origin(app_client):
    client, _ = app_client
    response = client.options(
        "/api/models/t1/student",
        headers={
            "Origin": "http://localhost:5173",
            "Access-Control-Request-Method": "GET",
        },
    )
    assert response.headers.get("access-control-allow-origin") == "http://localhost:5173"


def test_get_model_returns_active_definition(app_client):
    client, store = app_client
    store.put_model(
        tenant_id="t1",
        entity_type="student",
        model_definition={
            "base_fields": [
                {"name": "first_name", "type": "str", "required": True},
            ],
            "custom_fields": [],
        },
    )

    response = client.get("/api/models/t1/student")
    assert response.status_code == 200
    data = response.json()
    assert data["entity_type"] == "student"
    assert isinstance(data["model_definition"], dict)
    assert data["model_definition"]["base_fields"][0]["name"] == "first_name"


def test_get_model_not_found(app_client):
    client, _ = app_client
    response = client.get("/api/models/t1/nonexistent")
    assert response.status_code == 404


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
