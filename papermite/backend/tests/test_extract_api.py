"""Tests for POST /api/extract/{tenant_id}/{entity_type} endpoint."""
from unittest.mock import patch, MagicMock

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.config import TestUser

client = TestClient(app)

FAKE_USER = TestUser(
    user_id="u1",
    name="Test Admin",
    email="admin@test.com",
    password="pass",
    tenant_id="t1",
    tenant_name="Test Tenant",
    role="tenant_admin",
)


@pytest.fixture(autouse=True)
def mock_auth():
    """Bypass auth for all tests using FastAPI dependency override."""
    from app.api.auth import require_admin

    app.dependency_overrides[require_admin] = lambda: FAKE_USER
    yield
    app.dependency_overrides.pop(require_admin, None)


def _upload(tenant_id, entity_type, filename, content, content_type="application/pdf"):
    return client.post(
        f"/api/extract/{tenant_id}/{entity_type}",
        files={"file": (filename, content, content_type)},
    )


def test_unsupported_file_format():
    """Non-PDF/PNG/JPG/JPEG files return 422."""
    resp = _upload("t1", "student", "doc.docx", b"data", "application/msword")
    assert resp.status_code == 422
    assert "Unsupported" in resp.json()["detail"]


def test_model_not_found():
    """Returns 404 when no active model exists for tenant."""
    with patch("app.api.extract.get_active_model", return_value=None):
        resp = _upload("t1", "student", "app.pdf", b"%PDF-fake")
    assert resp.status_code == 404
    assert "model" in resp.json()["detail"].lower()


def test_entity_type_not_in_model():
    """Returns 404 when entity_type is not in the model definition."""
    fake_model = {
        "model_definition": {
            "student": {"base_fields": [], "custom_fields": []},
        }
    }
    with patch("app.api.extract.get_active_model", return_value=fake_model):
        resp = _upload("t1", "contact", "app.pdf", b"%PDF-fake")
    assert resp.status_code == 404
    assert "contact" in resp.json()["detail"].lower()


def test_successful_extraction():
    """Full pipeline returns extracted fields."""
    fake_model = {
        "model_definition": {
            "student": {
                "base_fields": [
                    {"name": "first_name", "type": "str", "required": True},
                    {"name": "last_name", "type": "str", "required": True},
                ],
                "custom_fields": [],
            }
        }
    }
    with (
        patch("app.api.extract.get_active_model", return_value=fake_model),
        patch("app.api.extract.parse_document", return_value="Student: Jane Doe"),
        patch(
            "app.api.extract.extract_fields",
            return_value={"first_name": "Jane", "last_name": "Doe"},
        ),
    ):
        resp = _upload("t1", "student", "app.pdf", b"%PDF-fake")
    assert resp.status_code == 200
    body = resp.json()
    assert body["fields"]["first_name"] == "Jane"
    assert body["fields"]["last_name"] == "Doe"


def test_partial_extraction_is_success():
    """Partial extraction returns 200 with whatever was found."""
    fake_model = {
        "model_definition": {
            "student": {
                "base_fields": [
                    {"name": "first_name", "type": "str", "required": True},
                    {"name": "last_name", "type": "str", "required": True},
                ],
                "custom_fields": [],
            }
        }
    }
    with (
        patch("app.api.extract.get_active_model", return_value=fake_model),
        patch("app.api.extract.parse_document", return_value="Applicant: Jane"),
        patch(
            "app.api.extract.extract_fields",
            return_value={"first_name": "Jane"},
        ),
    ):
        resp = _upload("t1", "student", "app.pdf", b"%PDF-fake")
    assert resp.status_code == 200
    assert resp.json()["fields"] == {"first_name": "Jane"}


def test_tenant_mismatch():
    """Returns 403 when tenant_id doesn't match user."""
    resp = _upload("wrong_tenant", "student", "app.pdf", b"%PDF-fake")
    assert resp.status_code == 403
