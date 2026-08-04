# familyhub/backend/tests/test_document_routes.py
"""Token-scoped document facade: upload presign + download URLs.

THE security property under test (DataCore's blob API has NO authorization
of any kind -- no Depends anywhere in document_routes.py -- so this facade
is the entire enforcement point):

1. `uploaded_by` is DERIVED from the token's application, never accepted
   from the client. Tests assert on the SERIALIZED OUTBOUND BODY, not just
   on a status code: a test that merely posts without the field proves
   nothing.
2. A parent may fetch a download URL ONLY for a document whose
   `uploaded_by == "parent:{their own application's entity_id}"`. Staff
   uploads carry the BARE DataCore user_id (fallback literal "staff") --
   there is no "staff:" prefix, so "not parent-prefixed" is the only safe
   reading, and every non-matching case must be refused BEFORE any presign
   call reaches DataCore.

Fixture shapes follow the bindings file, not the plan snippet:
- `/internal/application-by-token/{token}` returns FLATTENED DataCore rows
  (no `base_data` envelope) -- bindings §2, internal.py:123-130.
- `config.blocks` is a JSON STRING on the flattened row (engine.py:299,
  ApplicationEntryPage.tsx:106-108).
- documents from `/internal/.../documents` are flat dicts of
  {entity_id, document_id, filename, uploaded_by, item_id} (internal.py:155-161).
- The token's middle segment is the application's ENTITY_ID (tokens.py:3-4,
  minted from app_row["entity_id"] at internal.py:66), NOT the business
  RA-prefixed application_id.
"""
import base64
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


TENANT = "acme"
APP_EID = "app-eid-1"          # the application's DataCore entity_id
OTHER_APP_EID = "app-eid-999"  # some other family's application
DOC_ITEM_EID = "item-eid-docs"
FORM_ITEM_EID = "item-eid-form"

# Real token format: urlsafe-b64("{tenant}.{app_entity_id}.{sig}"), padding
# stripped. The facade decodes it ONLY to learn tenant/application, and only
# AFTER enrollx has verified the signature via the internal GET.
TOKEN = base64.urlsafe_b64encode(
    f"{TENANT}.{APP_EID}.fakesignature".encode()).decode().rstrip("=")

BLOCKS = [
    {"block_id": "b-docs", "type": "documents", "title": "Documents",
     "required": True, "blocking": True,
     "config": {"docs": [
         {"name": "Immunization record", "sensitive": True, "blocking": True},
         {"name": "Proof of address", "sensitive": False, "blocking": True},
     ]}},
]

HUB_BUNDLE = {
    "application": {"entity_id": APP_EID, "application_id": "RA260001",
                    "program_id": "PR0001", "status": "pending_items",
                    "token_version": 1},
    "items": [
        {"entity_id": DOC_ITEM_EID, "item_id": "AI0001", "application_id": APP_EID,
         "block_id": "b-docs", "kind": "document",
         "title": "Immunization record", "status": "not_started"},
        {"entity_id": "item-eid-docs-2", "item_id": "AI0003", "application_id": APP_EID,
         "block_id": "b-docs", "kind": "document",
         "title": "Proof of address", "status": "not_started"},
        {"entity_id": FORM_ITEM_EID, "item_id": "AI0002", "application_id": APP_EID,
         "block_id": "b-form", "kind": "form",
         "title": "Student information", "status": "verified"},
    ],
    # `blocks` arrives as a JSON string on the flattened DataCore row.
    "config": {"config_id": "RC0001", "program_id": "PR0001", "version": 1,
               "status": "published", "blocks": json.dumps(BLOCKS)},
}

DOCUMENTS = {
    "documents": [
        # Uploaded by THIS parent.
        {"entity_id": "DC0001", "document_id": "DC0001", "filename": "shots.pdf",
         "uploaded_by": f"parent:{APP_EID}", "item_id": DOC_ITEM_EID},
        # Uploaded by staff -- the BARE DataCore user_id, no "staff:" prefix.
        {"entity_id": "DC0002", "document_id": "DC0002", "filename": "staff-scan.pdf",
         "uploaded_by": "U42", "item_id": DOC_ITEM_EID},
        # Staff upload where DataCore had no user_id: the literal fallback.
        {"entity_id": "DC0003", "document_id": "DC0003", "filename": "note.pdf",
         "uploaded_by": "staff", "item_id": DOC_ITEM_EID},
        # A "parent:" tag belonging to a DIFFERENT application. Should not be
        # reachable in practice, but prefix-matching alone would let it through.
        {"entity_id": "DC0004", "document_id": "DC0004", "filename": "other.pdf",
         "uploaded_by": f"parent:{OTHER_APP_EID}", "item_id": DOC_ITEM_EID},
    ]
}


def _arm_token(fake_http, bundle=None, documents=None):
    # The /documents route must be registered FIRST: FakeHTTP matches by
    # substring in insertion order, and the bundle URL is a prefix of it.
    fake_http.add("GET", f"/internal/application-by-token/{TOKEN}/documents",
                  FakeResponse(200, DOCUMENTS if documents is None else documents))
    fake_http.add("GET", f"/internal/application-by-token/{TOKEN}",
                  FakeResponse(200, HUB_BUNDLE if bundle is None else bundle))


def _datacore_calls(fake_http):
    """Every call that reached DataCore's blob API (enrollx's internal
    documents listing lives under /internal/..., so it never matches)."""
    return [c for c in fake_http.calls if "/api/documents/" in c["url"]]


# --------------------------------------------------------------------------
# Upload presign
# --------------------------------------------------------------------------

def test_upload_derives_parent_uploaded_by_and_sensitive(client, fake_http):
    _arm_token(fake_http)
    fake_http.add("POST", f"/api/documents/{TENANT}",
                  FakeResponse(201, {"document_id": "DC0005",
                                     "upload_url": "https://r2.example/put",
                                     "storage_key": f"{TENANT}/{APP_EID}/DC0005/shots.pdf"}))
    resp = client.post(f"/api/application/{TOKEN}/documents",
                       json={"item_id": DOC_ITEM_EID, "filename": "shots.pdf",
                             "content_type": "application/pdf", "size": 12345})
    assert resp.status_code == 201
    assert resp.json()["upload_url"] == "https://r2.example/put"

    sent = _datacore_calls(fake_http)[0]["json"]
    assert sent["uploaded_by"] == f"parent:{APP_EID}"
    assert sent["application_id"] == APP_EID
    assert sent["item_id"] == DOC_ITEM_EID
    assert sent["sensitive"] is True  # from the config's docs entry
    assert sent["filename"] == "shots.pdf"


def test_upload_ignores_client_supplied_uploaded_by(client, fake_http):
    """THE test: a spoofed uploaded_by must not reach DataCore's payload.

    Asserts the SERIALIZED OUTBOUND BODY, which is the only thing that
    matters -- DataCore performs no validation of this field at all.
    """
    _arm_token(fake_http)
    fake_http.add("POST", f"/api/documents/{TENANT}",
                  FakeResponse(201, {"document_id": "DC0005",
                                     "upload_url": "https://r2.example/put",
                                     "storage_key": "k"}))
    resp = client.post(
        f"/api/application/{TOKEN}/documents",
        json={"item_id": DOC_ITEM_EID, "filename": "shots.pdf",
              "content_type": "application/pdf", "size": 100,
              # Every field an attacker might try to steer:
              "uploaded_by": f"parent:{OTHER_APP_EID}",
              "application_id": OTHER_APP_EID,
              "tenant_id": "evil-tenant",
              "sensitive": False,
              "storage_key": "../../etc/passwd"},
    )
    assert resp.status_code == 201

    call = _datacore_calls(fake_http)[0]
    sent = call["json"]
    assert sent["uploaded_by"] == f"parent:{APP_EID}"
    assert sent["application_id"] == APP_EID
    assert sent["sensitive"] is True          # derived, not the spoofed False
    assert "storage_key" not in sent          # DataCore builds this itself
    # Nothing anywhere in the serialized body may carry the spoofed scope,
    # and the DataCore URL must be the token's tenant.
    assert OTHER_APP_EID not in json.dumps(sent)
    assert "evil-tenant" not in call["url"]
    assert f"/api/documents/{TENANT}" in call["url"]


def test_upload_without_item_id_is_not_sensitive(client, fake_http):
    _arm_token(fake_http)
    fake_http.add("POST", f"/api/documents/{TENANT}",
                  FakeResponse(201, {"document_id": "DC0006", "upload_url": "u",
                                     "storage_key": "k"}))
    resp = client.post(f"/api/application/{TOKEN}/documents",
                       json={"filename": "misc.pdf",
                             "content_type": "application/pdf", "size": 10})
    assert resp.status_code == 201
    sent = _datacore_calls(fake_http)[0]["json"]
    assert sent["uploaded_by"] == f"parent:{APP_EID}"
    assert sent["item_id"] is None
    assert sent["sensitive"] is False


def test_upload_accepts_item_by_entity_id_and_forwards_entity_id(client, fake_http):
    """The identifier convention: hosts pass the item's ENTITY_ID as
    `item_id` (enrollx-frontend does exactly this,
    ApplicationEntryPage.tsx:161/283-296), and that is the value staff
    uploads store, so the facade must key on and forward entity_id."""
    _arm_token(fake_http)
    fake_http.add("POST", f"/api/documents/{TENANT}",
                  FakeResponse(201, {"document_id": "DC0007", "upload_url": "u",
                                     "storage_key": "k"}))
    resp = client.post(f"/api/application/{TOKEN}/documents",
                       json={"item_id": "item-eid-docs-2", "filename": "addr.pdf",
                             "content_type": "application/pdf", "size": 10})
    assert resp.status_code == 201
    sent = _datacore_calls(fake_http)[0]["json"]
    assert sent["item_id"] == "item-eid-docs-2"
    assert sent["sensitive"] is False  # "Proof of address" is not sensitive


def test_upload_rejects_non_document_item(client, fake_http):
    _arm_token(fake_http)
    resp = client.post(f"/api/application/{TOKEN}/documents",
                       json={"item_id": FORM_ITEM_EID, "filename": "x.pdf",
                             "content_type": "application/pdf", "size": 10})
    assert resp.status_code == 400
    assert _datacore_calls(fake_http) == []


def test_upload_rejects_item_from_another_application(client, fake_http):
    """An item id that isn't on THIS token's application must be refused
    before any presign -- the bundle is the only source of truth for which
    items belong to this parent."""
    _arm_token(fake_http)
    resp = client.post(f"/api/application/{TOKEN}/documents",
                       json={"item_id": "item-eid-someone-else", "filename": "x.pdf",
                             "content_type": "application/pdf", "size": 10})
    assert resp.status_code == 400
    assert _datacore_calls(fake_http) == []


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
                       json={"filename": "x.pdf", "content_type": "application/pdf",
                             "size": 0})
    assert resp.status_code == 400
    assert fake_http.calls == []


def test_upload_with_invalid_token_is_rejected(client, fake_http):
    """enrollx answers 401 for a bad/forged/revoked token (resolve_token,
    internal.py:50-62). It is relayed verbatim and DataCore is never called."""
    fake_http.add("GET", f"/internal/application-by-token/{TOKEN}",
                  FakeResponse(401, {"detail": "Invalid link"}))
    resp = client.post(f"/api/application/{TOKEN}/documents",
                       json={"filename": "x.pdf", "content_type": "application/pdf",
                             "size": 10})
    assert resp.status_code == 401
    assert _datacore_calls(fake_http) == []


def test_upload_masks_enrollx_500(client, fake_http):
    fake_http.add("GET", f"/internal/application-by-token/{TOKEN}",
                  FakeResponse(500, {"detail": "Traceback (most recent call last): ..."}))
    resp = client.post(f"/api/application/{TOKEN}/documents",
                       json={"filename": "x.pdf", "content_type": "application/pdf",
                             "size": 10})
    assert resp.status_code == 502
    assert "Traceback" not in resp.text
    assert _datacore_calls(fake_http) == []


def test_upload_masks_datacore_500(client, fake_http):
    _arm_token(fake_http)
    fake_http.add("POST", f"/api/documents/{TENANT}",
                  FakeResponse(500, {"detail": "R2 credentials rejected for bucket neoapex-prod"}))
    resp = client.post(f"/api/application/{TOKEN}/documents",
                       json={"filename": "x.pdf", "content_type": "application/pdf",
                             "size": 10})
    assert resp.status_code == 502
    assert "R2" not in resp.text


def test_upload_fails_closed_when_bundle_application_disagrees_with_token(client, fake_http):
    """Tripwire: the application enrollx resolved must be the one the token
    names. If they ever disagree, the derived uploaded_by would be attributed
    to the wrong family -- fail closed instead."""
    _arm_token(fake_http, bundle={**HUB_BUNDLE,
                                  "application": {**HUB_BUNDLE["application"],
                                                  "entity_id": OTHER_APP_EID}})
    resp = client.post(f"/api/application/{TOKEN}/documents",
                       json={"filename": "x.pdf", "content_type": "application/pdf",
                             "size": 10})
    assert resp.status_code == 502
    assert _datacore_calls(fake_http) == []


@pytest.mark.parametrize("bundle", [
    {"application": "not-a-dict", "items": [], "config": {}},
    {"items": [], "config": {}},                       # no application at all
    {"application": {"application_id": "RA260001"}},    # no entity_id
])
def test_upload_fails_closed_on_malformed_bundle(client, fake_http, bundle):
    """No shape of upstream nonsense may produce an upload attributed to a
    guessed application."""
    _arm_token(fake_http, bundle=bundle)
    resp = client.post(f"/api/application/{TOKEN}/documents",
                       json={"filename": "x.pdf", "content_type": "application/pdf",
                             "size": 10})
    assert resp.status_code == 502
    assert _datacore_calls(fake_http) == []


# --------------------------------------------------------------------------
# Download URL
# --------------------------------------------------------------------------

def test_download_own_document(client, fake_http):
    _arm_token(fake_http)
    fake_http.add("GET", f"/api/documents/{TENANT}/DC0001/url",
                  FakeResponse(200, {"download_url": "https://r2.example/get"}))
    resp = client.get(f"/api/application/{TOKEN}/documents/DC0001/url")
    assert resp.status_code == 200
    assert resp.json()["download_url"] == "https://r2.example/get"
    assert _datacore_calls(fake_http)[0]["url"].endswith(f"/api/documents/{TENANT}/DC0001/url")


def test_download_staff_uploaded_document_is_403(client, fake_http):
    """Staff uploads carry the BARE user_id ("U42"), with no "staff:"
    prefix -- so anything not equal to "parent:{our eid}" is refused."""
    _arm_token(fake_http)
    resp = client.get(f"/api/application/{TOKEN}/documents/DC0002/url")
    assert resp.status_code == 403
    assert _datacore_calls(fake_http) == []


def test_download_staff_fallback_literal_is_403(client, fake_http):
    _arm_token(fake_http)
    resp = client.get(f"/api/application/{TOKEN}/documents/DC0003/url")
    assert resp.status_code == 403
    assert _datacore_calls(fake_http) == []


def test_download_other_familys_parent_tag_is_403(client, fake_http):
    """Prefix-matching "parent:" would leak here. The comparison must be
    against this token's own application entity_id, in full."""
    _arm_token(fake_http)
    resp = client.get(f"/api/application/{TOKEN}/documents/DC0004/url")
    assert resp.status_code == 403
    assert _datacore_calls(fake_http) == []


def test_download_unknown_document_is_404(client, fake_http):
    _arm_token(fake_http)
    resp = client.get(f"/api/application/{TOKEN}/documents/DC9999/url")
    assert resp.status_code == 404
    assert _datacore_calls(fake_http) == []


def test_download_another_applications_document_is_404_before_any_presign(client, fake_http):
    """document_id is a GLOBAL handle (entity_id == document_id), so the
    only thing stopping a parent from naming another family's document is
    this facade: the id must appear in enrollx's per-token listing."""
    _arm_token(fake_http)
    # Armed, and would answer 200 if it were ever reached.
    fake_http.add("GET", f"/api/documents/{TENANT}/DC-OTHER-FAMILY/url",
                  FakeResponse(200, {"download_url": "https://r2.example/leak"}))
    resp = client.get(f"/api/application/{TOKEN}/documents/DC-OTHER-FAMILY/url")
    assert resp.status_code == 404
    assert "r2.example/leak" not in resp.text
    assert _datacore_calls(fake_http) == []


def test_download_cross_tenant_document_is_404_and_never_leaves_the_token_tenant(client, fake_http):
    """A document_id from a DIFFERENT tenant: refused by the same listing
    check, and the DataCore path could only ever be built from the token's
    own (signed) tenant anyway."""
    _arm_token(fake_http)
    fake_http.add("GET", "/api/documents/other-tenant/DC0001/url",
                  FakeResponse(200, {"download_url": "https://r2.example/cross-tenant"}))
    resp = client.get(f"/api/application/{TOKEN}/documents/DC-FROM-OTHER-TENANT/url")
    assert resp.status_code == 404
    assert _datacore_calls(fake_http) == []
    assert all("other-tenant" not in c["url"] for c in fake_http.calls)


def test_download_path_traversal_document_id_is_refused(client, fake_http):
    """document_id is interpolated into a DataCore URL; a crafted value must
    never get there. Only ids echoed back by enrollx's listing are ever
    forwarded."""
    _arm_token(fake_http)
    resp = client.get(f"/api/application/{TOKEN}/documents/..%2F..%2Ftenants/url")
    assert resp.status_code != 200
    assert _datacore_calls(fake_http) == []


def test_download_with_invalid_token_is_rejected(client, fake_http):
    fake_http.add("GET", f"/internal/application-by-token/{TOKEN}",
                  FakeResponse(401, {"detail": "Invalid link"}))
    resp = client.get(f"/api/application/{TOKEN}/documents/DC0001/url")
    assert resp.status_code == 401
    assert _datacore_calls(fake_http) == []


def test_download_masks_enrollx_500(client, fake_http):
    fake_http.add("GET", f"/internal/application-by-token/{TOKEN}",
                  FakeResponse(500, {"detail": "Traceback: DataCore connection reset"}))
    resp = client.get(f"/api/application/{TOKEN}/documents/DC0001/url")
    assert resp.status_code == 502
    assert "Traceback" not in resp.text
    assert _datacore_calls(fake_http) == []


def test_download_masks_documents_listing_500(client, fake_http):
    fake_http.add("GET", f"/internal/application-by-token/{TOKEN}/documents",
                  FakeResponse(500, {"detail": "binder error: no such column uploaded_by"}))
    fake_http.add("GET", f"/internal/application-by-token/{TOKEN}",
                  FakeResponse(200, HUB_BUNDLE))
    resp = client.get(f"/api/application/{TOKEN}/documents/DC0001/url")
    assert resp.status_code == 502
    assert "binder error" not in resp.text
    assert _datacore_calls(fake_http) == []


def test_download_masks_datacore_500(client, fake_http):
    _arm_token(fake_http)
    fake_http.add("GET", f"/api/documents/{TENANT}/DC0001/url",
                  FakeResponse(500, {"detail": "presign failed for bucket neoapex-prod"}))
    resp = client.get(f"/api/application/{TOKEN}/documents/DC0001/url")
    assert resp.status_code == 502
    assert "neoapex-prod" not in resp.text


def test_download_datacore_404_is_passed_through(client, fake_http):
    _arm_token(fake_http)
    fake_http.add("GET", f"/api/documents/{TENANT}/DC0001/url",
                  FakeResponse(404, {"detail": "Document not found"}))
    resp = client.get(f"/api/application/{TOKEN}/documents/DC0001/url")
    assert resp.status_code == 404


def test_download_sends_internal_key_to_enrollx_only(client, fake_http):
    """The internal shared secret must never be sent to DataCore."""
    _arm_token(fake_http)
    fake_http.add("GET", f"/api/documents/{TENANT}/DC0001/url",
                  FakeResponse(200, {"download_url": "https://r2.example/get"}))
    client.get(f"/api/application/{TOKEN}/documents/DC0001/url")
    for call in fake_http.calls:
        if "/internal/" in call["url"]:
            assert call["headers"]["X-Internal-Key"] == "test-internal-key"
        else:
            assert "X-Internal-Key" not in (call["headers"] or {})
