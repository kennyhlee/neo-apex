"""Tests for aggregate SQL queries (COUNT, SUM, GROUP BY)."""


def test_count_all_active(seeded_engine):
    """COUNT(*) across all active entities."""
    result = seeded_engine.query(
        tenant_id="t1", table_type="entities",
        sql="SELECT COUNT(*) AS total_students FROM data WHERE entity_type = 'student' AND _status = 'active'",
    )
    assert result["rows"][0]["total_students"] == 3


def test_count_with_custom_field_filter(seeded_engine):
    """COUNT with filter on custom field."""
    result = seeded_engine.query(
        tenant_id="t1", table_type="entities",
        sql="SELECT COUNT(*) AS count FROM data WHERE bus_day = 'tuesday' AND _status = 'active'",
    )
    assert result["rows"][0]["count"] == 2


def test_group_by_custom_field(seeded_engine):
    """GROUP BY on a custom field with COUNT."""
    result = seeded_engine.query(
        tenant_id="t1", table_type="entities",
        sql="SELECT bus_day, COUNT(*) AS count FROM data WHERE _status = 'active' AND entity_type != 'tenant' GROUP BY bus_day ORDER BY bus_day",
    )
    assert result["total"] == 2  # 2 groups
    groups = {r["bus_day"]: r["count"] for r in result["rows"]}
    assert groups["tuesday"] == 2
    assert groups["monday"] == 1


def test_group_by_base_field(seeded_engine):
    """GROUP BY on a base_data field."""
    result = seeded_engine.query(
        tenant_id="t1", table_type="entities",
        sql="SELECT grade, COUNT(*) AS count FROM data WHERE _status = 'active' GROUP BY grade ORDER BY grade",
    )
    grades = {r["grade"]: r["count"] for r in result["rows"]}
    assert grades["5"] == 2  # Alice and Charlie
    assert grades["3"] == 1  # Bob


def test_count_with_city_filter(seeded_engine):
    """Real-world: how many students in Springfield?"""
    result = seeded_engine.query(
        tenant_id="t1", table_type="entities",
        sql="SELECT COUNT(*) AS count FROM data WHERE city = 'Springfield' AND _status = 'active'",
    )
    assert result["rows"][0]["count"] == 2
