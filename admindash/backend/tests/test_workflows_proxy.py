"""Tests for /api/workflows/* thin proxy routes to apexflow-backend."""
import json

import httpx
import respx

BASE = "http://localhost:5910"


def _stub_auth(mock):
    mock.get("http://localhost:5800/auth/me").mock(
        return_value=httpx.Response(
            200, json={"user_id": "u1", "tenant_id": "t1", "role": "admin"}
        )
    )


# ── definitions ────────────────────────────────────────────────────────────


@respx.mock
def test_list_definitions_proxies_with_caller_token(client):
    _stub_auth(respx)
    route = respx.get(f"{BASE}/api/workflows/t1/definitions").mock(
        return_value=httpx.Response(200, json={"definitions": []})
    )
    resp = client.get(
        "/api/workflows/t1/definitions", headers={"Authorization": "Bearer good"}
    )
    assert resp.status_code == 200
    assert resp.json() == {"definitions": []}
    assert route.called
    assert route.calls.last.request.headers["authorization"] == "Bearer good"


@respx.mock
def test_definition_bundle_proxies(client):
    _stub_auth(respx)
    route = respx.get(f"{BASE}/api/workflows/t1/definitions/d1/bundle").mock(
        return_value=httpx.Response(200, json={"definition": {"entity_id": "d1"}})
    )
    resp = client.get(
        "/api/workflows/t1/definitions/d1/bundle",
        headers={"Authorization": "Bearer good"},
    )
    assert resp.status_code == 200
    assert resp.json() == {"definition": {"entity_id": "d1"}}
    assert route.called
    assert route.calls.last.request.headers["authorization"] == "Bearer good"


# ── tenant mismatch ─────────────────────────────────────────────────────────


@respx.mock
def test_tenant_mismatch_403_without_upstream_call(client):
    _stub_auth(respx)
    route = respx.get(f"{BASE}/api/workflows/OTHER/definitions").mock(
        return_value=httpx.Response(200, json={"definitions": []})
    )
    resp = client.get(
        "/api/workflows/OTHER/definitions", headers={"Authorization": "Bearer good"}
    )
    assert resp.status_code == 403
    assert not route.called


# ── instances ────────────────────────────────────────────────────────────


@respx.mock
def test_create_instance_relays_body_and_201(client):
    _stub_auth(respx)
    route = respx.post(
        f"{BASE}/api/workflows/t1/definitions/def1/instances"
    ).mock(return_value=httpx.Response(201, json={"entity_id": "i1"}))
    body = {"channel": "staff_assisted", "context": {"student_id": "s1"}}
    resp = client.post(
        "/api/workflows/t1/definitions/def1/instances",
        headers={"Authorization": "Bearer good"},
        json=body,
    )
    assert resp.status_code == 201
    assert resp.json() == {"entity_id": "i1"}
    assert route.called
    assert route.calls.last.request.headers["authorization"] == "Bearer good"


@respx.mock
def test_create_instance_relays_request_body_bytes_verbatim(client):
    _stub_auth(respx)
    route = respx.post(
        f"{BASE}/api/workflows/t1/definitions/def1/instances"
    ).mock(return_value=httpx.Response(201, json={"entity_id": "i1"}))
    body = {"channel": "staff_assisted", "context": {"student_id": "s1"}, "email": "a@b.com"}
    resp = client.post(
        "/api/workflows/t1/definitions/def1/instances",
        headers={"Authorization": "Bearer good"},
        json=body,
    )
    assert resp.status_code == 201
    import json as _j

    assert _j.loads(route.calls.last.request.content) == body


@respx.mock
def test_allowed_actions_proxies(client):
    _stub_auth(respx)
    route = respx.get(f"{BASE}/api/workflows/t1/instances/i1/allowed-actions").mock(
        return_value=httpx.Response(200, json={"allowed": ["approve", "reject"]})
    )
    resp = client.get(
        "/api/workflows/t1/instances/i1/allowed-actions",
        headers={"Authorization": "Bearer good"},
    )
    assert resp.status_code == 200
    assert resp.json() == {"allowed": ["approve", "reject"]}
    assert route.called
    assert route.calls.last.request.headers["authorization"] == "Bearer good"


@respx.mock
def test_instance_action_relays_body_and_409_verbatim(client):
    _stub_auth(respx)
    respx.post(f"{BASE}/api/workflows/t1/instances/i1/actions").mock(
        return_value=httpx.Response(409, json={"detail": {"allowed": ["approve"]}})
    )
    resp = client.post(
        "/api/workflows/t1/instances/i1/actions",
        headers={"Authorization": "Bearer good"},
        json={"action": "bogus"},
    )
    assert resp.status_code == 409
    assert resp.json()["detail"]["allowed"] == ["approve"]


# ── documents ────────────────────────────────────────────────────────────


@respx.mock
def test_create_document_proxies_and_201(client):
    _stub_auth(respx)
    route = respx.post(f"{BASE}/api/documents/t1").mock(
        return_value=httpx.Response(201, json={"document_id": "doc1"})
    )
    resp = client.post(
        "/api/workflows/t1/documents",
        headers={"Authorization": "Bearer good"},
        json={"instance_entity_id": "i1", "filename": "x.pdf"},
    )
    assert resp.status_code == 201
    assert resp.json() == {"document_id": "doc1"}
    assert route.called
    assert route.calls.last.request.headers["authorization"] == "Bearer good"


@respx.mock
def test_document_url_proxies(client):
    _stub_auth(respx)
    route = respx.get(f"{BASE}/api/documents/t1/doc1/url").mock(
        return_value=httpx.Response(200, json={"url": "https://example.com/doc1"})
    )
    resp = client.get(
        "/api/workflows/t1/documents/doc1/url",
        headers={"Authorization": "Bearer good"},
    )
    assert resp.status_code == 200
    assert resp.json() == {"url": "https://example.com/doc1"}
    assert route.called
    assert route.calls.last.request.headers["authorization"] == "Bearer good"


# ── unreachable ─────────────────────────────────────────────────────────


@respx.mock
def test_apexflow_unreachable_502(client):
    _stub_auth(respx)
    respx.get(f"{BASE}/api/workflows/t1/definitions").mock(
        side_effect=httpx.ConnectError("refused")
    )
    resp = client.get(
        "/api/workflows/t1/definitions", headers={"Authorization": "Bearer good"}
    )
    assert resp.status_code == 502
    assert resp.json()["detail"] == "ApexFlow is unreachable"


@respx.mock
def test_create_instance_apexflow_unreachable_502(client):
    _stub_auth(respx)
    respx.post(f"{BASE}/api/workflows/t1/definitions/def1/instances").mock(
        side_effect=httpx.ConnectError("refused")
    )
    resp = client.post(
        "/api/workflows/t1/definitions/def1/instances",
        headers={"Authorization": "Bearer good"},
        json={"channel": "staff_assisted"},
    )
    assert resp.status_code == 502
    assert resp.json()["detail"] == "ApexFlow is unreachable"


# ── lineage lifecycle actions + work-item list ─────────────────────────────



@respx.mock
def test_definition_actions_are_not_proxied(client):
    """Workflow lifecycle belongs to the ApexFlow designer. AdminDash must not
    expose it at all — hiding the buttons would leave the capability reachable
    by anyone holding an AdminDash token."""
    _stub_auth(respx)
    resp = client.post(
        "/api/workflows/t1/definitions/wd-1/actions",
        json={"action": "delete"},
        headers={"Authorization": "Bearer good"},
    )
    assert resp.status_code == 405 or resp.status_code == 404


@respx.mock
def test_lineage_instances_proxies(client):
    _stub_auth(respx)
    route = respx.get(f"{BASE}/api/workflows/t1/definitions/wd-1/instances").mock(
        return_value=httpx.Response(
            200, json={"instances": [{"entity_id": "wi-1", "state": "submitted"}]}
        )
    )
    resp = client.get(
        "/api/workflows/t1/definitions/wd-1/instances",
        headers={"Authorization": "Bearer good"},
    )
    assert resp.status_code == 200
    assert resp.json()["instances"][0]["state"] == "submitted"
    assert route.called
    assert route.calls.last.request.headers["authorization"] == "Bearer good"
