# apexflow/backend/tests/test_schema.py
"""Table-driven tests for app/workflows/schema.py — the pure pydantic v2
models for workflow definitions (machine + steps), per task-3-brief.md and
spec §3 "State machine schema" / "Steps and declared sections".

Written first per TDD (superpowers:test-driven-development): these import
app.workflows.schema, which does not exist yet, so this file is expected to
fail at collection until that module is implemented.

Coverage:
- Round-trip (model_validate(model_dump(by_alias=True)) == original) for
  every model in the Produces list, including the two aliased fields
  (TransitionDef.from_ <-> "from", ConditionGroup all_/any_/not_ <-> "all"/
  "any"/"not").
- ConditionGroup's "exactly one of all/any/not" model validator: zero keys
  set and two-plus keys set both raise.
- ENGINE_OWNED_FIELDS exact contents (Global Constraints list, verbatim).
"""
import pytest
from pydantic import ValidationError

from app.workflows.schema import (
    ENGINE_OWNED_FIELDS,
    Condition,
    ConditionGroup,
    EffectRef,
    FieldPick,
    GuardRef,
    MachineDef,
    RepeatSpec,
    SectionDef,
    StateDef,
    StepDef,
    TransitionDef,
)


def _round_trip(model_cls, payload):
    """Parse payload, dump by_alias, re-parse, and assert both instances and
    both dumps are equal — the round-trip guarantee the brief requires."""
    first = model_cls.model_validate(payload)
    dumped = first.model_dump(by_alias=True)
    second = model_cls.model_validate(dumped)
    assert first == second
    return first, dumped


# --- Condition -------------------------------------------------------------

CONDITION_CASES = [
    {"source": "student.first_name", "op": "eq", "value": "Ada"},
    {"source": "context.school_year", "op": "in", "value": ["2026", "2027"]},
    {"source": "documents.immunization", "op": "empty"},
    {"source": "documents.immunization", "op": "not_empty"},
    {"source": "context.opt_in", "op": "truthy"},
]


@pytest.mark.parametrize("payload", CONDITION_CASES)
def test_condition_round_trip(payload):
    first, dumped = _round_trip(Condition, payload)
    assert first.source == payload["source"]
    assert first.op == payload["op"]
    assert first.value == payload.get("value")


def test_condition_value_defaults_to_none():
    c = Condition(source="context.x", op="empty")
    assert c.value is None


# --- Condition op="in" value-shape guard --------------------------------------
# (post-review fix: evaluate_condition's `value in cond.value` crashed with a
# TypeError for non-iterable values and silently did Python substring
# membership for str values — guarded at the schema level instead so a
# malformed Condition can never reach the evaluator.)

def test_condition_in_with_list_value_is_valid():
    c = Condition(source="student.grade", op="in", value=["K", "1", "2"])
    assert c.value == ["K", "1", "2"]


def test_condition_in_with_omitted_value_is_rejected():
    with pytest.raises(ValidationError):
        Condition(source="student.grade", op="in")


def test_condition_in_with_none_value_is_rejected():
    with pytest.raises(ValidationError):
        Condition(source="student.grade", op="in", value=None)


def test_condition_in_with_scalar_value_is_rejected():
    with pytest.raises(ValidationError):
        Condition(source="student.grade", op="in", value=5)


def test_condition_in_with_string_value_is_rejected():
    # Guards against silent substring semantics: "K" in "K12" is True in
    # Python, which is not the intended "member of an authored list" meaning
    # of the "in" op.
    with pytest.raises(ValidationError):
        Condition(source="student.grade", op="in", value="K12")


@pytest.mark.parametrize("op", ["eq", "ne", "empty", "not_empty", "truthy"])
def test_non_in_ops_do_not_require_list_value(op):
    # The list-value guard is specific to op="in" — other ops accept any
    # value shape (including the default None).
    Condition(source="student.grade", op=op, value="K")
    Condition(source="student.grade", op=op)


# --- ConditionGroup ----------------------------------------------------------

def test_condition_group_all_alias_round_trip():
    payload = {
        "all": [
            {"source": "student.grade", "op": "eq", "value": "K"},
            {"source": "context.school_year", "op": "not_empty"},
        ]
    }
    first, dumped = _round_trip(ConditionGroup, payload)
    assert "all" in dumped
    assert dumped["all"][0]["source"] == "student.grade"
    assert first.all_ is not None
    assert first.any_ is None
    assert first.not_ is None


def test_condition_group_any_alias_round_trip():
    payload = {"any": [{"source": "context.x", "op": "truthy"}]}
    first, dumped = _round_trip(ConditionGroup, payload)
    assert "any" in dumped
    assert first.any_ is not None


def test_condition_group_not_alias_round_trip():
    payload = {"not": [{"source": "context.x", "op": "empty"}]}
    first, dumped = _round_trip(ConditionGroup, payload)
    assert "not" in dumped
    assert first.not_ is not None


def test_condition_group_nested_all_of_any_round_trip():
    payload = {
        "all": [
            {"any": [
                {"source": "student.grade", "op": "eq", "value": "K"},
                {"source": "student.grade", "op": "eq", "value": "1"},
            ]},
            {"source": "context.school_year", "op": "not_empty"},
        ]
    }
    first, dumped = _round_trip(ConditionGroup, payload)
    assert isinstance(first.all_[0], ConditionGroup)
    assert isinstance(first.all_[1], Condition)
    assert dumped["all"][0] == {"all": None, "any": [
        {"source": "student.grade", "op": "eq", "value": "K"},
        {"source": "student.grade", "op": "eq", "value": "1"},
    ], "not": None}


def test_condition_group_populate_by_name_also_works():
    # Constructing with the Python field names (not the JSON aliases) must
    # also work, since populate_by_name is required for round-tripping
    # dumps that used by_alias=False anywhere upstream.
    g = ConditionGroup(all_=[{"source": "context.x", "op": "truthy"}])
    assert g.all_ is not None


@pytest.mark.parametrize(
    "payload",
    [
        {},  # zero keys set
        {"all": None, "any": None, "not": None},  # explicit zero
        {
            "all": [{"source": "context.x", "op": "truthy"}],
            "any": [{"source": "context.y", "op": "truthy"}],
        },  # two keys set
        {
            "all": [{"source": "context.x", "op": "truthy"}],
            "any": [{"source": "context.y", "op": "truthy"}],
            "not": [{"source": "context.z", "op": "truthy"}],
        },  # three keys set
    ],
)
def test_condition_group_requires_exactly_one_key(payload):
    with pytest.raises(ValidationError):
        ConditionGroup.model_validate(payload)


# --- StateDef ----------------------------------------------------------------

@pytest.mark.parametrize(
    "payload",
    [
        {"state_id": "draft", "name": "Draft", "kind": "initial"},
        {"state_id": "submitted", "name": "Submitted", "kind": "active"},
        {"state_id": "enrolled", "name": "Enrolled", "kind": "terminal"},
    ],
)
def test_state_def_round_trip(payload):
    _round_trip(StateDef, payload)


def test_state_def_rejects_bad_kind():
    with pytest.raises(ValidationError):
        StateDef(state_id="x", name="X", kind="bogus")


# --- GuardRef / EffectRef -----------------------------------------------------

def test_guard_ref_round_trip():
    _round_trip(GuardRef, {"primitive": "all_blocking_items_complete", "params": {}})


def test_effect_ref_round_trip():
    _round_trip(EffectRef, {"primitive": "commit_sections", "params": {"section_ids": ["student"]}})


# --- TransitionDef -------------------------------------------------------------

def test_transition_def_from_alias_round_trip():
    payload = {
        "transition_id": "t1",
        "from": "draft",
        "to": "submitted",
        "action": "submit",
        "actor": "family",
        "guards": [{"primitive": "all_blocking_items_complete", "params": {}}],
        "effects": [{"primitive": "commit_sections", "params": {"section_ids": ["student"]}}],
    }
    first, dumped = _round_trip(TransitionDef, payload)
    assert "from" in dumped
    assert "from_" not in dumped
    assert first.from_ == "draft"


def test_transition_def_from_field_name_also_works():
    t = TransitionDef(
        transition_id="t1",
        from_="draft",
        to="submitted",
        action="submit",
        actor="system",
        guards=[],
        effects=[],
    )
    assert t.from_ == "draft"


def test_transition_def_defaults_empty_guards_effects():
    t = TransitionDef(
        transition_id="t1",
        **{"from": "draft"},
        to="submitted",
        action="submit",
        actor="staff",
    )
    assert t.guards == []
    assert t.effects == []


def test_transition_def_rejects_bad_actor():
    with pytest.raises(ValidationError):
        TransitionDef(
            transition_id="t1",
            **{"from": "draft"},
            to="submitted",
            action="submit",
            actor="parent",
        )


# --- MachineDef ----------------------------------------------------------------

def test_machine_def_round_trip():
    payload = {
        "states": [
            {"state_id": "draft", "name": "Draft", "kind": "initial"},
            {"state_id": "submitted", "name": "Submitted", "kind": "terminal"},
        ],
        "transitions": [
            {
                "transition_id": "t1",
                "from": "draft",
                "to": "submitted",
                "action": "submit",
                "actor": "family",
                "guards": [],
                "effects": [],
            }
        ],
    }
    first, dumped = _round_trip(MachineDef, payload)
    assert dumped["transitions"][0]["from"] == "draft"


# --- FieldPick / RepeatSpec / SectionDef ----------------------------------------

def test_field_pick_round_trip():
    _round_trip(FieldPick, {"name": "first_name", "required": True})


def test_repeat_spec_round_trip():
    _round_trip(RepeatSpec, {"min": 1, "max": 5})


def test_section_def_round_trip_no_repeat():
    payload = {
        "section_id": "student_section",
        "entity_model": "student",
        "fields": [{"name": "first_name", "required": True}],
        "mode": "create",
        "repeat": None,
    }
    first, dumped = _round_trip(SectionDef, payload)
    assert first.repeat is None


def test_section_def_round_trip_with_repeat():
    payload = {
        "section_id": "contacts_section",
        "entity_model": "contact",
        "fields": [{"name": "first_name", "required": True}],
        "mode": "match_or_create",
        "repeat": {"min": 0, "max": 3},
    }
    first, dumped = _round_trip(SectionDef, payload)
    assert first.repeat == RepeatSpec(min=0, max=3)


def test_section_def_rejects_bad_mode():
    with pytest.raises(ValidationError):
        SectionDef(
            section_id="s1",
            entity_model="student",
            fields=[],
            mode="bogus",
        )


# --- StepDef ---------------------------------------------------------------------

def test_step_def_round_trip_message_type():
    payload = {
        "step_id": "welcome",
        "type": "message",
        "title": "Welcome",
        "required": True,
        "blocking": False,
        "available_in": ["draft"],
        "show_if": None,
        "review": None,
        "config": {"body": "Welcome to enrollment"},
    }
    first, dumped = _round_trip(StepDef, payload)
    assert first.type == "message"
    assert first.show_if is None
    assert first.review is None
    assert dumped["config"] == {"body": "Welcome to enrollment"}


def test_step_def_round_trip_documents_type_with_show_if_and_review():
    payload = {
        "step_id": "documents",
        "type": "documents",
        "title": "Upload documents",
        "required": True,
        "blocking": True,
        "available_in": ["submitted", "in_review"],
        "show_if": {"all": [{"source": "context.school_year", "op": "not_empty"}]},
        "review": "staff",
        "config": {"docs": [{"name": "immunization", "description": "", "sensitive": True, "blocking": True}]},
    }
    first, dumped = _round_trip(StepDef, payload)
    assert first.type == "documents"
    assert first.review == "staff"
    assert isinstance(first.show_if, ConditionGroup)
    assert dumped["show_if"]["all"][0]["source"] == "context.school_year"
    assert dumped["config"]["docs"][0]["name"] == "immunization"


def test_step_def_round_trip_form_type():
    payload = {
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
                    "fields": [{"name": "guardian1_name", "required": True}],
                    "mode": "create",
                    "repeat": None,
                }
            ]
        },
    }
    first, dumped = _round_trip(StepDef, payload)
    assert first.type == "form"
    assert first.review is None
    assert dumped["config"]["sections"][0]["section_id"] == "family_section"
    assert dumped["config"]["sections"][0]["entity_model"] == "family"


def test_step_def_rejects_bad_review():
    with pytest.raises(ValidationError):
        StepDef(
            step_id="s",
            type="form",
            title="T",
            required=True,
            blocking=True,
            available_in=[],
            review="bogus",
            config={},
        )


# --- ENGINE_OWNED_FIELDS ------------------------------------------------------

def test_engine_owned_fields_exact_contents():
    assert ENGINE_OWNED_FIELDS == frozenset({
        "instance_id",
        "workflow_instance_id",
        "definition_id",
        "definition_version",
        "state",
        "subject_refs",
        "context",
        "channel_started",
        "applicant_email",
        "token_version",
        "draft_data",
        "opened_at",
        "closed_at",
    })


def test_engine_owned_fields_is_frozenset():
    assert isinstance(ENGINE_OWNED_FIELDS, frozenset)
