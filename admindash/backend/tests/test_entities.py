"""Tests for entity CRUD proxy routes."""
import asyncio
import time
from concurrent.futures import ThreadPoolExecutor

import httpx
import respx

DATACORE = "http://localhost:5800"


def _stub_auth(mock):
    mock.get("http://localhost:5800/auth/me").mock(
        return_value=httpx.Response(200, json={"id": "u1", "tenant_id": "t1"})
    )


@respx.mock
def test_create_entity_forwards_with_path_params(client):
    _stub_auth(respx)
    route = respx.post(
        "http://localhost:5800/api/entities/t1/student"
    ).mock(return_value=httpx.Response(200, json={"id": "stu_1"}))
    resp = client.post(
        "/api/entities/t1/student",
        json={"base_data": {"first_name": "Ada"}, "custom_fields": {}},
        headers={"Authorization": "Bearer good"},
    )
    assert resp.status_code == 200
    assert resp.json() == {"id": "stu_1"}
    assert route.called


@respx.mock
def test_update_entity_preserves_entity_id(client):
    _stub_auth(respx)
    route = respx.put(
        "http://localhost:5800/api/entities/t1/student/stu_1"
    ).mock(return_value=httpx.Response(200, json={"id": "stu_1", "updated": True}))
    resp = client.put(
        "/api/entities/t1/student/stu_1",
        json={"base_data": {"first_name": "Ada"}, "custom_fields": {}},
        headers={"Authorization": "Bearer good"},
    )
    assert resp.status_code == 200
    assert route.called


@respx.mock
def test_archive_endpoint_forwards(client):
    _stub_auth(respx)
    route = respx.post(
        "http://localhost:5800/api/entities/t1/student/archive"
    ).mock(return_value=httpx.Response(200, json={"archived": 2}))
    resp = client.post(
        "/api/entities/t1/student/archive",
        json={"entity_ids": ["stu_1", "stu_2"]},
        headers={"Authorization": "Bearer good"},
    )
    assert resp.status_code == 200
    assert resp.json() == {"archived": 2}
    assert route.called


@respx.mock
def test_next_id_is_get(client):
    _stub_auth(respx)
    route = respx.get(
        "http://localhost:5800/api/entities/t1/student/next-id"
    ).mock(return_value=httpx.Response(200, json={"next_id": "stu_42"}))
    resp = client.get(
        "/api/entities/t1/student/next-id",
        headers={"Authorization": "Bearer good"},
    )
    assert resp.status_code == 200
    assert resp.json() == {"next_id": "stu_42"}
    assert route.called


@respx.mock
def test_duplicate_check_forwards(client):
    _stub_auth(respx)
    route = respx.post(
        "http://localhost:5800/api/entities/t1/student/duplicate-check"
    ).mock(return_value=httpx.Response(200, json={"duplicates": []}))
    resp = client.post(
        "/api/entities/t1/student/duplicate-check",
        json={"first_name": "Ada", "last_name": "Lovelace"},
        headers={"Authorization": "Bearer good"},
    )
    assert resp.status_code == 200
    assert route.called


def test_unauthenticated_create_returns_401(client):
    resp = client.post("/api/entities/t1/student", json={})
    assert resp.status_code == 401


# ── DataCore-unreachable -> 502 (event-loop-blocking regression) ───────────
#
# Ported from apexflow/backend/tests/test_entities_api.py's equivalent pair
# (apexflow Plan 2 gate defect, admindash half): before the fix,
# `_proxy_to_datacore` called the *sync* `httpx.request()` directly inside an
# `async def` route with no threadpool — every call blocked Uvicorn's single
# asyncio event loop for the full DataCore round-trip AND opened a brand-new
# unpooled connection each time. Under concurrent browser load (CORS
# preflights + the actual request + other tabs' polling, all serialized onto
# that one blocked thread) this produced an intermittent, instant
# `httpx.RequestError` that a one-shot curl never triggered.


@respx.mock
def test_create_entity_returns_502_when_datacore_unreachable(client):
    _stub_auth(respx)
    respx.post(f"{DATACORE}/api/entities/t1/student").mock(
        side_effect=httpx.ConnectError("connection refused")
    )
    resp = client.post(
        "/api/entities/t1/student",
        headers={"Authorization": "Bearer good"},
        json={"base_data": {"first_name": "Ada"}, "custom_fields": {}},
    )
    assert resp.status_code == 502
    assert resp.json()["detail"] == "DataCore is unreachable"


@respx.mock
def test_concurrent_creates_are_not_serialized_by_the_proxy(client):
    """Regression test for the event-loop-blocking root cause: the proxy
    must not hold Uvicorn's single event loop hostage for the full DataCore
    round-trip. Simulate N concurrent requests each with a non-trivial
    DataCore latency; if `_proxy_to_datacore` ever regresses back to a
    blocking sync call made directly on the event loop (no
    `run_in_threadpool`, no `await`), these requests serialize and the total
    wall-clock time scales with N * per-request latency instead of running
    concurrently.
    """
    _stub_auth(respx)
    per_request_delay = 0.2
    concurrency = 6

    async def slow_handler(request: httpx.Request) -> httpx.Response:
        await asyncio.sleep(per_request_delay)
        return httpx.Response(200, json={"id": "stu_slow"})

    respx.post(f"{DATACORE}/api/entities/t1/student").mock(side_effect=slow_handler)

    def do_request() -> int:
        return client.post(
            "/api/entities/t1/student",
            headers={"Authorization": "Bearer good"},
            json={"base_data": {"first_name": "Ada"}, "custom_fields": {}},
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
