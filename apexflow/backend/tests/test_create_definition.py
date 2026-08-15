# apexflow/backend/tests/test_create_definition.py
"""Route-level tests for `POST /api/workflows/{tenant_id}/definitions` — the
one WRITE that creates a v1 draft lineage from a parsed definition object.

Written first per TDD (superpowers:test-driven-development): the route and
`defs.create_definition` do not exist yet, so this file is expected to 404 /
AttributeError until they land.

Mocking follows tests/test_designer_api.py: the in-memory `fake_dc` fixture
(tests/fakes.py) stands in for DataCore, and auth is an app-level override of
`require_authenticated_user` rather than a minted JWT — `require_staff_tenant`
then does the real role + tenant-match check against that dict.

The `dc_create_calls` fixture below is this file's own addition: two of the
three tests assert on what was HANDED to DataCore (JSON strings, not dicts) or
that nothing was handed to it at all, and a flattened read-back cannot answer
either question — `FakeDataCore._store_row` stringifies every value on the way
in (mirroring real DataCore's query-path flattening), so a dict written into
`machine` reads back as a JSON string exactly like a correctly-encoded one
would.
"""
import json

import pytest
from fastapi.testclient import TestClient

from app.auth import require_authenticated_user
from app.main import app
from app.workflows import datacore as dc

TENANT = "acme"


@pytest.fixture
def client(fake_dc):
    app.dependency_overrides[require_authenticated_user] = lambda: {
        "user_id": "u1", "tenant_id": TENANT, "role": "admin", "_token": "Bearer test-token",
    }
    yield TestClient(app)
    app.dependency_overrides.clear()


@pytest.fixture
def dc_create_calls(fake_dc, monkeypatch):
    """Record every `dc.dc_create(tenant_id, entity_type, base_data)` the
    request makes, then delegate to the fake so the row really is stored."""
    calls: list[dict] = []
    inner = dc.dc_create

    def _recording(tenant_id, entity_type, base_data, token=None):
        calls.append({"tenant_id": tenant_id, "entity_type": entity_type,
                      "base_data": base_data})
        return inner(tenant_id, entity_type, base_data, token)

    monkeypatch.setattr(dc, "dc_create", _recording)
    return calls


# The smallest machine that validates with ZERO errors — the same skeleton
# the designer's "New workflow" flow builds client-side today
# (frontend/src/pages/DefinitionsPage.tsx::submitNewWorkflow). An empty
# machine would trip validate.py's "no initial state"/"no terminal state"
# immediately, which is a different (and less interesting) assertion.
SKELETON_MACHINE = {
    "states": [
        {"state_id": "draft", "name": "Draft", "kind": "initial"},
        {"state_id": "done", "name": "Done", "kind": "terminal"},
    ],
    "transitions": [
        {"transition_id": "submit", "from": "draft", "to": "done",
         "action": "submit", "actor": "family", "guards": [], "effects": []},
    ],
}


def test_create_definition_returns_row_errors_health(client, fake_dc, dc_create_calls):
    resp = client.post(
        f"/api/workflows/{TENANT}/definitions",
        json={"name": "Fall Registration", "machine": SKELETON_MACHINE,
              "steps": [], "channel_access": "family"},
    )
    assert resp.status_code == 201, resp.text
    body = resp.json()

    row = body["row"]
    assert row["name"] == "Fall Registration"
    assert row["status"] == "draft"
    assert str(row["version"]) == "1"
    assert row["lineage_status"] == "active"
    assert row["channel_access"] == "family"
    assert row["definition_id"].startswith("fall-registration-")
    # The caller navigates to the editor with this — a create that didn't
    # hand back the row's DataCore id would be useless to every consumer.
    assert row["entity_id"]

    assert body["errors"] == []
    assert body["health"] == "current"

    # The row DataCore was asked to store carries machine/steps as JSON
    # STRINGS, never dicts. Encoding server-side in exactly one place is the
    # whole point of this endpoint — the designer used to hand-JSON.stringify
    # into the schema-less generic entities proxy, and so could (and did)
    # write shapes that bricked every later read of the row.
    assert len(dc_create_calls) == 1
    base = dc_create_calls[0]["base_data"]
    assert dc_create_calls[0]["entity_type"] == "workflow_definition"
    assert isinstance(base["machine"], str)
    assert isinstance(base["steps"], str)
    assert json.loads(base["machine"])["states"][0]["state_id"] == "draft"
    # alias spelling survives the round trip: "from", not "from_"
    assert json.loads(base["machine"])["transitions"][0]["from"] == "draft"
    assert json.loads(base["steps"]) == []

    # ...and the stored row round-trips through a normal read.
    stored = fake_dc.get_entity(TENANT, "workflow_definition", row["entity_id"])
    assert json.loads(stored["machine"])["states"][0]["state_id"] == "draft"


def test_create_definition_rejects_unparseable_machine(client, dc_create_calls):
    """A machine that doesn't validate against schema.py must be refused
    BEFORE anything is written — a stored-but-unparseable row 422s (or, before
    the read paths were hardened, 500s) on every future fetch, so letting one
    in through a create would just move the corrupt-row problem one endpoint
    over."""
    resp = client.post(
        f"/api/workflows/{TENANT}/definitions",
        json={"name": "Broken", "machine": {"states": "nope"}, "steps": []},
    )
    assert resp.status_code == 422
    assert isinstance(resp.json()["detail"]["parse_error"], str)
    assert resp.json()["detail"]["parse_error"]  # non-empty

    assert dc_create_calls == []


def test_create_definition_requires_matching_tenant(client, dc_create_calls):
    """`require_staff_tenant` rejects a token whose tenant differs from the
    path's before any DataCore call — same 403 the other designer routes give
    (tests/test_designer_api.py::test_cross_tenant_designer_routes_are_403)."""
    resp = client.post(
        "/api/workflows/othertenant/definitions",
        json={"name": "Fall Registration", "machine": SKELETON_MACHINE, "steps": []},
    )
    assert resp.status_code == 403
    assert dc_create_calls == []


def test_create_definition_defaults_channel_access_to_staff_only(client, dc_create_calls):
    """`channel_access` is optional — a workflow only becomes family-reachable
    deliberately, so the default must be the closed one."""
    resp = client.post(
        f"/api/workflows/{TENANT}/definitions",
        json={"name": "Internal Thing", "machine": SKELETON_MACHINE, "steps": []},
    )
    assert resp.status_code == 201, resp.text
    assert resp.json()["row"]["channel_access"] == "staff_only"
    assert dc_create_calls[0]["base_data"]["channel_access"] == "staff_only"


def test_create_definition_ids_are_distinct_for_the_same_name(client):
    """Two workflows named the same thing are two lineages, not one. The
    suffix is what keeps `definition_id` — which every lineage read
    (`get_published_definition`, `get_draft_definition`, `model_impact`)
    matches on — from silently merging them."""
    ids = set()
    for _ in range(2):
        resp = client.post(
            f"/api/workflows/{TENANT}/definitions",
            json={"name": "Fall Registration", "machine": SKELETON_MACHINE, "steps": []},
        )
        assert resp.status_code == 201, resp.text
        ids.add(resp.json()["row"]["definition_id"])
    assert len(ids) == 2
