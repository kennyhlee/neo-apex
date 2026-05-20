"""Regression tests for POST /api/tenants/{tenant_id}/finalize/commit.

Pins the contract that custom-field renames flow from the request payload
straight into the model definition sent to DataCore.
"""
from unittest.mock import MagicMock, patch

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.models.registry import UserRecord

client = TestClient(app)

FAKE_USER = UserRecord(
    user_id="u1",
    name="Test Admin",
    email="admin@test.com",
    password_hash="",
    tenant_id="t1",
    tenant_name="Test Tenant",
    role="admin",
    created_at="",
)


@pytest.fixture(autouse=True)
def mock_auth():
    """Bypass auth for all tests using FastAPI dependency override."""
    from app.api.auth import require_admin

    app.dependency_overrides[require_admin] = lambda: FAKE_USER
    yield
    app.dependency_overrides.pop(require_admin, None)


def _payload_with_renamed_custom_field() -> dict:
    """A finalize payload with one custom field renamed away from any LLM default."""
    return {
        "extraction": {
            "extraction_id": "e1",
            "tenant_id": "t1",
            "filename": "app.pdf",
            "entities": [
                {
                    "entity_type": "student",
                    "entity": {
                        "first_name": "Sam",
                        "date_of_birth": "2010-01-01",
                        "custom_fields": {"date_of_birth": "2010-01-01"},
                    },
                    "field_mappings": [
                        {
                            "field_name": "first_name",
                            "value": "Sam",
                            "source": "base_model",
                            "required": True,
                            "field_type": "str",
                        },
                        {
                            "field_name": "date_of_birth",
                            "value": "2010-01-01",
                            "source": "custom_field",
                            "required": False,
                            "field_type": "date",
                        },
                    ],
                }
            ],
            "status": "pending_review",
        }
    }


def _datacore_response_payload(model_definition: dict) -> dict:
    """Shape that `finalize_commit` expects back from DataCore."""
    return {
        "status": "ok",
        "version": 1,
        "model_definition": model_definition,
        "source_filename": "app.pdf",
        "created_by": "Test Admin",
        "created_at": "2026-05-16T00:00:00Z",
    }


def test_renamed_custom_field_is_passed_through_to_datacore():
    """Frontend rename must reach DataCore's model_definition payload verbatim."""
    captured: dict = {}

    def fake_put(url, *, json, timeout):  # noqa: ARG001 - signature matches httpx.put
        captured["url"] = url
        captured["json"] = json
        mock_resp = MagicMock()
        mock_resp.status_code = 200
        mock_resp.json.return_value = _datacore_response_payload(
            json["model_definition"]
        )
        return mock_resp

    with patch("app.api.finalize.httpx.put", side_effect=fake_put):
        resp = client.post(
            "/api/tenants/t1/finalize/commit",
            json=_payload_with_renamed_custom_field(),
        )

    assert resp.status_code == 200, resp.text

    # The renamed custom field reached DataCore under its new name.
    sent_model = captured["json"]["model_definition"]
    assert "student" in sent_model, sent_model
    student = sent_model["student"]

    custom_names = [f["name"] for f in student["custom_fields"]]
    base_names = [f["name"] for f in student["base_fields"]]

    assert "date_of_birth" in custom_names, custom_names
    # Critically: no trace of the LLM-default name anywhere.
    assert "dob" not in custom_names, custom_names
    assert "dob" not in base_names, base_names

    # And the renamed field's other properties were preserved.
    renamed = next(f for f in student["custom_fields"] if f["name"] == "date_of_birth")
    assert renamed["type"] == "date"
    assert renamed["required"] is False


def test_finalize_rejects_tenant_mismatch():
    """Sanity: the existing tenant guard still works with the test setup."""
    bad = _payload_with_renamed_custom_field()
    bad["extraction"]["tenant_id"] = "other_tenant"
    resp = client.post("/api/tenants/t1/finalize/commit", json=bad)
    assert resp.status_code == 400, resp.text


def _payload_with_tenant_entity(
    tenant_base: dict | None = None,
    tenant_custom: dict | None = None,
) -> dict:
    """Build a finalize payload whose extraction includes a TENANT entity.

    `tenant_base` and `tenant_custom` are dicts of field_name -> value.
    Each pair becomes a FieldMapping with the matching `source`.
    """
    tenant_base = tenant_base or {}
    tenant_custom = tenant_custom or {}
    mappings = []
    for name, value in tenant_base.items():
        mappings.append({
            "field_name": name, "value": value, "source": "base_model",
            "required": False, "field_type": "str",
        })
    for name, value in tenant_custom.items():
        mappings.append({
            "field_name": name, "value": value, "source": "custom_field",
            "required": False, "field_type": "str",
        })
    return {
        "extraction": {
            "extraction_id": "e1",
            "tenant_id": "t1",
            "filename": "app.pdf",
            "entities": [
                {
                    "entity_type": "TENANT",
                    "entity": {},  # mapper produces this; splitter doesn't read it
                    "field_mappings": mappings,
                }
            ],
            "status": "pending_review",
        }
    }


def test_finalize_persists_extracted_tenant_when_row_empty():
    """Happy path: no existing tenant row → PUT the merged extracted values."""
    put_calls: list[dict] = []

    def fake_put(url, *, json, timeout):  # noqa: ARG001
        put_calls.append({"url": url, "json": json})
        mock_resp = MagicMock()
        mock_resp.status_code = 200
        if "/models/" in url:
            mock_resp.json.return_value = _datacore_response_payload(
                json.get("model_definition") or {}
            )
        else:
            mock_resp.json.return_value = {}
        return mock_resp

    def fake_post(url, *, json, timeout):  # noqa: ARG001
        mock_resp = MagicMock()
        mock_resp.status_code = 200
        mock_resp.json.return_value = {"data": [], "total": 0}
        return mock_resp

    with patch("app.api.finalize.httpx.put", side_effect=fake_put), \
         patch("app.api.finalize.httpx.post", side_effect=fake_post) as mock_post:
        resp = client.post(
            "/api/tenants/t1/finalize/commit",
            json=_payload_with_tenant_entity(
                tenant_base={"name": "Acme"},
                tenant_custom={"school_district_code": "DC-100"},
            ),
        )

    assert resp.status_code == 200, resp.text

    # Exactly two PUTs: models first, tenants second
    assert len(put_calls) == 2, put_calls
    assert "/models/t1" in put_calls[0]["url"]
    assert put_calls[1]["url"].endswith("/tenants/t1")
    assert put_calls[1]["json"] == {
        "base_data": {"name": "Acme"},
        "custom_fields": {"school_district_code": "DC-100"},
    }

    # And we read existing first
    assert mock_post.call_count == 1
