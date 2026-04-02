"""Tests for tenant API endpoints."""

import tempfile

import pytest
from fastapi.testclient import TestClient
from unittest.mock import MagicMock

from datacore import Store
from datacore.api import create_app


@pytest.fixture
def tenant_client():
    with tempfile.TemporaryDirectory() as tmp:
        mock_embedder = MagicMock()
        mock_embedder.embed.return_value = [0.0] * 1024
        store = Store(data_dir=tmp, embedder=mock_embedder)
        app = create_app(store)
        yield TestClient(app), store


def test_put_tenant_creates_entity(tenant_client):
    client, store = tenant_client
    resp = client.put(
        "/api/tenants/t1",
        json={
            "base_data": {
                "tenant_id": "t1",
                "name": "Acme Child Center",
                "primary_address": "123 Main St",
            },
        },
    )
    assert resp.status_code == 201
    data = resp.json()
    assert data["entity_type"] == "tenant"
    assert data["entity_id"] == "t1"
    assert data["base_data"]["name"] == "Acme Child Center"
    assert data["base_data"]["_abbrev"] == "ACC"
    assert data["_version"] == 1


def test_put_tenant_derives_abbrev_two_words(tenant_client):
    client, _ = tenant_client
    resp = client.put(
        "/api/tenants/t1",
        json={"base_data": {"tenant_id": "t1", "name": "Green Valley"}},
    )
    assert resp.status_code == 201
    assert resp.json()["base_data"]["_abbrev"] == "GVA"


def test_put_tenant_derives_abbrev_three_words(tenant_client):
    client, _ = tenant_client
    resp = client.put(
        "/api/tenants/t1",
        json={"base_data": {"tenant_id": "t1", "name": "Acme Child Center"}},
    )
    assert resp.status_code == 201
    assert resp.json()["base_data"]["_abbrev"] == "ACC"


def test_put_tenant_derives_abbrev_fallback_to_id(tenant_client):
    client, _ = tenant_client
    resp = client.put(
        "/api/tenants/myorg",
        json={"base_data": {"tenant_id": "myorg"}},
    )
    assert resp.status_code == 201
    assert resp.json()["base_data"]["_abbrev"] == "MYO"


def test_put_tenant_update_returns_200(tenant_client):
    client, _ = tenant_client
    client.put(
        "/api/tenants/t1",
        json={"base_data": {"tenant_id": "t1", "name": "Old Name"}},
    )
    resp = client.put(
        "/api/tenants/t1",
        json={"base_data": {"tenant_id": "t1", "name": "New Name"}},
    )
    assert resp.status_code == 200
    assert resp.json()["_version"] == 2


def test_put_tenant_with_custom_fields(tenant_client):
    client, _ = tenant_client
    resp = client.put(
        "/api/tenants/t1",
        json={
            "base_data": {"tenant_id": "t1", "name": "Test School"},
            "custom_fields": {"state_rating": "5-star"},
        },
    )
    assert resp.status_code == 201
    assert resp.json()["custom_fields"]["state_rating"] == "5-star"


def test_get_tenant_returns_entity(tenant_client):
    client, _ = tenant_client
    client.put(
        "/api/tenants/t1",
        json={"base_data": {"tenant_id": "t1", "name": "Test School"}},
    )
    resp = client.get("/api/tenants/t1")
    assert resp.status_code == 200
    assert resp.json()["base_data"]["name"] == "Test School"
    assert resp.json()["base_data"]["_abbrev"] == "TSC"


def test_get_tenant_not_found(tenant_client):
    client, _ = tenant_client
    resp = client.get("/api/tenants/nonexistent")
    assert resp.status_code == 404
