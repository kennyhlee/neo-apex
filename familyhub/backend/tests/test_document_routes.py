# familyhub/backend/tests/test_document_routes.py
"""Token-scoped document facade: upload presign + download URLs.

Task 10 retarget (see app/api/documents.py's module docstring): this route
used to validate the token, resolve items, and derive `uploaded_by`/
`sensitive` itself before calling DataCore directly. All of that now lives
in apexflow's `/internal/instance-by-token/{token}/documents*` routes
(apexflow/backend/app/api/internal.py) -- this module is a thin proxy that
does local, network-free validation (content type, size, token shape) and
otherwise forwards. These tests therefore focus on: local validation still
works without any upstream call, the proxy forwards to the right apexflow
path, and the 4xx-verbatim/5xx-masked relay policy holds.
"""
import base64
import json

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.ratelimit import document_presign_limiter, request_link_limiter, start_limiter


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
    document_presign_limiter._hits.clear()
    yield


@pytest.fixture
def client():
    return TestClient(app)


TENANT = "acme"
INSTANCE_EID = "wi-1"
# Real token shape: urlsafe-b64("{tenant}.{instance_entity_id}.{sig}"),
# padding stripped -- `parse_token` (app/tokenutil.py) is decode-only, so a
# fake signature is fine; the facade never verifies it itself.
TOKEN = base64.urlsafe_b64encode(
    f"{TENANT}.{INSTANCE_EID}.fakesignature".encode()).decode().rstrip("=")


# --------------------------------------------------------------------------
# Upload presign
# --------------------------------------------------------------------------

def test_upload_proxies_to_apexflow_token_scoped_route(client, fake_http):
    fake_http.add("POST", f"/internal/instance-by-token/{TOKEN}/documents",
                  FakeResponse(201, {"document_id": "DC0005",
                                     "upload_url": "https://r2.example/put",
                                     "storage_key": f"{TENANT}/wi-1/DC0005/shots.pdf"}))
    resp = client.post(f"/api/application/{TOKEN}/documents",
                       json={"item_id": "item-eid-docs", "filename": "shots.pdf",
                             "content_type": "application/pdf", "size": 12345})
    assert resp.status_code == 201
    assert resp.json()["upload_url"] == "https://r2.example/put"

    call = fake_http.calls[0]
    assert call["url"].endswith(f"/internal/instance-by-token/{TOKEN}/documents")
    assert call["headers"]["X-Internal-Key"] == "test-internal-key"
    sent = call["json"]
    assert sent["item_id"] == "item-eid-docs"
    assert sent["filename"] == "shots.pdf"
    # `uploaded_by` is never sent by this facade at all -- apexflow derives
    # it server-side from the token. A client-supplied value in the request
    # body is silently dropped by pydantic's extra="ignore" before it could
    # ever reach here.
    assert "uploaded_by" not in sent


def test_upload_ignores_client_supplied_uploaded_by(client, fake_http):
    """THE test: a spoofed uploaded_by must not reach the outbound payload
    at all -- asserts the SERIALIZED OUTBOUND BODY, which is the only thing
    that matters."""
    fake_http.add("POST", f"/internal/instance-by-token/{TOKEN}/documents",
                  FakeResponse(201, {"document_id": "DC0005",
                                     "upload_url": "https://r2.example/put",
                                     "storage_key": "k"}))
    resp = client.post(
        f"/api/application/{TOKEN}/documents",
        json={"item_id": "item-eid-docs", "filename": "shots.pdf",
              "content_type": "application/pdf", "size": 100,
              "uploaded_by": "family:some-other-instance",
              "sensitive": False, "storage_key": "../../etc/passwd"},
    )
    assert resp.status_code == 201
    sent = fake_http.calls[0]["json"]
    assert "uploaded_by" not in sent
    assert "sensitive" not in sent
    assert "storage_key" not in sent
    assert "family:some-other-instance" not in json.dumps(sent)


def test_upload_without_item_id(client, fake_http):
    fake_http.add("POST", f"/internal/instance-by-token/{TOKEN}/documents",
                  FakeResponse(201, {"document_id": "DC0006", "upload_url": "u", "storage_key": "k"}))
    resp = client.post(f"/api/application/{TOKEN}/documents",
                       json={"filename": "misc.pdf", "content_type": "application/pdf", "size": 10})
    assert resp.status_code == 201
    sent = fake_http.calls[0]["json"]
    assert sent["item_id"] is None


def test_upload_rejects_disallowed_content_type(client, fake_http):
    resp = client.post(f"/api/application/{TOKEN}/documents",
                       json={"filename": "x.exe", "content_type": "application/x-msdownload",
                             "size": 10})
    assert resp.status_code == 415
    assert fake_http.calls == []


def test_upload_rejects_oversize(client, fake_http):
    resp = client.post(f"/api/application/{TOKEN}/documents",
                       json={"filename": "x.pdf", "content_type": "application/pdf",
                             "size": 21 * 1024 * 1024})
    assert resp.status_code == 413
    assert fake_http.calls == []


def test_upload_rejects_non_positive_size(client, fake_http):
    resp = client.post(f"/api/application/{TOKEN}/documents",
                       json={"filename": "x.pdf", "content_type": "application/pdf", "size": 0})
    assert resp.status_code == 400
    assert fake_http.calls == []


def test_upload_with_invalid_token_passthrough(client, fake_http):
    """apexflow's resolve_token answers a UNIFORM 401 for every failure mode
    (coordinator review fix: a 403 for "scope doesn't resolve" vs. 401 for
    "signature/version wrong" would be an existence oracle -- this route has
    no auth of its own). Relayed verbatim."""
    fake_http.add("POST", f"/internal/instance-by-token/{TOKEN}/documents",
                  FakeResponse(401, {"detail": "Invalid or revoked link"}))
    resp = client.post(f"/api/application/{TOKEN}/documents",
                       json={"filename": "x.pdf", "content_type": "application/pdf", "size": 10})
    assert resp.status_code == 401


def test_upload_masks_apexflow_500(client, fake_http):
    fake_http.add("POST", f"/internal/instance-by-token/{TOKEN}/documents",
                  FakeResponse(500, {"detail": "Traceback (most recent call last): ..."}))
    resp = client.post(f"/api/application/{TOKEN}/documents",
                       json={"filename": "x.pdf", "content_type": "application/pdf", "size": 10})
    assert resp.status_code == 502
    assert "Traceback" not in resp.text


def test_upload_is_rate_limited(client, fake_http):
    """The only token-scoped route that WRITES. Unthrottled, one valid token
    buys unbounded rows and bytes (the presigned PUT cannot enforce the
    declared size)."""
    fake_http.add("POST", f"/internal/instance-by-token/{TOKEN}/documents",
                  FakeResponse(201, {"document_id": "DC0009", "upload_url": "u", "storage_key": "k"}))
    payload = {"filename": "x.pdf", "content_type": "application/pdf", "size": 10}
    for _ in range(20):
        assert client.post(f"/api/application/{TOKEN}/documents",
                           json=payload).status_code == 201
    before = len(fake_http.calls)
    throttled = client.post(f"/api/application/{TOKEN}/documents", json=payload)
    assert throttled.status_code == 429
    # Refused by the dependency, so it cost no upstream call at all.
    assert len(fake_http.calls) == before


def test_upload_apexflow_error_body_is_never_relayed_verbatim_on_5xx(client, fake_http):
    fake_http.add("POST", f"/internal/instance-by-token/{TOKEN}/documents",
                  FakeResponse(502, {"detail": "Could not start the upload. Please try again."}))
    resp = client.post(f"/api/application/{TOKEN}/documents",
                       json={"filename": "x.pdf", "content_type": "application/pdf", "size": 10})
    assert resp.status_code == 502


def test_malformed_token_upload_costs_no_upstream_call(client, fake_http):
    resp = client.post("/api/application/not-a-real-token/documents",
                       json={"filename": "x.pdf", "content_type": "application/pdf", "size": 10})
    assert resp.status_code == 400
    assert fake_http.calls == []


def test_malformed_token_download_costs_no_upstream_call(client, fake_http):
    resp = client.get("/api/application/not-a-real-token/documents/DC0001/url")
    assert resp.status_code == 400
    assert fake_http.calls == []


# --------------------------------------------------------------------------
# Download URL
# --------------------------------------------------------------------------

def test_download_proxies_to_apexflow_token_scoped_route(client, fake_http):
    fake_http.add("GET", f"/internal/instance-by-token/{TOKEN}/documents/DC0001/url",
                  FakeResponse(200, {"download_url": "https://r2.example/get"}))
    resp = client.get(f"/api/application/{TOKEN}/documents/DC0001/url")
    assert resp.status_code == 200
    assert resp.json()["download_url"] == "https://r2.example/get"
    assert fake_http.calls[0]["headers"]["X-Internal-Key"] == "test-internal-key"


def test_download_forbidden_passthrough(client, fake_http):
    """apexflow enforces the sensitive/ownership rule server-side now; a 403
    from it is relayed verbatim (parent-safe: "not your document")."""
    fake_http.add("GET", f"/internal/instance-by-token/{TOKEN}/documents/DC0002/url",
                  FakeResponse(403, {"detail": "Not permitted to view this document"}))
    resp = client.get(f"/api/application/{TOKEN}/documents/DC0002/url")
    assert resp.status_code == 403


def test_download_not_found_passthrough(client, fake_http):
    fake_http.add("GET", f"/internal/instance-by-token/{TOKEN}/documents/DC9999/url",
                  FakeResponse(404, {"detail": "No such document on this instance"}))
    resp = client.get(f"/api/application/{TOKEN}/documents/DC9999/url")
    assert resp.status_code == 404


def test_download_masks_apexflow_500(client, fake_http):
    fake_http.add("GET", f"/internal/instance-by-token/{TOKEN}/documents/DC0001/url",
                  FakeResponse(500, {"detail": "presign failed for bucket neoapex-prod"}))
    resp = client.get(f"/api/application/{TOKEN}/documents/DC0001/url")
    assert resp.status_code == 502
    assert "neoapex-prod" not in resp.text


def test_download_status_forwarded_but_body_replaced_on_5xx(client, fake_http):
    fake_http.add("GET", f"/internal/instance-by-token/{TOKEN}/documents/DC0001/url",
                  FakeResponse(502, {"detail": "That document is not available right now."}))
    resp = client.get(f"/api/application/{TOKEN}/documents/DC0001/url")
    assert resp.status_code == 502
