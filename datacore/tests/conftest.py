import tempfile
from unittest.mock import MagicMock

import pytest
from datacore import Store, QueryEngine


@pytest.fixture
def mock_embedder():
    embedder = MagicMock()
    embedder.embed.return_value = [0.0] * 1024
    embedder.embed_batch.return_value = []
    return embedder


@pytest.fixture
def tmp_dir():
    with tempfile.TemporaryDirectory() as d:
        yield d


@pytest.fixture
def store(tmp_dir, mock_embedder):
    return Store(
        data_dir=tmp_dir,
        embedder=mock_embedder,
        max_model_versions=5,
        default_max_entity_versions=3,
        entity_version_limits={"student": 3, "staff": 2},
    )


@pytest.fixture
def engine(store):
    return QueryEngine(store)


@pytest.fixture
def seeded_store(store):
    """Store with pre-loaded model definitions and entity records."""
    cid = "seed-change"
    store.put_model(
        tenant_id="t1",
        entity_type="student",
        model_definition={
            "base_fields": [
                {"name": "first_name", "type": "str", "required": True},
                {"name": "last_name", "type": "str", "required": True},
                {"name": "grade", "type": "str", "required": False},
            ],
            "custom_fields": [],
        },
        change_id=cid,
    )
    store.put_model(
        tenant_id="t1",
        entity_type="staff",
        model_definition={
            "base_fields": [
                {"name": "name", "type": "str", "required": True},
                {"name": "role", "type": "str", "required": True},
            ],
            "custom_fields": [],
        },
        change_id=cid,
    )
    store.put_entity(
        tenant_id="t1", entity_type="student", entity_id="S001",
        base_data={"first_name": "Alice", "last_name": "Smith", "grade": "5"},
        custom_fields={"city": "Springfield", "bus_day": "tuesday"},
    )
    store.put_entity(
        tenant_id="t1", entity_type="student", entity_id="S002",
        base_data={"first_name": "Bob", "last_name": "Jones", "grade": "3"},
        custom_fields={"city": "Shelbyville", "bus_day": "monday"},
    )
    store.put_entity(
        tenant_id="t1", entity_type="student", entity_id="S003",
        base_data={"first_name": "Charlie", "last_name": "Brown", "grade": "5"},
        custom_fields={"city": "Springfield", "bus_day": "tuesday"},
    )
    return store


@pytest.fixture
def seeded_engine(seeded_store):
    return QueryEngine(seeded_store)
