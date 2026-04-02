"""Tests for querying TOON custom fields as flattened columns."""

import pytest
from datacore import QueryEngine


@pytest.fixture(autouse=True)
def setup_tenant(store):
    """Ensure tenant exists before each test."""
    store.put_entity(
        tenant_id="t1",
        entity_type="tenant",
        entity_id="t1",
        base_data={"tenant_id": "t1", "name": "Test School", "_abbrev": "TES"},
    )


def test_query_filter_on_custom_field(seeded_engine):
    """Spec: Custom fields queryable as regular columns."""
    result = seeded_engine.query(
        tenant_id="t1", table_type="entities",
        sql="SELECT entity_id, city FROM data WHERE city = 'Springfield' AND _status = 'active'",
    )
    assert result["total"] == 2
    ids = {r["entity_id"] for r in result["rows"]}
    assert ids == {"S001", "S003"}


def test_query_filter_on_different_custom_field(seeded_engine):
    """Can filter on any custom field."""
    result = seeded_engine.query(
        tenant_id="t1", table_type="entities",
        sql="SELECT entity_id, bus_day FROM data WHERE bus_day = 'monday' AND _status = 'active'",
    )
    assert result["total"] == 1
    assert result["rows"][0]["entity_id"] == "S002"


def test_query_base_and_custom_fields_together(seeded_engine):
    """Can select and filter on both base_data and custom fields."""
    result = seeded_engine.query(
        tenant_id="t1", table_type="entities",
        sql="SELECT first_name, city FROM data WHERE grade = '5' AND city = 'Springfield' AND _status = 'active'",
    )
    assert result["total"] == 2
    names = {r["first_name"] for r in result["rows"]}
    assert names == {"Alice", "Charlie"}


def test_query_entity_detail_by_id(seeded_engine):
    """Spec: Query entity detail by ID — full record returned."""
    result = seeded_engine.query(
        tenant_id="t1", table_type="entities",
        sql="SELECT entity_id, first_name, last_name, grade, city, bus_day FROM data WHERE entity_id = 'S001' AND _status = 'active'",
    )
    assert result["total"] == 1
    row = result["rows"][0]
    assert row["first_name"] == "Alice"
    assert row["last_name"] == "Smith"
    assert row["city"] == "Springfield"
    assert row["bus_day"] == "tuesday"


def test_query_entity_detail_not_found(seeded_engine):
    """Spec: Empty result for nonexistent entity_id."""
    result = seeded_engine.query(
        tenant_id="t1", table_type="entities",
        sql="SELECT * FROM data WHERE entity_id = 'NOPE' AND _status = 'active'",
    )
    assert result["total"] == 0
    assert result["rows"] == []


def test_query_nested_custom_field_values(store):
    """Regression: nested custom field values (lists/dicts) don't crash PyArrow."""
    store.put_entity(
        tenant_id="t1",
        entity_type="student",
        entity_id="S100",
        base_data={"first_name": "Dana", "last_name": "Lee"},
        custom_fields={"tags": ["math", "science"], "meta": {"level": 3}},
    )
    engine = QueryEngine(store)
    result = engine.query(
        tenant_id="t1", table_type="entities",
        sql="SELECT entity_id, tags, meta FROM data WHERE entity_id = 'S100' AND _status = 'active'",
    )
    assert result["total"] == 1
    assert result["rows"][0]["entity_id"] == "S100"
    # Nested values are JSON-serialized strings
    assert "math" in result["rows"][0]["tags"]
    assert "level" in result["rows"][0]["meta"]
