"""Tests for /auth/login and /auth/me proxy routes."""
import json
import httpx
import respx


@respx.mock
def test_login_forwards_body_to_datacore(client):
    route = respx.post("http://localhost:5800/auth/login").mock(
        return_value=httpx.Response(
            200, json={"token": "abc", "user": {"id": "u1"}}
        )
    )
    resp = client.post("/auth/login", json={"email": "a@b.com", "password": "x"})
    assert resp.status_code == 200
    assert resp.json() == {"token": "abc", "user": {"id": "u1"}}
    forwarded = route.calls[0].request
    assert json.loads(forwarded.content) == {"email": "a@b.com", "password": "x"}


@respx.mock
def test_login_passes_through_datacore_error(client):
    respx.post("http://localhost:5800/auth/login").mock(
        return_value=httpx.Response(401, json={"detail": "bad credentials"})
    )
    resp = client.post("/auth/login", json={"email": "a@b.com", "password": "x"})
    assert resp.status_code == 401
    assert resp.json() == {"detail": "bad credentials"}


@respx.mock
def test_me_with_valid_token_returns_user(client):
    respx.get("http://localhost:5800/auth/me").mock(
        return_value=httpx.Response(200, json={"id": "u1", "tenant_id": "t1"})
    )
    resp = client.get("/auth/me", headers={"Authorization": "Bearer good"})
    assert resp.status_code == 200
    assert resp.json() == {"id": "u1", "tenant_id": "t1"}


def test_me_without_header_returns_401(client):
    resp = client.get("/auth/me")
    assert resp.status_code == 401


@respx.mock
def test_me_when_datacore_rejects_returns_401(client):
    respx.get("http://localhost:5800/auth/me").mock(
        return_value=httpx.Response(401, json={"detail": "expired"})
    )
    resp = client.get("/auth/me", headers={"Authorization": "Bearer bad"})
    assert resp.status_code == 401
