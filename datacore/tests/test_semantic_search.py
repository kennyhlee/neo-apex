"""Tests for semantic search via QueryEngine."""

import tempfile
from unittest.mock import MagicMock

import pytest

from datacore import Store, QueryEngine


def _make_embedder(vectors_map=None):
    """Create a mock embedder that returns predictable vectors.

    vectors_map: dict mapping text substrings to vectors.
    Default: returns different vectors per call to simulate real embeddings.
    """
    embedder = MagicMock()
    call_count = [0]

    def mock_embed(fields):
        call_count[0] += 1
        # Return slightly different vectors for each entity
        vec = [0.0] * 1024
        vec[0] = float(call_count[0])
        return vec

    def mock_embed_query(query):
        # Return a vector close to entity 1 by default
        vec = [0.0] * 1024
        vec[0] = 1.0
        return vec

    embedder.embed.side_effect = mock_embed
    embedder.embed_query.side_effect = mock_embed_query
    return embedder


@pytest.fixture
def search_setup():
    with tempfile.TemporaryDirectory() as tmp:
        embedder = _make_embedder()
        store = Store(data_dir=tmp, embedder=embedder)
        engine = QueryEngine(store)

        store.put_entity("t1", "student", "S001",
            base_data={"first_name": "Alice", "last_name": "Smith"},
            custom_fields={"city": "Springfield"})
        store.put_entity("t1", "student", "S002",
            base_data={"first_name": "Bob", "last_name": "Jones"},
            custom_fields={"city": "Portland"})
        store.put_entity("t1", "teacher", "T001",
            base_data={"first_name": "Carol", "last_name": "White"},
            custom_fields={})

        yield engine, store, embedder


def test_semantic_search_returns_results(search_setup):
    engine, store, embedder = search_setup
    result = engine.semantic_search(
        tenant_id="t1",
        query="students in Springfield",
    )
    assert "results" in result
    assert "total" in result
    assert result["total"] > 0
    assert "_distance" in result["results"][0]


def test_semantic_search_respects_limit(search_setup):
    engine, store, embedder = search_setup
    result = engine.semantic_search(
        tenant_id="t1",
        query="students",
        limit=1,
    )
    assert len(result["results"]) == 1


def test_semantic_search_filters_by_entity_type(search_setup):
    engine, store, embedder = search_setup
    result = engine.semantic_search(
        tenant_id="t1",
        query="people",
        entity_type="student",
    )
    for r in result["results"]:
        assert r["entity_type"] == "student"


def test_semantic_search_returns_decoded_data(search_setup):
    engine, store, embedder = search_setup
    result = engine.semantic_search(
        tenant_id="t1",
        query="Alice",
        limit=10,
    )
    # base_data and custom_fields should be decoded dicts, not TOON strings
    for r in result["results"]:
        assert isinstance(r["base_data"], dict)
        assert isinstance(r["custom_fields"], dict)


def test_semantic_search_excludes_vector_from_results(search_setup):
    engine, store, embedder = search_setup
    result = engine.semantic_search(
        tenant_id="t1",
        query="Alice",
    )
    for r in result["results"]:
        assert "vector" not in r


def test_semantic_search_only_active_records(search_setup):
    engine, store, embedder = search_setup
    # Update Alice to create an archived version
    store.put_entity("t1", "student", "S001",
        base_data={"first_name": "Alice", "last_name": "Smith-Updated"},
        custom_fields={"city": "Springfield"})

    result = engine.semantic_search(
        tenant_id="t1",
        query="Alice",
        limit=10,
    )
    for r in result["results"]:
        assert r["_status"] == "active"


def test_semantic_search_empty_table(search_setup):
    engine, store, embedder = search_setup
    result = engine.semantic_search(
        tenant_id="t99",
        query="anything",
    )
    assert result["results"] == []
    assert result["total"] == 0


def test_semantic_search_calls_embed_query(search_setup):
    engine, store, embedder = search_setup
    engine.semantic_search(tenant_id="t1", query="find students")
    embedder.embed_query.assert_called_with("find students")


from fastapi.testclient import TestClient
from datacore.api import create_app


def test_search_endpoint_returns_results(search_setup):
    engine, store, embedder = search_setup
    app = create_app(store)
    client = TestClient(app)

    response = client.get("/api/search/t1?q=students+in+Springfield")
    assert response.status_code == 200
    data = response.json()
    assert "results" in data
    assert "total" in data
    assert data["total"] > 0


def test_search_endpoint_with_entity_type_filter(search_setup):
    engine, store, embedder = search_setup
    app = create_app(store)
    client = TestClient(app)

    response = client.get("/api/search/t1?q=people&entity_type=student")
    assert response.status_code == 200
    for r in response.json()["results"]:
        assert r["entity_type"] == "student"


def test_search_endpoint_with_limit(search_setup):
    engine, store, embedder = search_setup
    app = create_app(store)
    client = TestClient(app)

    response = client.get("/api/search/t1?q=students&limit=1")
    assert response.status_code == 200
    assert len(response.json()["results"]) <= 1


def test_search_endpoint_requires_query(search_setup):
    engine, store, embedder = search_setup
    app = create_app(store)
    client = TestClient(app)

    response = client.get("/api/search/t1")
    assert response.status_code == 422  # missing required query param
