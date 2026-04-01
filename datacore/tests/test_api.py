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


# --- Query endpoint tests ---


def test_query_default_returns_active_students(app_client):
    client, store = app_client
    store.put_entity("t1", "student", "s1", {"first_name": "Zara", "last_name": "Adams"}, {})
    store.put_entity("t1", "student", "s2", {"first_name": "Alice", "last_name": "Brown"}, {})
    store.put_entity("t1", "student", "s3", {"first_name": "Bob", "last_name": "Clark"}, {})

    resp = client.get("/api/entities/t1/student/query")
    assert resp.status_code == 200
    body = resp.json()
    assert body["total"] == 3
    assert len(body["data"]) == 3
    assert body["data"][0]["last_name"] == "Adams"
    assert body["data"][1]["last_name"] == "Brown"


def test_query_filters_by_entity_type(app_client):
    client, store = app_client
    store.put_entity("t1", "student", "s1", {"last_name": "A"}, {})
    store.put_entity("t1", "teacher", "t1", {"last_name": "B"}, {})

    resp = client.get("/api/entities/t1/student/query")
    assert resp.status_code == 200
    assert resp.json()["total"] == 1
    assert resp.json()["data"][0]["entity_type"] == "student"


def test_query_sort(app_client):
    client, store = app_client
    store.put_entity("t1", "student", "s1", {"first_name": "Zara", "last_name": "A"}, {})
    store.put_entity("t1", "student", "s2", {"first_name": "Alice", "last_name": "B"}, {})

    resp = client.get("/api/entities/t1/student/query?sort_by=first_name&sort_dir=desc")
    assert resp.status_code == 200
    data = resp.json()["data"]
    assert data[0]["first_name"] == "Zara"


def test_query_invalid_sort_column(app_client):
    client, store = app_client
    store.put_entity("t1", "student", "s1", {"last_name": "A"}, {})
    resp = client.get("/api/entities/t1/student/query?sort_by=nonexistent")
    assert resp.status_code == 400


def test_query_pagination(app_client):
    client, store = app_client
    for i in range(5):
        store.put_entity("t1", "student", f"s{i}", {"last_name": f"Name{i:02d}"}, {})

    resp = client.get("/api/entities/t1/student/query?limit=2&offset=2")
    body = resp.json()
    assert body["total"] == 5
    assert len(body["data"]) == 2


def test_query_limit_clamped(app_client):
    client, store = app_client
    store.put_entity("t1", "student", "s1", {"last_name": "A"}, {})
    resp = client.get("/api/entities/t1/student/query?limit=100")
    assert resp.status_code == 200


def test_query_base_field_filter(app_client):
    client, store = app_client
    store.put_entity("t1", "student", "s1", {"first_name": "Jane", "last_name": "Doe"}, {})
    store.put_entity("t1", "student", "s2", {"first_name": "John", "last_name": "Smith"}, {})

    resp = client.get("/api/entities/t1/student/query?first_name=jan")
    body = resp.json()
    assert body["total"] == 1
    assert body["data"][0]["first_name"] == "Jane"


def test_query_address_substring_match(app_client):
    client, store = app_client
    store.put_entity("t1", "student", "s1", {"last_name": "A", "address": "123 Main St, San Jose, CA"}, {})
    store.put_entity("t1", "student", "s2", {"last_name": "B", "address": "456 Oak Ave, Portland, OR"}, {})

    resp = client.get("/api/entities/t1/student/query?address=san jose")
    body = resp.json()
    assert body["total"] == 1
    assert "San Jose" in body["data"][0]["address"]
