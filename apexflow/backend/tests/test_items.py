"""Item-op tests (Task 6): save_draft, complete_item, verify/reject/waive
authority matrix, applicable_items dynamic show_if.

Written first per TDD — app.workflows.engine does not exist yet at the time
these were drafted, so this file was confirmed failing at collection before
engine.py existed. All item ops are unit-tested directly against
app.workflows.engine (per task-6-brief.md: "Item ops get NO routes in this
task ... unit-test the functions directly").
"""
import json

import pytest
from fastapi import HTTPException

from app.workflows import engine
from app.workflows.schema import StepDef

TENANT = "acme"


# --- fixtures -------------------------------------------------------------


def _machine():
    return {
        "states": [
            {"state_id": "draft", "name": "Draft", "kind": "initial"},
            {"state_id": "submitted", "name": "Submitted", "kind": "terminal"},
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
            }
        ],
    }


def _steps():
    return [
        {
            "step_id": "form_auto",
            "type": "form",
            "title": "Auto-verified form",
            "required": True,
            "blocking": True,
            "available_in": ["draft"],
            "show_if": None,
            "review": None,  # default for form -> auto
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
            "step_id": "form_staff",
            "type": "form",
            "title": "Staff-reviewed form",
            "required": True,
            "blocking": True,
            "available_in": ["draft"],
            "show_if": None,
            "review": "staff",
            "config": {
                "sections": [
                    {
                        "section_id": "extra_section",
                        "entity_model": "student",
                        "fields": [{"name": "first_name", "required": False}],
                        "mode": "create",
                        "repeat": None,
                    }
                ]
            },
        },
        {
            "step_id": "docs_default",
            "type": "documents",
            "title": "Docs (staff default)",
            "required": True,
            "blocking": True,
            "available_in": ["draft"],
            "show_if": None,
            "review": None,  # default for documents -> staff
            "config": {"docs": [{"name": "ID"}]},
        },
        {
            "step_id": "docs_auto",
            "type": "documents",
            "title": "Docs (auto)",
            "required": False,
            "blocking": False,
            "available_in": ["draft"],
            "show_if": None,
            "review": "auto",
            "config": {"docs": [{"name": "Photo"}]},
        },
    ]


def _models():
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


def _setup(fake_dc):
    """Seed a published definition and create one instance against it.
    Returns (instance_row [FLATTENED], items_by_step_id [creation envelopes])."""
    fake_dc.set_model(TENANT, "student", _models()["student"])
    base = {
        "definition_id": "wd-items-1",
        "name": "Enrollment",
        "version": 1,
        "status": "published",
        "lineage_status": "active",
        "channel_access": "family",
        "machine": json.dumps(_machine()),
        "steps": json.dumps(_steps()),
    }
    fake_dc.dc_create(TENANT, "workflow_definition", base)

    result = engine.create_instance(TENANT, "wd-items-1", {}, "family")
    instance_eid = result["instance"]["entity_id"]
    instance_row = fake_dc.get_entity(TENANT, "workflow_instance", instance_eid)
    items = {i["base_data"]["step_id"]: i for i in result["items"]}
    return instance_row, items


def _refresh_instance(fake_dc, instance_row):
    return fake_dc.get_entity(TENANT, "workflow_instance", instance_row["entity_id"])


def _set_payload_ref(fake_dc, item_eid, ref="doc-1"):
    item = fake_dc.get_entity(TENANT, "workflow_item", item_eid)
    base = engine._item_base_data(item)
    base["payload_ref"] = ref
    return fake_dc.dc_update(TENANT, "workflow_item", item_eid, base)


# --- REVIEW_DEFAULTS / is_family_actor -------------------------------------


def test_review_defaults_constant():
    assert engine.REVIEW_DEFAULTS == {"form": "auto", "documents": "staff", "message": "auto"}


def test_is_family_actor():
    assert engine.is_family_actor("family:tok1") is True
    assert engine.is_family_actor("staff-u1") is False


# --- save_draft -------------------------------------------------------------


def test_save_draft_rejects_context_key(fake_dc):
    instance_row, _ = _setup(fake_dc)
    with pytest.raises(HTTPException) as exc:
        engine.save_draft(TENANT, instance_row, {"context": {"school_year": "2026"}}, "family:tok1")
    assert exc.value.status_code == 400


def test_save_draft_rejects_engine_owned_field(fake_dc):
    instance_row, _ = _setup(fake_dc)
    with pytest.raises(HTTPException) as exc:
        engine.save_draft(TENANT, instance_row, {"student_section": {"state": "enrolled"}},
                          "family:tok1")
    assert exc.value.status_code == 400
    assert "state" in exc.value.detail["fields"]


def test_save_draft_shallow_merges_per_section_and_writes_no_activity(fake_dc):
    instance_row, _ = _setup(fake_dc)

    engine.save_draft(TENANT, instance_row, {"student_section": {"first_name": "Ada"}}, "family:tok1")
    refreshed = _refresh_instance(fake_dc, instance_row)
    assert json.loads(refreshed["draft_data"]) == {"student_section": {"first_name": "Ada"}}

    updated = engine.save_draft(TENANT, refreshed, {"student_section": {"last_name": "Lovelace"}},
                                "family:tok1")
    draft = json.loads(updated["base_data"]["draft_data"])
    assert draft == {"student_section": {"first_name": "Ada", "last_name": "Lovelace"}}

    # create_instance itself writes one state_change activity; save_draft
    # must add nothing on top of it (autosave-noise avoidance).
    activities = fake_dc.find("workflow_activity", instance_id=instance_row["entity_id"])
    assert len(activities) == 1
    assert activities[0]["type"] == "state_change"


# --- complete_item: form ----------------------------------------------------


def test_complete_item_form_missing_required_fields_409(fake_dc):
    instance_row, items = _setup(fake_dc)
    item_eid = items["form_auto"]["entity_id"]

    with pytest.raises(HTTPException) as exc:
        engine.complete_item(TENANT, instance_row, item_eid, "family:tok1")
    assert exc.value.status_code == 409
    missing = exc.value.detail["missing"]
    assert "student_section.first_name" in missing
    assert "student_section.last_name" in missing


def test_complete_item_form_review_auto_verifies(fake_dc):
    instance_row, items = _setup(fake_dc)
    engine.save_draft(TENANT, instance_row,
                      {"student_section": {"first_name": "Ada", "last_name": "Lovelace"}},
                      "family:tok1")
    refreshed = _refresh_instance(fake_dc, instance_row)
    item_eid = items["form_auto"]["entity_id"]

    updated = engine.complete_item(TENANT, refreshed, item_eid, "family:tok1")
    assert updated["base_data"]["status"] == "verified"
    assert updated["base_data"]["completed_by"] == "family:tok1"

    activities = fake_dc.find("workflow_activity", instance_id=instance_row["entity_id"],
                              type="item_change")
    assert len(activities) == 1
    assert activities[0]["to_value"] == "verified"


def test_complete_item_form_review_staff_submits(fake_dc):
    instance_row, items = _setup(fake_dc)
    # form_staff's only field pick is not required, so no missing-fields 409.
    item_eid = items["form_staff"]["entity_id"]

    updated = engine.complete_item(TENANT, instance_row, item_eid, "family:tok1")
    assert updated["base_data"]["status"] == "submitted"


# --- complete_item: documents -----------------------------------------------


def test_complete_item_documents_requires_payload_ref(fake_dc):
    instance_row, items = _setup(fake_dc)
    item_eid = items["docs_default"]["entity_id"]

    with pytest.raises(HTTPException) as exc:
        engine.complete_item(TENANT, instance_row, item_eid, "family:tok1")
    assert exc.value.status_code == 409


def test_complete_item_documents_review_default_submits_after_payload_ref(fake_dc):
    instance_row, items = _setup(fake_dc)
    item_eid = items["docs_default"]["entity_id"]
    _set_payload_ref(fake_dc, item_eid)

    updated = engine.complete_item(TENANT, instance_row, item_eid, "family:tok1")
    assert updated["base_data"]["status"] == "submitted"


def test_complete_item_documents_review_auto_verifies_after_payload_ref(fake_dc):
    instance_row, items = _setup(fake_dc)
    item_eid = items["docs_auto"]["entity_id"]
    _set_payload_ref(fake_dc, item_eid, ref="doc-2")

    updated = engine.complete_item(TENANT, instance_row, item_eid, "family:tok1")
    assert updated["base_data"]["status"] == "verified"


# --- item lookup / instance-membership guard --------------------------------


def test_complete_item_wrong_instance_404s(fake_dc):
    instance_row, _items = _setup(fake_dc)
    other_result = engine.create_instance(TENANT, "wd-items-1", {}, "family")
    other_item_eid = other_result["items"][0]["entity_id"]

    with pytest.raises(HTTPException) as exc:
        engine.complete_item(TENANT, instance_row, other_item_eid, "family:tok1")
    assert exc.value.status_code == 404


# --- verify_item / reject_item / waive_item: staff-only ---------------------


def test_family_actor_cannot_verify_item_403(fake_dc):
    instance_row, items = _setup(fake_dc)
    item_eid = items["form_staff"]["entity_id"]
    engine.complete_item(TENANT, instance_row, item_eid, "family:tok1")  # -> submitted

    with pytest.raises(HTTPException) as exc:
        engine.verify_item(TENANT, instance_row, item_eid, "family:tok1")
    assert exc.value.status_code == 403


def test_staff_can_verify_submitted_item(fake_dc):
    instance_row, items = _setup(fake_dc)
    item_eid = items["form_staff"]["entity_id"]
    engine.complete_item(TENANT, instance_row, item_eid, "family:tok1")  # -> submitted

    updated = engine.verify_item(TENANT, instance_row, item_eid, "staff-u1")
    assert updated["base_data"]["status"] == "verified"


def test_verify_item_wrong_source_status_409(fake_dc):
    instance_row, items = _setup(fake_dc)
    item_eid = items["docs_default"]["entity_id"]  # still not_started

    with pytest.raises(HTTPException) as exc:
        engine.verify_item(TENANT, instance_row, item_eid, "staff-u1")
    assert exc.value.status_code == 409


def test_reject_item_staff_only(fake_dc):
    instance_row, items = _setup(fake_dc)
    item_eid = items["form_staff"]["entity_id"]
    engine.complete_item(TENANT, instance_row, item_eid, "family:tok1")

    with pytest.raises(HTTPException) as exc:
        engine.reject_item(TENANT, instance_row, item_eid, "family:tok1")
    assert exc.value.status_code == 403

    updated = engine.reject_item(TENANT, instance_row, item_eid, "staff-u1")
    assert updated["base_data"]["status"] == "rejected"


def test_waive_family_actor_403(fake_dc):
    instance_row, items = _setup(fake_dc)
    item_eid = items["docs_default"]["entity_id"]

    with pytest.raises(HTTPException) as exc:
        engine.waive_item(TENANT, instance_row, item_eid, "family:tok1")
    assert exc.value.status_code == 403


def test_waive_from_any_non_verified_status(fake_dc):
    instance_row, items = _setup(fake_dc)
    for step_id in ("form_auto", "form_staff", "docs_default", "docs_auto"):
        item_eid = items[step_id]["entity_id"]
        updated = engine.waive_item(TENANT, instance_row, item_eid, "staff-u1")
        assert updated["base_data"]["status"] == "waived"


def test_waive_after_verified_409(fake_dc):
    instance_row, items = _setup(fake_dc)
    engine.save_draft(TENANT, instance_row,
                      {"student_section": {"first_name": "Ada", "last_name": "Lovelace"}},
                      "family:tok1")
    refreshed = _refresh_instance(fake_dc, instance_row)
    item_eid = items["form_auto"]["entity_id"]
    engine.complete_item(TENANT, refreshed, item_eid, "family:tok1")  # -> verified (auto)

    with pytest.raises(HTTPException) as exc:
        engine.waive_item(TENANT, instance_row, item_eid, "staff-u1")
    assert exc.value.status_code == 409


# --- applicable_items: dynamic show_if --------------------------------------


def _step(step_id, show_if=None, step_type="message"):
    return StepDef.model_validate({
        "step_id": step_id, "type": step_type, "title": "T", "required": False,
        "blocking": False, "available_in": ["draft"], "show_if": show_if,
        "review": None, "config": {},
    })


def test_applicable_items_hides_and_reveals_by_show_if():
    steps = [
        _step("always"),
        _step("conditional", show_if={
            "all": [{"source": "student_section.wants_bus", "op": "truthy"}]
        }),
    ]
    items = [
        {"item_id": "i1", "step_id": "always"},
        {"item_id": "i2", "step_id": "conditional"},
    ]

    hidden = engine.applicable_items(steps, items, {"student_section": {"wants_bus": False}}, {})
    assert [i["item_id"] for i in hidden] == ["i1"]

    revealed = engine.applicable_items(steps, items, {"student_section": {"wants_bus": True}}, {})
    assert {i["item_id"] for i in revealed} == {"i1", "i2"}


def test_applicable_items_uses_context_prefixed_sources():
    steps = [_step("summer_only", show_if={
        "all": [{"source": "context.school_year", "op": "eq", "value": "2026-2027"}]
    })]
    items = [{"item_id": "i1", "step_id": "summer_only"}]

    assert engine.applicable_items(steps, items, {}, {"school_year": "2025-2026"}) == []
    assert [i["item_id"] for i in
            engine.applicable_items(steps, items, {}, {"school_year": "2026-2027"})] == ["i1"]
