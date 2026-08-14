"""Route-level tests for the definitions API (Task 5): publish/lineage
lifecycle actions and model-impact scanning.

Written first per TDD (superpowers:test-driven-development):
app.api.definitions / app.workflows.definitions do not exist yet, so this
file is expected to fail at collection until they are implemented.

Auth pattern follows enrollx/backend/tests/test_actions_approve.py: override
`require_authenticated_user` at the app level rather than minting a real JWT
(DataCore's /auth/me is out of scope for these tests) — this file's `client`
fixture shadows conftest.py's plain `client` fixture, adding that override on
top of the shared `fake_dc` fixture.

Cross-task note (per task-5 brief): a "deprecate blocks Task 6 instance
creation" test belongs to Task 6 (it needs `create_instance`, which doesn't
exist until then) — intentionally NOT written here.
"""
import json

import pytest
from fastapi.testclient import TestClient

from app.auth import require_authenticated_user
from app.main import app

TENANT = "acme"


@pytest.fixture
def client(fake_dc):
    app.dependency_overrides[require_authenticated_user] = lambda: {
        "user_id": "u1", "tenant_id": TENANT, "role": "admin", "_token": "Bearer test-token",
    }
    yield TestClient(app)
    app.dependency_overrides.clear()


# --- Fixture builders (mirrors tests/test_validate.py's base fixture) -------


def _valid_machine():
    return {
        "states": [
            {"state_id": "draft", "name": "Draft", "kind": "initial"},
            {"state_id": "submitted", "name": "Submitted", "kind": "active"},
            {"state_id": "enrolled", "name": "Enrolled", "kind": "terminal"},
        ],
        "transitions": [
            {
                "transition_id": "t_submit",
                "from": "draft",
                "to": "submitted",
                "action": "submit",
                "actor": "family",
                "guards": [],
                "effects": [
                    {"primitive": "commit_sections", "params": {"section_ids": ["student_section"]}}
                ],
            },
            {
                "transition_id": "t_approve",
                "from": "submitted",
                "to": "enrolled",
                "action": "approve",
                "actor": "staff",
                "guards": [{"primitive": "all_blocking_items_complete", "params": {}}],
                "effects": [],
            },
        ],
    }


def _broken_machine():
    """No terminal state, no outgoing transition from the initial state —
    trips several validate_definition rules at once; publish must reject."""
    return {
        "states": [{"state_id": "draft", "name": "Draft", "kind": "initial"}],
        "transitions": [],
    }


def _valid_steps():
    return [
        {
            "step_id": "student_details",
            "type": "form",
            "title": "Student details",
            "required": True,
            "blocking": True,
            "available_in": ["draft"],
            "show_if": None,
            "review": None,
            "config": {
                "sections": [
                    {
                        "section_id": "student_section",
                        "entity_model": "student",
                        "fields": [
                            {"name": "first_name", "required": True},
                            {"name": "last_name", "required": True},
                        ],
                        "mode": "create",
                        "repeat": None,
                    }
                ]
            },
        }
    ]


def _valid_models():
    return {
        "student": {
            "base_fields": [
                {"name": "student_id", "type": "str", "required": True},
                {"name": "first_name", "type": "str", "required": True},
                {"name": "last_name", "type": "str", "required": True},
            ],
            "custom_fields": [],
        }
    }


def _seed_definition(fake_dc, *, definition_id, version=1, status="draft",
                     lineage_status="active", machine=None, steps=None,
                     channel_access="staff_only", name="Enrollment"):
    base = {
        "definition_id": definition_id,
        "name": name,
        "version": version,
        "status": status,
        "lineage_status": lineage_status,
        "channel_access": channel_access,
        "machine": json.dumps(machine if machine is not None else _valid_machine()),
        "steps": json.dumps(steps if steps is not None else _valid_steps()),
    }
    created = fake_dc.dc_create(TENANT, "workflow_definition", base)
    return created["entity_id"]


def act(client, entity_id, action, **params):
    return client.post(
        f"/api/workflows/{TENANT}/definitions/{entity_id}/actions",
        json={"action": action, **params},
    )


# --- publish ------------------------------------------------------------


def test_publish_flips_draft_to_published_and_supersedes_prior(client, fake_dc):
    fake_dc.set_model(TENANT, "student", _valid_models()["student"])
    v1_eid = _seed_definition(fake_dc, definition_id="wd-lineage-1", version=1, status="published")
    v2_eid = _seed_definition(fake_dc, definition_id="wd-lineage-1", version=2, status="draft")

    resp = act(client, v2_eid, "publish")
    assert resp.status_code == 200
    assert resp.json()["base_data"]["status"] == "published"

    v2_row = fake_dc.get_entity(TENANT, "workflow_definition", v2_eid)
    assert v2_row["status"] == "published"
    v1_row = fake_dc.get_entity(TENANT, "workflow_definition", v1_eid)
    assert v1_row["status"] == "superseded"


def test_publish_invalid_machine_returns_409_with_errors(client, fake_dc):
    fake_dc.set_model(TENANT, "student", _valid_models()["student"])
    eid = _seed_definition(fake_dc, definition_id="wd-lineage-2", machine=_broken_machine())

    resp = act(client, eid, "publish")
    assert resp.status_code == 409
    errors = resp.json()["detail"]["errors"]
    assert isinstance(errors, list) and len(errors) > 0

    row = fake_dc.get_entity(TENANT, "workflow_definition", eid)
    assert row["status"] == "draft"


def test_publish_business_id_instead_of_entity_id_404s_and_leaves_row_draft(client, fake_dc):
    fake_dc.set_model(TENANT, "student", _valid_models()["student"])
    business_id = fake_dc.next_id(TENANT, "workflow_definition")
    real_eid = _seed_definition(fake_dc, definition_id=business_id)

    resp = act(client, business_id, "publish")
    assert resp.status_code == 404

    row = fake_dc.get_entity(TENANT, "workflow_definition", real_eid)
    assert row["status"] == "draft"


def test_publish_cross_tenant_row_404s(client, fake_dc):
    fake_dc.set_model(TENANT, "student", _valid_models()["student"])
    other_base = {
        "definition_id": "wd-other-tenant",
        "name": "Other",
        "version": 1,
        "status": "draft",
        "lineage_status": "active",
        "channel_access": "staff_only",
        "machine": json.dumps(_valid_machine()),
        "steps": json.dumps(_valid_steps()),
    }
    created = fake_dc.dc_create("globex", "workflow_definition", other_base)
    resp = act(client, created["entity_id"], "publish")
    assert resp.status_code == 404


def test_republish_already_published_row_is_idempotent(client, fake_dc):
    """Re-publishing the row that is ALREADY the published version of its
    lineage must not supersede itself, and must leave exactly one published
    row behind (coordinator review finding)."""
    fake_dc.set_model(TENANT, "student", _valid_models()["student"])
    eid = _seed_definition(fake_dc, definition_id="wd-lineage-idem", status="published")

    resp = act(client, eid, "publish")
    assert resp.status_code == 200

    row = fake_dc.get_entity(TENANT, "workflow_definition", eid)
    assert row["status"] == "published"

    published = [
        r for r in fake_dc.find("workflow_definition", definition_id="wd-lineage-idem")
        if r["status"] == "published"
    ]
    assert len(published) == 1
    assert published[0]["entity_id"] == eid


def test_publish_new_version_preserves_deprecated_lineage_status(client, fake_dc):
    """Coordinator review finding #1: deprecate(v1) -> publish(v2) must NOT
    silently revert the lineage to active. lineage_status is read from the
    published row (spec §3), so publish must carry it forward from the row
    it supersedes rather than defaulting the new row to "active"."""
    fake_dc.set_model(TENANT, "student", _valid_models()["student"])
    v1_eid = _seed_definition(fake_dc, definition_id="wd-lineage-deprecate-then-publish",
                              version=1, status="published")
    assert act(client, v1_eid, "deprecate").status_code == 200

    v2_eid = _seed_definition(fake_dc, definition_id="wd-lineage-deprecate-then-publish",
                              version=2, status="draft")
    resp = act(client, v2_eid, "publish")
    assert resp.status_code == 200
    assert resp.json()["base_data"]["lineage_status"] == "deprecated"

    from app.workflows.definitions import get_published_definition
    published = get_published_definition(TENANT, "wd-lineage-deprecate-then-publish")
    assert published["lineage_status"] == "deprecated"

    v1_row = fake_dc.get_entity(TENANT, "workflow_definition", v1_eid)
    assert v1_row["status"] == "superseded"


# --- deprecate / reactivate ------------------------------------------------


def test_deprecate_then_reactivate_lineage_status(client, fake_dc):
    fake_dc.set_model(TENANT, "student", _valid_models()["student"])
    eid = _seed_definition(fake_dc, definition_id="wd-lineage-3", status="published")

    resp = act(client, eid, "deprecate")
    assert resp.status_code == 200
    row = fake_dc.get_entity(TENANT, "workflow_definition", eid)
    assert row["lineage_status"] == "deprecated"

    resp = act(client, eid, "reactivate")
    assert resp.status_code == 200
    row = fake_dc.get_entity(TENANT, "workflow_definition", eid)
    assert row["lineage_status"] == "active"


def test_deprecate_against_draft_row_returns_409(client, fake_dc):
    """Coordinator review finding #2: deprecate/reactivate/archive must only
    act on the published row of a lineage."""
    fake_dc.set_model(TENANT, "student", _valid_models()["student"])
    eid = _seed_definition(fake_dc, definition_id="wd-lineage-draft-guard", status="draft")

    resp = act(client, eid, "deprecate")
    assert resp.status_code == 409
    assert "published" in resp.json()["detail"].lower()

    row = fake_dc.get_entity(TENANT, "workflow_definition", eid)
    assert row["lineage_status"] == "active"  # untouched


def test_reactivate_against_superseded_row_returns_409(client, fake_dc):
    fake_dc.set_model(TENANT, "student", _valid_models()["student"])
    eid = _seed_definition(fake_dc, definition_id="wd-lineage-superseded-guard",
                           status="superseded")

    resp = act(client, eid, "reactivate")
    assert resp.status_code == 409


# --- archive ------------------------------------------------------------
#
# `retire` was this action's name before archive/unarchive made it reversible.
# The legacy alias's own coverage lives in test_archive_lifecycle.py; these
# route-wiring tests exercise the current `archive` action only.


def _seed_instance(fake_dc, *, definition_id, closed_at=""):
    base = {
        "instance_id": fake_dc.next_id(TENANT, "workflow_instance"),
        "definition_id": definition_id,
        "definition_version": 1,
        "state": "draft",
        "channel_started": "family",
        "opened_at": "2026-08-01T00:00:00+00:00",
        "closed_at": closed_at,
    }
    return fake_dc.dc_create(TENANT, "workflow_instance", base)["entity_id"]


def test_archive_from_active_is_refused(client, fake_dc):
    """Archive is reachable only from `deprecated` — deprecating first is the
    window in which mid-flight work is allowed to finish."""
    fake_dc.set_model(TENANT, "student", _valid_models()["student"])
    eid = _seed_definition(fake_dc, definition_id="wd-lineage-4", status="published")
    _seed_instance(fake_dc, definition_id="wd-lineage-4", closed_at="")

    resp = act(client, eid, "archive")
    assert resp.status_code == 409
    assert resp.json()["detail"]["reason"] == "not_deprecated"

    row = fake_dc.get_entity(TENANT, "workflow_definition", eid)
    assert row["lineage_status"] == "active"


def test_archive_bulk_freezes_open_instances_then_archives(client, fake_dc):
    """Archive suspends whatever is still running — every open instance of the
    lineage goes through `machine.freeze_instance` before the lineage flips.
    There is no destructive variant: force archive was removed."""
    fake_dc.set_model(TENANT, "student", _valid_models()["student"])
    eid = _seed_definition(fake_dc, definition_id="wd-lineage-5", status="published")
    open_eid = _seed_instance(fake_dc, definition_id="wd-lineage-5", closed_at="")
    already_closed_eid = _seed_instance(
        fake_dc, definition_id="wd-lineage-5", closed_at="2026-08-02T00:00:00+00:00")

    assert act(client, eid, "deprecate").status_code == 200
    resp = act(client, eid, "archive")
    assert resp.status_code == 200

    row = fake_dc.get_entity(TENANT, "workflow_definition", eid)
    assert row["lineage_status"] == "archived"

    frozen_row = fake_dc.get_entity(TENANT, "workflow_instance", open_eid)
    assert frozen_row["frozen_at"]
    # freezing suspends: state untouched, still not closed
    assert frozen_row["state"] == "draft"
    assert not frozen_row["closed_at"]

    # the already-closed instance (excluded from the open-instance query) is untouched.
    untouched_row = fake_dc.get_entity(TENANT, "workflow_instance", already_closed_eid)
    assert untouched_row["state"] == "draft"
    assert not untouched_row.get("frozen_at")


def test_archive_with_no_open_instances_succeeds(client, fake_dc):
    fake_dc.set_model(TENANT, "student", _valid_models()["student"])
    eid = _seed_definition(fake_dc, definition_id="wd-lineage-6", status="published")
    _seed_instance(fake_dc, definition_id="wd-lineage-6", closed_at="2026-08-02T00:00:00+00:00")

    assert act(client, eid, "deprecate").status_code == 200
    resp = act(client, eid, "archive")
    assert resp.status_code == 200
    row = fake_dc.get_entity(TENANT, "workflow_definition", eid)
    assert row["lineage_status"] == "archived"


# --- model-impact ---------------------------------------------------------


def _model_impact_machine():
    return {
        "states": [
            {"state_id": "draft", "name": "Draft", "kind": "initial"},
            {"state_id": "submitted", "name": "Submitted", "kind": "terminal"},
        ],
        "transitions": [
            {
                "transition_id": "t1",
                "from": "draft",
                "to": "submitted",
                "action": "go",
                "actor": "staff",
                "guards": [
                    {
                        "primitive": "data_condition",
                        "params": {
                            "condition": {
                                "all": [{"source": "student_section.first_name", "op": "not_empty"}]
                            }
                        },
                    }
                ],
                "effects": [],
            }
        ],
    }


def _model_impact_steps():
    return [
        {
            "step_id": "student_details",
            "type": "form",
            "title": "Student details",
            "required": True,
            "blocking": True,
            "available_in": ["draft"],
            "show_if": None,
            "review": None,
            "config": {
                "sections": [
                    {
                        "section_id": "student_section",
                        "entity_model": "student",
                        "fields": [
                            {"name": "first_name", "required": True},
                            {"name": "last_name", "required": True},
                        ],
                        "mode": "create",
                        "repeat": None,
                    }
                ]
            },
        },
        {
            "step_id": "photo_step",
            "type": "message",
            "title": "Photo release",
            "required": False,
            "blocking": False,
            "available_in": ["draft"],
            "show_if": {"all": [{"source": "student_section.first_name", "op": "not_empty"}]},
            "review": None,
            "config": {"body": "Please review the photo release."},
        },
    ]


def _family_steps():
    return [
        {
            "step_id": "family_details",
            "type": "form",
            "title": "Family details",
            "required": True,
            "blocking": True,
            "available_in": ["draft"],
            "show_if": None,
            "review": None,
            "config": {
                "sections": [
                    {
                        "section_id": "family_section",
                        "entity_model": "family",
                        "fields": [{"name": "family_name", "required": True}],
                        "mode": "create",
                        "repeat": None,
                    }
                ]
            },
        }
    ]


def test_model_impact_returns_section_show_if_and_guard_references(client, fake_dc):
    _seed_definition(
        fake_dc, definition_id="wd-impact-1", status="published",
        machine=_model_impact_machine(), steps=_model_impact_steps(),
    )
    # A definition referencing a different entity_model must not show up.
    _seed_definition(
        fake_dc, definition_id="wd-impact-2", status="published", steps=_family_steps(),
    )
    # A draft referencing "student" must be excluded (model-impact scans
    # PUBLISHED definitions only).
    _seed_definition(
        fake_dc, definition_id="wd-impact-3", status="draft",
        machine=_model_impact_machine(), steps=_model_impact_steps(),
    )

    resp = client.get(f"/api/workflows/{TENANT}/model-impact?entity_type=student")
    assert resp.status_code == 200
    refs = resp.json()["references"]
    kinds = {r["kind"] for r in refs}
    assert kinds == {"section", "show_if", "guard"}
    assert all(r["definition_id"] == "wd-impact-1" for r in refs)
    assert all(r["entity_id"] and r["version"] == 1 for r in refs)


def test_model_impact_field_filter_narrows_to_matching_field(client, fake_dc):
    _seed_definition(
        fake_dc, definition_id="wd-impact-4", status="published",
        machine=_model_impact_machine(), steps=_model_impact_steps(),
    )
    _seed_definition(
        fake_dc, definition_id="wd-impact-5", status="published", steps=_family_steps(),
    )

    resp = client.get(f"/api/workflows/{TENANT}/model-impact?entity_type=student&field=last_name")
    refs = resp.json()["references"]
    # Only the section field-pick references last_name; show_if/guard both
    # reference first_name only.
    assert {r["kind"] for r in refs} == {"section"}

    resp = client.get(f"/api/workflows/{TENANT}/model-impact?entity_type=family")
    refs = resp.json()["references"]
    assert len(refs) == 1
    assert refs[0]["definition_id"] == "wd-impact-5"


def test_model_impact_is_tenant_scoped(client, fake_dc):
    """A published definition in another tenant referencing the same
    entity_type must never leak into this tenant's model-impact scan."""
    _seed_definition(
        fake_dc, definition_id="wd-impact-6", status="published",
        machine=_model_impact_machine(), steps=_model_impact_steps(),
    )
    other_base = {
        "definition_id": "wd-impact-other-tenant",
        "name": "Other tenant",
        "version": 1,
        "status": "published",
        "lineage_status": "active",
        "channel_access": "staff_only",
        "machine": json.dumps(_model_impact_machine()),
        "steps": json.dumps(_model_impact_steps()),
    }
    fake_dc.dc_create("globex", "workflow_definition", other_base)

    resp = client.get(f"/api/workflows/{TENANT}/model-impact?entity_type=student")
    refs = resp.json()["references"]
    assert refs  # this tenant's own reference is still present
    assert all(r["definition_id"] == "wd-impact-6" for r in refs)


# --- new_draft ----------------------------------------------------------


def test_new_draft_creates_next_version_from_published(client, fake_dc):
    published = _seed_definition(fake_dc, definition_id="enroll", version=3,
                                 status="published", lineage_status="active")

    resp = act(client, published, "new_draft")

    assert resp.status_code == 200
    row = resp.json()
    assert row["status"] == "draft"
    assert int(row["version"]) == 4
    assert row["definition_id"] == "enroll"
    # A brand-new row, not a mutation of the published one.
    assert row["entity_id"] != published


def test_new_draft_carries_lineage_status_forward(client, fake_dc):
    published = _seed_definition(fake_dc, definition_id="enroll", version=3,
                                 status="published", lineage_status="deprecated")

    row = act(client, published, "new_draft").json()

    assert row["lineage_status"] == "deprecated"


def test_new_draft_copies_authored_content(client, fake_dc):
    published = _seed_definition(fake_dc, definition_id="enroll", version=3,
                                 status="published", name="Enrollment",
                                 channel_access="family")

    row = act(client, published, "new_draft").json()

    assert row["name"] == "Enrollment"
    assert row["channel_access"] == "family"
    # machine/steps stay JSON-encoded strings across the copy.
    assert json.loads(row["machine"]) == _valid_machine()
    assert json.loads(row["steps"]) == _valid_steps()


def test_new_draft_refuses_when_a_draft_already_exists(client, fake_dc):
    published = _seed_definition(fake_dc, definition_id="enroll", version=3,
                                 status="published")
    existing = _seed_definition(fake_dc, definition_id="enroll", version=4,
                                status="draft")

    resp = act(client, published, "new_draft")

    assert resp.status_code == 409
    detail = resp.json()["detail"]
    assert detail["reason"] == "draft_exists"
    assert detail["entity_id"] == existing


def test_new_draft_ignores_a_draft_in_another_lineage(client, fake_dc):
    published = _seed_definition(fake_dc, definition_id="enroll", version=3,
                                 status="published")
    _seed_definition(fake_dc, definition_id="camp", version=1, status="draft")

    assert act(client, published, "new_draft").status_code == 200


def test_new_draft_refuses_on_an_archived_lineage(client, fake_dc):
    published = _seed_definition(fake_dc, definition_id="enroll", version=3,
                                 status="published", lineage_status="archived")

    resp = act(client, published, "new_draft")

    assert resp.status_code == 409
    assert resp.json()["detail"]["reason"] == "lineage_archived"


def test_new_draft_refuses_on_a_retired_lineage(client, fake_dc):
    """`retired` is the legacy alias for `archived` and must gate identically."""
    published = _seed_definition(fake_dc, definition_id="enroll", version=3,
                                 status="published", lineage_status="retired")

    resp = act(client, published, "new_draft")

    assert resp.status_code == 409
    assert resp.json()["detail"]["reason"] == "lineage_archived"


def test_new_draft_refuses_on_a_draft_row(client, fake_dc):
    draft = _seed_definition(fake_dc, definition_id="enroll", version=1, status="draft")

    resp = act(client, draft, "new_draft")

    assert resp.status_code == 409
    assert resp.json()["detail"]["reason"] == "not_published"


def test_new_draft_refuses_on_a_superseded_row(client, fake_dc):
    superseded = _seed_definition(fake_dc, definition_id="enroll", version=1,
                                  status="superseded")

    resp = act(client, superseded, "new_draft")

    assert resp.status_code == 409
    assert resp.json()["detail"]["reason"] == "not_published"


def test_new_draft_404s_on_an_unknown_entity(client, fake_dc):
    assert act(client, "no-such-entity", "new_draft").status_code == 404
