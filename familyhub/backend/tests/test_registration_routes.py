# familyhub/backend/tests/test_registration_routes.py
"""Public registration facade: config bundle + start (rate limited)."""
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
    monkeypatch.setattr(settings, "enrollx_internal_key", "test-internal-key")


@pytest.fixture(autouse=True)
def reset_rate_limits():
    start_limiter._hits.clear()
    request_link_limiter._hits.clear()
    yield


@pytest.fixture
def client():
    return TestClient(app)


BUNDLE = {
    "config": {"config_id": "RC0001", "program_id": "PR0001", "version": 1,
               "status": "published", "blocks": []},
    "program": {"program_id": "PR0001", "name": "Fall 2026", "capacity": 20,
                "status": "active"},
    "capacity": {"capacity": 20, "approved": 3, "enrolled": 3, "full": False},
}


def test_config_bundle_passthrough(client, fake_http):
    fake_http.add("GET", "/internal/registration/acme/PR0001/config", FakeResponse(200, BUNDLE))
    resp = client.get("/api/registration/acme/PR0001")
    assert resp.status_code == 200
    body = resp.json()
    assert body["program"]["name"] == "Fall 2026"
    # fullness comes from the sibling "capacity" object, not program.is_full
    assert body["capacity"]["full"] is False
    # internal key was attached
    assert fake_http.calls[0]["headers"]["X-Internal-Key"] == "test-internal-key"


def test_config_bundle_404_passthrough(client, fake_http):
    fake_http.add("GET", "/internal/registration/acme/NOPE/config",
                  FakeResponse(404, {"detail": "No published registration flow for this program"}))
    resp = client.get("/api/registration/acme/NOPE")
    assert resp.status_code == 404


def test_config_bundle_masks_upstream_500(client, fake_http):
    fake_http.add("GET", "/internal/registration/acme/PR0001/config",
                  FakeResponse(500, {"detail": "Traceback (most recent call last): ..."}))
    resp = client.get("/api/registration/acme/PR0001")
    assert resp.status_code == 502
    assert "Traceback" not in resp.text


def test_start_returns_token_and_hub_url(client, fake_http):
    fake_http.add("POST", "/internal/registration/acme/PR0001/start",
                  FakeResponse(201, {"application": {"base_data": {"application_id": "RA260001"}},
                                     "token": "tok123"}))
    resp = client.post("/api/registration/acme/PR0001/start",
                       json={"applicant_email": "parent@example.com"})
    assert resp.status_code == 201
    body = resp.json()
    assert body["token"] == "tok123"
    assert body["hub_url"] == "/application/tok123"
    # facade supplies school_year itself -- brief's parent-facing contract
    # carries only applicant_email, but enrollx's internal start route
    # requires school_year with no default.
    sent = fake_http.calls[0]["json"]
    assert sent["applicant_email"] == "parent@example.com"
    assert "school_year" in sent and sent["school_year"]


def test_start_rejects_junk_email(client, fake_http):
    resp = client.post("/api/registration/acme/PR0001/start", json={"applicant_email": "junk"})
    assert resp.status_code == 422
    assert fake_http.calls == []  # never reached enrollx


def test_start_passes_through_upstream_errors(client, fake_http):
    fake_http.add("POST", "/internal/registration/acme/PR0001/start",
                  FakeResponse(404, {"detail": "No such program"}))
    resp = client.post("/api/registration/acme/PR0001/start",
                       json={"applicant_email": "parent@example.com"})
    assert resp.status_code == 404


def test_start_masks_upstream_500(client, fake_http):
    fake_http.add("POST", "/internal/registration/acme/PR0001/start",
                  FakeResponse(500, {"detail": "DataCore write failed: connection reset by peer"}))
    resp = client.post("/api/registration/acme/PR0001/start",
                       json={"applicant_email": "parent@example.com"})
    assert resp.status_code == 502
    assert "DataCore" not in resp.text


def test_start_is_rate_limited_per_ip(client, fake_http):
    fake_http.add("POST", "/internal/registration/acme/PR0001/start",
                  FakeResponse(201, {"token": "tok123"}))
    for _ in range(10):
        ok = client.post("/api/registration/acme/PR0001/start",
                         json={"applicant_email": "parent@example.com"})
        assert ok.status_code == 201
    throttled = client.post("/api/registration/acme/PR0001/start",
                            json={"applicant_email": "parent@example.com"})
    assert throttled.status_code == 429
