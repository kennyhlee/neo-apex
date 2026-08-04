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


def test_query_cross_tenant_sql_403(as_user):
    resp = as_user(tenant="acme").post("/api/query", json={"sql": "SELECT * FROM globex_entities"})
    assert resp.status_code == 403


# ── /api/query: corrected tenant + SQL-shape guard ─────────────────────────
#
# DataCore scopes a query by the body's tenant_id field, and always registers
# the tenant's table under the fixed alias `data` (see datacore/src/datacore/
# query.py). So /api/query has no {tenant_id} path param to guard with
# require_staff_tenant; instead the route checks the body's tenant_id against
# the token (assert_query_tenant_match) and that the SQL only ever references
# the `data` alias (assert_sql_uses_data_alias).


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


def test_query_function_table_escape_403(as_user):
    resp = as_user(tenant="acme").post(
        "/api/query",
        json={"tenant_id": "acme", "sql": "SELECT * FROM read_csv('/etc/passwd')"},
    )
    assert resp.status_code == 403


def test_query_mismatched_body_tenant_id_403(as_user):
    resp = as_user(tenant="acme").post(
        "/api/query",
        json={"tenant_id": "globex", "sql": "SELECT * FROM data"},
    )
    assert resp.status_code == 403
