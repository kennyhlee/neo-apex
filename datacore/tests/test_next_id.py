"""Tests for GET /api/entities/{tenant}/student/next-id (read-only preview)
and POST /api/entities/{tenant}/student (auto-assigns student_id)."""

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
    assert data["next_id"].startswith("ACC-ST")
    assert data["next_id"].endswith("0001")
    assert data["approximate"] is True


def test_next_id_is_read_only(id_client):
    """Calling next-id multiple times should return the same value."""
    client, _ = id_client
    resp1 = client.get("/api/entities/t1/student/next-id")
    resp2 = client.get("/api/entities/t1/student/next-id")
    assert resp1.json()["sequence"] == 1
    assert resp2.json()["sequence"] == 1
    assert resp1.json()["next_id"] == resp2.json()["next_id"]


def test_next_id_increments_after_create(id_client):
    """next-id should reflect the new sequence after a student is created."""
    client, _ = id_client
    # Preview: should be 1
    resp = client.get("/api/entities/t1/student/next-id")
    assert resp.json()["sequence"] == 1

    # Create a student (counter increments)
    client.post(
        "/api/entities/t1/student",
        json={"base_data": {"first_name": "Alice", "last_name": "Smith"}},
    )

    # Preview: should now be 2
    resp = client.get("/api/entities/t1/student/next-id")
    assert resp.json()["sequence"] == 2


def test_create_student_auto_assigns_id(id_client):
    """POST /entities/{tenant}/student should auto-assign student_id."""
    client, _ = id_client
    resp = client.post(
        "/api/entities/t1/student",
        json={"base_data": {"first_name": "Alice", "last_name": "Smith"}},
    )
    assert resp.status_code == 201
    data = resp.json()
    assert "student_id" in data["base_data"]
    assert data["base_data"]["student_id"].startswith("ACC-ST")
    assert data["base_data"]["student_id"].endswith("0001")


def test_create_student_sequential_ids(id_client):
    """Two students should get sequential IDs with no gaps."""
    client, _ = id_client
    r1 = client.post(
        "/api/entities/t1/student",
        json={"base_data": {"first_name": "Alice", "last_name": "Smith"}},
    )
    r2 = client.post(
        "/api/entities/t1/student",
        json={"base_data": {"first_name": "Bob", "last_name": "Jones"}},
    )
    assert r1.json()["base_data"]["student_id"].endswith("0001")
    assert r2.json()["base_data"]["student_id"].endswith("0002")


def test_create_student_preserves_provided_id(id_client):
    """If student_id is provided, don't override it."""
    client, _ = id_client
    resp = client.post(
        "/api/entities/t1/student",
        json={"base_data": {"first_name": "Alice", "last_name": "Smith", "student_id": "CUSTOM-001"}},
    )
    assert resp.status_code == 201
    assert resp.json()["base_data"]["student_id"] == "CUSTOM-001"


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
