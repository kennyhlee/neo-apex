# familyhub/backend/tests/test_application_routes.py
"""Token-scoped application facade: hub bundle, action allowlist,
constant-200 request-link, checkout.

Task 10: GET/PUT `/api/application/{token}` and request-link retarget from
enrollx's `/internal/application-by-token/*` / `/internal/registration/*` to
apexflow's `/internal/instance-by-token/*` / `/internal/workflows/*`.
Checkout is the ONE call site NOT retargeted (apexflow has no payments
surface in Plan 1) -- it still uses `enrollx_internal_key`, so this file
keeps BOTH internal-key fixtures patched.
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
    monkeypatch.setattr(settings, "enrollx_internal_key", "test-enrollx-key")


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
}


def test_hub_bundle_passthrough(client, fake_http):
    fake_http.add("GET", f"/internal/instance-by-token/{TOKEN}", FakeResponse(200, HUB_BUNDLE))
    resp = client.get(f"/api/application/{TOKEN}")
    assert resp.status_code == 200
    assert resp.json()["instance"]["entity_id"] == "wi-1"
    assert fake_http.calls[0]["headers"]["X-Internal-Key"] == "test-internal-key"


def test_hub_bundle_expired_token_passthrough(client, fake_http):
    fake_http.add("GET", f"/internal/instance-by-token/{TOKEN}",
                  FakeResponse(401, {"detail": "Invalid or revoked link"}))
    resp = client.get(f"/api/application/{TOKEN}")
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
    resp = client.get(f"/api/application/{TOKEN}")
    assert resp.status_code == 401
    assert resp.json() == {"detail": "Invalid or revoked link"}


def test_hub_bundle_masks_upstream_500(client, fake_http):
    fake_http.add("GET", f"/internal/instance-by-token/{TOKEN}",
                  FakeResponse(500, {"detail": "Traceback (most recent call last): ..."}))
    resp = client.get(f"/api/application/{TOKEN}")
    assert resp.status_code == 502
    assert "Traceback" not in resp.text


def test_allowed_parent_action_is_proxied(client, fake_http):
    fake_http.add("POST", f"/internal/instance-by-token/{TOKEN}/actions",
                  FakeResponse(200, {"instance": {"state": "draft"}}))
    resp = client.put(f"/api/application/{TOKEN}",
                      json={"action": "save_draft", "section_answers": {"s1": {"child_name": "Mei"}}})
    assert resp.status_code == 200
    sent = fake_http.calls[0]["json"]
    assert sent["action"] == "save_draft"


def test_withdraw_action_is_proxied(client, fake_http):
    """Coordinator review fix: `withdraw` is an `actor: "family"` transition
    the enrollment template declares (and apexflow's machine allows any
    family-permitted transition through the token-scoped actions route) --
    PARENT_ACTIONS was missing it, which 403'd a real, apexflow-legal action
    before it ever reached the network."""
    fake_http.add("POST", f"/internal/instance-by-token/{TOKEN}/actions",
                  FakeResponse(200, {"instance": {"state": "withdrawn"}}))
    resp = client.put(f"/api/application/{TOKEN}", json={"action": "withdraw"})
    assert resp.status_code == 200
    assert fake_http.calls[0]["json"]["action"] == "withdraw"


def test_action_masks_upstream_500(client, fake_http):
    fake_http.add("POST", f"/internal/instance-by-token/{TOKEN}/actions",
                  FakeResponse(500, {"detail": "DataCore write failed: connection reset by peer"}))
    resp = client.put(f"/api/application/{TOKEN}", json={"action": "submit"})
    assert resp.status_code == 502
    assert "DataCore" not in resp.text


@pytest.mark.parametrize("action", [
    "approve", "decline", "request_changes", "verify_item", "reject_item",
    "waive_item", "cancel_instance", "record_offline_payment", "promote_waitlist",
    "publish_config", "resend_link", "delete_everything", "", None,
    ["save_draft"], {"action": "save_draft"},
])
def test_staff_or_unknown_actions_are_403_before_any_proxying(client, fake_http, action):
    resp = client.put(f"/api/application/{TOKEN}", json={"action": action})
    assert resp.status_code == 403
    assert fake_http.calls == []  # THE critical assertion: nothing reached apexflow


def test_non_object_body_is_400(client, fake_http):
    resp = client.put(f"/api/application/{TOKEN}", json=["not", "a", "dict"])
    assert resp.status_code == 400
    assert fake_http.calls == []


def test_request_link_match_and_no_match_are_indistinguishable(client, fake_http):
    fake_http.add("POST", f"/internal/workflows/{TENANT}/request-link", FakeResponse(200, {}))
    matched = client.post("/api/application/request-link",
                          json={"tenant_id": TENANT, "email": "parent@example.com"})
    fake_http.routes.clear()
    fake_http.add("POST", f"/internal/workflows/{TENANT}/request-link", FakeResponse(200, {}))
    unmatched = client.post("/api/application/request-link",
                            json={"tenant_id": TENANT, "email": "stranger@example.com"})
    assert matched.status_code == unmatched.status_code == 200
    assert matched.json() == unmatched.json() == {"status": "ok"}


def test_request_link_forwards_only_the_email(client, fake_http):
    fake_http.add("POST", f"/internal/workflows/{TENANT}/request-link", FakeResponse(200, {}))
    resp = client.post("/api/application/request-link",
                       json={"tenant_id": TENANT, "email": "p@example.com"})
    assert resp.status_code == 200 and resp.json() == {"status": "ok"}
    sent = next(c for c in fake_http.calls if c["method"] == "POST")["json"]
    assert sent == {"email": "p@example.com"}


def test_request_link_upstream_error_is_still_200(client, fake_http):
    fake_http.add("POST", f"/internal/workflows/{TENANT}/request-link",
                  FakeResponse(500, {"detail": "boom"}))
    resp = client.post("/api/application/request-link",
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
    resp = client.post("/api/application/request-link",
                       json={"tenant_id": TENANT, "email": "parent@example.com"})
    assert resp.status_code == 200
    assert resp.json() == {"status": "ok"}


def test_request_link_is_rate_limited(client, fake_http):
    fake_http.add("POST", f"/internal/workflows/{TENANT}/request-link", FakeResponse(200, {}))
    for _ in range(10):
        assert client.post("/api/application/request-link",
                           json={"tenant_id": TENANT, "email": "p@example.com"}).status_code == 200
    throttled = client.post("/api/application/request-link",
                            json={"tenant_id": TENANT, "email": "p@example.com"})
    assert throttled.status_code == 429


# --- checkout: NOT retargeted -- still enrollx (module docstring) ----------


def test_checkout_still_uses_enrollx_and_its_own_internal_key(client, fake_http):
    fake_http.add("POST", f"/internal/application-by-token/{TOKEN}/checkout",
                  FakeResponse(200, {"checkout_url": "https://checkout.stripe.com/c/pay/cs_test"}))
    resp = client.post(f"/api/application/{TOKEN}/checkout")
    assert resp.status_code == 200
    assert "checkout_url" in resp.json()
    assert fake_http.calls[0]["headers"]["X-Internal-Key"] == "test-enrollx-key"


def test_checkout_forwards_optional_item_id(client, fake_http):
    fake_http.add("POST", f"/internal/application-by-token/{TOKEN}/checkout",
                  FakeResponse(200, {"checkout_url": "https://checkout.stripe.com/c/pay/cs_test"}))
    resp = client.post(f"/api/application/{TOKEN}/checkout", json={"item_id": "item-entity-1"})
    assert resp.status_code == 200
    assert fake_http.calls[0]["json"]["item_id"] == "item-entity-1"


def test_checkout_masks_upstream_500(client, fake_http):
    fake_http.add("POST", f"/internal/application-by-token/{TOKEN}/checkout",
                  FakeResponse(500, {"detail": "Stripe blew up with a raw traceback"}))
    resp = client.post(f"/api/application/{TOKEN}/checkout")
    assert resp.status_code == 502
    assert "Stripe blew up" not in resp.text
