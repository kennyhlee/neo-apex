# apexflow/backend/tests/test_documents_api.py
"""Route-level tests for the staff document blob proxy (Task 10):
`app/api/documents.py`.

Written first per TDD: `app.api.documents` does not exist yet at the time
these were drafted. Auth pattern follows test_definitions_api.py/
test_instances.py: override `require_authenticated_user` at the app level.

Covers task-10-brief.md Step 1's `uploaded_by` derivation requirement on the
staff surface (roadmap security rule: never accepted from the client), and
this surface's own error-relay convention (status forwarded, body masked) --
distinct from the token-scoped surface's uniform 502 masking (see
app/api/internal.py's module docstring, and app/api/documents.py's own).
"""
import pytest
from fastapi.testclient import TestClient

from app.auth import require_authenticated_user
from app.main import app

TENANT = "acme"


@pytest.fixture
def client(fake_dc):
    app.dependency_overrides[require_authenticated_user] = lambda: {
        "user_id": "staff-1", "tenant_id": TENANT, "role": "admin", "_token": "Bearer test-token",
    }
    yield TestClient(app)
    app.dependency_overrides.clear()


def test_create_document_derives_uploaded_by_and_ignores_client_value(client, fake_dc, monkeypatch):
    captured = {}

    class FakeResp:
        status_code = 201
        text = ""

        def json(self):
            return {"document_id": "DC-1", "upload_url": "https://x/upload", "storage_key": "k"}

    def fake_request(method, url, json=None, headers=None, timeout=None):
        captured["json"] = json
        captured["headers"] = headers
        return FakeResp()

    monkeypatch.setattr("app.api.documents.httpx.request", fake_request)

    resp = client.post(f"/api/documents/{TENANT}", json={
        "instance_id": "wd-instance-1", "filename": "x.pdf",
        "content_type": "application/pdf", "size": 10,
        "uploaded_by": "someone-else",  # must be silently dropped, never forwarded
    })
    assert resp.status_code == 201
    assert captured["json"]["uploaded_by"] == "staff-1"
    assert captured["json"]["application_id"] == "wd-instance-1"
    assert captured["headers"]["Authorization"] == "Bearer test-token"


def test_create_document_forwards_status_but_masks_body(client, fake_dc, monkeypatch):
    class FakeResp:
        status_code = 500
        text = "internal DataCore trace naming a storage key"

    monkeypatch.setattr("app.api.documents.httpx.request", lambda *a, **k: FakeResp())

    resp = client.post(f"/api/documents/{TENANT}", json={
        "instance_id": "wd-instance-1", "filename": "x.pdf",
        "content_type": "application/pdf", "size": 10,
    })
    assert resp.status_code == 500
    assert "internal DataCore trace" not in resp.text


def test_get_document_url(client, fake_dc, monkeypatch):
    class FakeResp:
        status_code = 200

        def json(self):
            return {"download_url": "https://x/download"}

    monkeypatch.setattr("app.api.documents.httpx.request", lambda *a, **k: FakeResp())

    resp = client.get(f"/api/documents/{TENANT}/DC-1/url")
    assert resp.status_code == 200
    assert resp.json()["download_url"] == "https://x/download"


def test_get_document_url_forwards_404(client, fake_dc, monkeypatch):
    class FakeResp:
        status_code = 404
        text = "Document not found"

    monkeypatch.setattr("app.api.documents.httpx.request", lambda *a, **k: FakeResp())

    resp = client.get(f"/api/documents/{TENANT}/DC-nope/url")
    assert resp.status_code == 404


def test_create_document_requires_staff_auth(fake_dc):
    client = TestClient(app)  # no require_authenticated_user override
    resp = client.post(f"/api/documents/{TENANT}", json={
        "instance_id": "wd-1", "filename": "x.pdf", "content_type": "application/pdf", "size": 10,
    })
    assert resp.status_code == 401


def test_create_document_cross_tenant_403(client, fake_dc):
    resp = client.post("/api/documents/other-tenant", json={
        "instance_id": "wd-1", "filename": "x.pdf", "content_type": "application/pdf", "size": 10,
    })
    assert resp.status_code == 403
