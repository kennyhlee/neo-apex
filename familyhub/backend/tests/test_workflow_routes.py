# familyhub/backend/tests/test_workflow_routes.py
"""Public workflow facade: config bundle relay + start (rate limited).

Task 10: retargeted from enrollx's `/internal/registration/{tenant_id}/*` to
apexflow's `/internal/workflows/{tenant_id}/{definition_id}/*`. Task 6
(Plan 3): renamed from `test_registration_routes.py`, retargeted to
`/api/workflows/...`, and the config-bundle assertions now check a VERBATIM
relay of apexflow's `{definition, models, tenant, capacity, lineage_status}`
bundle -- no more `_config_bundle_from_apexflow` reshape (see
app/api/workflows.py's module docstring).
"""
import datetime
import json

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.ratelimit import request_link_limiter, start_limiter


class FakeResponse:
    def __init__(self, status_code, json_body=None, content=None, content_type="application/json"):
        self.status_code = status_code
        self._json = json_body
        self.content = content if content is not None else json.dumps(json_body or {}).encode()
        self.headers = {"content-type": content_type}

    def json(self):
        if self._json is None:
            return json.loads(self.content.decode())
        return self._json


class FakeHTTP:
    """Route table keyed by (METHOD, url substring). Records every call."""

    def __init__(self):
        self.routes = {}
        self.calls = []

    def add(self, method, url_part, response):
        self.routes[(method.upper(), url_part)] = response

    def request(self, method, url, **kwargs):
        self.calls.append({"method": method.upper(), "url": url, **kwargs})
        for (m, part), resp in self.routes.items():
            if m == method.upper() and part in url:
                return resp
        raise AssertionError(f"Unexpected upstream call: {method} {url}")


@pytest.fixture
def fake_http(monkeypatch):
    fake = FakeHTTP()
    monkeypatch.setattr("app.upstream.httpx.request", fake.request)
    return fake


@pytest.fixture(autouse=True)
def internal_key(monkeypatch):
    from app.config import settings
    monkeypatch.setattr(settings, "apexflow_internal_key", "test-internal-key")


@pytest.fixture(autouse=True)
def reset_rate_limits():
    start_limiter._hits.clear()
    request_link_limiter._hits.clear()
    yield


@pytest.fixture
def client():
    return TestClient(app)


TENANT = "acme"
DEFINITION_ID = "enrollment"

BUNDLE = {
    "definition": {"definition_id": DEFINITION_ID, "name": "Enrollment", "version": 1,
                   "machine": {"states": [], "transitions": []}, "steps": []},
    "models": {},
    "tenant": {"tenant_id": TENANT, "name": "Acme Afterschool"},
    "capacity": {"capacity": 20, "admitted": 3, "full": False},
    "lineage_status": "active",
}


def test_workflow_bundle_relays_verbatim(client, fake_http):
    fake_http.add("GET", f"/internal/workflows/{TENANT}/{DEFINITION_ID}/config",
                  FakeResponse(200, BUNDLE))
    resp = client.get(f"/api/workflows/{TENANT}/{DEFINITION_ID}")
    assert resp.status_code == 200
    body = resp.json()
    assert body == BUNDLE
    # internal key was attached
    assert fake_http.calls[0]["headers"]["X-Internal-Key"] == "test-internal-key"


def test_workflow_bundle_relays_models_and_lineage_status(client, fake_http):
    fake_http.add("GET", f"/internal/workflows/{TENANT}/{DEFINITION_ID}/config", FakeResponse(200, {
        "definition": {"definition_id": DEFINITION_ID, "name": "Enrollment", "version": 2,
                       "machine": {"states": [], "transitions": []}, "steps": []},
        "models": {"student": {"base_fields": [], "custom_fields": []}},
        "tenant": {"tenant_id": TENANT, "name": "Acme"},
        "capacity": {"capacity": None, "admitted": 0, "full": False},
        "lineage_status": "deprecated",
    }))
    resp = client.get(f"/api/workflows/{TENANT}/{DEFINITION_ID}")
    assert resp.status_code == 200
    body = resp.json()
    assert body["lineage_status"] == "deprecated"
    assert "blocks" not in json.dumps(body)          # the placeholder is gone
    assert body["models"]["student"] == {"base_fields": [], "custom_fields": []}


def test_config_bundle_404_passthrough(client, fake_http):
    fake_http.add("GET", f"/internal/workflows/{TENANT}/nosuch/config",
                  FakeResponse(404, {"detail": "No published workflow_definition for this lineage"}))
    resp = client.get(f"/api/workflows/{TENANT}/nosuch")
    assert resp.status_code == 404


def test_config_bundle_masks_upstream_500(client, fake_http):
    fake_http.add("GET", f"/internal/workflows/{TENANT}/{DEFINITION_ID}/config",
                  FakeResponse(500, {"detail": "Traceback (most recent call last): ..."}))
    resp = client.get(f"/api/workflows/{TENANT}/{DEFINITION_ID}")
    assert resp.status_code == 502
    assert "Traceback" not in resp.text


def test_start_returns_token_and_hub_url(client, fake_http):
    fake_http.add(
        "POST", f"/internal/workflows/{TENANT}/{DEFINITION_ID}/start",
        FakeResponse(201, {
            "instance": {"entity_id": "wi-1", "state": "draft", "definition_id": DEFINITION_ID},
            "items": [{"entity_id": "item-1", "entity_type": "workflow_item",
                      "base_data": {"kind": "form"}}],
            "token": "tok123", "link": "http://localhost:5620/w/acme/enrollment?token=tok123",
        }),
    )
    resp = client.post(f"/api/workflows/{TENANT}/{DEFINITION_ID}/start",
                       json={"applicant_email": "parent@example.com"})
    assert resp.status_code == 201
    body = resp.json()
    assert body["token"] == "tok123"
    assert body["hub_url"] == "/application/tok123"
    # state is no longer renamed to status -- relayed as apexflow sends it
    assert body["instance"]["state"] == "draft"
    assert "status" not in body["instance"]
    assert body["instance"]["entity_id"] == "wi-1"
    assert body["items"] == [{"entity_id": "item-1", "entity_type": "workflow_item",
                              "base_data": {"kind": "form"}}]

    start_call = next(c for c in fake_http.calls if c["method"] == "POST")
    sent = start_call["json"]
    assert sent["applicant_email"] == "parent@example.com"
    assert "school_year" in sent["context"] and sent["context"]["school_year"]


def test_start_rejects_junk_email(client, fake_http):
    resp = client.post(f"/api/workflows/{TENANT}/{DEFINITION_ID}/start",
                       json={"applicant_email": "junk"})
    assert resp.status_code == 422
    assert fake_http.calls == []  # never reached apexflow


def test_start_passes_through_upstream_errors(client, fake_http):
    fake_http.add("POST", f"/internal/workflows/{TENANT}/{DEFINITION_ID}/start",
                  FakeResponse(404, {"detail": "No published workflow_definition for this lineage"}))
    resp = client.post(f"/api/workflows/{TENANT}/{DEFINITION_ID}/start",
                       json={"applicant_email": "parent@example.com"})
    assert resp.status_code == 404


def test_start_masks_upstream_500(client, fake_http):
    fake_http.add("POST", f"/internal/workflows/{TENANT}/{DEFINITION_ID}/start",
                  FakeResponse(500, {"detail": "DataCore write failed: connection reset by peer"}))
    resp = client.post(f"/api/workflows/{TENANT}/{DEFINITION_ID}/start",
                       json={"applicant_email": "parent@example.com"})
    assert resp.status_code == 502
    assert "DataCore" not in resp.text


def test_start_is_rate_limited_per_ip(client, fake_http):
    fake_http.add("POST", f"/internal/workflows/{TENANT}/{DEFINITION_ID}/start",
                  FakeResponse(201, {"instance": {"entity_id": "wi-1", "state": "draft"},
                                     "items": [], "token": "tok123", "link": "http://x/link"}))
    for _ in range(10):
        ok = client.post(f"/api/workflows/{TENANT}/{DEFINITION_ID}/start",
                         json={"applicant_email": "parent@example.com"})
        assert ok.status_code == 201
    throttled = client.post(f"/api/workflows/{TENANT}/{DEFINITION_ID}/start",
                            json={"applicant_email": "parent@example.com"})
    assert throttled.status_code == 429


@pytest.mark.parametrize("today,expected", [
    (datetime.date(2026, 3, 1), "2025-2026"),
    (datetime.date(2026, 7, 1), "2026-2027"),
    (datetime.date(2026, 12, 31), "2026-2027"),
])
def test_start_derives_school_year_with_the_july_rollover(
        client, fake_http, monkeypatch, today, expected):
    """Same rule as workflow-forms's defaultSchoolYear() and apexflow's
    enrollment template's `context.school_year` scoping -- all channels must
    agree, because the capacity snapshot the parent was shown was computed
    for this year."""
    monkeypatch.setattr("app.api.workflows._today", lambda: today)
    fake_http.add("POST", f"/internal/workflows/{TENANT}/{DEFINITION_ID}/start",
                  FakeResponse(201, {"instance": {"entity_id": "wi-1", "state": "draft"},
                                     "items": [], "token": "tok123", "link": "http://x/link"}))
    resp = client.post(f"/api/workflows/{TENANT}/{DEFINITION_ID}/start",
                       json={"applicant_email": "parent@example.com"})
    assert resp.status_code == 201
    start_call = next(c for c in fake_http.calls if c["method"] == "POST")
    assert start_call["json"]["context"]["school_year"] == expected


def test_start_no_longer_prefetches_the_config_bundle(client, fake_http):
    """The pre-flight GET existed only to read program.start_date. With the
    school year derived locally it is a wasted round trip on the parent's
    slowest connection -- and only apexflow can answer "is this school
    open", which the start call itself already does."""
    fake_http.add("POST", f"/internal/workflows/{TENANT}/{DEFINITION_ID}/start",
                  FakeResponse(201, {"instance": {"entity_id": "wi-1", "state": "draft"},
                                     "items": [], "token": "tok123", "link": "http://x/link"}))
    client.post(f"/api/workflows/{TENANT}/{DEFINITION_ID}/start",
               json={"applicant_email": "parent@example.com"})
    assert fake_http.calls and all(c["method"] == "POST" for c in fake_http.calls)


def test_workflow_bundle_relays_archived_lineage_status(client, fake_http):
    """FamilyHub needs no code change for archive: RegisterPage already renders
    the closed state for any lineage_status != 'active'. Asserted rather than
    assumed."""
    fake_http.add("GET", f"/internal/workflows/{TENANT}/{DEFINITION_ID}/config",
                  FakeResponse(200, {**BUNDLE, "lineage_status": "archived"}))

    resp = client.get(f"/api/workflows/{TENANT}/{DEFINITION_ID}")

    assert resp.status_code == 200
    assert resp.json()["lineage_status"] == "archived"
