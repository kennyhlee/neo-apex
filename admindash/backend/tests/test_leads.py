import json as _j

import httpx
import pytest
import respx


def _stub_auth(mock):
    mock.get("http://localhost:5800/auth/me").mock(
        return_value=httpx.Response(200, json={"id": "u1", "tenant_id": "t1"})
    )


def test_stages_constant_is_ordered():
    from app.api.leads import STAGES
    assert STAGES == ["New", "Contacted", "Tour Scheduled", "Toured", "Enrolled", "Lost"]


# ── create / list / get routes ────────────────────────────────────────────


@respx.mock
def test_create_lead_manual(client):
    _stub_auth(respx)
    route = respx.post("http://localhost:5800/api/entities/t1/lead").mock(
        return_value=httpx.Response(201, json={
            "entity_id": "ld1", "base_data": {
                "guardian_name": "Sam Rivera", "email": "sam@example.com",
                "source": "manual", "stage": "New"}})
    )
    resp = client.post("/api/leads/t1",
        json={"guardian_name": "Sam Rivera", "email": "sam@example.com"},
        headers={"Authorization": "Bearer good"})
    assert resp.status_code == 201
    sent = route.calls.last.request
    body = _j.loads(sent.content)
    assert body["base_data"]["source"] == "manual"
    assert body["base_data"]["stage"] == "New"


@respx.mock
def test_create_lead_requires_contact(client):
    _stub_auth(respx)
    resp = client.post("/api/leads/t1", json={"guardian_name": "No Contact"},
        headers={"Authorization": "Bearer good"})
    assert resp.status_code == 422


@respx.mock
def test_list_leads_filters_by_stage(client):
    _stub_auth(respx)
    route = respx.post("http://localhost:5800/api/query").mock(
        return_value=httpx.Response(200, json={"data": [{"entity_id": "ld1", "stage": "Toured"}], "total": 1}))
    resp = client.get("/api/leads/t1?stage=Toured", headers={"Authorization": "Bearer good"})
    assert resp.status_code == 200
    sql = _j.loads(route.calls.last.request.content)["sql"]
    assert "entity_type = 'lead'" in sql and "stage = 'Toured'" in sql


def test_list_leads_requires_auth(client):
    resp = client.get("/api/leads/t1")
    assert resp.status_code == 401


@respx.mock
def test_get_lead_returns_lead(client):
    _stub_auth(respx)
    respx.post("http://localhost:5800/api/query").mock(
        return_value=httpx.Response(200, json={"data": [{"entity_id": "ld1", "stage": "New"}], "total": 1}))
    resp = client.get("/api/leads/t1/ld1", headers={"Authorization": "Bearer good"})
    assert resp.status_code == 200
    assert resp.json()["entity_id"] == "ld1"


@respx.mock
def test_get_lead_not_found(client):
    _stub_auth(respx)
    respx.post("http://localhost:5800/api/query").mock(
        return_value=httpx.Response(200, json={"data": [], "total": 0}))
    resp = client.get("/api/leads/t1/missing", headers={"Authorization": "Bearer good"})
    assert resp.status_code == 404


@respx.mock
def test_create_lead_honors_email_import_source(client):
    _stub_auth(respx)
    # Case 1: email_import source is preserved
    route = respx.post("http://localhost:5800/api/entities/t1/lead").mock(
        return_value=httpx.Response(201, json={
            "entity_id": "ld2", "base_data": {
                "guardian_name": "X", "email": "x@e.com",
                "source": "email_import", "stage": "New"}})
    )
    resp = client.post("/api/leads/t1",
        json={"guardian_name": "X", "email": "x@e.com", "source": "email_import"},
        headers={"Authorization": "Bearer good"})
    assert resp.status_code == 201
    body = _j.loads(route.calls.last.request.content)
    assert body["base_data"]["source"] == "email_import"

    # Case 2: unknown source falls back to manual
    route2 = respx.post("http://localhost:5800/api/entities/t1/lead").mock(
        return_value=httpx.Response(201, json={
            "entity_id": "ld3", "base_data": {
                "guardian_name": "X", "email": "x@e.com",
                "source": "manual", "stage": "New"}})
    )
    resp2 = client.post("/api/leads/t1",
        json={"guardian_name": "X", "email": "x@e.com", "source": "unknown_value"},
        headers={"Authorization": "Bearer good"})
    assert resp2.status_code == 201
    body2 = _j.loads(route2.calls.last.request.content)
    assert body2["base_data"]["source"] == "manual"
