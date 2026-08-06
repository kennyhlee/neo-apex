# apexflow/backend/tests/test_auth_proxy.py
"""Route-level tests for the auth proxy (Task 4 follow-up): `app/api/auth_proxy.py`.

Ported from admindash/backend/tests/test_auth.py (interface map §1a/§2g) —
same respx-mocked-DataCore shapes. Unlike every other route in this suite,
these two need no `require_authenticated_user`/`require_staff_tenant`
override: `login` mints the token in the first place, and `me` relays
whatever bearer the caller sent without this service validating it itself
(DataCore does that). Reuses the shared `client`/`fake_dc` fixtures from
conftest.py — `fake_dc` patches `app.workflows.datacore`, which these routes
never call (they hit `settings.datacore_url` directly via raw httpx, same as
`api/entities.py`/`api/query.py`), so it's inert here but harmless to share.
"""
import json

import httpx
import respx

DATACORE = "http://localhost:5800"


@respx.mock
def test_login_forwards_body_to_datacore(client):
    route = respx.post(f"{DATACORE}/auth/login").mock(
        return_value=httpx.Response(200, json={"token": "abc", "user": {"id": "u1"}})
    )
    resp = client.post("/auth/login", json={"email": "a@b.com", "password": "x"})
    assert resp.status_code == 200
    assert resp.json() == {"token": "abc", "user": {"id": "u1"}}
    forwarded = route.calls[0].request
    assert json.loads(forwarded.content) == {"email": "a@b.com", "password": "x"}


@respx.mock
def test_login_passes_through_datacore_error(client):
    respx.post(f"{DATACORE}/auth/login").mock(
        return_value=httpx.Response(401, json={"detail": "bad credentials"})
    )
    resp = client.post("/auth/login", json={"email": "a@b.com", "password": "x"})
    assert resp.status_code == 401
    assert resp.json() == {"detail": "bad credentials"}


@respx.mock
def test_login_502s_when_datacore_unreachable(client):
    respx.post(f"{DATACORE}/auth/login").mock(side_effect=httpx.ConnectError("refused"))
    resp = client.post("/auth/login", json={"email": "a@b.com", "password": "x"})
    assert resp.status_code == 502


@respx.mock
def test_me_with_valid_token_returns_user(client):
    route = respx.get(f"{DATACORE}/auth/me").mock(
        return_value=httpx.Response(200, json={"id": "u1", "tenant_id": "t1"})
    )
    resp = client.get("/auth/me", headers={"Authorization": "Bearer good"})
    assert resp.status_code == 200
    assert resp.json() == {"id": "u1", "tenant_id": "t1"}
    forwarded = route.calls[0].request
    assert forwarded.headers["authorization"] == "Bearer good"


def test_me_without_header_returns_401(client):
    resp = client.get("/auth/me")
    assert resp.status_code == 401


@respx.mock
def test_me_when_datacore_rejects_returns_401(client):
    respx.get(f"{DATACORE}/auth/me").mock(
        return_value=httpx.Response(401, json={"detail": "expired"})
    )
    resp = client.get("/auth/me", headers={"Authorization": "Bearer bad"})
    assert resp.status_code == 401


@respx.mock
def test_me_502s_when_datacore_unreachable(client):
    respx.get(f"{DATACORE}/auth/me").mock(side_effect=httpx.ConnectError("refused"))
    resp = client.get("/auth/me", headers={"Authorization": "Bearer good"})
    assert resp.status_code == 502
