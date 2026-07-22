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


def _base_model_keys():
    with open(tenants.BASE_MODEL_PATH) as f:
        return set(json.load(f).keys())


def test_sync_defaults_noop_when_all_present(client, monkeypatch):
    all_keys = _base_model_keys()

    def fake_post(url, json=None, **kwargs):
        return FakeResponse(data=[{"entity_type": et} for et in all_keys])

    def fake_put(*args, **kwargs):
        raise AssertionError("PUT must not be called when nothing is missing")

    monkeypatch.setattr(tenants.httpx, "post", fake_post)
    monkeypatch.setattr(tenants.httpx, "put", fake_put)

    resp = client.post("/api/tenants/t1/model/sync-defaults")
    assert resp.status_code == 200
    assert resp.json() == {"added": []}


def test_sync_defaults_adds_only_missing_entities(client, monkeypatch):
    all_keys = _base_model_keys()
    present = all_keys - {"lead"}
    put_calls = []

    def fake_post(url, json=None, **kwargs):
        return FakeResponse(data=[{"entity_type": et} for et in present])

    def fake_put(url, json=None, **kwargs):
        put_calls.append(json)
        return FakeResponse(status_code=200)

    monkeypatch.setattr(tenants.httpx, "post", fake_post)
    monkeypatch.setattr(tenants.httpx, "put", fake_put)

    resp = client.post("/api/tenants/t1/model/sync-defaults")
    assert resp.status_code == 200
    assert resp.json()["added"] == ["lead"]

    assert len(put_calls) == 1
    sent_keys = set(put_calls[0]["model_definition"].keys())
    assert sent_keys == {"lead"}
    assert "lead" in sent_keys
    assert present.isdisjoint(sent_keys)
    assert put_calls[0]["source_filename"] == "base_model.json"


def test_sync_defaults_tenant_mismatch_returns_403(client, monkeypatch):
    def fake_post(url, json=None, **kwargs):
        raise AssertionError("should not query DataCore on tenant mismatch")

    monkeypatch.setattr(tenants.httpx, "post", fake_post)

    resp = client.post("/api/tenants/other/model/sync-defaults")
    assert resp.status_code == 403
