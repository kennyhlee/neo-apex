"""Tests for basic QueryEngine SQL queries and tenant scoping."""
import pytest
from datacore import QueryEngine
from datacore.query import TableNotFoundError


def test_query_basic_select(seeded_engine):
    """Spec: Query a table with SQL — results as list of dicts."""
    result = seeded_engine.query(
        tenant_id="t1", table_type="entities",
        sql="SELECT entity_id FROM data WHERE _status = 'active'",
    )
    assert isinstance(result, dict)
    assert "rows" in result
    assert "total" in result
    assert result["total"] == 3
    ids = {r["entity_id"] for r in result["rows"]}
    assert ids == {"S001", "S002", "S003"}


def test_query_tenant_scoping(seeded_store):
    """Spec: Query with tenant filter — only that tenant's data."""
    from datacore import QueryEngine

    seeded_store.put_entity(
        tenant_id="t2", entity_type="student", entity_id="T2-001",
        base_data={"first_name": "Zara"},
    )
    engine = QueryEngine(seeded_store)

    t1_result = engine.query(
        tenant_id="t1", table_type="entities",
        sql="SELECT entity_id FROM data WHERE _status = 'active'",
    )
    t2_result = engine.query(
        tenant_id="t2", table_type="entities",
        sql="SELECT entity_id FROM data WHERE _status = 'active'",
    )
    assert t1_result["total"] == 3
    assert t2_result["total"] == 1
    assert t2_result["rows"][0]["entity_id"] == "T2-001"


def test_query_nonexistent_table_raises(seeded_engine):
    """Spec: Query non-existent table — TableNotFoundError."""
    with pytest.raises(TableNotFoundError):
        seeded_engine.query(
            tenant_id="no-tenant", table_type="entities",
            sql="SELECT * FROM data",
        )


def test_query_models_table(seeded_engine):
    """Can query the models table too."""
    result = seeded_engine.query(
        tenant_id="t1", table_type="models",
        sql="SELECT entity_type FROM data WHERE _status = 'active'",
    )
    assert result["total"] == 2
    types = {r["entity_type"] for r in result["rows"]}
    assert types == {"student", "staff"}


def test_query_invalid_table_type(seeded_engine):
    """Invalid table_type raises ValueError."""
    with pytest.raises(ValueError, match="table_type must be"):
        seeded_engine.query(
            tenant_id="t1", table_type="bad",
            sql="SELECT * FROM data",
        )
