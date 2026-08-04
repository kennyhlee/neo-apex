"""Document proxy route guards, happy paths, and the `uploaded_by`
derivation property (Task 10 Part A — the one sanctioned backend change in
Plan 4)."""
import httpx
import pytest
import respx
from fastapi.testclient import TestClient

from app.auth import require_authenticated_user
from app.config import settings
from app.main import app


def override_user(tenant="acme", role="admin", user_id="u1"):
    def f():
        return {"user_id": user_id, "tenant_id": tenant, "role": role, "_token": "Bearer x"}

    return f


@pytest.fixture
def as_user():
    def _as(tenant="acme", role="admin", user_id="u1"):
        app.dependency_overrides[require_authenticated_user] = override_user(
            tenant, role, user_id)
        return TestClient(app)

    yield _as
    app.dependency_overrides.clear()


# ── POST /api/documents/{tenant_id} ────────────────────────────────────────

VALID_BODY = {
    "application_id": "RA260001",
    "item_id": "AI260007",
    "filename": "transcript.pdf",
    "content_type": "application/pdf",
    "size": 1024,
    "sensitive": False,
}


def test_create_document_requires_auth():
    resp = TestClient(app).post("/api/documents/acme", json=VALID_BODY)
    assert resp.status_code == 401


def test_create_document_cross_tenant_403(as_user):
    resp = as_user(tenant="acme").post("/api/documents/globex", json=VALID_BODY)
    assert resp.status_code == 403


def test_create_document_parent_role_403(as_user):
    resp = as_user(role="parent").post("/api/documents/acme", json=VALID_BODY)
    assert resp.status_code == 403


@respx.mock
def test_create_document_happy_path(as_user):
    route = respx.post(f"{settings.datacore_url}/api/documents/acme").mock(
        return_value=httpx.Response(201, json={
            "document_id": "DOC260001",
            "upload_url": "https://r2.example.com/put/DOC260001",
            "storage_key": "acme/RA260001/DOC260001/transcript.pdf",
        })
    )
    resp = as_user(tenant="acme", user_id="staff-42").post(
        "/api/documents/acme", json=VALID_BODY)
    assert resp.status_code == 201
    body = resp.json()
    assert body["document_id"] == "DOC260001"
    assert body["upload_url"] == "https://r2.example.com/put/DOC260001"

    # The outgoing DataCore payload carries the derived staff user_id.
    sent = route.calls[0].request
    import json as _json
    sent_body = _json.loads(sent.content)
    assert sent_body["uploaded_by"] == "staff-42"
    assert sent_body["application_id"] == "RA260001"
    assert sent_body["item_id"] == "AI260007"


@respx.mock
def test_create_document_ignores_client_supplied_uploaded_by(as_user):
    """A client that sends `uploaded_by` in the body must not have it
    forwarded — the proxy always derives it from the authenticated caller.
    This is the property Plan 5's parent-download access control depends on."""
    route = respx.post(f"{settings.datacore_url}/api/documents/acme").mock(
        return_value=httpx.Response(201, json={
            "document_id": "DOC260002",
            "upload_url": "https://r2.example.com/put/DOC260002",
            "storage_key": "acme/RA260001/DOC260002/transcript.pdf",
        })
    )
    spoofed_body = {**VALID_BODY, "uploaded_by": "parent:RA999999"}
    resp = as_user(tenant="acme", user_id="staff-42").post(
        "/api/documents/acme", json=spoofed_body)
    assert resp.status_code == 201

    import json as _json
    sent_body = _json.loads(route.calls[0].request.content)
    assert sent_body["uploaded_by"] == "staff-42"
    assert sent_body["uploaded_by"] != "parent:RA999999"


@respx.mock
def test_create_document_propagates_datacore_4xx(as_user):
    """The POST side must forward DataCore's status code, mirroring
    test_get_document_url_not_found_propagates_404 on the GET side. The status
    is what lets a caller tell a bad request apart from an outage."""
    respx.post(f"{settings.datacore_url}/api/documents/acme").mock(
        return_value=httpx.Response(422, json={"detail": "size must be positive"})
    )
    resp = as_user(tenant="acme").post("/api/documents/acme", json=VALID_BODY)
    assert resp.status_code == 422


@respx.mock
def test_create_document_does_not_leak_datacore_error_body(as_user):
    """The status code crosses the boundary; the body does not. DataCore's
    error text is an internal detail (storage keys, upstream hosts, model
    field names) and this proxy is where it stops — it is logged, and the
    client gets a stable message."""
    respx.post(f"{settings.datacore_url}/api/documents/acme").mock(
        return_value=httpx.Response(
            500, text="Traceback: r2 bucket acme-private/secret-key unreachable")
    )
    resp = as_user(tenant="acme").post("/api/documents/acme", json=VALID_BODY)
    assert resp.status_code == 500
    assert "secret-key" not in resp.text
    assert "Traceback" not in resp.text


# ── GET /api/documents/{tenant_id}/{document_id}/url ───────────────────────

def test_get_document_url_requires_auth():
    resp = TestClient(app).get("/api/documents/acme/DOC260001/url")
    assert resp.status_code == 401


def test_get_document_url_cross_tenant_403(as_user):
    resp = as_user(tenant="acme").get("/api/documents/globex/DOC260001/url")
    assert resp.status_code == 403


def test_get_document_url_parent_role_403(as_user):
    resp = as_user(role="parent").get("/api/documents/acme/DOC260001/url")
    assert resp.status_code == 403


@respx.mock
def test_get_document_url_happy_path(as_user):
    respx.get(f"{settings.datacore_url}/api/documents/acme/DOC260001/url").mock(
        return_value=httpx.Response(200, json={
            "download_url": "https://r2.example.com/get/DOC260001",
        })
    )
    resp = as_user(tenant="acme").get("/api/documents/acme/DOC260001/url")
    assert resp.status_code == 200
    assert resp.json()["download_url"] == "https://r2.example.com/get/DOC260001"


@respx.mock
def test_get_document_url_not_found_propagates_404(as_user):
    respx.get(f"{settings.datacore_url}/api/documents/acme/DOC-missing/url").mock(
        return_value=httpx.Response(404, json={"detail": "Document not found"})
    )
    resp = as_user(tenant="acme").get("/api/documents/acme/DOC-missing/url")
    assert resp.status_code == 404
    # Status forwarded, body not — same boundary rule as the POST side.
    assert "Document not found" not in resp.text
