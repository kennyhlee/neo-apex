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
import asyncio
import json
import time
from concurrent.futures import ThreadPoolExecutor

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


# ── DataCore-unreachable -> 502 (Plan 2 browser-gate defect regression) ────
#
# Ported from test_entities_api.py's equivalent pair (final-review fix wave):
# before the fix, this route called the *sync* `httpx.post()` directly
# inside an `async def` route with no threadpool — every call blocked
# Uvicorn's single asyncio event loop for the full DataCore round-trip AND
# opened a brand-new unpooled connection each time. Under concurrent browser
# load (CORS preflights + the actual request + other tabs' polling, all
# serialized onto that one blocked thread) this produced an intermittent,
# instant `httpx.RequestError` that a one-shot curl never triggered. See
# gate-debug-report.md for the full narrative.


@respx.mock
def test_query_returns_502_when_datacore_unreachable(client):
    respx.post(f"{DATACORE}/api/query").mock(
        side_effect=httpx.ConnectError("connection refused")
    )
    resp = client.post(
        "/api/query",
        json={"tenant_id": TENANT, "table": "entities", "sql": "SELECT * FROM data"},
    )
    assert resp.status_code == 502
    assert resp.json()["detail"] == "DataCore is unreachable"


@respx.mock
def test_concurrent_queries_are_not_serialized_by_the_proxy(client):
    """Regression test for the event-loop-blocking root cause: the proxy
    must not hold Uvicorn's single event loop hostage for the full
    DataCore round-trip. Simulate N concurrent requests each with a
    non-trivial DataCore latency; if the route ever regresses back to a
    blocking sync call made directly on the event loop (no
    `run_in_threadpool`, no `await`), these requests serialize and the
    total wall-clock time scales with N * per-request latency instead of
    running concurrently.
    """
    per_request_delay = 0.2
    concurrency = 6

    async def slow_handler(request: httpx.Request) -> httpx.Response:
        await asyncio.sleep(per_request_delay)
        return httpx.Response(200, json={"data": [], "total": 0})

    respx.post(f"{DATACORE}/api/query").mock(side_effect=slow_handler)

    def do_request() -> int:
        resp = client.post(
            "/api/query",
            json={"tenant_id": TENANT, "table": "entities", "sql": "SELECT * FROM data"},
        )
        return resp.status_code

    started = time.monotonic()
    with ThreadPoolExecutor(max_workers=concurrency) as pool:
        statuses = list(pool.map(lambda _: do_request(), range(concurrency)))
    elapsed = time.monotonic() - started

    assert statuses == [200] * concurrency
    # Fully serialized would take ~concurrency * per_request_delay (1.2s);
    # true concurrency stays close to a single request's delay. Generous
    # multiplier to keep this stable under CI/test-runner scheduling noise.
    assert elapsed < per_request_delay * (concurrency / 2), (
        f"proxy calls appear serialized: {elapsed:.2f}s for {concurrency} "
        f"concurrent requests at {per_request_delay}s each"
    )
