"""Tenant-match enforcement on proxy routes."""
import httpx
import pytest
import respx
from fastapi.testclient import TestClient

from app.main import app
from app.auth import require_authenticated_user
from app.tenancy import assert_query_tenant_match, assert_sql_is_safe_read
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


# ── /api/query: SQL shape guard ───────────────────────────────────────────
#
# Defense in depth on the SQL's *shape*, not its table names: a single
# SELECT/WITH statement with no DuckDB filesystem/network function call. Same
# denylist shape datacore/src/datacore/api/readonly_query.py uses for
# untrusted SQL, so CTEs, subqueries and keyword-bearing string literals all
# pass while the escape class stays blocked.


def test_sql_guard_allows_data_alias():
    """The real shape every admindash query uses (see DashboardContext.tsx:37)."""
    assert_sql_is_safe_read(
        "SELECT * FROM data WHERE entity_type = 'student' AND _status = 'active'"
    )


def test_sql_guard_rejects_function_table_escape():
    with pytest.raises(HTTPException) as exc:
        assert_sql_is_safe_read("SELECT * FROM read_csv('/etc/passwd')")
    assert exc.value.status_code == 403


@pytest.mark.parametrize("sql", [
    "SELECT * FROM read_parquet('s3://evil/x.parquet')",
    "SELECT * FROM read_json('/etc/passwd')",
    "SELECT read_text('/etc/passwd')",
    "SELECT read_blob('/etc/passwd')",
    "SELECT * FROM write_csv('/tmp/exfil.csv')",
    "SELECT system('ls')",
    "ATTACH '/tmp/evil.db' AS evil",
    "COPY (SELECT * FROM data) TO '/tmp/exfil.csv'",
    "INSTALL httpfs",
])
def test_sql_guard_rejects_every_readonly_query_deny_pattern(sql):
    """Every escape `readonly_query.py::_DENY` blocks must also be blocked here."""
    with pytest.raises(HTTPException) as exc:
        assert_sql_is_safe_read(sql)
    assert exc.value.status_code == 403


def test_sql_guard_rejects_quoted_function_table_escape():
    """DuckDB resolves `"read_csv"(...)` as the function, so quoting must not hide it."""
    with pytest.raises(HTTPException) as exc:
        assert_sql_is_safe_read("SELECT * FROM \"read_csv\"('/etc/passwd')")
    assert exc.value.status_code == 403


def test_sql_guard_rejects_stacked_statement():
    with pytest.raises(HTTPException) as exc:
        assert_sql_is_safe_read("SELECT * FROM data; ATTACH '/tmp/evil.db' AS evil")
    assert exc.value.status_code == 403


def test_sql_guard_rejects_escape_hidden_behind_a_comment():
    with pytest.raises(HTTPException) as exc:
        assert_sql_is_safe_read(
            "SELECT * FROM data -- ok\nUNION SELECT * FROM read_csv('/etc/passwd')"
        )
    assert exc.value.status_code == 403


def test_sql_guard_rejects_unterminated_string_literal():
    """A scanner desynced from the parser is how a guard like this gets
    bypassed — refuse rather than guess."""
    with pytest.raises(HTTPException) as exc:
        assert_sql_is_safe_read("SELECT * FROM data WHERE a = 'oops")
    assert exc.value.status_code == 403


def test_sql_guard_allows_double_quoted_data_alias():
    assert_sql_is_safe_read('SELECT * FROM "data"')


def test_sql_guard_allows_bracketed_data_alias():
    assert_sql_is_safe_read("SELECT * FROM [data]")


# The four shapes the previous allowlist guard wrongly rejected.


@pytest.mark.parametrize("term", ["from", "into", "join", "update"])
def test_sql_guard_allows_string_literal_containing_a_sql_keyword(term):
    """The literal SQL CommandPalette.tsx:133 builds. Typing "from" into ⌘K
    must return results, not 403."""
    assert_sql_is_safe_read(
        "SELECT * FROM data WHERE entity_type = 'student' AND _status = 'active' "
        f"AND (first_name ILIKE '%{term}%' OR last_name ILIKE '%{term}%' "
        f"OR student_id ILIKE '%{term}%') LIMIT 5"
    )


def test_sql_guard_allows_cte():
    """Plans 2–4 need CTEs for capacity roll-ups."""
    assert_sql_is_safe_read("WITH x AS (SELECT * FROM data) SELECT * FROM x")


def test_sql_guard_allows_subquery():
    assert_sql_is_safe_read("SELECT * FROM (SELECT * FROM data) t")


def test_sql_guard_allows_plain_from_data():
    assert_sql_is_safe_read("SELECT * FROM data")


def test_sql_guard_allows_doubled_quote_escaped_literal():
    """escapeSql() in client.ts doubles quotes; the scan must not desync on it."""
    assert_sql_is_safe_read("SELECT * FROM data WHERE last_name ILIKE '%O''Brien%'")
