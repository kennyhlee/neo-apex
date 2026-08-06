# familyhub/backend/tests/test_registration_routes.py
"""Public registration facade: config bundle + start (rate limited).

Task 10: retargeted from enrollx's `/internal/registration/{tenant_id}/*` to
apexflow's `/internal/workflows/{tenant_id}/{definition_id}/*`. See
app/api/registration.py's module docstring for the reshaping policy
(`config.blocks` is a documented placeholder `[]` pending the Phase 3
steps->blocks compiler; `tenant`/`capacity` pass through losslessly).
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
    "tenant": {"tenant_id": TENANT, "name": "Acme Afterschool"},
    "capacity": {"capacity": 20, "admitted": 3, "full": False},
}


def test_config_bundle_reshapes_definition_into_config(client, fake_http):
    fake_http.add("GET", f"/internal/workflows/{TENANT}/{DEFINITION_ID}/config",
                  FakeResponse(200, BUNDLE))
    resp = client.get(f"/api/registration/{TENANT}/{DEFINITION_ID}")
    assert resp.status_code == 200
    body = resp.json()
    assert body["tenant"]["name"] == "Acme Afterschool"
    assert body["capacity"]["full"] is False
    assert body["config"]["config_id"] == DEFINITION_ID
    assert body["config"]["version"] == 1
    assert body["config"]["status"] == "published"
    assert body["config"]["blocks"] == []  # documented Phase 3 placeholder
    # internal key was attached
    assert fake_http.calls[0]["headers"]["X-Internal-Key"] == "test-internal-key"


def test_config_bundle_404_passthrough(client, fake_http):
    fake_http.add("GET", f"/internal/workflows/{TENANT}/nosuch/config",
                  FakeResponse(404, {"detail": "No published workflow_definition for this lineage"}))
    resp = client.get(f"/api/registration/{TENANT}/nosuch")
    assert resp.status_code == 404


def test_config_bundle_masks_upstream_500(client, fake_http):
    fake_http.add("GET", f"/internal/workflows/{TENANT}/{DEFINITION_ID}/config",
                  FakeResponse(500, {"detail": "Traceback (most recent call last): ..."}))
    resp = client.get(f"/api/registration/{TENANT}/{DEFINITION_ID}")
    assert resp.status_code == 502
    assert "Traceback" not in resp.text


def test_start_returns_token_and_hub_url(client, fake_http):
    fake_http.add(
        "POST", f"/internal/workflows/{TENANT}/{DEFINITION_ID}/start",
        FakeResponse(201, {
            "instance": {"entity_id": "wi-1", "state": "draft", "definition_id": DEFINITION_ID},
            "items": [{"entity_id": "item-1", "entity_type": "workflow_item",
                      "base_data": {"kind": "form"}}],
            "token": "tok123", "link": "http://localhost:6000/w/acme/enrollment?token=tok123",
        }),
    )
    resp = client.post(f"/api/registration/{TENANT}/{DEFINITION_ID}/start",
                       json={"applicant_email": "parent@example.com"})
    assert resp.status_code == 201
    body = resp.json()
    assert body["token"] == "tok123"
    assert body["hub_url"] == "/application/tok123"
    # instance.state reshaped to application.status (identical vocabulary)
    assert body["application"]["status"] == "draft"
    assert body["application"]["entity_id"] == "wi-1"
    assert body["items"] == [{"entity_id": "item-1", "entity_type": "workflow_item",
                              "base_data": {"kind": "form"}}]

    start_call = next(c for c in fake_http.calls if c["method"] == "POST")
    sent = start_call["json"]
    assert sent["applicant_email"] == "parent@example.com"
    assert "school_year" in sent["context"] and sent["context"]["school_year"]


def test_start_rejects_junk_email(client, fake_http):
    resp = client.post(f"/api/registration/{TENANT}/{DEFINITION_ID}/start",
                       json={"applicant_email": "junk"})
    assert resp.status_code == 422
    assert fake_http.calls == []  # never reached apexflow


def test_start_passes_through_upstream_errors(client, fake_http):
    fake_http.add("POST", f"/internal/workflows/{TENANT}/{DEFINITION_ID}/start",
                  FakeResponse(404, {"detail": "No published workflow_definition for this lineage"}))
    resp = client.post(f"/api/registration/{TENANT}/{DEFINITION_ID}/start",
                       json={"applicant_email": "parent@example.com"})
    assert resp.status_code == 404


def test_start_masks_upstream_500(client, fake_http):
    fake_http.add("POST", f"/internal/workflows/{TENANT}/{DEFINITION_ID}/start",
                  FakeResponse(500, {"detail": "DataCore write failed: connection reset by peer"}))
    resp = client.post(f"/api/registration/{TENANT}/{DEFINITION_ID}/start",
                       json={"applicant_email": "parent@example.com"})
    assert resp.status_code == 502
    assert "DataCore" not in resp.text


def test_start_is_rate_limited_per_ip(client, fake_http):
    fake_http.add("POST", f"/internal/workflows/{TENANT}/{DEFINITION_ID}/start",
                  FakeResponse(201, {"instance": {"entity_id": "wi-1", "state": "draft"},
                                     "items": [], "token": "tok123", "link": "http://x/link"}))
    for _ in range(10):
        ok = client.post(f"/api/registration/{TENANT}/{DEFINITION_ID}/start",
                         json={"applicant_email": "parent@example.com"})
        assert ok.status_code == 201
    throttled = client.post(f"/api/registration/{TENANT}/{DEFINITION_ID}/start",
                            json={"applicant_email": "parent@example.com"})
    assert throttled.status_code == 429


@pytest.mark.parametrize("today,expected", [
    (datetime.date(2026, 3, 1), "2025-2026"),
    (datetime.date(2026, 7, 1), "2026-2027"),
    (datetime.date(2026, 12, 31), "2026-2027"),
])
def test_start_derives_school_year_with_the_july_rollover(
        client, fake_http, monkeypatch, today, expected):
    """Same rule as flow-runtime's defaultSchoolYear() and apexflow's
    enrollment template's `context.school_year` scoping -- all channels must
    agree, because the capacity snapshot the parent was shown was computed
    for this year."""
    monkeypatch.setattr("app.api.registration._today", lambda: today)
    fake_http.add("POST", f"/internal/workflows/{TENANT}/{DEFINITION_ID}/start",
                  FakeResponse(201, {"instance": {"entity_id": "wi-1", "state": "draft"},
                                     "items": [], "token": "tok123", "link": "http://x/link"}))
    resp = client.post(f"/api/registration/{TENANT}/{DEFINITION_ID}/start",
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
    client.post(f"/api/registration/{TENANT}/{DEFINITION_ID}/start",
               json={"applicant_email": "parent@example.com"})
    assert fake_http.calls and all(c["method"] == "POST" for c in fake_http.calls)
