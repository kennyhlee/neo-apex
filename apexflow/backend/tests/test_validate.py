# apexflow/backend/tests/test_validate.py
"""Table-driven tests for app/workflows/validate.py — publish-time
validation (`validate_definition`) and model-coherence classification
(`definition_health`), per task-4-brief.md and spec §3 "State machine
schema" / "Steps and declared sections" / "Model evolution".

Written first per TDD (superpowers:test-driven-development): app.workflows.
validate does not exist yet, so this file is expected to fail at collection
until it is implemented.

Layout:
- `_base_machine_dict`/`_base_steps_list`/`_base_models` build one fully
  valid definition (student form step, draft->submitted->enrolled machine).
  `test_valid_definition_*` assert it round-trips to `[]` / `"current"`.
- Every other `validate_definition` rule gets a dedicated mutator function
  that copies the base fixture and breaks exactly one thing, plus a
  parametrized test asserting the expected error substring appears
  somewhere in the returned list (not exact-list equality, since breaking
  one invariant can incidentally trip a second one, e.g. removing a
  transition makes both "no outgoing transition" and "unreachable" true).
- `definition_health` gets its own explicit tests (broken/stale/current +
  broken-beats-stale priority), since its three-way return isn't a list to
  substring-match.
"""
import copy

import pytest

from app.workflows.schema import MachineDef, StepDef
from app.workflows.validate import definition_health, validate_definition


# --- Base fixture: one fully valid definition -------------------------------


def _base_machine_dict():
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
                    {
                        "primitive": "commit_sections",
                        "params": {"section_ids": ["student_section"]},
                    }
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


def _base_steps_list():
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


def _base_models():
    return {
        "student": {
            "base_fields": [
                {"name": "student_id", "type": "str", "required": True},
                {"name": "first_name", "type": "str", "required": True},
                {"name": "last_name", "type": "str", "required": True},
                {"name": "nickname", "type": "str", "required": False},
            ],
            "custom_fields": [],
        },
        "family": {
            "base_fields": [
                {"name": "family_id", "type": "str", "required": True},
                {"name": "family_name", "type": "str", "required": True},
            ],
            "custom_fields": [],
        },
    }


def _build(machine_dict, steps_list, models):
    machine = MachineDef.model_validate(machine_dict)
    steps = [StepDef.model_validate(s) for s in steps_list]
    return machine, steps, models


def test_valid_definition_returns_no_errors():
    machine, steps, models = _build(_base_machine_dict(), _base_steps_list(), _base_models())
    assert validate_definition(machine, steps, models) == []


def test_valid_definition_health_is_current():
    machine, steps, models = _build(_base_machine_dict(), _base_steps_list(), _base_models())
    assert definition_health(machine, steps, models) == "current"


# --- validate_definition: one row per spec rule -----------------------------


def _zero_initial_states(m, s, md):
    m = copy.deepcopy(m)
    m["states"][0]["kind"] = "active"
    return m, s, md


def _two_initial_states(m, s, md):
    m = copy.deepcopy(m)
    m["states"][1]["kind"] = "initial"
    return m, s, md


def _zero_terminal_states(m, s, md):
    m = copy.deepcopy(m)
    m["states"][2]["kind"] = "active"
    return m, s, md


def _unreachable_state(m, s, md):
    m = copy.deepcopy(m)
    m["states"].append({"state_id": "orphan", "name": "Orphan", "kind": "active"})
    return m, s, md


def _non_terminal_missing_outgoing(m, s, md):
    m = copy.deepcopy(m)
    # Drop the only transition out of "submitted" — it's non-terminal.
    m["transitions"] = [t for t in m["transitions"] if t["from"] != "submitted"]
    return m, s, md


def _extra_unguarded_transition(m, s, md):
    m = copy.deepcopy(m)
    m["transitions"].append(
        {
            "transition_id": "t_submit_dup",
            "from": "draft",
            "to": "submitted",
            "action": "submit",
            "actor": "family",
            "guards": [],
            "effects": [],
        }
    )
    return m, s, md


def _unguarded_not_declared_last(m, s, md):
    m = copy.deepcopy(m)
    m["states"].append({"state_id": "waitlisted", "name": "Waitlisted", "kind": "terminal"})
    # Unguarded draft->submitted (t_submit) is declared BEFORE a guarded
    # alternative for the same (from, action) — must be last, so this fails.
    m["transitions"].insert(
        1,
        {
            "transition_id": "t_waitlist",
            "from": "draft",
            "to": "waitlisted",
            "action": "submit",
            "actor": "system",
            "guards": [{"primitive": "capacity_available", "params": {}}],
            "effects": [],
        },
    )
    return m, s, md


def _unknown_guard_primitive(m, s, md):
    m = copy.deepcopy(m)
    m["transitions"][1]["guards"] = [{"primitive": "bogus_guard", "params": {}}]
    return m, s, md


def _unknown_effect_primitive(m, s, md):
    m = copy.deepcopy(m)
    m["transitions"][0]["effects"].append({"primitive": "bogus_effect", "params": {}})
    return m, s, md


def _commit_sections_undeclared_section(m, s, md):
    m = copy.deepcopy(m)
    m["transitions"][0]["effects"][0]["params"]["section_ids"] = ["ghost_section"]
    return m, s, md


def _available_in_undeclared_state(m, s, md):
    s = copy.deepcopy(s)
    s[0]["available_in"] = ["nope"]
    return m, s, md


def _transition_to_undeclared_state(m, s, md):
    m = copy.deepcopy(m)
    m["transitions"][1]["to"] = "nowhere"
    return m, s, md


def _transition_from_undeclared_state(m, s, md):
    m = copy.deepcopy(m)
    m["transitions"][1]["from"] = "nowhere"
    return m, s, md


def _section_names_engine_owned_field(m, s, md):
    s = copy.deepcopy(s)
    s[0]["config"]["sections"][0]["fields"].append({"name": "state", "required": True})
    return m, s, md


def _coverage_required_field_missing(m, s, md):
    s = copy.deepcopy(s)
    s[0]["config"]["sections"][0]["fields"] = [{"name": "first_name", "required": True}]
    return m, s, md


def _coverage_required_field_present_but_not_required(m, s, md):
    s = copy.deepcopy(s)
    s[0]["config"]["sections"][0]["fields"] = [
        {"name": "first_name", "required": True},
        {"name": "last_name", "required": False},
    ]
    return m, s, md


def _conditional_section_with_required_field(m, s, md):
    m = copy.deepcopy(m)
    s = copy.deepcopy(s)
    md = copy.deepcopy(md)
    m["transitions"][0]["effects"].append(
        {"primitive": "commit_sections", "params": {"section_ids": ["family_section"]}}
    )
    s.append(
        {
            "step_id": "family_details",
            "type": "form",
            "title": "Family details",
            "required": True,
            "blocking": True,
            "available_in": ["draft"],
            "show_if": {"all": [{"source": "context.opt_in", "op": "truthy"}]},
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
    )
    return m, s, md


def _section_unknown_entity_model(m, s, md):
    s = copy.deepcopy(s)
    s[0]["config"]["sections"][0]["entity_model"] = "spaceship"
    return m, s, md


def _section_field_does_not_exist_on_model(m, s, md):
    s = copy.deepcopy(s)
    s[0]["config"]["sections"][0]["fields"].append({"name": "does_not_exist", "required": False})
    return m, s, md


VALIDATE_FAILURE_CASES = [
    ("zero initial states", _zero_initial_states, "no initial state"),
    ("two initial states", _two_initial_states, "2 initial states"),
    ("zero terminal states", _zero_terminal_states, "no terminal state"),
    ("unreachable state", _unreachable_state, "'orphan' is unreachable"),
    (
        "non-terminal state missing outgoing transition",
        _non_terminal_missing_outgoing,
        "'submitted' is non-terminal but has no outgoing transition",
    ),
    (
        "extra unguarded transition for (from, action)",
        _extra_unguarded_transition,
        "at most one unguarded transition is allowed",
    ),
    (
        "unguarded transition not declared last",
        _unguarded_not_declared_last,
        "must be declared last",
    ),
    ("unknown guard primitive", _unknown_guard_primitive, "unknown primitive 'bogus_guard'"),
    ("unknown effect primitive", _unknown_effect_primitive, "unknown primitive 'bogus_effect'"),
    (
        "commit_sections references undeclared section",
        _commit_sections_undeclared_section,
        "undeclared section 'ghost_section'",
    ),
    (
        "available_in references undeclared state",
        _available_in_undeclared_state,
        "undeclared state 'nope'",
    ),
    (
        "transition.to references undeclared state",
        _transition_to_undeclared_state,
        "undeclared state 'nowhere'",
    ),
    (
        "transition.from references undeclared state",
        _transition_from_undeclared_state,
        "undeclared state 'nowhere'",
    ),
    (
        "section names an ENGINE_OWNED_FIELDS field",
        _section_names_engine_owned_field,
        "engine-owned field 'state'",
    ),
    (
        "coverage: required field missing from unconditional section",
        _coverage_required_field_missing,
        "required field 'last_name' is not included+required",
    ),
    (
        "coverage: required field present but not marked required",
        _coverage_required_field_present_but_not_required,
        "required field 'last_name' is not included+required",
    ),
    (
        "conditional section includes model-required field",
        _conditional_section_with_required_field,
        "includes model-required field 'family_name'",
    ),
    (
        "section references unknown entity model",
        _section_unknown_entity_model,
        "unknown entity model 'spaceship'",
    ),
    (
        "section field does not exist on model",
        _section_field_does_not_exist_on_model,
        "field 'does_not_exist' does not exist on model 'student'",
    ),
]


@pytest.mark.parametrize(
    "name,mutate,expected_substring",
    VALIDATE_FAILURE_CASES,
    ids=[c[0] for c in VALIDATE_FAILURE_CASES],
)
def test_validate_definition_rule_violation(name, mutate, expected_substring):
    m, s, md = mutate(_base_machine_dict(), _base_steps_list(), _base_models())
    machine, steps, models = _build(m, s, md)
    errors = validate_definition(machine, steps, models)
    assert errors, f"{name}: expected at least one error, got none"
    assert any(expected_substring in e for e in errors), (
        f"{name}: expected an error containing {expected_substring!r}, got {errors}"
    )


# --- Coverage exemptions: these must NOT produce errors ---------------------


def test_link_and_id_fields_are_exempt_from_coverage():
    # student_id is required on the model but is the model's own id field
    # (`{model}_id` naming) — never picked in a section, never an error even
    # though it's absent from student_section's fields.
    machine, steps, models = _build(_base_machine_dict(), _base_steps_list(), _base_models())
    assert not any("student_id" in e for e in validate_definition(machine, steps, models))


def test_model_defaulted_field_is_exempt_from_coverage():
    m = _base_machine_dict()
    s = _base_steps_list()
    md = _base_models()
    md["student"]["base_fields"].append(
        {"name": "status", "type": "selection", "required": True, "default": "Active"}
    )
    machine, steps, models = _build(m, s, md)
    errors = validate_definition(machine, steps, models)
    assert not any("'status'" in e for e in errors)


def test_set_entity_field_on_committing_transition_exempts_field():
    m = _base_machine_dict()
    s = _base_steps_list()
    md = _base_models()
    md["student"]["base_fields"].append(
        {"name": "status", "type": "selection", "required": True}
    )
    # t_submit is the committing transition for student_section (its
    # commit_sections effect lists section_ids: ["student_section"]).
    m["transitions"][0]["effects"].append(
        {
            "primitive": "set_entity_field",
            "params": {"ref": "student", "field": "status", "value": "Active"},
        }
    )
    machine, steps, models = _build(m, s, md)
    errors = validate_definition(machine, steps, models)
    assert not any("'status'" in e for e in errors)


def test_set_entity_field_on_non_committing_transition_does_not_exempt_field():
    # Same as above, but the set_entity_field effect sits on t_approve, which
    # does NOT commit student_section — per spec §3 the exemption is scoped
    # to "the committing transition", so this must still error.
    m = _base_machine_dict()
    s = _base_steps_list()
    md = _base_models()
    md["student"]["base_fields"].append(
        {"name": "status", "type": "selection", "required": True}
    )
    m["transitions"][1]["effects"].append(
        {
            "primitive": "set_entity_field",
            "params": {"ref": "student", "field": "status", "value": "Active"},
        }
    )
    machine, steps, models = _build(m, s, md)
    errors = validate_definition(machine, steps, models)
    assert any("'status'" in e for e in errors)


# --- definition_health -------------------------------------------------------


def test_definition_health_broken_on_removed_section_field():
    # last_name is still picked by student_section, but the model no longer
    # declares it (simulates field removal post-publish) — dangling ref.
    m = _base_machine_dict()
    s = _base_steps_list()
    md = _base_models()
    md["student"]["base_fields"] = [
        f for f in md["student"]["base_fields"] if f["name"] != "last_name"
    ]
    machine, steps, models = _build(m, s, md)
    assert definition_health(machine, steps, models) == "broken"


def test_definition_health_broken_on_removed_show_if_source_field():
    m = _base_machine_dict()
    s = _base_steps_list()
    md = _base_models()
    s[0]["show_if"] = {"all": [{"source": "student_section.nickname", "op": "not_empty"}]}
    md["student"]["base_fields"] = [
        f for f in md["student"]["base_fields"] if f["name"] != "nickname"
    ]
    machine, steps, models = _build(m, s, md)
    assert definition_health(machine, steps, models) == "broken"


def test_definition_health_stale_on_coverage_hole():
    # nickname becomes required post-publish without any section covering
    # it (optional -> required is exactly spec's "stale" trigger).
    m = _base_machine_dict()
    s = _base_steps_list()
    md = _base_models()
    for f in md["student"]["base_fields"]:
        if f["name"] == "nickname":
            f["required"] = True
    machine, steps, models = _build(m, s, md)
    assert definition_health(machine, steps, models) == "stale"


def test_definition_health_broken_beats_stale_when_both_present():
    m = _base_machine_dict()
    s = _base_steps_list()
    md = _base_models()
    md["student"]["base_fields"] = [
        f for f in md["student"]["base_fields"] if f["name"] != "last_name"
    ]
    for f in md["student"]["base_fields"]:
        if f["name"] == "nickname":
            f["required"] = True
    machine, steps, models = _build(m, s, md)
    assert definition_health(machine, steps, models) == "broken"
