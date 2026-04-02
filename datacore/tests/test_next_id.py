"""Tests for GET /api/entities/{tenant}/student/next-id endpoint."""

import tempfile
from unittest.mock import MagicMock

import pytest
from fastapi.testclient import TestClient

from datacore import Store
from datacore.api import create_app


@pytest.fixture
def id_client():
    with tempfile.TemporaryDirectory() as tmp:
        mock_embedder = MagicMock()
        mock_embedder.embed.return_value = [0.0] * 1024
        store = Store(data_dir=tmp, embedder=mock_embedder)
        app = create_app(store)
        client = TestClient(app)
        # Set up tenant via API
        client.put(
            "/api/tenants/t1",
            json={
                "base_data": {
                    "tenant_id": "t1",
                    "name": "Acme Child Center",
                    "primary_address": "123 Main St",
                },
            },
        )
        yield client, store


def test_next_id_first_student(id_client):
    client, _ = id_client
    resp = client.get("/api/entities/t1/student/next-id")
    assert resp.status_code == 200
    data = resp.json()
    assert data["tenant_abbrev"] == "ACC"
    assert data["entity_abbrev"] == "ST"
    assert data["sequence"] == 1
    # ID format: ACC-ST{YY}0001
    assert data["next_id"].startswith("ACC-ST")
    assert data["next_id"].endswith("0001")


def test_next_id_increments(id_client):
    client, _ = id_client
    client.get("/api/entities/t1/student/next-id")
    resp = client.get("/api/entities/t1/student/next-id")
    data = resp.json()
    assert data["sequence"] == 2
    assert data["next_id"].endswith("0002")


def test_next_id_sequence_three(id_client):
    client, _ = id_client
    client.get("/api/entities/t1/student/next-id")
    client.get("/api/entities/t1/student/next-id")
    resp = client.get("/api/entities/t1/student/next-id")
    data = resp.json()
    assert data["sequence"] == 3
    assert data["next_id"].endswith("0003")


def test_next_id_no_tenant_returns_404(id_client):
    client, _ = id_client
    resp = client.get("/api/entities/nonexistent/student/next-id")
    assert resp.status_code == 404


def test_next_id_uses_current_year(id_client):
    client, _ = id_client
    resp = client.get("/api/entities/t1/student/next-id")
    data = resp.json()
    from datetime import datetime, timezone
    yy = str(datetime.now(timezone.utc).year)[-2:]
    assert f"-ST{yy}" in data["next_id"]


def test_next_id_year_rollover(id_client):
    """Different years get independent counters."""
    client, store = id_client
    # Manually set a counter for 2025
    store.increment_sequence("t1", "student", "2025")
    store.increment_sequence("t1", "student", "2025")

    # Current year should start at 1
    resp = client.get("/api/entities/t1/student/next-id")
    data = resp.json()
    assert data["sequence"] == 1
