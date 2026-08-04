"""Document blob API: presigned R2 URLs + document entity records."""
import os
import tempfile
from unittest.mock import MagicMock

import pytest

# Fake R2 config BEFORE importing the app/module under test
os.environ.setdefault("DATACORE_R2_ENDPOINT", "https://test.r2.cloudflarestorage.com")
os.environ.setdefault("DATACORE_R2_BUCKET", "neoapex-test")
os.environ.setdefault("DATACORE_R2_ACCESS_KEY_ID", "testkey")
os.environ.setdefault("DATACORE_R2_SECRET_ACCESS_KEY", "testsecret")

from fastapi.testclient import TestClient

from datacore import Store
from datacore.api import create_app
from datacore.documents import build_storage_key, presign_upload, presign_download


# ---------------------------------------------------------------------------
# Presigning (pure local crypto — no network)
# ---------------------------------------------------------------------------

def test_storage_key_is_tenant_prefixed():
    key = build_storage_key("acme", "RA260001", "DOC1", "immunization.pdf")
    assert key == "acme/RA260001/DOC1/immunization.pdf"


def test_presign_upload_returns_scoped_url():
    url = presign_upload("acme/RA260001/DOC1/immunization.pdf", "application/pdf")
    assert "acme/RA260001/DOC1/immunization.pdf" in url
    assert "X-Amz-Signature" in url


def test_presign_download_returns_scoped_url():
    url = presign_download("acme/RA260001/DOC1/immunization.pdf")
    assert "acme/RA260001/DOC1/immunization.pdf" in url
    assert "X-Amz-Signature" in url


# ---------------------------------------------------------------------------
# Endpoint tests
# ---------------------------------------------------------------------------

@pytest.fixture
def doc_client():
    with tempfile.TemporaryDirectory() as tmp:
        mock_embedder = MagicMock()
        mock_embedder.embed.return_value = [0.0] * 1024
        store = Store(data_dir=tmp, embedder=mock_embedder)
        app = create_app(store)
        client = TestClient(app)
        client.put(
            "/api/tenants/acme",
            json={
                "base_data": {
                    "tenant_id": "acme",
                    "name": "Acme Child Center",
                    "primary_address": "123 Main St",
                },
            },
        )
        yield client, store


def _post_document(client, **overrides):
    body = {
        "application_id": "RA260001",
        "item_id": "AI260001",
        "filename": "immunization.pdf",
        "content_type": "application/pdf",
        "size": 1024,
        "sensitive": True,
    }
    body.update(overrides)
    return client.post("/api/documents/acme", json=body)


def test_create_document_returns_201_with_document_id_and_upload_url(doc_client):
    client, _ = doc_client
    resp = _post_document(client)
    assert resp.status_code == 201
    data = resp.json()
    assert data["document_id"].startswith("ACC-DC")
    assert "upload_url" in data
    assert "X-Amz-Signature" in data["upload_url"]
    assert data["storage_key"] == f"acme/RA260001/{data['document_id']}/immunization.pdf"


def test_create_document_writes_entity_through_shared_store_path(doc_client):
    client, store = doc_client
    resp = _post_document(client)
    document_id = resp.json()["document_id"]

    entity = store.get_active_entity("acme", "document", document_id)
    assert entity is not None
    assert entity["base_data"]["application_id"] == "RA260001"
    assert entity["base_data"]["filename"] == "immunization.pdf"
    assert entity["base_data"]["content_type"] == "application/pdf"
    assert entity["base_data"]["size"] == 1024
    assert entity["base_data"]["sensitive"] is True
    assert entity["base_data"]["storage_key"] == resp.json()["storage_key"]


def test_document_ids_are_sequential(doc_client):
    client, _ = doc_client
    r1 = _post_document(client, filename="a.pdf")
    r2 = _post_document(client, filename="b.pdf")
    assert r1.json()["document_id"].endswith("0001")
    assert r2.json()["document_id"].endswith("0002")


def test_get_document_url_after_post(doc_client):
    client, _ = doc_client
    post_resp = _post_document(client)
    document_id = post_resp.json()["document_id"]

    resp = client.get(f"/api/documents/acme/{document_id}/url")
    assert resp.status_code == 200
    data = resp.json()
    assert "download_url" in data
    assert "X-Amz-Signature" in data["download_url"]
    assert post_resp.json()["storage_key"].split("/")[-1] in data["download_url"]


def test_get_document_url_unknown_id_returns_404(doc_client):
    client, _ = doc_client
    resp = client.get("/api/documents/acme/NOPE-0001/url")
    assert resp.status_code == 404


def test_create_document_rejects_disallowed_content_type(doc_client):
    client, _ = doc_client
    resp = _post_document(client, content_type="application/zip")
    assert resp.status_code == 400


def test_create_document_rejects_oversized_file(doc_client):
    client, _ = doc_client
    resp = _post_document(client, size=21 * 1024 * 1024)
    assert resp.status_code == 413


@pytest.mark.parametrize("bad_filename", [
    "../../othertenant/evil.pdf",
    "..%2fevil.pdf".replace("%2f", "/"),
    "sub/dir/evil.pdf",
    "..",
    "/etc/passwd",
])
def test_create_document_rejects_path_traversal_filename(doc_client, bad_filename):
    client, _ = doc_client
    resp = _post_document(client, filename=bad_filename)
    assert resp.status_code == 400
