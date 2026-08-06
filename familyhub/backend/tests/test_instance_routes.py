# familyhub/backend/tests/test_instance_routes.py
"""Token-scoped instance facade: hub bundle, action relay, constant-200
request-link.

Task 10: GET/PUT `/api/application/{token}` and request-link retarget from
enrollx's `/internal/application-by-token/*` / `/internal/registration/*` to
apexflow's `/internal/instance-by-token/*` / `/internal/workflows/*`.

Task 6 (Plan 3): renamed `test_application_routes.py` -> here, retargeted to
`/api/instance/{token}` (app/api/application.py -> app/api/instance.py).
`PARENT_ACTIONS` and its hand-synced allowlist are deleted: the PUT route's
local guard shrinks to shape-validation only (JSON object with a string
`action`) -- everything else, including which specific actions are
permitted, is apexflow's call and relays back verbatim via the existing
4xx-verbatim relay convention (apexflow's `BLOCKED_TOKEN_ACTIONS` 403 and
actor checks are now the ONLY authority).
"""
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
TOKEN = "tok123"
HUB_BUNDLE = {
    "instance": {"entity_id": "wi-1", "state": "submitted", "definition_id": "enrollment"},
    "items": [],
    "definition": {"definition_id": "enrollment", "version": 1,
                   "machine": {"states": [], "transitions": []}, "steps": []},
    "allowed": ["save_draft", "complete_item", "submit"],
}


def test_hub_bundle_passthrough(client, fake_http):
    fake_http.add("GET", f"/internal/instance-by-token/{TOKEN}", FakeResponse(200, HUB_BUNDLE))
    resp = client.get(f"/api/instance/{TOKEN}")
    assert resp.status_code == 200
    body = resp.json()
    assert body["instance"]["entity_id"] == "wi-1"
    # apexflow's `allowed` field relays verbatim too.
    assert body["allowed"] == ["save_draft", "complete_item", "submit"]
    assert fake_http.calls[0]["headers"]["X-Internal-Key"] == "test-internal-key"


def test_hub_bundle_expired_token_passthrough(client, fake_http):
    fake_http.add("GET", f"/internal/instance-by-token/{TOKEN}",
                  FakeResponse(401, {"detail": "Invalid or revoked link"}))
    resp = client.get(f"/api/instance/{TOKEN}")
    assert resp.status_code == 401


def test_hub_bundle_wrong_scope_passthrough_is_401_not_403(client, fake_http):
    """Coordinator review fix: apexflow's resolve_token is UNIFORMLY 401 on
    every failure mode, including a token whose (tenant, instance) scope
    doesn't resolve -- a 403 there would be an existence oracle (this route
    has no auth of its own, so an unauthenticated caller could otherwise
    tell "instance doesn't exist" apart from "instance exists but the
    token is wrong"). This test pins the passthrough to 401, matching the
    same identical body `test_hub_bundle_expired_token_passthrough` above
    asserts for the "just plain invalid" case -- the two must be
    indistinguishable from familyhub's side too."""
    fake_http.add("GET", f"/internal/instance-by-token/{TOKEN}",
                  FakeResponse(401, {"detail": "Invalid or revoked link"}))
    resp = client.get(f"/api/instance/{TOKEN}")
    assert resp.status_code == 401
    assert resp.json() == {"detail": "Invalid or revoked link"}


def test_hub_bundle_masks_upstream_500(client, fake_http):
    fake_http.add("GET", f"/internal/instance-by-token/{TOKEN}",
                  FakeResponse(500, {"detail": "Traceback (most recent call last): ..."}))
    resp = client.get(f"/api/instance/{TOKEN}")
    assert resp.status_code == 502
    assert "Traceback" not in resp.text


def test_instance_put_relays_action_and_response_body(client, fake_http):
    fake_http.add("POST", f"/internal/instance-by-token/{TOKEN}/actions",
                  FakeResponse(200, {"instance": {"state": "draft"}}))
    resp = client.put(f"/api/instance/{TOKEN}",
                      json={"action": "save_draft", "section_answers": {"s1": {"child_name": "Mei"}}})
    assert resp.status_code == 200
    sent = fake_http.calls[0]["json"]
    assert sent["action"] == "save_draft"
    assert sent["section_answers"] == {"s1": {"child_name": "Mei"}}


def test_instance_put_relays_any_action_and_apexflow_403s_stand(client, fake_http):
    """THE key new-behavior test: there is no local allowlist any more --
    apexflow decides which actions are permitted on the family channel, and
    its 403 relays verbatim rather than being pre-empted locally."""
    fake_http.add("POST", f"/internal/instance-by-token/{TOKEN}/actions",
                  FakeResponse(403, {
                      "detail": "Action 'verify_item' is not permitted on the family channel"}))
    resp = client.put(f"/api/instance/{TOKEN}", json={"action": "verify_item"})
    assert resp.status_code == 403                    # relayed verbatim, not locally decided
    assert resp.json() == {
        "detail": "Action 'verify_item' is not permitted on the family channel"}
    # the request DID reach apexflow -- no local guard intercepted it.
    assert fake_http.calls[0]["json"]["action"] == "verify_item"


def test_instance_put_relays_withdraw_and_resubmit_too(client, fake_http):
    """No allowlist means every action -- including ones a hand-synced list
    might have missed -- reaches apexflow, which is now the sole authority."""
    fake_http.add("POST", f"/internal/instance-by-token/{TOKEN}/actions",
                  FakeResponse(200, {"instance": {"state": "withdrawn"}}))
    resp = client.put(f"/api/instance/{TOKEN}", json={"action": "withdraw"})
    assert resp.status_code == 200
    assert fake_http.calls[0]["json"]["action"] == "withdraw"


def test_action_masks_upstream_500(client, fake_http):
    fake_http.add("POST", f"/internal/instance-by-token/{TOKEN}/actions",
                  FakeResponse(500, {"detail": "DataCore write failed: connection reset by peer"}))
    resp = client.put(f"/api/instance/{TOKEN}", json={"action": "submit"})
    assert resp.status_code == 502
    assert "DataCore" not in resp.text


def test_instance_put_still_rejects_non_string_action_locally(client, fake_http):
    resp = client.put(f"/api/instance/{TOKEN}", json={"action": 7})
    assert resp.status_code == 400
    assert fake_http.calls == []                       # no upstream call for malformed input


@pytest.mark.parametrize("action", [None, ["save_draft"], {"action": "save_draft"}, 3.14])
def test_instance_put_rejects_non_string_action_shapes_locally(client, fake_http, action):
    resp = client.put(f"/api/instance/{TOKEN}", json={"action": action})
    assert resp.status_code == 400
    assert fake_http.calls == []


def test_instance_put_forwards_empty_string_action_to_apexflow(client, fake_http):
    """An empty string is still a string -- shape-validation only, not an
    allowlist (module docstring). apexflow's own `InternalActionRequest`
    declares `action: str` with no length floor, so it is apexflow's call
    whether "" is a legal action name, not this facade's."""
    fake_http.add("POST", f"/internal/instance-by-token/{TOKEN}/actions",
                  FakeResponse(400, {"detail": "Unknown action ''"}))
    resp = client.put(f"/api/instance/{TOKEN}", json={"action": ""})
    assert resp.status_code == 400
    assert fake_http.calls[0]["json"]["action"] == ""


def test_instance_put_rejects_missing_action_locally(client, fake_http):
    resp = client.put(f"/api/instance/{TOKEN}", json={"section_answers": {}})
    assert resp.status_code == 400
    assert fake_http.calls == []


def test_non_object_body_is_400(client, fake_http):
    resp = client.put(f"/api/instance/{TOKEN}", json=["not", "a", "dict"])
    assert resp.status_code == 400
    assert fake_http.calls == []


def test_request_link_match_and_no_match_are_indistinguishable(client, fake_http):
    fake_http.add("POST", f"/internal/workflows/{TENANT}/request-link", FakeResponse(200, {}))
    matched = client.post("/api/instance/request-link",
                          json={"tenant_id": TENANT, "email": "parent@example.com"})
    fake_http.routes.clear()
    fake_http.add("POST", f"/internal/workflows/{TENANT}/request-link", FakeResponse(200, {}))
    unmatched = client.post("/api/instance/request-link",
                            json={"tenant_id": TENANT, "email": "stranger@example.com"})
    assert matched.status_code == unmatched.status_code == 200
    assert matched.json() == unmatched.json() == {"status": "ok"}


def test_request_link_forwards_only_the_email(client, fake_http):
    fake_http.add("POST", f"/internal/workflows/{TENANT}/request-link", FakeResponse(200, {}))
    resp = client.post("/api/instance/request-link",
                       json={"tenant_id": TENANT, "email": "p@example.com"})
    assert resp.status_code == 200 and resp.json() == {"status": "ok"}
    sent = next(c for c in fake_http.calls if c["method"] == "POST")["json"]
    assert sent == {"email": "p@example.com"}


def test_request_link_upstream_error_is_still_200(client, fake_http):
    fake_http.add("POST", f"/internal/workflows/{TENANT}/request-link",
                  FakeResponse(500, {"detail": "boom"}))
    resp = client.post("/api/instance/request-link",
                       json={"tenant_id": TENANT, "email": "parent@example.com"})
    assert resp.status_code == 200
    assert resp.json() == {"status": "ok"}


def test_request_link_still_200_on_upstream_outage(client, monkeypatch):
    # A genuine network-level failure (not a bad HTTP status -- an actual
    # httpx.RequestError, e.g. connection refused) must not break the
    # constant-200 invariant either. call_upstream turns this into an
    # HTTPException(502); request_link must swallow that too.
    import httpx

    def raise_request_error(method, url, **kwargs):
        raise httpx.ConnectError("connection refused")

    monkeypatch.setattr("app.upstream.httpx.request", raise_request_error)
    resp = client.post("/api/instance/request-link",
                       json={"tenant_id": TENANT, "email": "parent@example.com"})
    assert resp.status_code == 200
    assert resp.json() == {"status": "ok"}


def test_request_link_is_rate_limited(client, fake_http):
    fake_http.add("POST", f"/internal/workflows/{TENANT}/request-link", FakeResponse(200, {}))
    for _ in range(10):
        assert client.post("/api/instance/request-link",
                           json={"tenant_id": TENANT, "email": "p@example.com"}).status_code == 200
    throttled = client.post("/api/instance/request-link",
                            json={"tenant_id": TENANT, "email": "p@example.com"})
    assert throttled.status_code == 429
