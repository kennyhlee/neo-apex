"""Tests for tenant profile fallback and non-destructive model sync-defaults.

These mirror the DataCore-facing behaviour by stubbing the httpx calls used
inside app.api.tenants and overriding the auth dependency so no real JWT /
DataCore auth round-trip is needed.
"""
import json

import pytest
from fastapi.testclient import TestClient

from app.api import tenants
from app.api.auth import get_current_user
from app.main import app

ADMIN_USER = {
    "name": "Admin User",
    "role": "admin",
    "tenant_id": "t1",
    "tenant_name": "Sunrise Academy",
}


class FakeResponse:
    def __init__(self, status_code=200, data=None, json_body=None):
        self.status_code = status_code
        self._json = json_body if json_body is not None else {"data": data or []}

    def json(self):
        return self._json


@pytest.fixture
def client():
    app.dependency_overrides[get_current_user] = lambda: ADMIN_USER
    with TestClient(app) as c:
        # 173.245.48.1 is inside a Cloudflare range so the ingress
        # allowlist middleware admits the request in tests.
        c.headers.update({"fly-client-ip": "173.245.48.1"})
        yield c
    app.dependency_overrides.clear()


# ─── FIX 1: tenant name fallback ─────────────────────────────


def test_get_tenant_profile_falls_back_to_tenant_name_when_missing(client, monkeypatch):
    # Row has no name field at all.
    def fake_post(url, json=None, **kwargs):
        return FakeResponse(data=[{"entity_type": "tenant", "abbrev": "SA"}])

    monkeypatch.setattr(tenants.httpx, "post", fake_post)

    resp = client.get("/api/tenants/t1")
    assert resp.status_code == 200
    assert resp.json()["name"] == "Sunrise Academy"


def test_get_tenant_profile_falls_back_when_name_is_none(client, monkeypatch):
    def fake_post(url, json=None, **kwargs):
        return FakeResponse(data=[{"entity_type": "tenant", "name": None, "abbrev": "SA"}])

    monkeypatch.setattr(tenants.httpx, "post", fake_post)

    resp = client.get("/api/tenants/t1")
    assert resp.status_code == 200
    assert resp.json()["name"] == "Sunrise Academy"


def test_get_tenant_profile_keeps_stored_name(client, monkeypatch):
    def fake_post(url, json=None, **kwargs):
        return FakeResponse(data=[{"entity_type": "tenant", "name": "Stored Name", "abbrev": "SN"}])

    monkeypatch.setattr(tenants.httpx, "post", fake_post)

    resp = client.get("/api/tenants/t1")
    assert resp.status_code == 200
    assert resp.json()["name"] == "Stored Name"


# ─── FIX 2: non-destructive sync-defaults ────────────────────


def _base_model():
    with open(tenants.BASE_MODEL_PATH) as f:
        return json.load(f)


def _stored(et, base_fields, custom_fields=()):
    return {
        "entity_type": et,
        "model_definition": {
            "base_fields": list(base_fields),
            "custom_fields": list(custom_fields),
        },
    }


def _complete_rows():
    return [_stored(et, d.get("base_fields", [])) for et, d in _base_model().items()]


def _lagging_registration_rows(custom_fields=(), drop=None):
    """Complete rows, except registration_application lacks some base fields."""
    base = _base_model()["registration_application"]["base_fields"]
    drop = set(drop) if drop is not None else {f["name"] for f in base[-8:]}
    rows = [r for r in _complete_rows() if r["entity_type"] != "registration_application"]
    rows.append(_stored(
        "registration_application",
        [f for f in base if f["name"] not in drop],
        custom_fields,
    ))
    return rows, sorted(drop)


class Recorder:
    def __init__(self):
        self.puts = []
        self.preflights = []


def fake_httpx(monkeypatch, *, rows, preflight=None, preflight_error=False):
    rec = Recorder()

    def fake_post(url, json=None, **kwargs):
        if "model-preflight" in url:
            rec.preflights.append({"url": url, "json": json, "headers": kwargs.get("headers")})
            if preflight_error:
                raise tenants.httpx.ConnectError("x")
            return FakeResponse(json_body=preflight)
        return FakeResponse(data=rows)

    def fake_put(url, json=None, **kwargs):
        rec.puts.append(json)
        return FakeResponse(status_code=200)

    monkeypatch.setattr(tenants.httpx, "post", fake_post)
    monkeypatch.setattr(tenants.httpx, "put", fake_put)
    return rec


AUTH = {"Authorization": "Bearer t"}
SYNC = "/api/tenants/t1/model/sync-defaults"
NO_RISK = {"definitions": []}


def _risk(before="current", after="stale"):
    return {"definitions": [{
        "definition_id": "d1", "name": "Registration", "version": 1,
        "health_before": before, "health_after": after,
    }]}


def test_sync_adds_eight_lagging_application_fields_and_keeps_custom(client, monkeypatch):
    rows, eight = _lagging_registration_rows(
        custom_fields=[{"name": "packet_notes", "type": "string"}])
    rec = fake_httpx(monkeypatch, rows=rows, preflight=NO_RISK)

    resp = client.post(SYNC, headers=AUTH)
    assert resp.status_code == 200
    assert len(rec.puts) == 1
    sent = rec.puts[0]["model_definition"]
    assert set(sent) == {"registration_application"}
    want = [f["name"] for f in _base_model()["registration_application"]["base_fields"]]
    assert [f["name"] for f in sent["registration_application"]["base_fields"]] == want
    assert "packet_notes" in [f["name"] for f in sent["registration_application"]["custom_fields"]]
    assert resp.json()["changed"]["registration_application"]["added_fields"] == eight
    assert len(eight) == 8


def test_sync_noop_sends_no_put_and_no_preflight(client, monkeypatch):
    fake_httpx(monkeypatch, rows=_complete_rows())

    def boom(*a, **k):
        raise AssertionError("must not be called on a no-op")

    real_post = tenants.httpx.post

    def guarded_post(url, json=None, **kwargs):
        if "model-preflight" in url:
            boom()
        return real_post(url, json=json, **kwargs)

    monkeypatch.setattr(tenants.httpx, "post", guarded_post)
    monkeypatch.setattr(tenants.httpx, "put", boom)

    resp = client.post(SYNC, headers=AUTH)
    assert resp.status_code == 200
    assert resp.json() == {"added_entities": [], "changed": {}, "workflows_at_risk": []}


def test_sync_writes_only_changed_types(client, monkeypatch):
    rows, _ = _lagging_registration_rows()
    rec = fake_httpx(monkeypatch, rows=rows, preflight=NO_RISK)

    resp = client.post(SYNC, headers=AUTH)
    assert resp.status_code == 200
    assert "student" not in rec.puts[0]["model_definition"]
    assert set(rec.puts[0]["model_definition"]) == {"registration_application"}


def test_sync_leaves_tenant_only_type_alone(client, monkeypatch):
    rows, _ = _lagging_registration_rows()
    rows.append(_stored("scholarship", [{"name": "amount", "type": "number"}]))
    rec = fake_httpx(monkeypatch, rows=rows, preflight=NO_RISK)

    resp = client.post(SYNC, headers=AUTH)
    assert resp.status_code == 200
    assert "scholarship" not in rec.puts[0]["model_definition"]
    body = resp.json()
    assert "scholarship" not in body["changed"]
    assert "scholarship" not in body["added_entities"]


def test_sync_reports_demoted_fields(client, monkeypatch):
    rows, _ = _lagging_registration_rows(
        custom_fields=[{"name": "channel_started", "type": "string", "required": True}],
        drop={_base_model()["registration_application"]["base_fields"][-1]["name"]},
    )
    fake_httpx(monkeypatch, rows=rows, preflight=NO_RISK)

    resp = client.post(SYNC, headers=AUTH)
    assert resp.status_code == 200
    assert resp.json()["changed"]["registration_application"]["demoted_fields"] == ["channel_started"]


def test_sync_409_when_workflow_would_go_stale(client, monkeypatch):
    rows, _ = _lagging_registration_rows()
    rec = fake_httpx(monkeypatch, rows=rows, preflight=_risk())

    resp = client.post(SYNC, headers=AUTH)
    assert resp.status_code == 409
    detail = resp.json()["detail"]
    assert detail["reason"] == "workflows_at_risk"
    assert len(detail["workflows_at_risk"]) == 1
    assert rec.puts == []


def test_sync_force_writes_despite_risk(client, monkeypatch):
    rows, _ = _lagging_registration_rows()
    rec = fake_httpx(monkeypatch, rows=rows, preflight=_risk())

    resp = client.post(SYNC, headers=AUTH, json={"force": True})
    assert resp.status_code == 200
    assert len(rec.puts) == 1
    assert len(resp.json()["workflows_at_risk"]) == 1


def test_sync_no_risk_when_health_unchanged(client, monkeypatch):
    rows, _ = _lagging_registration_rows()
    rec = fake_httpx(monkeypatch, rows=rows, preflight=_risk("stale", "stale"))

    resp = client.post(SYNC, headers=AUTH)
    assert resp.status_code == 200
    assert len(rec.puts) == 1
    assert resp.json()["workflows_at_risk"] == []


def test_sync_502_when_preflight_unavailable(client, monkeypatch):
    rows, _ = _lagging_registration_rows()
    rec = fake_httpx(monkeypatch, rows=rows, preflight_error=True)

    resp = client.post(SYNC, headers=AUTH)
    assert resp.status_code == 502
    assert resp.json()["detail"]["reason"] == "preflight_unavailable"
    assert rec.puts == []


def test_sync_force_through_preflight_failure(client, monkeypatch):
    rows, _ = _lagging_registration_rows()
    rec = fake_httpx(monkeypatch, rows=rows, preflight_error=True)

    resp = client.post(SYNC, headers=AUTH, json={"force": True})
    assert resp.status_code == 200
    assert len(rec.puts) == 1
    assert resp.json()["preflight"] == "unavailable"


def test_sync_forwards_authorization_to_preflight(client, monkeypatch):
    rows, _ = _lagging_registration_rows()
    rec = fake_httpx(monkeypatch, rows=rows, preflight=NO_RISK)

    client.post(SYNC, headers=AUTH)
    assert len(rec.preflights) == 1
    assert rec.preflights[0]["headers"]["Authorization"] == "Bearer t"
    assert "/api/workflows/t1/model-preflight" in rec.preflights[0]["url"]
    assert set(rec.preflights[0]["json"]["models"]) == {"registration_application"}


def test_sync_tenant_mismatch_403(client, monkeypatch):
    def fake_post(url, json=None, **kwargs):
        raise AssertionError("should not query DataCore on tenant mismatch")

    monkeypatch.setattr(tenants.httpx, "post", fake_post)

    resp = client.post("/api/tenants/other/model/sync-defaults", headers=AUTH)
    assert resp.status_code == 403


def test_sync_adds_missing_entity_type_whole(client, monkeypatch):
    rows = [r for r in _complete_rows() if r["entity_type"] != "lead"]
    rec = fake_httpx(monkeypatch, rows=rows, preflight=NO_RISK)

    resp = client.post(SYNC, headers=AUTH)
    assert resp.status_code == 200
    assert resp.json()["added_entities"] == ["lead"]
    assert len(rec.puts) == 1
    assert rec.puts[0]["model_definition"] == {"lead": _base_model()["lead"]}
    assert rec.puts[0]["source_filename"] == "base_model.json"
