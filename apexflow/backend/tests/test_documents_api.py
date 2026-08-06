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

`test_create_document_derives_sensitive_*` (final-review fix wave, finding
I1): the mirror image of `test_internal_api.py`'s
`test_token_document_sensitive_derived_from_definition_not_client` /
`test_token_document_sensitive_defaults_false_when_item_unresolvable`, for
this staff surface -- `sensitive` must be derived from the pinned
definition, never trusted from the client, here too.
"""
import json

import pytest
from fastapi.testclient import TestClient

from app.auth import require_authenticated_user
from app.main import app
from app.workflows import engine

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


def _machine():
    return {
        "states": [
            {"state_id": "draft", "name": "Draft", "kind": "initial"},
            {"state_id": "submitted", "name": "Submitted", "kind": "terminal"},
        ],
        "transitions": [
            {
                "transition_id": "t_submit",
                "from": "draft", "to": "submitted", "action": "submit", "actor": "family",
                "guards": [], "effects": [],
            },
        ],
    }


def _docs_steps():
    return [
        {
            "step_id": "docs_step", "type": "documents", "title": "Required documents",
            "required": True, "blocking": True, "available_in": ["draft"], "show_if": None,
            "review": None,
            "config": {"docs": [{"name": "Immunization Record", "sensitive": True}]},
        },
    ]


def _seed_docs_definition(fake_dc, *, definition_id="wd-docs-1"):
    base = {
        "definition_id": definition_id,
        "name": "Enrollment",
        "version": 1,
        "status": "published",
        "lineage_status": "active",
        "channel_access": "staff",
        "machine": json.dumps(_machine()),
        "steps": json.dumps(_docs_steps()),
    }
    created = fake_dc.dc_create(TENANT, "workflow_definition", base)
    return created["entity_id"]


def test_create_document_derives_sensitive_from_definition_not_client(client, fake_dc, monkeypatch):
    """The point of this fix: `sensitive` is no longer a client-trusted
    field on the staff surface either. The client explicitly lies
    (`sensitive: False`) about an item bound to a definition doc entry
    marked `sensitive: True` -- the DataCore create call must still carry
    `sensitive: True`, derived server-side from the pinned definition."""
    definition_id = "wd-docs-1"
    _seed_docs_definition(fake_dc, definition_id=definition_id)
    result = engine.create_instance(TENANT, definition_id, {}, "staff")
    instance_eid = result["instance"]["entity_id"]
    item_eid = next(
        i["entity_id"] for i in result["items"] if i["base_data"]["title"] == "Immunization Record"
    )

    captured = {}

    class FakeResp:
        status_code = 201
        text = ""

        def json(self):
            return {"document_id": "DC-1", "upload_url": "https://x/upload", "storage_key": "k"}

    def fake_request(method, url, json=None, headers=None, timeout=None):
        captured["json"] = json
        return FakeResp()

    monkeypatch.setattr("app.api.documents.httpx.request", fake_request)

    resp = client.post(f"/api/documents/{TENANT}", json={
        "instance_id": instance_eid, "item_id": item_eid, "filename": "shots.pdf",
        "content_type": "application/pdf", "size": 10,
        "sensitive": False,  # client lies; must be ignored
    })
    assert resp.status_code == 201
    assert captured["json"]["sensitive"] is True


def test_create_document_sensitive_defaults_false_when_unresolvable(client, fake_dc, monkeypatch):
    """No `item_id` at all, AND an `instance_id` that doesn't resolve to any
    `workflow_instance` row -- `_derive_sensitive_for_staff` must default to
    `False`, not error, and must NOT trust a client-supplied `sensitive:
    True` either (a free-standing staff upload with no bound item, e.g. an
    ad hoc attachment, is the common real case this covers)."""
    captured = {}

    class FakeResp:
        status_code = 201
        text = ""

        def json(self):
            return {"document_id": "DC-1", "upload_url": "https://x/upload", "storage_key": "k"}

    def fake_request(method, url, json=None, headers=None, timeout=None):
        captured["json"] = json
        return FakeResp()

    monkeypatch.setattr("app.api.documents.httpx.request", fake_request)

    resp = client.post(f"/api/documents/{TENANT}", json={
        "instance_id": "no-such-instance", "filename": "x.pdf",
        "content_type": "application/pdf", "size": 10,
        "sensitive": True,  # client lies the other way
    })
    assert resp.status_code == 201
    assert captured["json"]["sensitive"] is False


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
