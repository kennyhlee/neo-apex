# apexflow/backend/tests/test_primitives.py
"""Table-driven tests for app.workflows.primitives (Task 7): the
GUARDS/EFFECTS registries and EvalContext.

See task-7-report.md for the linking-id-form / match-heuristic /
due-clocks-source decisions this suite locks in.
"""
import json
from datetime import datetime, timedelta, timezone

import pytest
from fastapi import HTTPException

from app.workflows.primitives import EFFECTS, GUARDS, EvalContext
from app.workflows.schema import MachineDef, StateDef, StepDef
from tests.fakes import FakeDataCore

TENANT = "acme"


def _machine() -> MachineDef:
    return MachineDef(
        states=[
            StateDef(state_id="draft", name="Draft", kind="initial"),
            StateDef(state_id="done", name="Done", kind="terminal"),
        ],
        transitions=[],
    )


def _definition(steps: list[StepDef], definition_id: str = "wf-lineage-1", version: int = 1) -> dict:
    return {"machine": _machine(), "steps": steps, "definition_id": definition_id, "version": version}


def _ctx(**overrides) -> EvalContext:
    defaults = dict(
        tenant_id=TENANT,
        instance={"entity_id": "inst-1", "subject_refs": "{}", "applicant_email": ""},
        items=[],
        definition=_definition([]),
        draft={},
        context={},
        models={},
        actor="family",
        now=datetime(2026, 6, 1, tzinfo=timezone.utc),
        token=None,
    )
    defaults.update(overrides)
    return EvalContext(**defaults)


def _step(step_id="s1", type_="form", config=None, show_if=None) -> StepDef:
    return StepDef(
        step_id=step_id, type=type_, title="Step", required=True, blocking=True,
        available_in=["draft"], config=config or {}, show_if=show_if,
    )


# --- guards: all_blocking_items_complete -----------------------------------


@pytest.mark.parametrize(
    "items, expected",
    [
        ([], True),  # vacuously true, no items at all
        ([{"step_id": "s1", "blocking": "true", "status": "not_started"}], False),
        ([{"step_id": "s1", "blocking": "true", "status": "submitted"}], True),
        ([{"step_id": "s1", "blocking": "true", "status": "verified"}], True),
        ([{"step_id": "s1", "blocking": "true", "status": "waived"}], True),
        ([{"step_id": "s1", "blocking": "false", "status": "not_started"}], True),  # non-blocking, ignored
        (
            [
                {"step_id": "s1", "blocking": "true", "status": "submitted"},
                {"step_id": "s1", "blocking": "true", "status": "not_started"},
            ],
            False,
        ),
    ],
)
def test_all_blocking_items_complete(items, expected):
    ctx = _ctx(items=items, definition=_definition([_step()]))
    assert GUARDS["all_blocking_items_complete"](ctx, {}) is expected


# --- guards: items_in_status -------------------------------------------


def test_items_in_status_filters_by_step_ids():
    items = [
        {"step_id": "s1", "status": "verified"},
        {"step_id": "s2", "status": "not_started"},
    ]
    ctx = _ctx(items=items, definition=_definition([_step("s1"), _step("s2")]))
    assert GUARDS["items_in_status"](ctx, {"step_ids": ["s1"], "status": "verified"}) is True
    assert GUARDS["items_in_status"](ctx, {"status": "verified"}) is False  # s2 not verified


def test_items_in_status_respects_show_if_applicability():
    from app.workflows.schema import Condition, ConditionGroup

    hidden_step = _step("s2", show_if=ConditionGroup(all_=[Condition(source="context.x", op="eq", value="yes")]))
    items = [{"step_id": "s1", "status": "verified"}, {"step_id": "s2", "status": "not_started"}]
    ctx = _ctx(items=items, definition=_definition([_step("s1"), hidden_step]), context={})
    # s2 is inapplicable (context.x != "yes"), so only s1 is checked -> all verified
    assert GUARDS["items_in_status"](ctx, {"status": "verified"}) is True


# --- guards: capacity_available (boundary is the key assertion) -----------


def _seed_tenant_capacity(fake_dc: FakeDataCore, capacity: int) -> None:
    fake_dc.rows.append(FakeDataCore._store_row(TENANT, "tenant", TENANT, {"capacity": capacity}))


def _seed_instance(fake_dc: FakeDataCore, definition_id: str, state: str, context: dict | None = None) -> None:
    fake_dc.dc_create(TENANT, "workflow_instance", {
        "definition_id": definition_id, "state": state,
        "context": json.dumps(context or {}),
    })


def test_capacity_available_exactly_at_capacity_is_false(fake_dc):
    _seed_tenant_capacity(fake_dc, 2)
    _seed_instance(fake_dc, "wf-lineage-1", "approved")
    _seed_instance(fake_dc, "wf-lineage-1", "approved")
    ctx = _ctx()
    assert GUARDS["capacity_available"](
        ctx, {"count_states": ["approved"], "capacity_field": "capacity"}
    ) is False


def test_capacity_available_below_capacity_is_true(fake_dc):
    _seed_tenant_capacity(fake_dc, 2)
    _seed_instance(fake_dc, "wf-lineage-1", "approved")
    ctx = _ctx()
    assert GUARDS["capacity_available"](
        ctx, {"count_states": ["approved"], "capacity_field": "capacity"}
    ) is True


@pytest.mark.parametrize("raw_capacity", [None, 0])
def test_capacity_available_missing_or_zero_is_unlimited(fake_dc, raw_capacity):
    if raw_capacity is not None:
        _seed_tenant_capacity(fake_dc, raw_capacity)
    else:
        fake_dc.rows.append(FakeDataCore._store_row(TENANT, "tenant", TENANT, {}))
    for _ in range(50):
        _seed_instance(fake_dc, "wf-lineage-1", "approved")
    ctx = _ctx()
    assert GUARDS["capacity_available"](
        ctx, {"count_states": ["approved"], "capacity_field": "capacity"}
    ) is True


def test_capacity_available_scoped_by_context_key(fake_dc):
    _seed_tenant_capacity(fake_dc, 1)
    _seed_instance(fake_dc, "wf-lineage-1", "approved", {"school_year": "2025-2026"})
    ctx = _ctx(context={"school_year": "2026-2027"})
    # the only existing 'approved' instance is a DIFFERENT school_year -> not counted
    assert GUARDS["capacity_available"](
        ctx, {"count_states": ["approved"], "capacity_field": "capacity", "scope_context_key": "school_year"}
    ) is True


def test_capacity_available_excludes_own_instance_row(fake_dc):
    """A guard evaluated while the EVALUATING instance's own current state is
    already one of count_states (e.g. re-evaluating a transition out of an
    approved-like state) must not have that row inflate the count it's being
    measured against — capacity 1, no OTHER rows, self already 'approved'
    -> still available."""
    _seed_tenant_capacity(fake_dc, 1)
    created = fake_dc.dc_create(TENANT, "workflow_instance", {
        "definition_id": "wf-lineage-1", "state": "approved", "context": "{}",
    })
    self_row = fake_dc.get_entity(TENANT, "workflow_instance", created["entity_id"])
    ctx = _ctx(instance=self_row)
    assert GUARDS["capacity_available"](
        ctx, {"count_states": ["approved"], "capacity_field": "capacity"}
    ) is True


# --- guards: data_condition -------------------------------------------


def test_data_condition_reads_draft_and_context():
    from app.workflows.schema import Condition, ConditionGroup

    ctx = _ctx(draft={"family_section": {"family_name": "Smith"}}, context={"school_year": "2026-2027"})
    cond = ConditionGroup(all_=[
        Condition(source="family_section.family_name", op="eq", value="Smith"),
        Condition(source="context.school_year", op="eq", value="2026-2027"),
    ]).model_dump(by_alias=True)
    assert GUARDS["data_condition"](ctx, {"condition": cond}) is True


# --- guards: date_window (end-inclusive is the key assertion) -------------


def test_date_window_end_is_inclusive():
    ctx = _ctx(now=datetime(2026, 8, 5, 23, 59, 59, 999999, tzinfo=timezone.utc))
    assert GUARDS["date_window"](ctx, {"end": "2026-08-05"}) is True


def test_date_window_after_end_is_false():
    ctx = _ctx(now=datetime(2026, 8, 6, 0, 0, 0, tzinfo=timezone.utc))
    assert GUARDS["date_window"](ctx, {"end": "2026-08-05"}) is False


def test_date_window_before_start_is_false():
    ctx = _ctx(now=datetime(2026, 7, 31, 23, 59, 59, tzinfo=timezone.utc))
    assert GUARDS["date_window"](ctx, {"start": "2026-08-01"}) is False


def test_date_window_within_bounds_is_true():
    ctx = _ctx(now=datetime(2026, 8, 3, tzinfo=timezone.utc))
    assert GUARDS["date_window"](ctx, {"start": "2026-08-01", "end": "2026-08-05"}) is True


def test_date_window_no_bounds_is_always_true():
    ctx = _ctx()
    assert GUARDS["date_window"](ctx, {}) is True


# --- guards: actor_role -------------------------------------------------


@pytest.mark.parametrize(
    "actor, roles, expected",
    [
        ("family", ["family"], True),
        ("family:parent-1", ["family"], True),
        ("staff-user-7", ["staff"], True),
        ("staff-user-7", ["admin"], True),  # Phase 1: staff/admin indistinguishable
        ("family", ["staff"], False),
        ("staff-user-7", ["family"], False),
        ("family_advocate_007", ["family"], False),  # not a bare startswith("family") match
    ],
)
def test_actor_role(actor, roles, expected):
    ctx = _ctx(actor=actor)
    assert GUARDS["actor_role"](ctx, {"roles": roles}) is expected


# --- effects: commit_sections (4-section fixture: family -> student ->
# contacts(repeat) -> registration_application) -----------------------------


def _family_section():
    return {
        "section_id": "family_section", "entity_model": "family", "mode": "create",
        "fields": [{"name": "family_name", "required": True}, {"name": "primary_email", "required": False}],
    }


def _student_section(extra_fields=None):
    fields = [{"name": "first_name", "required": True}, {"name": "last_name", "required": True}]
    fields += extra_fields or []
    return {"section_id": "student_section", "entity_model": "student", "mode": "create", "fields": fields}


def _contacts_section():
    return {
        "section_id": "contacts_section", "entity_model": "contact", "mode": "create",
        "fields": [{"name": "first_name", "required": True}, {"name": "phone", "required": False}],
        "repeat": {"min": 0, "max": 5},
    }


def _app_section():
    return {
        "section_id": "app_section", "entity_model": "registration_application", "mode": "create",
        "fields": [{"name": "school_year", "required": True}],
    }


def _four_section_models():
    return {
        "family": {"base_fields": [
            {"name": "family_name", "type": "str", "required": True},
            {"name": "primary_email", "type": "email", "required": False},
        ], "custom_fields": []},
        "student": {"base_fields": [
            {"name": "first_name", "type": "str", "required": True},
            {"name": "last_name", "type": "str", "required": True},
            {"name": "family_id", "type": "str", "required": False},
        ], "custom_fields": []},
        "contact": {"base_fields": [
            {"name": "first_name", "type": "str", "required": True},
            {"name": "phone", "type": "str", "required": False},
            {"name": "family_id", "type": "str", "required": False},
        ], "custom_fields": []},
        "registration_application": {"base_fields": [
            {"name": "school_year", "type": "str", "required": True},
            {"name": "student_id", "type": "str", "required": False},
            {"name": "family_id", "type": "str", "required": False},
        ], "custom_fields": []},
    }


def _four_section_step():
    return _step("s1", config={"sections": [
        _family_section(), _student_section(), _contacts_section(), _app_section(),
    ]})


def _seeded_instance(fake_dc: FakeDataCore, **base) -> dict:
    """commit_sections persists subject_refs to the instance row after every
    section, via dc_update — the fake's dc_update is upsert-refusing (an
    intentional divergence, see fakes.py's docstring point 5), so every
    commit_sections test needs a REAL workflow_instance row behind ctx.instance,
    not just a bare dict with an entity_id."""
    created = fake_dc.dc_create(TENANT, "workflow_instance", {
        "subject_refs": "{}", "applicant_email": "", **base,
    })
    return fake_dc.get_entity(TENANT, "workflow_instance", created["entity_id"])


def test_commit_sections_order_and_link_field_injection(fake_dc):
    draft = {
        "family_section": {"family_name": "Smith Family", "primary_email": "a@example.com"},
        "student_section": {"first_name": "Jo", "last_name": "Smith"},
        "contacts_section": [
            {"first_name": "Aunt Jane", "phone": "555-1111"},
            {"first_name": "Uncle Bob"},
        ],
        "app_section": {"school_year": "2026-2027"},
    }
    ctx = _ctx(
        instance=_seeded_instance(fake_dc),
        draft=draft, models=_four_section_models(),
        definition=_definition([_four_section_step()]),
    )
    EFFECTS["commit_sections"](ctx, {
        "section_ids": ["family_section", "student_section", "contacts_section", "app_section"],
    })

    families = fake_dc.find("family")
    students = fake_dc.find("student")
    contacts = fake_dc.find("contact")
    apps = fake_dc.find("registration_application")
    assert len(families) == 1
    assert len(students) == 1
    assert len(contacts) == 2
    assert len(apps) == 1

    family_entity_id = families[0]["entity_id"]
    # link-field injection: student.family_id / contact.family_id / both
    # registration_application link fields carry the EARLIER entity's
    # DataCore entity_id (not its business id) -- see primitives.py's
    # module docstring, decision 1.
    assert students[0]["family_id"] == family_entity_id
    assert contacts[0]["family_id"] == family_entity_id
    assert contacts[1]["family_id"] == family_entity_id
    assert apps[0]["family_id"] == family_entity_id
    assert apps[0]["student_id"] == students[0]["entity_id"]

    subject_refs = json.loads(ctx.instance["subject_refs"])
    assert subject_refs["family_id"] == family_entity_id
    assert subject_refs["student_id"] == students[0]["entity_id"]
    assert set(subject_refs["contact_id"]) == {c["entity_id"] for c in contacts}
    assert subject_refs["registration_application_id"] == apps[0]["entity_id"]


def test_commit_sections_orphan_tolerant_writes_field_model_no_longer_declares(fake_dc):
    student_section = _student_section(extra_fields=[{"name": "middle_name", "required": False}])
    step = _step("s1", config={"sections": [_family_section(), student_section]})
    models = _four_section_models()  # student model has no "middle_name" field
    draft = {
        "family_section": {"family_name": "Doe Family"},
        "student_section": {"first_name": "Al", "last_name": "Doe", "middle_name": "X"},
    }
    ctx = _ctx(instance=_seeded_instance(fake_dc), draft=draft, models=models, definition=_definition([step]))
    EFFECTS["commit_sections"](ctx, {"section_ids": ["family_section", "student_section"]})

    students = fake_dc.find("student")
    assert len(students) == 1
    assert students[0]["middle_name"] == "X"  # written despite the model not declaring it


def test_commit_sections_strips_engine_owned_fields(fake_dc):
    section = {
        "section_id": "family_section", "entity_model": "family", "mode": "create",
        "fields": [{"name": "family_name", "required": True}, {"name": "context", "required": False}],
    }
    step = _step("s1", config={"sections": [section]})
    draft = {"family_section": {"family_name": "Owned Test", "context": "should-not-write"}}
    ctx = _ctx(instance=_seeded_instance(fake_dc), draft=draft, models={}, definition=_definition([step]))
    EFFECTS["commit_sections"](ctx, {"section_ids": ["family_section"]})

    families = fake_dc.find("family")
    assert len(families) == 1
    assert "context" not in families[0] or families[0]["context"] is None


def test_commit_sections_missing_required_field_raises_409(fake_dc):
    step = _step("s1", config={"sections": [_family_section()]})
    draft = {"family_section": {"primary_email": "no-name@example.com"}}  # family_name missing
    ctx = _ctx(draft=draft, models=_four_section_models(), definition=_definition([step]))
    with pytest.raises(HTTPException) as exc_info:
        EFFECTS["commit_sections"](ctx, {"section_ids": ["family_section"]})
    assert exc_info.value.status_code == 409
    assert "family_section.family_name" in exc_info.value.detail["missing"]
    assert fake_dc.find("family") == []  # nothing written


def test_commit_sections_match_or_create_matches_existing_family(fake_dc):
    fake_dc.dc_create(TENANT, "family", {"family_name": "Existing Family"})
    existing_id = fake_dc.find("family")[0]["entity_id"]

    section = dict(_family_section())
    section["mode"] = "match_or_create"
    step = _step("s1", config={"sections": [section]})
    draft = {"family_section": {"family_name": "existing family"}}  # case-insensitive match
    ctx = _ctx(instance=_seeded_instance(fake_dc), draft=draft, models=_four_section_models(),
               definition=_definition([step]))
    EFFECTS["commit_sections"](ctx, {"section_ids": ["family_section"]})

    assert len(fake_dc.find("family")) == 1  # no new row created
    subject_refs = json.loads(ctx.instance["subject_refs"])
    assert subject_refs["family_id"] == existing_id


# --- effects: set_entity_field --------------------------------------------


def test_set_entity_field_instance(fake_dc):
    fake_dc.dc_create(TENANT, "workflow_instance", {"state": "draft"})
    row = fake_dc.find("workflow_instance")[0]
    ctx = _ctx(instance=dict(row))
    EFFECTS["set_entity_field"](ctx, {"ref": "instance", "field": "state", "value": "submitted"})
    assert ctx.instance["state"] == "submitted"
    updated = fake_dc.get_entity(TENANT, "workflow_instance", row["entity_id"])
    assert updated["state"] == "submitted"


def test_set_entity_field_resolved_ref(fake_dc):
    created = fake_dc.dc_create(TENANT, "student", {"first_name": "Jo", "status": "pending"})
    entity_id = created["entity_id"]
    ctx = _ctx(instance={"entity_id": "inst-1", "subject_refs": json.dumps({"student_id": entity_id})})
    EFFECTS["set_entity_field"](ctx, {"ref": "student", "field": "status", "value": "Enrolled"})
    updated = fake_dc.get_entity(TENANT, "student", entity_id)
    assert updated["status"] == "Enrolled"
    assert updated["first_name"] == "Jo"  # round-tripped, not clobbered


def test_set_entity_field_missing_ref_raises_409(fake_dc):
    ctx = _ctx(instance={"entity_id": "inst-1", "subject_refs": "{}"})
    with pytest.raises(HTTPException) as exc_info:
        EFFECTS["set_entity_field"](ctx, {"ref": "student", "field": "status", "value": "Enrolled"})
    assert exc_info.value.status_code == 409


# --- effects: send_email --------------------------------------------------


def test_send_email_no_op_when_no_applicant_email(fake_dc, caplog):
    ctx = _ctx(instance={"entity_id": "inst-1", "subject_refs": "{}", "applicant_email": ""})
    EFFECTS["send_email"](ctx, {"template": "approved"})
    assert fake_dc.find("workflow_activity") == []  # true no-op, nothing logged


def test_send_email_escapes_state_and_logs_activity(fake_dc, monkeypatch):
    captured = {}

    def fake_send_email(to, subject, body_html):
        captured["to"] = to
        captured["subject"] = subject
        captured["body_html"] = body_html
        return "logged"

    monkeypatch.setattr("app.workflows.primitives.send_email", fake_send_email)
    ctx = _ctx(instance={
        "entity_id": "inst-1", "subject_refs": "{}",
        "applicant_email": "parent@example.com",
        "state": "<script>evil</script>",
    })
    EFFECTS["send_email"](ctx, {"template": "approved"})

    assert captured["to"] == "parent@example.com"
    assert "<script>" not in captured["body_html"]
    assert "&lt;script&gt;" in captured["body_html"]

    activities = fake_dc.find("workflow_activity")
    assert len(activities) == 1
    assert activities[0]["type"] == "email_sent"
    assert "parent@example.com" in activities[0]["to_value"]


# --- effects: issue_link -------------------------------------------------


def test_issue_link_mints_token_and_stores_nothing(fake_dc):
    from app.workflows.tokens import verify_link_token

    ctx = _ctx(instance={"entity_id": "inst-1", "subject_refs": "{}", "token_version": 1})
    EFFECTS["issue_link"](ctx, {})
    assert ctx.issued_link is not None
    tenant_id, instance_entity_id = verify_link_token(ctx.issued_link, 1)
    assert tenant_id == TENANT
    assert instance_entity_id == "inst-1"
    # nothing beyond token_version written to DataCore
    assert fake_dc.rows == []


# --- effects: start_due_clocks --------------------------------------------


def _documents_step():
    return _step("doc_step", type_="documents", config={"docs": [
        {"name": "Immunization Record", "description": "", "sensitive": True, "blocking": True,
         "due_days_after_state": 14},
        {"name": "Photo Release", "description": "", "sensitive": False, "blocking": False},
    ]})


def test_start_due_clocks_sets_due_at_from_doc_config(fake_dc):
    created = fake_dc.dc_create(TENANT, "workflow_item", {
        "step_id": "doc_step", "kind": "documents", "title": "Immunization Record",
        "status": "not_started",
    })
    item = fake_dc.get_entity(TENANT, "workflow_item", created["entity_id"])
    now = datetime(2026, 8, 5, tzinfo=timezone.utc)
    ctx = _ctx(items=[item], definition=_definition([_documents_step()]), now=now)

    EFFECTS["start_due_clocks"](ctx, {"step_ids": ["doc_step"]})

    updated = fake_dc.get_entity(TENANT, "workflow_item", item["entity_id"])
    assert updated["due_at"] == (now + timedelta(days=14)).isoformat()
    assert ctx.items[0]["due_at"] == updated["due_at"]  # ctx mutated in place


def test_start_due_clocks_skips_item_with_no_due_days_config(fake_dc):
    created = fake_dc.dc_create(TENANT, "workflow_item", {
        "step_id": "doc_step", "kind": "documents", "title": "Photo Release",
        "status": "not_started",
    })
    item = fake_dc.get_entity(TENANT, "workflow_item", created["entity_id"])
    ctx = _ctx(items=[item], definition=_definition([_documents_step()]))

    EFFECTS["start_due_clocks"](ctx, {"step_ids": ["doc_step"]})

    updated = fake_dc.get_entity(TENANT, "workflow_item", item["entity_id"])
    assert not updated.get("due_at")


def test_start_due_clocks_does_not_overwrite_existing_due_at(fake_dc):
    created = fake_dc.dc_create(TENANT, "workflow_item", {
        "step_id": "doc_step", "kind": "documents", "title": "Immunization Record",
        "status": "not_started", "due_at": "2026-01-01T00:00:00+00:00",
    })
    item = fake_dc.get_entity(TENANT, "workflow_item", created["entity_id"])
    ctx = _ctx(items=[item], definition=_definition([_documents_step()]))

    EFFECTS["start_due_clocks"](ctx, {"step_ids": ["doc_step"]})

    updated = fake_dc.get_entity(TENANT, "workflow_item", item["entity_id"])
    assert updated["due_at"] == "2026-01-01T00:00:00+00:00"


# --- effects: set_context -------------------------------------------------


def test_set_context(fake_dc):
    fake_dc.dc_create(TENANT, "workflow_instance", {"context": json.dumps({"school_year": "2025-2026"})})
    row = fake_dc.find("workflow_instance")[0]
    ctx = _ctx(instance=dict(row), context={"school_year": "2025-2026"})
    EFFECTS["set_context"](ctx, {"key": "school_year", "value": "2026-2027"})
    assert ctx.context["school_year"] == "2026-2027"
    updated = fake_dc.get_entity(TENANT, "workflow_instance", row["entity_id"])
    assert json.loads(updated["context"])["school_year"] == "2026-2027"


# --- registry <-> validate.py wiring --------------------------------------


def test_validate_py_name_sets_derive_from_registries():
    from app.workflows.validate import EFFECT_PRIMITIVES, GUARD_PRIMITIVES

    assert GUARD_PRIMITIVES == frozenset(GUARDS)
    assert EFFECT_PRIMITIVES == frozenset(EFFECTS)
