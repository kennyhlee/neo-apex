import pytest
from fastapi import HTTPException

from datacore.api import readonly_query as rq


def test_validate_accepts_select_and_with():
    assert rq.validate_readonly_sql("SELECT * FROM data") == "SELECT * FROM data"
    assert rq.validate_readonly_sql(
        "  WITH x AS (SELECT 1 AS n) SELECT * FROM x ;").startswith("WITH")


@pytest.mark.parametrize("bad", [
    "",
    "INSERT INTO data VALUES (1)",
    "UPDATE data SET x = 1",
    "DELETE FROM data",
    "DROP TABLE data",
    "SELECT 1; DROP TABLE data",
    "SELECT * FROM read_csv('/etc/hosts')",
    "ATTACH 'x.db' AS y",
    "COPY data TO '/tmp/x.csv'",
    "PRAGMA database_list",
])
def test_validate_rejects_non_readonly(bad):
    with pytest.raises(ValueError):
        rq.validate_readonly_sql(bad)


def test_validate_allows_column_named_like_function():
    # 'read_receipts' is a column, not the read_csv/read_* function call.
    assert "read_receipts" in rq.validate_readonly_sql(
        "SELECT read_receipts FROM data")


def test_endpoint_returns_rows_without_vector(seeded_store):
    rq._store = seeded_store
    out = rq.readonly_query(rq.ReadOnlyQueryRequest(
        tenant_id="t1", table="entities",
        sql="SELECT * FROM data WHERE entity_type = 'student'"))
    assert out["total"] == 3
    assert len(out["data"]) == 3
    assert all("vector" not in row for row in out["data"])


def test_endpoint_rejects_write(seeded_store):
    rq._store = seeded_store
    with pytest.raises(HTTPException) as ei:
        rq.readonly_query(rq.ReadOnlyQueryRequest(
            tenant_id="t1", table="entities", sql="DELETE FROM data"))
    assert ei.value.status_code == 400


def test_endpoint_maps_execution_error_to_400(seeded_store):
    """A DuckDB execution error (e.g. type conversion) must be 400, not 500, so the
    caller (LLM) can self-correct instead of seeing a system failure."""
    rq._store = seeded_store
    with pytest.raises(HTTPException) as ei:
        rq.readonly_query(rq.ReadOnlyQueryRequest(
            tenant_id="t1", table="entities",
            sql="SELECT CAST('x' AS INTEGER) AS n"))
    assert ei.value.status_code == 400
    assert "SQL error" in str(ei.value.detail)
