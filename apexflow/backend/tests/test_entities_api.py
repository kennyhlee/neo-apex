# apexflow/backend/tests/test_entities_api.py
"""Route-level tests for the generic entity CRUD proxy (Task 1 of Plan 2):
`app/api/entities.py`.

Ported from admindash/backend/tests/test_entities.py (interface map §6a) —
same respx-mocked-DataCore shapes. Auth pattern follows this suite's own
convention (test_documents_api.py/test_definitions_api.py): override
`require_authenticated_user` at the app level rather than minting a real JWT
or mocking DataCore's /auth/me — apexflow's `require_staff_tenant` (the
`require_tenant_match` binding, app/auth.py's `# ADJUST(bindings)` note)
layers the tenant-path-param check on top of that override.

Cross-tenant 403 coverage exercises every route (task-1-brief.md Step 1) —
each fires before any DataCore call, so no respx mock is needed for those.
The round-trip test simulates a stateful DataCore across the create route
and the query route together (brief's "draft write round-trip"): since both
proxy routes forward raw HTTP straight to DataCore (interface map §6 — they
do not go through app.workflows.datacore), the existing tests/fakes.py
FakeDataCore (which patches that module) does not intercept these calls;
this test builds a small in-memory respx side_effect instead, the minimal
extension the brief anticipates ("extend minimally if the query passthrough
needs a fake").
"""
import json

import httpx
import pytest
import respx
from fastapi.testclient import TestClient

from app.auth import require_authenticated_user
from app.main import app

TENANT = "acme"
DATACORE = "http://localhost:5800"


@pytest.fixture
def client(fake_dc):
    app.dependency_overrides[require_authenticated_user] = lambda: {
        "user_id": "staff-1", "tenant_id": TENANT, "role": "admin", "_token": "Bearer test-token",
    }
    yield TestClient(app)
    app.dependency_overrides.clear()


# ── forwarding shape (ported verbatim from admindash's test patterns) ─────


@respx.mock
def test_create_entity_forwards_with_path_params(client):
    route = respx.post(
        f"{DATACORE}/api/entities/{TENANT}/workflow_definition"
    ).mock(return_value=httpx.Response(200, json={"entity_id": "wd_1"}))
    resp = client.post(
        f"/api/entities/{TENANT}/workflow_definition",
        json={"base_data": {"name": "Draft"}, "custom_fields": {}},
    )
    assert resp.status_code == 200
    assert resp.json() == {"entity_id": "wd_1"}
    assert route.called


@respx.mock
def test_update_entity_preserves_entity_id(client):
    route = respx.put(
        f"{DATACORE}/api/entities/{TENANT}/workflow_definition/wd_1"
    ).mock(return_value=httpx.Response(200, json={"entity_id": "wd_1", "updated": True}))
    resp = client.put(
        f"/api/entities/{TENANT}/workflow_definition/wd_1",
        json={"base_data": {"name": "Draft"}, "custom_fields": {}},
    )
    assert resp.status_code == 200
    assert route.called


@respx.mock
def test_archive_endpoint_forwards(client):
    route = respx.post(
        f"{DATACORE}/api/entities/{TENANT}/workflow_definition/archive"
    ).mock(return_value=httpx.Response(200, json={"archived": 1}))
    resp = client.post(
        f"/api/entities/{TENANT}/workflow_definition/archive",
        json={"entity_ids": ["wd_1"]},
    )
    assert resp.status_code == 200
    assert resp.json() == {"archived": 1}
    assert route.called


@respx.mock
def test_restore_endpoint_forwards(client):
    route = respx.post(
        f"{DATACORE}/api/entities/{TENANT}/workflow_definition/restore"
    ).mock(return_value=httpx.Response(200, json={"restored": 1}))
    resp = client.post(
        f"/api/entities/{TENANT}/workflow_definition/restore",
        json={"entity_ids": ["wd_1"]},
    )
    assert resp.status_code == 200
    assert route.called


@respx.mock
def test_next_id_is_get(client):
    route = respx.get(
        f"{DATACORE}/api/entities/{TENANT}/workflow_definition/next-id"
    ).mock(return_value=httpx.Response(200, json={"next_id": "wd_42"}))
    resp = client.get(f"/api/entities/{TENANT}/workflow_definition/next-id")
    assert resp.status_code == 200
    assert resp.json() == {"next_id": "wd_42"}
    assert route.called


@respx.mock
def test_duplicate_check_forwards(client):
    route = respx.post(
        f"{DATACORE}/api/entities/{TENANT}/workflow_definition/duplicate-check"
    ).mock(return_value=httpx.Response(200, json={"duplicates": []}))
    resp = client.post(
        f"/api/entities/{TENANT}/workflow_definition/duplicate-check",
        json={"first_name": "Ada", "last_name": "Lovelace"},
    )
    assert resp.status_code == 200
    assert route.called


def test_unauthenticated_create_returns_401(fake_dc):
    client = TestClient(app)  # no require_authenticated_user override
    resp = client.post(f"/api/entities/{TENANT}/workflow_definition", json={})
    assert resp.status_code == 401


# ── cross-tenant 403 on every route (task-1-brief.md Step 1) ──────────────


@pytest.mark.parametrize(
    "method,path,body",
    [
        ("post", "/api/entities/othertenant/workflow_definition", {"base_data": {}}),
        ("put", "/api/entities/othertenant/workflow_definition/wd_1", {"base_data": {}}),
        ("post", "/api/entities/othertenant/workflow_definition/archive", {"entity_ids": []}),
        ("post", "/api/entities/othertenant/workflow_definition/restore", {"entity_ids": []}),
        ("post", "/api/entities/othertenant/workflow_definition/duplicate-check", {}),
    ],
)
def test_cross_tenant_write_routes_are_403(client, method, path, body):
    resp = getattr(client, method)(path, json=body)
    assert resp.status_code == 403


def test_cross_tenant_next_id_is_403(client):
    resp = client.get("/api/entities/othertenant/workflow_definition/next-id")
    assert resp.status_code == 403


# ── draft write round-trip (task-1-brief.md Step 1) ────────────────────────


@respx.mock
def test_draft_write_round_trip(client):
    """Create a workflow_definition draft through the entity proxy, then read
    it back through the query proxy — the designer's actual save/reload
    cycle. Both routes forward straight to DataCore (no shared in-process
    state), so this test stands in a tiny stateful DataCore of its own."""
    store: dict[str, dict] = {}

    def handle_create(request: httpx.Request) -> httpx.Response:
        payload = json.loads(request.content)
        entity_id = "wd-draft-1"
        row = {"entity_id": entity_id, "entity_type": "workflow_definition",
               **payload["base_data"]}
        store[entity_id] = row
        return httpx.Response(
            200,
            json={"entity_id": entity_id, "entity_type": "workflow_definition",
                  "base_data": payload["base_data"]},
        )

    def handle_query(request: httpx.Request) -> httpx.Response:
        payload = json.loads(request.content)
        assert payload["tenant_id"] == TENANT
        rows = list(store.values())
        return httpx.Response(200, json={"data": rows, "total": len(rows)})

    respx.post(f"{DATACORE}/api/entities/{TENANT}/workflow_definition").mock(
        side_effect=handle_create
    )
    respx.post(f"{DATACORE}/api/query").mock(side_effect=handle_query)

    create_resp = client.post(
        f"/api/entities/{TENANT}/workflow_definition",
        json={"base_data": {"name": "Enrollment Draft", "status": "draft"}, "custom_fields": {}},
    )
    assert create_resp.status_code == 200
    entity_id = create_resp.json()["entity_id"]

    query_resp = client.post(
        "/api/query",
        json={"tenant_id": TENANT, "table": "entities",
              "sql": "SELECT * FROM data WHERE entity_type = 'workflow_definition'"},
    )
    assert query_resp.status_code == 200
    rows = query_resp.json()["data"]
    assert len(rows) == 1
    assert rows[0]["entity_id"] == entity_id
    assert rows[0]["name"] == "Enrollment Draft"
    assert rows[0]["status"] == "draft"
