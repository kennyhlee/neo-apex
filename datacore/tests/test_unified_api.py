"""Tests for the unified POST /api/query endpoint."""
import json
import tempfile

import pytest
from fastapi.testclient import TestClient
from unittest.mock import MagicMock

from datacore import Store
from datacore.api import create_app


@pytest.fixture
def uf_client():
    with tempfile.TemporaryDirectory() as tmp:
        mock_embedder = MagicMock()
        mock_embedder.embed.return_value = [0.0] * 1024
        store = Store(data_dir=tmp, embedder=mock_embedder)

        # Set up tenant
        store.put_entity(
            tenant_id="t1", entity_type="tenant", entity_id="t1",
            base_data={"tenant_id": "t1", "name": "Test School", "_abbrev": "TES"},
        )
        # Add students
        store.put_entity(
            tenant_id="t1", entity_type="student", entity_id="s1",
            base_data={"first_name": "Alice", "last_name": "Smith", "grade": "5"},
        )
        store.put_entity(
            tenant_id="t1", entity_type="student", entity_id="s2",
            base_data={"first_name": "Bob", "last_name": "Jones", "grade": "3"},
        )
        # Add model
        store.put_model(
            tenant_id="t1", entity_type="student",
            model_definition={
                "base_fields": [{"name": "first_name", "type": "str", "required": True}],
                "custom_fields": [],
            },
        )

        app = create_app(store)
        yield TestClient(app), store


# --- Entity queries ---

def test_query_entities(uf_client):
    client, _ = uf_client
    resp = client.post("/api/query", json={
        "tenant_id": "t1",
        "table": "entities",
        "sql": "SELECT * FROM data WHERE entity_type = 'student' AND _status = 'active' ORDER BY last_name",
    })
    assert resp.status_code == 200
    data = resp.json()
    assert data["total"] == 2
    assert len(data["data"]) == 2
    assert data["data"][0]["last_name"] == "Jones"


def test_query_entities_with_filter(uf_client):
    client, _ = uf_client
    resp = client.post("/api/query", json={
        "tenant_id": "t1",
        "table": "entities",
        "sql": "SELECT * FROM data WHERE entity_type = 'student' AND _status = 'active' AND first_name = 'Alice'",
    })
    assert resp.status_code == 200
    assert resp.json()["total"] == 1
    assert resp.json()["data"][0]["first_name"] == "Alice"


def test_query_entities_empty(uf_client):
    client, _ = uf_client
    resp = client.post("/api/query", json={
        "tenant_id": "t1",
        "table": "entities",
        "sql": "SELECT * FROM data WHERE entity_type = 'teacher'",
    })
    assert resp.status_code == 200
    assert resp.json() == {"data": [], "total": 0}


def test_query_entities_no_table(uf_client):
    client, _ = uf_client
    resp = client.post("/api/query", json={
        "tenant_id": "nonexistent",
        "table": "entities",
        "sql": "SELECT * FROM data",
    })
    assert resp.status_code == 200
    assert resp.json() == {"data": [], "total": 0}


# --- Tenant queries ---

def test_query_tenant(uf_client):
    client, _ = uf_client
    resp = client.post("/api/query", json={
        "tenant_id": "t1",
        "table": "tenants",
        "sql": "SELECT * FROM data WHERE entity_type = 'tenant' AND _status = 'active'",
    })
    assert resp.status_code == 200
    data = resp.json()
    assert data["total"] >= 1


# --- Model queries ---

def test_query_models(uf_client):
    client, _ = uf_client
    resp = client.post("/api/query", json={
        "tenant_id": "t1",
        "table": "models",
        "sql": "SELECT * FROM data WHERE _status = 'active'",
    })
    assert resp.status_code == 200
    data = resp.json()
    assert data["total"] >= 1


def test_query_models_by_entity_type(uf_client):
    client, _ = uf_client
    resp = client.post("/api/query", json={
        "tenant_id": "t1",
        "table": "models",
        "sql": "SELECT * FROM data WHERE entity_type = 'student' AND _status = 'active'",
    })
    assert resp.status_code == 200
    assert resp.json()["total"] == 1


# --- Validation ---

def test_query_invalid_table(uf_client):
    client, _ = uf_client
    resp = client.post("/api/query", json={
        "tenant_id": "t1",
        "table": "invalid",
        "sql": "SELECT * FROM data",
    })
    assert resp.status_code == 422


def test_query_missing_fields(uf_client):
    client, _ = uf_client
    resp = client.post("/api/query", json={"tenant_id": "t1"})
    assert resp.status_code == 422


def test_query_bad_sql(uf_client):
    client, _ = uf_client
    resp = client.post("/api/query", json={
        "tenant_id": "t1",
        "table": "entities",
        "sql": "THIS IS NOT SQL",
    })
    assert resp.status_code == 400


def test_query_blocks_filesystem_access(uf_client):
    """`/api/query` runs the engine with external access disabled, so a
    DuckDB file-reading table function fails here — not only on the
    `/api/query/readonly` variant, and regardless of which caller (launchpad,
    papermite, a proxy, or a direct client) sent the SQL."""
    client, _ = uf_client
    resp = client.post("/api/query", json={
        "tenant_id": "t1",
        "table": "entities",
        "sql": "SELECT * FROM read_csv('/etc/passwd')",
    })
    assert resp.status_code in (400, 500)
    assert "read_csv" in resp.json()["detail"] or "external access" in resp.json()["detail"].lower()
