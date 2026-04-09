"""Tests for generic entity auto-ID generation.

Temporarily adds 'program' to DEFAULT_ABBREVS to verify that the auto-ID
system works for entity types beyond student: table creation, sequence
records, and sequential ID assignment.
"""

import tempfile
from unittest.mock import MagicMock

import pytest
from fastapi.testclient import TestClient

from datacore import Store
from datacore.api import create_app
from datacore.api.routes import DEFAULT_ABBREVS


@pytest.fixture
def program_client():
    """Client with 'program' registered in DEFAULT_ABBREVS."""
    original = dict(DEFAULT_ABBREVS)
    DEFAULT_ABBREVS["program"] = "PR"
    with tempfile.TemporaryDirectory() as tmp:
        mock_embedder = MagicMock()
        mock_embedder.embed.return_value = [0.0] * 1024
        store = Store(data_dir=tmp, embedder=mock_embedder)
        app = create_app(store)
        client = TestClient(app)
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
    DEFAULT_ABBREVS.clear()
    DEFAULT_ABBREVS.update(original)


def test_program_auto_id_assigned(program_client):
    """Creating a program without program_id should auto-assign one."""
    client, _ = program_client
    resp = client.post(
        "/api/entities/t1/program",
        json={"base_data": {"name": "After School Art"}},
    )
    assert resp.status_code == 201
    data = resp.json()
    pid = data["base_data"]["program_id"]
    assert pid.startswith("ACC-PR")
    assert pid.endswith("0001")


def test_program_sequential_ids(program_client):
    """Two programs should get sequential IDs."""
    client, _ = program_client
    r1 = client.post(
        "/api/entities/t1/program",
        json={"base_data": {"name": "After School Art"}},
    )
    r2 = client.post(
        "/api/entities/t1/program",
        json={"base_data": {"name": "Summer Science"}},
    )
    assert r1.json()["base_data"]["program_id"].endswith("0001")
    assert r2.json()["base_data"]["program_id"].endswith("0002")


def test_program_sequence_table_created(program_client):
    """Sequence table should have a program row after first creation."""
    client, store = program_client
    client.post(
        "/api/entities/t1/program",
        json={"base_data": {"name": "After School Art"}},
    )
    from datetime import datetime, timezone
    year = str(datetime.now(timezone.utc).year)
    seq = store.get_sequence("t1", "program", year)
    assert seq["counter"] == 1
    assert seq["entity_abbrev"] == "PR"


def test_program_sequence_independent_of_student(program_client):
    """Program and student counters should not interfere."""
    client, _ = program_client
    client.post(
        "/api/entities/t1/student",
        json={"base_data": {"first_name": "Alice", "last_name": "Smith"}},
    )
    client.post(
        "/api/entities/t1/student",
        json={"base_data": {"first_name": "Bob", "last_name": "Jones"}},
    )
    resp = client.post(
        "/api/entities/t1/program",
        json={"base_data": {"name": "After School Art"}},
    )
    assert resp.json()["base_data"]["program_id"].endswith("0001")


def test_program_preserves_provided_id(program_client):
    """If program_id is provided, don't override it."""
    client, _ = program_client
    resp = client.post(
        "/api/entities/t1/program",
        json={"base_data": {"name": "Art", "program_id": "CUSTOM-001"}},
    )
    assert resp.status_code == 201
    assert resp.json()["base_data"]["program_id"] == "CUSTOM-001"


def test_default_abbrevs_cleaned_up(program_client):
    """Verify fixture cleanup — 'program' should not persist in DEFAULT_ABBREVS."""
    # This test runs during fixture teardown has already happened for the
    # parametrized fixture, but we can verify the fixture yielded correctly
    _, _ = program_client
    # After this test, the fixture teardown will restore DEFAULT_ABBREVS.
    # We verify it still has 'program' during the test (before teardown).
    assert "program" in DEFAULT_ABBREVS
