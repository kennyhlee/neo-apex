"""Tests for entity CRUD proxy routes."""
import httpx
import respx


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
