# apexflow/backend/tests/test_query_api.py
"""Route-level tests for the generic SQL query proxy (Task 1 of Plan 2):
`app/api/query.py`.

Ported from admindash/backend/tests/test_query.py + the route-level slice of
admindash/backend/tests/test_tenancy.py's `/api/query` section (interface
map §6b) — same forwarding shape, same tenant-match-via-body-field
rationale (`/api/query` has no {tenant_id} path param; DataCore always
registers a tenant's table under the fixed alias `data`, so "tenant-table
scoping" here means the body's tenant_id, not a table-name prefix).

The SQL-shape guard's full escape/legitimate corpus and byte-identity check
are NOT duplicated here — they live in datacore/tests/test_readonly_query.py
and admindash/backend/tests/test_tenancy.py, whose `_GUARD_FILES` this task
extends with apexflow/backend/app/tenancy.py (interface map §5d). This file
only proves the guard is actually wired into the route (non-SELECT SQL
rejected end-to-end), not the guard's own internals.

Auth pattern follows this suite's convention (test_documents_api.py):
override `require_authenticated_user` at the app level.
"""
import json

import httpx
import pytest
import respx
from fastapi.testclient import TestClient

from app.auth import require_authenticated_user
from app.main import app

TENANT = "acme"
DATACORE = "http://localhost:5800"


@pytest.fixture
def client(fake_dc):
    app.dependency_overrides[require_authenticated_user] = lambda: {
        "user_id": "staff-1", "tenant_id": TENANT, "role": "admin", "_token": "Bearer test-token",
    }
    yield TestClient(app)
    app.dependency_overrides.clear()


@respx.mock
def test_authenticated_query_is_forwarded(client):
    route = respx.post(f"{DATACORE}/api/query").mock(
        return_value=httpx.Response(200, json={"data": [{"id": 1}], "total": 1})
    )
    body = {"tenant_id": TENANT, "table": "entities", "sql": "SELECT * FROM data"}
    resp = client.post("/api/query", json=body)
    assert resp.status_code == 200
    assert resp.json() == {"data": [{"id": 1}], "total": 1}
    assert json.loads(route.calls[0].request.content) == body


def test_unauthenticated_query_returns_401(fake_dc):
    client = TestClient(app)  # no require_authenticated_user override
    resp = client.post("/api/query", json={"tenant_id": TENANT, "sql": "SELECT 1"})
    assert resp.status_code == 401


@respx.mock
def test_query_surfaces_datacore_500_verbatim(client):
    respx.post(f"{DATACORE}/api/query").mock(
        return_value=httpx.Response(500, json={"error": "boom"})
    )
    resp = client.post(
        "/api/query",
        json={"tenant_id": TENANT, "table": "entities", "sql": "SELECT * FROM data"},
    )
    assert resp.status_code == 500
    assert resp.json() == {"error": "boom"}


def test_malformed_json_body_returns_400(client):
    """Invalid JSON must be rejected with 400, not an uncaught 500."""
    resp = client.post(
        "/api/query",
        content=b"{not valid json",
        headers={"Content-Type": "application/json"},
    )
    assert resp.status_code == 400


def test_non_object_json_body_returns_400(client):
    """A JSON array or scalar body must be rejected with 400, not an
    AttributeError 500."""
    resp = client.post("/api/query", json=["SELECT 1"])
    assert resp.status_code == 400


# ── tenant-table scoping: the body's tenant_id, not a path param ──────────


def test_query_with_mismatched_body_tenant_id_is_403(client):
    resp = client.post(
        "/api/query",
        json={"tenant_id": "othertenant", "table": "entities", "sql": "SELECT * FROM data"},
    )
    assert resp.status_code == 403


def test_query_with_missing_body_tenant_id_is_403(client):
    resp = client.post(
        "/api/query",
        json={"table": "entities", "sql": "SELECT * FROM data"},
    )
    assert resp.status_code == 403


@respx.mock
def test_query_with_matching_body_tenant_id_passes_guard(client):
    """A body tenant_id matching the caller's own tenant must not be blocked
    by the tenant-match guard. DataCore is mocked so the request completes
    without depending on a live DataCore; we assert the guard didn't reject
    it (not that the overall response is 200)."""
    respx.post(f"{DATACORE}/api/query").mock(
        return_value=httpx.Response(200, json={"data": [], "total": 0})
    )
    resp = client.post(
        "/api/query",
        json={"tenant_id": TENANT, "table": "entities", "sql": "SELECT * FROM data"},
    )
    assert resp.status_code != 403


# ── non-SELECT SQL rejected end-to-end (task-1-brief.md Step 1) ───────────


@pytest.mark.parametrize(
    "sql",
    [
        "DELETE FROM data",
        "UPDATE data SET x = 1",
        "DROP TABLE data",
        "INSERT INTO data VALUES (1)",
        "SELECT * FROM data; ATTACH '/tmp/evil.db' AS evil",
        "SELECT * FROM read_csv('/etc/passwd')",
    ],
)
def test_non_select_or_unsafe_sql_is_rejected(client, sql):
    resp = client.post(
        "/api/query",
        json={"tenant_id": TENANT, "table": "entities", "sql": sql},
    )
    assert resp.status_code == 403


@respx.mock
def test_select_sql_passes_the_route_guard(client):
    respx.post(f"{DATACORE}/api/query").mock(
        return_value=httpx.Response(200, json={"data": [], "total": 0})
    )
    resp = client.post(
        "/api/query",
        json={"tenant_id": TENANT, "table": "entities", "sql": "SELECT * FROM data"},
    )
    assert resp.status_code == 200
