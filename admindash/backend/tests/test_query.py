"""Tests for /api/query proxy route."""
import asyncio
import json
import time
from concurrent.futures import ThreadPoolExecutor

import httpx
import respx

DATACORE = "http://localhost:5800"


def _stub_auth(mock):
    mock.get(f"{DATACORE}/auth/me").mock(
        return_value=httpx.Response(200, json={"id": "u1", "tenant_id": "t1"})
    )


@respx.mock
def test_authenticated_query_is_forwarded(client):
    respx.get("http://localhost:5800/auth/me").mock(
        return_value=httpx.Response(200, json={"id": "u1", "tenant_id": "t1"})
    )
    route = respx.post("http://localhost:5800/api/query").mock(
        return_value=httpx.Response(200, json={"data": [{"id": 1}], "total": 1})
    )
    body = {"tenant_id": "t1", "table": "entities", "sql": "SELECT 1"}
    resp = client.post(
        "/api/query", json=body, headers={"Authorization": "Bearer good"}
    )
    assert resp.status_code == 200
    assert resp.json() == {"data": [{"id": 1}], "total": 1}
    assert json.loads(route.calls[0].request.content) == body


def test_unauthenticated_query_returns_401(client):
    resp = client.post("/api/query", json={"sql": "SELECT 1"})
    assert resp.status_code == 401


@respx.mock
def test_query_surfaces_datacore_500_verbatim(client):
    respx.get("http://localhost:5800/auth/me").mock(
        return_value=httpx.Response(200, json={"id": "u1", "tenant_id": "t1"})
    )
    respx.post("http://localhost:5800/api/query").mock(
        return_value=httpx.Response(500, json={"error": "boom"})
    )
    resp = client.post(
        "/api/query",
        json={"tenant_id": "t1", "sql": "SELECT 1"},
        headers={"Authorization": "Bearer good"},
    )
    assert resp.status_code == 500
    assert resp.json() == {"error": "boom"}


@respx.mock
def test_malformed_json_body_returns_400(client):
    """Invalid JSON must be rejected with 400, not an uncaught 500."""
    respx.get("http://localhost:5800/auth/me").mock(
        return_value=httpx.Response(200, json={"id": "u1", "tenant_id": "t1"})
    )
    resp = client.post(
        "/api/query",
        content=b"{not valid json",
        headers={"Authorization": "Bearer good", "Content-Type": "application/json"},
    )
    assert resp.status_code == 400


@respx.mock
def test_non_object_json_body_returns_400(client):
    """A JSON array or scalar body must be rejected with 400, not an AttributeError 500."""
    respx.get("http://localhost:5800/auth/me").mock(
        return_value=httpx.Response(200, json={"id": "u1", "tenant_id": "t1"})
    )
    resp = client.post(
        "/api/query",
        json=["SELECT 1"],
        headers={"Authorization": "Bearer good"},
    )
    assert resp.status_code == 400


# ── DataCore-unreachable -> 502 (event-loop-blocking regression) ───────────
#
# Ported from apexflow/backend/tests/test_query_api.py's equivalent pair
# (apexflow Plan 2 gate defect, admindash half): before the fix, this route
# called the *sync* `httpx.post()` directly inside an `async def` route with
# no threadpool — every call blocked Uvicorn's single asyncio event loop for
# the full DataCore round-trip AND opened a brand-new unpooled connection
# each time. Under concurrent browser load (CORS preflights + the actual
# request + other tabs' polling, all serialized onto that one blocked
# thread) this produced an intermittent, instant `httpx.RequestError` that a
# one-shot curl never triggered.


@respx.mock
def test_query_returns_502_when_datacore_unreachable(client):
    _stub_auth(respx)
    respx.post(f"{DATACORE}/api/query").mock(
        side_effect=httpx.ConnectError("connection refused")
    )
    resp = client.post(
        "/api/query",
        json={"tenant_id": "t1", "table": "entities", "sql": "SELECT 1"},
        headers={"Authorization": "Bearer good"},
    )
    assert resp.status_code == 502
    assert resp.json()["detail"] == "DataCore is unreachable"


@respx.mock
def test_concurrent_queries_are_not_serialized_by_the_proxy(client):
    """Regression test for the event-loop-blocking root cause: the proxy
    must not hold Uvicorn's single event loop hostage for the full DataCore
    round-trip. Simulate N concurrent requests each with a non-trivial
    DataCore latency; if the route ever regresses back to a blocking sync
    call made directly on the event loop (no `run_in_threadpool`, no
    `await`), these requests serialize and the total wall-clock time scales
    with N * per-request latency instead of running concurrently.
    """
    _stub_auth(respx)
    per_request_delay = 0.2
    concurrency = 6

    async def slow_handler(request: httpx.Request) -> httpx.Response:
        await asyncio.sleep(per_request_delay)
        return httpx.Response(200, json={"data": [], "total": 0})

    respx.post(f"{DATACORE}/api/query").mock(side_effect=slow_handler)

    def do_request() -> int:
        return client.post(
            "/api/query",
            json={"tenant_id": "t1", "table": "entities", "sql": "SELECT 1"},
            headers={"Authorization": "Bearer good"},
        ).status_code

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
