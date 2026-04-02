"""Tests for pagination (limit/offset) with total count."""


def test_pagination_first_page(seeded_engine):
    """First page returns limited rows but full total."""
    result = seeded_engine.query(
        tenant_id="t1", table_type="entities",
        sql="SELECT entity_id FROM data WHERE _status = 'active' AND entity_type != 'tenant' ORDER BY entity_id",
        limit=2, offset=0,
    )
    assert result["total"] == 3
    assert len(result["rows"]) == 2
    assert result["rows"][0]["entity_id"] == "S001"
    assert result["rows"][1]["entity_id"] == "S002"


def test_pagination_second_page(seeded_engine):
    """Second page returns remaining rows."""
    result = seeded_engine.query(
        tenant_id="t1", table_type="entities",
        sql="SELECT entity_id FROM data WHERE _status = 'active' AND entity_type != 'tenant' ORDER BY entity_id",
        limit=2, offset=2,
    )
    assert result["total"] == 3
    assert len(result["rows"]) == 1
    assert result["rows"][0]["entity_id"] == "S003"


def test_pagination_beyond_results(seeded_engine):
    """Offset beyond total returns empty rows but correct total."""
    result = seeded_engine.query(
        tenant_id="t1", table_type="entities",
        sql="SELECT entity_id FROM data WHERE _status = 'active' AND entity_type != 'tenant' ORDER BY entity_id",
        limit=10, offset=100,
    )
    assert result["total"] == 3
    assert result["rows"] == []


def test_pagination_limit_only(seeded_engine):
    """Limit without offset starts from beginning."""
    result = seeded_engine.query(
        tenant_id="t1", table_type="entities",
        sql="SELECT entity_id FROM data WHERE _status = 'active' AND entity_type != 'tenant' ORDER BY entity_id",
        limit=1,
    )
    assert result["total"] == 3
    assert len(result["rows"]) == 1
    assert result["rows"][0]["entity_id"] == "S001"


def test_no_pagination_returns_all(seeded_engine):
    """No limit/offset returns all rows."""
    result = seeded_engine.query(
        tenant_id="t1", table_type="entities",
        sql="SELECT entity_id FROM data WHERE _status = 'active' AND entity_type != 'tenant' ORDER BY entity_id",
    )
    assert result["total"] == 3
    assert len(result["rows"]) == 3


def test_pagination_with_filter(seeded_engine):
    """Pagination works correctly with WHERE filters."""
    result = seeded_engine.query(
        tenant_id="t1", table_type="entities",
        sql="SELECT entity_id FROM data WHERE city = 'Springfield' AND _status = 'active' ORDER BY entity_id",
        limit=1, offset=0,
    )
    assert result["total"] == 2  # 2 in Springfield total
    assert len(result["rows"]) == 1  # but only 1 returned
