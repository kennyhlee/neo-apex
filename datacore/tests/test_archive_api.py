"""Tests for POST /api/entities/{tenant_id}/{entity_type}/archive endpoint."""
import tempfile

import pytest
from fastapi.testclient import TestClient
from unittest.mock import MagicMock

from datacore import Store
from datacore.api import create_app


@pytest.fixture
def arc_client():
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
            base_data={"first_name": "Alice", "last_name": "Smith"},
        )
        store.put_entity(
            tenant_id="t1", entity_type="student", entity_id="s2",
            base_data={"first_name": "Bob", "last_name": "Jones"},
        )
        store.put_entity(
            tenant_id="t1", entity_type="student", entity_id="s3",
            base_data={"first_name": "Carol", "last_name": "Lee"},
        )

        app = create_app(store)
        yield TestClient(app), store


def test_archive_single(arc_client):
    client, store = arc_client
    resp = client.post("/api/entities/t1/student/archive", json={
        "entity_ids": ["s1"],
    })
    assert resp.status_code == 200
    assert resp.json() == {"archived": 1}
    entity = store.get_active_entity("t1", "student", "s1")
    assert entity is None


def test_archive_multiple(arc_client):
    client, store = arc_client
    resp = client.post("/api/entities/t1/student/archive", json={
        "entity_ids": ["s1", "s2"],
    })
    assert resp.status_code == 200
    assert resp.json() == {"archived": 2}
    assert store.get_active_entity("t1", "student", "s1") is None
    assert store.get_active_entity("t1", "student", "s2") is None
    assert store.get_active_entity("t1", "student", "s3") is not None


def test_archive_nonexistent(arc_client):
    client, _ = arc_client
    resp = client.post("/api/entities/t1/student/archive", json={
        "entity_ids": ["nonexistent"],
    })
    assert resp.status_code == 200
    assert resp.json() == {"archived": 0}


def test_archive_empty_list(arc_client):
    client, _ = arc_client
    resp = client.post("/api/entities/t1/student/archive", json={
        "entity_ids": [],
    })
    assert resp.status_code == 200
    assert resp.json() == {"archived": 0}


def test_archive_missing_body(arc_client):
    client, _ = arc_client
    resp = client.post("/api/entities/t1/student/archive", json={})
    assert resp.status_code == 422
