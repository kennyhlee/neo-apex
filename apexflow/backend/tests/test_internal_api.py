# apexflow/backend/tests/test_internal_api.py
"""Route-level tests for the token-scoped family channel (Task 10):
`app/api/internal.py`.

Written first per TDD: `app.api.internal` does not exist yet at the time
these were drafted. Auth pattern is X-Internal-Key (no JWT, no
`require_authenticated_user` override) -- the whole point of this module.

Covers task-10-brief.md Step 1's failing-test list: token scope wrong
tenant/instance -> 401; revocation via token_version bump -> 401 (see
app/api/internal.py's module docstring: resolve_token is UNIFORMLY 401 on
every failure mode -- coordinator review fix, an earlier draft split this
into 401 vs. 403 and that split was itself an existence oracle for an
unauthenticated caller); family action allowlist including the blocked
staff-only built-ins -> 403; request-link anti-enumeration (unknown email
still 200 {}); uploaded_by derivation on the token-scoped document surface;
and the internal-key gate itself (401 for missing/wrong key).
"""
import json

import pytest
from fastapi.testclient import TestClient

from app.config import settings
from app.main import app
from app.workflows.tokens import make_link_token

TENANT = "acme"
HEADERS = {"X-Internal-Key": settings.internal_key}


@pytest.fixture
def client(fake_dc):
    return TestClient(app)


# --- fixtures ----------------------------------------------------------


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


def _steps():
    return [
        {
            "step_id": "form_step", "type": "form", "title": "Form", "required": True,
            "blocking": True, "available_in": ["draft"], "show_if": None, "review": "auto",
            "config": {"sections": [{
                "section_id": "s1", "entity_model": "student", "mode": "create",
                "fields": [{"name": "first_name", "required": False}], "repeat": None,
            }]},
        },
    ]


def _seed_definition(fake_dc, *, definition_id="wd-1", channel_access="family"):
    fake_dc.set_model(TENANT, "student", {
        "base_fields": [
            {"name": "student_id", "type": "str", "required": True},
            {"name": "first_name", "type": "str", "required": False},
        ],
        "custom_fields": [],
    })
    base = {
        "definition_id": definition_id,
        "name": "Enrollment",
        "version": 1,
        "status": "published",
        "lineage_status": "active",
        "channel_access": channel_access,
        "machine": json.dumps(_machine()),
        "steps": json.dumps(_steps()),
    }
    created = fake_dc.dc_create(TENANT, "workflow_definition", base)
    return created["entity_id"]


def _start(client, fake_dc, *, definition_id="wd-1", email="parent@example.com"):
    _seed_definition(fake_dc, definition_id=definition_id)
    resp = client.post(
        f"/internal/workflows/{TENANT}/{definition_id}/start",
        json={"context": {"school_year": "2026-2027"}, "applicant_email": email},
        headers=HEADERS,
    )
    assert resp.status_code == 201, resp.text
    return resp.json()


# --- internal-key gate ------------------------------------------------------


def test_missing_internal_key_401(client, fake_dc):
    resp = client.get(f"/internal/workflows/{TENANT}/wd-1/config")
    assert resp.status_code == 401


def test_wrong_internal_key_401(client, fake_dc):
    resp = client.get(f"/internal/workflows/{TENANT}/wd-1/config",
                      headers={"X-Internal-Key": "nope"})
    assert resp.status_code == 401


# --- start ------------------------------------------------------------------


def test_start_workflow_returns_instance_items_token_link(client, fake_dc):
    body = _start(client, fake_dc)
    assert body["instance"]["state"] == "draft"
    assert len(body["items"]) == 1
    assert body["token"]
    assert body["link"] == f"http://localhost:5620/w/{TENANT}/wd-1?token={body['token']}"


def test_start_workflow_404_unknown_lineage(client, fake_dc):
    resp = client.post(
        f"/internal/workflows/{TENANT}/does-not-exist/start",
        json={"context": {}, "applicant_email": "p@example.com"},
        headers=HEADERS,
    )
    assert resp.status_code == 404


def test_start_workflow_404_for_staff_only_definition(client, fake_dc):
    """A published definition with channel_access != "family" must 404 on
    the family/token-scoped start route -- 404, not 403, so an
    unauthenticated caller on the public surface can't tell "staff-only
    definition exists" apart from "no such lineage" (same anti-oracle
    reasoning as resolve_token's uniform 401)."""
    _seed_definition(fake_dc, definition_id="wd-staff-only", channel_access="staff_only")
    resp = client.post(
        f"/internal/workflows/{TENANT}/wd-staff-only/start",
        json={"context": {}, "applicant_email": "p@example.com"},
        headers=HEADERS,
    )
    assert resp.status_code == 404


# --- config -------------------------------------------------------------


def test_config_route_returns_definition_tenant_capacity(client, fake_dc):
    _seed_definition(fake_dc, definition_id="wd-cfg")
    fake_dc.rows.append(fake_dc._store_row(TENANT, "tenant", TENANT, {"name": "Acme School"}))

    resp = client.get(f"/internal/workflows/{TENANT}/wd-cfg/config", headers=HEADERS)
    assert resp.status_code == 200
    body = resp.json()
    assert body["definition"]["definition_id"] == "wd-cfg"
    assert body["definition"]["machine"]["states"]
    assert body["tenant"] == {"tenant_id": TENANT, "name": "Acme School"}
    assert body["capacity"] == {"capacity": None, "admitted": 0, "full": False}


def test_config_route_404_for_unpublished_lineage(client, fake_dc):
    resp = client.get(f"/internal/workflows/{TENANT}/nope/config", headers=HEADERS)
    assert resp.status_code == 404


def test_config_route_404_for_staff_only_definition(client, fake_dc):
    """Same anti-oracle reasoning as the start route above: a staff-only
    definition must 404 on the family/token-scoped config route, not reveal
    its existence via a 403."""
    _seed_definition(fake_dc, definition_id="wd-cfg-staff-only", channel_access="staff_only")
    resp = client.get(f"/internal/workflows/{TENANT}/wd-cfg-staff-only/config", headers=HEADERS)
    assert resp.status_code == 404


def test_config_route_capacity_from_guard_and_tenant_field(client, fake_dc):
    machine = {
        "states": [
            {"state_id": "draft", "name": "Draft", "kind": "initial"},
            {"state_id": "approved", "name": "Approved", "kind": "terminal"},
        ],
        "transitions": [
            {
                "transition_id": "t_submit", "from": "draft", "to": "approved", "action": "submit",
                "actor": "family",
                "guards": [{
                    "primitive": "capacity_available",
                    "params": {"capacity_field": "capacity", "count_states": ["approved"]},
                }],
                "effects": [],
            },
        ],
    }
    base = {
        "definition_id": "wd-cap", "name": "Capacity", "version": 1, "status": "published",
        "lineage_status": "active", "channel_access": "family",
        "machine": json.dumps(machine), "steps": json.dumps([]),
    }
    fake_dc.dc_create(TENANT, "workflow_definition", base)
    fake_dc.rows.append(fake_dc._store_row(TENANT, "tenant", TENANT, {"capacity": 2}))
    fake_dc.rows.append(fake_dc._store_row("other-eid", "workflow_instance", TENANT, {
        "definition_id": "wd-cap", "state": "approved",
    }))

    resp = client.get(f"/internal/workflows/{TENANT}/wd-cap/config", headers=HEADERS)
    assert resp.status_code == 200
    assert resp.json()["capacity"] == {"capacity": 2, "admitted": 1, "full": False}


def test_config_route_capacity_full_when_admitted_equals_capacity(client, fake_dc):
    """Boundary: `_capacity_summary` must report `full: True` once admitted
    reaches (not just exceeds) capacity -- admitted >= capacity, not >."""
    machine = {
        "states": [
            {"state_id": "draft", "name": "Draft", "kind": "initial"},
            {"state_id": "approved", "name": "Approved", "kind": "terminal"},
        ],
        "transitions": [
            {
                "transition_id": "t_submit", "from": "draft", "to": "approved", "action": "submit",
                "actor": "family",
                "guards": [{
                    "primitive": "capacity_available",
                    "params": {"capacity_field": "capacity", "count_states": ["approved"]},
                }],
                "effects": [],
            },
        ],
    }
    base = {
        "definition_id": "wd-cap-full", "name": "Capacity Full", "version": 1, "status": "published",
        "lineage_status": "active", "channel_access": "family",
        "machine": json.dumps(machine), "steps": json.dumps([]),
    }
    fake_dc.dc_create(TENANT, "workflow_definition", base)
    fake_dc.rows.append(fake_dc._store_row(TENANT, "tenant", TENANT, {"capacity": 1}))
    fake_dc.rows.append(fake_dc._store_row("other-eid", "workflow_instance", TENANT, {
        "definition_id": "wd-cap-full", "state": "approved",
    }))

    resp = client.get(f"/internal/workflows/{TENANT}/wd-cap-full/config", headers=HEADERS)
    assert resp.status_code == 200
    assert resp.json()["capacity"] == {"capacity": 1, "admitted": 1, "full": True}


# --- request-link (anti-enumeration) -----------------------------------


def test_request_link_unknown_email_still_200_empty(client, fake_dc):
    resp = client.post(f"/internal/workflows/{TENANT}/request-link", headers=HEADERS,
                       json={"email": "nobody@example.com"})
    assert resp.status_code == 200
    assert resp.json() == {}


def test_request_link_known_email_sends_and_still_returns_200_empty(client, fake_dc, monkeypatch):
    _start(client, fake_dc, definition_id="wd-relink", email="parent@example.com")
    sent = []
    monkeypatch.setattr(
        "app.api.internal.send_email",
        lambda to, subject, body_html: sent.append(to) or "sent",
    )

    resp = client.post(f"/internal/workflows/{TENANT}/request-link", headers=HEADERS,
                       json={"email": "PARENT@example.com"})
    assert resp.status_code == 200
    assert resp.json() == {}
    assert sent == ["parent@example.com"]


# --- instance-by-token / actions -----------------------------------------


def test_instance_by_token_returns_instance_items_definition(client, fake_dc):
    started = _start(client, fake_dc, definition_id="wd-tok")
    token = started["token"]

    resp = client.get(f"/internal/instance-by-token/{token}", headers=HEADERS)
    assert resp.status_code == 200
    body = resp.json()
    assert body["instance"]["entity_id"] == started["instance"]["entity_id"]
    assert len(body["items"]) == 1
    assert body["definition"]["definition_id"] == "wd-tok"


def test_save_draft_and_submit_via_token(client, fake_dc):
    started = _start(client, fake_dc, definition_id="wd-act")
    token = started["token"]

    resp = client.post(f"/internal/instance-by-token/{token}/actions", headers=HEADERS,
                       json={"action": "save_draft",
                             "section_answers": {"s1": {"first_name": "Ada"}}})
    assert resp.status_code == 200

    resp = client.post(f"/internal/instance-by-token/{token}/actions", headers=HEADERS,
                       json={"action": "submit"})
    assert resp.status_code == 200
    assert resp.json()["instance"]["state"] == "submitted"


@pytest.mark.parametrize("action", ["cancel_instance", "verify_item", "reject_item", "waive_item"])
def test_blocked_staff_only_actions_403_via_token(client, fake_dc, action):
    started = _start(client, fake_dc, definition_id=f"wd-blocked-{action}")
    token = started["token"]

    resp = client.post(f"/internal/instance-by-token/{token}/actions", headers=HEADERS,
                       json={"action": action, "item_id": "whatever"})
    assert resp.status_code == 403


def test_actions_by_token_unknown_action_409(client, fake_dc):
    started = _start(client, fake_dc, definition_id="wd-unknown-action")
    resp = client.post(f"/internal/instance-by-token/{started['token']}/actions", headers=HEADERS,
                       json={"action": "nope"})
    assert resp.status_code == 409


# --- token scope: UNIFORM 401 on every failure mode (coordinator review) ---
#
# A 403-vs-401 split (an earlier draft of this task) is an existence oracle:
# an unauthenticated caller could tell "instance doesn't exist" (403) apart
# from "instance exists but the signature/version is wrong" (401) with no
# credential at all -- familyhub's public token routes carry no auth of
# their own. Every resolve_token failure mode below must produce the
# IDENTICAL status AND body.


def test_wrong_tenant_scope_401(client, fake_dc):
    started = _start(client, fake_dc, definition_id="wd-scope")
    instance_eid = started["instance"]["entity_id"]
    forged = make_link_token("other-tenant", instance_eid, 1)

    resp = client.get(f"/internal/instance-by-token/{forged}", headers=HEADERS)
    assert resp.status_code == 401


def test_unknown_instance_scope_401(client, fake_dc):
    forged = make_link_token(TENANT, "does-not-exist", 1)
    resp = client.get(f"/internal/instance-by-token/{forged}", headers=HEADERS)
    assert resp.status_code == 401


def test_revoked_token_401_after_token_version_bump(client, fake_dc):
    """token_version bump revokes a previously-valid token."""
    started = _start(client, fake_dc, definition_id="wd-revoke")
    token = started["token"]
    instance_eid = started["instance"]["entity_id"]

    row = fake_dc.get_entity(TENANT, "workflow_instance", instance_eid)
    base = {k: v for k, v in row.items() if k not in ("entity_id", "entity_type", "_tenant")}
    base["token_version"] = int(base.get("token_version", 1)) + 1
    fake_dc.dc_update(TENANT, "workflow_instance", instance_eid, base)

    resp = client.get(f"/internal/instance-by-token/{token}", headers=HEADERS)
    assert resp.status_code == 401


def test_malformed_token_401(client, fake_dc):
    resp = client.get("/internal/instance-by-token/not-a-real-token", headers=HEADERS)
    assert resp.status_code == 401


def test_token_scope_failure_bodies_are_indistinguishable(client, fake_dc):
    """THE anti-oracle assertion: a malformed token, a wrong-tenant token, an
    unknown-instance token, and a revoked (version-bumped) token must all
    produce the SAME response body -- not just the same status code -- or an
    unauthenticated caller could still tell them apart."""
    started = _start(client, fake_dc, definition_id="wd-scope-bodies")
    instance_eid = started["instance"]["entity_id"]

    row = fake_dc.get_entity(TENANT, "workflow_instance", instance_eid)
    base = {k: v for k, v in row.items() if k not in ("entity_id", "entity_type", "_tenant")}
    base["token_version"] = int(base.get("token_version", 1)) + 1
    fake_dc.dc_update(TENANT, "workflow_instance", instance_eid, base)

    tokens = [
        "not-a-real-token",
        make_link_token("other-tenant", instance_eid, 1),
        make_link_token(TENANT, "does-not-exist", 1),
        started["token"],  # now revoked by the version bump above
    ]
    bodies = {
        client.get(f"/internal/instance-by-token/{t}", headers=HEADERS).json()["detail"]
        for t in tokens
    }
    assert len(bodies) == 1


# --- documents (token-scoped) --------------------------------------------


def test_documents_by_token_hides_others_sensitive_docs(client, fake_dc):
    started = _start(client, fake_dc, definition_id="wd-docs-list")
    eid = started["instance"]["entity_id"]
    fake_dc.rows.append(fake_dc._store_row("doc-own", "document", TENANT, {
        "document_id": "DC-1", "application_id": eid, "filename": "own.pdf",
        "uploaded_by": f"family:{eid}", "sensitive": True, "item_id": "",
    }))
    fake_dc.rows.append(fake_dc._store_row("doc-other-sensitive", "document", TENANT, {
        "document_id": "DC-2", "application_id": eid, "filename": "staff.pdf",
        "uploaded_by": "staff-user-1", "sensitive": True, "item_id": "",
    }))
    fake_dc.rows.append(fake_dc._store_row("doc-other-nonsensitive", "document", TENANT, {
        "document_id": "DC-3", "application_id": eid, "filename": "public.pdf",
        "uploaded_by": "staff-user-1", "sensitive": False, "item_id": "",
    }))

    resp = client.get(f"/internal/instance-by-token/{started['token']}/documents", headers=HEADERS)
    assert resp.status_code == 200
    filenames = sorted(d["filename"] for d in resp.json()["documents"])
    assert filenames == ["own.pdf", "public.pdf"]


def test_create_document_by_token_ignores_client_supplied_uploaded_by(client, fake_dc, monkeypatch):
    started = _start(client, fake_dc, definition_id="wd-doc")
    token = started["token"]

    captured = {}

    class FakeResp:
        status_code = 201
        text = ""

        def json(self):
            return {"document_id": "DC-1", "upload_url": "https://example/upload", "storage_key": "k"}

    def fake_request(method, url, json=None, headers=None, timeout=None):
        captured["json"] = json
        return FakeResp()

    monkeypatch.setattr("app.api.internal.httpx.request", fake_request)

    resp = client.post(
        f"/internal/instance-by-token/{token}/documents", headers=HEADERS,
        json={"filename": "x.pdf", "content_type": "application/pdf",
              "size": 100, "uploaded_by": "someone-else"},
    )
    assert resp.status_code == 201
    assert captured["json"]["uploaded_by"] == f"family:{started['instance']['entity_id']}"
    assert captured["json"]["application_id"] == started["instance"]["entity_id"]


def test_document_create_by_token_masks_upstream_500_to_502(client, fake_dc, monkeypatch):
    started = _start(client, fake_dc, definition_id="wd-doc-fail")
    token = started["token"]

    class FakeResp:
        status_code = 500
        text = "boom: internal storage key leaked"

    monkeypatch.setattr("app.api.internal.httpx.request", lambda *a, **k: FakeResp())

    resp = client.post(
        f"/internal/instance-by-token/{token}/documents", headers=HEADERS,
        json={"filename": "x.pdf", "content_type": "application/pdf", "size": 10},
    )
    assert resp.status_code == 502
    assert "boom" not in resp.text


def test_document_url_by_token_ownership_and_missing(client, fake_dc, monkeypatch):
    started = _start(client, fake_dc, definition_id="wd-docs-url")
    eid = started["instance"]["entity_id"]
    token = started["token"]

    fake_dc.rows.append(fake_dc._store_row("doc-own", "document", TENANT, {
        "document_id": "DC-1", "application_id": eid, "filename": "own.pdf",
        "uploaded_by": f"family:{eid}", "sensitive": True, "item_id": "",
    }))
    fake_dc.rows.append(fake_dc._store_row("doc-staff-sensitive", "document", TENANT, {
        "document_id": "DC-2", "application_id": eid, "filename": "staff.pdf",
        "uploaded_by": "staff-user-1", "sensitive": True, "item_id": "",
    }))
    fake_dc.rows.append(fake_dc._store_row("doc-staff-nonsensitive", "document", TENANT, {
        "document_id": "DC-3", "application_id": eid, "filename": "handbook.pdf",
        "uploaded_by": "staff-user-1", "sensitive": False, "item_id": "",
    }))

    class FakeResp:
        status_code = 200

        def json(self):
            return {"download_url": "https://example/download"}

    monkeypatch.setattr("app.api.internal.httpx.request", lambda *a, **k: FakeResp())

    resp = client.get(f"/internal/instance-by-token/{token}/documents/DC-1/url", headers=HEADERS)
    assert resp.status_code == 200
    assert resp.json()["download_url"] == "https://example/download"

    resp = client.get(f"/internal/instance-by-token/{token}/documents/DC-2/url", headers=HEADERS)
    assert resp.status_code == 403

    # Intentional generalization (coordinator review, see
    # document_url_by_token's docstring): a NON-sensitive document uploaded
    # by someone else on the SAME instance is downloadable, not just
    # listable -- this is a widening relative to familyhub's pre-Task-10
    # own-uploads-only download rule.
    resp = client.get(f"/internal/instance-by-token/{token}/documents/DC-3/url", headers=HEADERS)
    assert resp.status_code == 200
    assert resp.json()["download_url"] == "https://example/download"

    resp = client.get(f"/internal/instance-by-token/{token}/documents/DC-999/url", headers=HEADERS)
    assert resp.status_code == 404
