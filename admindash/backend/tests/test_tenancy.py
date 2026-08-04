"""Tenant-match enforcement on proxy routes."""
import httpx
import pytest
import respx
from fastapi.testclient import TestClient

from app.main import app
from app.auth import require_authenticated_user
from app.tenancy import assert_query_tenant_match, assert_sql_uses_data_alias
from fastapi import HTTPException


def fake_user_acme():
    return {"user_id": "u1", "tenant_id": "acme", "role": "admin", "_token": "Bearer x"}


@pytest.fixture
def client():
    app.dependency_overrides[require_authenticated_user] = fake_user_acme
    yield TestClient(app)
    app.dependency_overrides.clear()


def test_cross_tenant_entity_write_is_403(client):
    resp = client.post("/api/entities/othertenant/student", json={"base_data": {}})
    assert resp.status_code == 403


def test_cross_tenant_leads_read_is_403(client):
    resp = client.get("/api/leads/othertenant")
    assert resp.status_code == 403


# ── /api/query: body tenant_id is the real tenant-match check ─────────────
#
# This route has no {tenant_id} path param — DataCore scopes a query by the
# body's tenant_id field, not by table naming. Every table admindash queries
# is registered under the fixed alias `data` (see datacore/src/datacore/
# query.py), so a table-prefix scheme cannot express tenant scope here.


def test_query_with_mismatched_body_tenant_id_is_403(client):
    resp = client.post(
        "/api/query",
        json={"tenant_id": "othertenant", "table": "entities", "sql": "SELECT * FROM data"},
    )
    assert resp.status_code == 403


@respx.mock
def test_query_with_matching_body_tenant_id_passes_guard(client):
    """A body tenant_id matching the caller's own tenant must not be blocked
    by the tenant-match guard. DataCore is mocked so the request completes
    without depending on a live DataCore; we assert the guard didn't reject
    it (not that the overall response is 200)."""
    respx.post("http://localhost:5800/api/query").mock(
        return_value=httpx.Response(200, json={"data": [], "total": 0})
    )
    resp = client.post(
        "/api/query",
        json={"tenant_id": "acme", "table": "entities", "sql": "SELECT * FROM data"},
    )
    assert resp.status_code != 403


def test_query_tenant_match_helper_rejects_mismatch():
    with pytest.raises(HTTPException) as exc:
        assert_query_tenant_match("othertenant", {"tenant_id": "acme"})
    assert exc.value.status_code == 403


def test_query_tenant_match_helper_rejects_missing_tenant_id():
    with pytest.raises(HTTPException) as exc:
        assert_query_tenant_match(None, {"tenant_id": "acme"})
    assert exc.value.status_code == 403


def test_query_tenant_match_helper_allows_match():
    assert_query_tenant_match("acme", {"tenant_id": "acme"})


# ── /api/query: SQL must reference only the `data` alias ──────────────────
#
# Defense in depth. DataCore always registers the tenant's table as `data`;
# it only disables external access (blocking DuckDB table functions like
# read_csv/read_parquet) when called with external=True, which this route
# does not use — so admindash must reject anything but `data` itself.


def test_sql_guard_allows_data_alias():
    """The real shape every admindash query uses (see DashboardContext.tsx:37)."""
    assert_sql_uses_data_alias(
        "SELECT * FROM data WHERE entity_type = 'student' AND _status = 'active'"
    )


def test_sql_guard_rejects_function_table_escape():
    with pytest.raises(HTTPException) as exc:
        assert_sql_uses_data_alias("SELECT * FROM read_csv('/etc/passwd')")
    assert exc.value.status_code == 403


def test_sql_guard_rejects_comma_joined_other_table():
    """Implicit joins (comma-separated FROM list) must check every table, not just the first."""
    with pytest.raises(HTTPException) as exc:
        assert_sql_uses_data_alias("SELECT * FROM data, othertable")
    assert exc.value.status_code == 403


def test_sql_guard_allows_double_quoted_data_alias():
    assert_sql_uses_data_alias('SELECT * FROM "data"')


def test_sql_guard_allows_bracketed_data_alias():
    assert_sql_uses_data_alias("SELECT * FROM [data]")
