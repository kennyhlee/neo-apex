"""Tests for /api/query proxy route."""
import json
import httpx
import respx


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
        json={"sql": "SELECT 1"},
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
