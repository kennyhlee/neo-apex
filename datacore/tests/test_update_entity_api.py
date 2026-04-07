"""Tests for PUT /api/entities/{tenant_id}/{entity_type}/{entity_id} endpoint."""
import tempfile

import pytest
from fastapi.testclient import TestClient
from unittest.mock import MagicMock

from datacore import Store
from datacore.api import create_app


@pytest.fixture
def upd_client():
    with tempfile.TemporaryDirectory() as tmp:
        mock_embedder = MagicMock()
        mock_embedder.embed.return_value = [0.0] * 1024
        store = Store(data_dir=tmp, embedder=mock_embedder)

        store.put_entity(
            tenant_id="t1", entity_type="tenant", entity_id="t1",
            base_data={"tenant_id": "t1", "name": "Test School", "_abbrev": "TES"},
        )
        store.put_entity(
            tenant_id="t1", entity_type="student", entity_id="s1",
            base_data={"first_name": "Alice", "last_name": "Smith", "grade_level": "2nd"},
            custom_fields={"transportation": "bus"},
        )

        app = create_app(store)
        yield TestClient(app), store


def test_update_entity(upd_client):
    client, store = upd_client
    resp = client.put("/api/entities/t1/student/s1", json={
        "base_data": {"first_name": "Alice", "last_name": "Smith", "grade_level": "3rd"},
        "custom_fields": {"transportation": "car"},
    })
    assert resp.status_code == 200
    body = resp.json()
    assert body["base_data"]["grade_level"] == "3rd"
    assert body["custom_fields"]["transportation"] == "car"
    assert body["_version"] == 2

    entity = store.get_active_entity("t1", "student", "s1")
    assert entity["base_data"]["grade_level"] == "3rd"


def test_update_entity_not_found(upd_client):
    client, _ = upd_client
    resp = client.put("/api/entities/t1/student/nonexistent", json={
        "base_data": {"first_name": "Bob"},
    })
    assert resp.status_code == 200
    assert resp.json()["_version"] == 1


def test_update_entity_no_tenant(upd_client):
    client, _ = upd_client
    resp = client.put("/api/entities/no_tenant/student/s1", json={
        "base_data": {"first_name": "Alice"},
    })
    assert resp.status_code == 400
    assert "Tenant" in resp.json()["detail"]


def test_update_entity_missing_body(upd_client):
    client, _ = upd_client
    resp = client.put("/api/entities/t1/student/s1", json={})
    assert resp.status_code == 422


def test_update_preserves_version_history(upd_client):
    client, store = upd_client
    client.put("/api/entities/t1/student/s1", json={
        "base_data": {"first_name": "Alice", "last_name": "Smith", "grade_level": "3rd"},
    })
    client.put("/api/entities/t1/student/s1", json={
        "base_data": {"first_name": "Alice", "last_name": "Smith", "grade_level": "4th"},
    })
    entity = store.get_active_entity("t1", "student", "s1")
    assert entity["_version"] == 3
    assert entity["base_data"]["grade_level"] == "4th"
