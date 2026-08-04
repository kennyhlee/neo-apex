# enrollx/backend/tests/test_auth_guards.py
import httpx
import pytest
import respx
from fastapi.testclient import TestClient

from app.auth import require_authenticated_user
from app.main import app


def override_user(tenant="acme", role="admin"):
    def f():
        return {"user_id": "u1", "tenant_id": tenant, "role": role, "_token": "Bearer x"}
    return f


@pytest.fixture
def as_user():
    def _as(tenant="acme", role="admin"):
        app.dependency_overrides[require_authenticated_user] = override_user(tenant, role)
        return TestClient(app)
    yield _as
    app.dependency_overrides.clear()


def test_entities_requires_auth():
    resp = TestClient(app).post("/api/entities/acme/student", json={"base_data": {}})
    assert resp.status_code == 401


def test_entities_cross_tenant_403(as_user):
    resp = as_user(tenant="acme").post("/api/entities/globex/student", json={"base_data": {}})
    assert resp.status_code == 403


def test_entities_parent_role_403(as_user):
    resp = as_user(role="parent").post("/api/entities/acme/student", json={"base_data": {}})
    assert resp.status_code == 403


# ── /api/query: auth + role ───────────────────────────────────────────────


def test_query_requires_auth():
    resp = TestClient(app).post(
        "/api/query", json={"tenant_id": "acme", "sql": "SELECT * FROM data"}
    )
    assert resp.status_code == 401


def test_query_parent_role_403(as_user):
    resp = as_user(role="parent").post(
        "/api/query", json={"tenant_id": "acme", "sql": "SELECT * FROM data"}
    )
    assert resp.status_code == 403


def test_query_malformed_json_body_returns_400(as_user):
    """Invalid JSON must be rejected with 400, not an uncaught 500."""
    resp = as_user(tenant="acme").post(
        "/api/query",
        content=b"{not valid json",
        headers={"Content-Type": "application/json"},
    )
    assert resp.status_code == 400


def test_query_non_object_json_body_returns_400(as_user):
    """A JSON array or scalar body must be rejected with 400, not an AttributeError 500."""
    resp = as_user(tenant="acme").post("/api/query", json=[1, 2, 3])
    assert resp.status_code == 400


# ── /api/query: corrected tenant + SQL-shape guard ─────────────────────────
#
# DataCore scopes a query by the body's tenant_id field, and always registers
# the tenant's table under the fixed alias `data` (see datacore/src/datacore/
# query.py). So /api/query has no {tenant_id} path param to guard with
# require_staff_tenant; instead the route checks the body's tenant_id against
# the token (assert_query_tenant_match) and that the SQL is a single
# escape-free read statement (assert_sql_is_safe_read).


def test_query_cross_tenant_403(as_user):
    """A body tenant_id belonging to a *different* tenant is 403 — the
    cross-tenant branch, distinct from the missing-tenant_id branch below."""
    resp = as_user(tenant="acme").post(
        "/api/query",
        json={"tenant_id": "globex", "table": "entities", "sql": "SELECT * FROM data"},
    )
    assert resp.status_code == 403


def test_query_missing_body_tenant_id_403(as_user):
    """DataCore requires tenant_id, so its absence is not a legitimate request."""
    resp = as_user(tenant="acme").post(
        "/api/query", json={"table": "entities", "sql": "SELECT * FROM data"}
    )
    assert resp.status_code == 403


@respx.mock
def test_query_real_shape_sql_passes_guard(as_user):
    """A real-shape query against the `data` alias, with a matching body
    tenant_id, must not be blocked by either guard. DataCore is mocked so the
    request completes without depending on a live DataCore; we assert the
    guards didn't reject it (not that the overall response is 200)."""
    respx.post("http://localhost:5800/api/query").mock(
        return_value=httpx.Response(200, json={"data": [], "total": 0})
    )
    resp = as_user(tenant="acme").post(
        "/api/query",
        json={
            "tenant_id": "acme",
            "table": "entities",
            "sql": "SELECT * FROM data WHERE entity_type = 'student' AND _status = 'active'",
        },
    )
    assert resp.status_code != 403


@pytest.mark.parametrize("sql", [
    "SELECT * FROM read_csv('/etc/passwd')",
    "SELECT * FROM \"read_csv\"('/etc/passwd')",
    "SELECT * FROM read_parquet('s3://evil/x.parquet')",
    "COPY (SELECT * FROM data) TO '/tmp/exfil.csv'",
    "SELECT * FROM data; ATTACH '/tmp/evil.db' AS evil",
])
def test_query_function_table_escape_403(as_user, sql):
    resp = as_user(tenant="acme").post(
        "/api/query", json={"tenant_id": "acme", "sql": sql}
    )
    assert resp.status_code == 403


@respx.mock
@pytest.mark.parametrize("sql", [
    # A string literal containing a SQL keyword — the shape ⌘K/ILIKE filters build.
    "SELECT * FROM data WHERE first_name ILIKE '%from%' LIMIT 5",
    "SELECT * FROM data WHERE first_name ILIKE '%update%' LIMIT 5",
    # CTE and subquery — Plans 2–4 need both for capacity roll-ups.
    "WITH x AS (SELECT * FROM data) SELECT * FROM x",
    "SELECT * FROM (SELECT * FROM data) t",
    "SELECT * FROM data",
])
def test_query_legitimate_shapes_pass_guard(as_user, sql):
    respx.post("http://localhost:5800/api/query").mock(
        return_value=httpx.Response(200, json={"data": [], "total": 0})
    )
    resp = as_user(tenant="acme").post(
        "/api/query", json={"tenant_id": "acme", "table": "entities", "sql": sql}
    )
    assert resp.status_code != 403
