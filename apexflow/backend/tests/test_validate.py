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
from app.workflows.validate import (
    _guard_params_items_in_status,
    definition_health,
    validate_definition,
)


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


def test_section_copy_errors_reach_validate_definition():
    """Wiring regression guard: every other section-copy test in
    `test_section_copy.py` calls `_section_copy_errors` directly, so
    deleting the `errors += _section_copy_errors(section_entries)` line
    inside `validate_definition` (validate.py) leaves that whole file green
    — nothing exercises the aggregate. This drives the same over-length-
    title + disallowed-link-scheme defect through the PUBLIC
    `validate_definition` entry point instead, so unwiring the check breaks
    a test."""
    steps_list = _base_steps_list()
    section = steps_list[0]["config"]["sections"][0]
    section["title"] = "x" * 81
    # No nested parens in the link target -- keeps this test about the
    # WIRING, not the regex-capture edge cases IMPORTANT 4 covers separately.
    section["description"] = "Click [here](javascript:doBadThing) to continue."
    machine, steps, models = _build(_base_machine_dict(), steps_list, _base_models())
    errors = validate_definition(machine, steps, models)
    assert any("student_section" in e and "title" in e for e in errors), errors
    assert any("javascript:dobadthing" in e.lower() for e in errors), errors


def test_guarded_transition_plus_unguarded_last_in_same_group_is_valid():
    """Regression guard for `_unguarded_branch_errors` false positives: a
    (from, action) group with ONE guarded transition followed by ONE
    unguarded transition declared LAST is legal ("at most one unguarded,
    and if present it must be last" -- not "zero unguarded allowed"). This
    is exactly the enrollment template's waitlist-branch shape (module
    docstring's decision 2, generalized here to a minimal fixture) and must
    not trip any validate_definition rule."""
    m = _base_machine_dict()
    s = _base_steps_list()
    md = _base_models()
    # Insert a GUARDED alternative for (from="draft", action="submit")
    # BEFORE the existing unguarded t_submit -- t_submit (unguarded) stays
    # declared last, so this must publish clean.
    m["states"].append({"state_id": "waitlisted", "name": "Waitlisted", "kind": "terminal"})
    m["transitions"].insert(
        0,
        {
            "transition_id": "t_submit_waitlisted",
            "from": "draft",
            "to": "waitlisted",
            "action": "submit",
            "actor": "system",
            "guards": [{"primitive": "actor_role", "params": {"roles": ["staff", "admin"]}}],
            "effects": [],
        },
    )
    machine, steps, models = _build(m, s, md)
    assert validate_definition(machine, steps, models) == []


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


# --- Guard/effect PARAM validation (spec §3 "refs resolve with valid
# params") ---------------------------------------------------------------
#
# Each case is a minimal 2-state/1-transition machine carrying exactly one
# guard or effect with broken params -- isolated from the base fixture's
# other rules (no sections/steps needed unless the primitive under test
# references one, e.g. start_due_clocks) so a failure here can only be
# about the param rule being tested.


def _minimal_machine(guards=None, effects=None):
    return {
        "states": [
            {"state_id": "draft", "name": "Draft", "kind": "initial"},
            {"state_id": "done", "name": "Done", "kind": "terminal"},
        ],
        "transitions": [
            {
                "transition_id": "t1",
                "from": "draft",
                "to": "done",
                "action": "go",
                "actor": "staff",
                "guards": guards or [],
                "effects": effects or [],
            }
        ],
    }


def _case_items_in_status_missing_status():
    return _minimal_machine(guards=[{"primitive": "items_in_status", "params": {}}]), [], {}


def _case_items_in_status_bad_quantifier():
    return _minimal_machine(guards=[{
        "primitive": "items_in_status",
        "params": {"status": "verified", "quantifier": "most"},
    }]), [], {}


def _case_items_in_status_step_ids_not_list():
    return _minimal_machine(guards=[{
        "primitive": "items_in_status",
        "params": {"status": "verified", "step_ids": "not-a-list"},
    }]), [], {}


def _case_capacity_available_missing_count_states():
    return _minimal_machine(guards=[{
        "primitive": "capacity_available",
        "params": {"capacity_field": "capacity"},
    }]), [], {}


def _case_capacity_available_missing_capacity_field():
    return _minimal_machine(guards=[{
        "primitive": "capacity_available",
        "params": {"count_states": ["approved"]},
    }]), [], {}


def _case_data_condition_missing_condition():
    return _minimal_machine(guards=[{"primitive": "data_condition", "params": {}}]), [], {}


def _case_data_condition_invalid_condition():
    return _minimal_machine(guards=[{
        "primitive": "data_condition",
        "params": {"condition": "not-a-condition-group"},
    }]), [], {}


def _case_date_window_neither_bound():
    return _minimal_machine(guards=[{"primitive": "date_window", "params": {}}]), [], {}


def _case_date_window_malformed_date():
    return _minimal_machine(guards=[{
        "primitive": "date_window",
        "params": {"start": "not-a-date"},
    }]), [], {}


def _case_actor_role_empty_roles():
    return _minimal_machine(guards=[{"primitive": "actor_role", "params": {"roles": []}}]), [], {}


def _case_commit_sections_empty_section_ids():
    return _minimal_machine(effects=[{
        "primitive": "commit_sections", "params": {"section_ids": []},
    }]), [], {}


def _case_set_entity_field_missing_ref():
    return _minimal_machine(effects=[{
        "primitive": "set_entity_field",
        "params": {"field": "status", "value": "x"},
    }]), [], {}


def _case_set_entity_field_missing_field():
    return _minimal_machine(effects=[{
        "primitive": "set_entity_field",
        "params": {"ref": "student", "value": "x"},
    }]), [], {}


def _case_set_entity_field_instance_engine_owned():
    return _minimal_machine(effects=[{
        "primitive": "set_entity_field",
        "params": {"ref": "instance", "field": "state", "value": "x"},
    }]), [], {}


def _case_send_email_missing_template():
    return _minimal_machine(effects=[{"primitive": "send_email", "params": {}}]), [], {}


def _case_start_due_clocks_empty_step_ids():
    return _minimal_machine(effects=[{
        "primitive": "start_due_clocks", "params": {"step_ids": []},
    }]), [], {}


def _case_start_due_clocks_undeclared_step():
    return _minimal_machine(effects=[{
        "primitive": "start_due_clocks", "params": {"step_ids": ["ghost_step"]},
    }]), [], {}


def _case_set_context_missing_key():
    return _minimal_machine(effects=[{"primitive": "set_context", "params": {}}]), [], {}


PARAM_VALIDATION_CASES = [
    ("items_in_status: missing status", _case_items_in_status_missing_status,
     "missing required param 'status'"),
    ("items_in_status: invalid quantifier", _case_items_in_status_bad_quantifier,
     "param 'quantifier' must be 'all' or 'any'"),
    ("items_in_status: step_ids not a list", _case_items_in_status_step_ids_not_list,
     "param 'step_ids' must be a list"),
    ("capacity_available: missing count_states", _case_capacity_available_missing_count_states,
     "missing required param 'count_states'"),
    ("capacity_available: missing capacity_field", _case_capacity_available_missing_capacity_field,
     "missing required param 'capacity_field'"),
    ("data_condition: missing condition", _case_data_condition_missing_condition,
     "missing required param 'condition'"),
    ("data_condition: invalid condition", _case_data_condition_invalid_condition,
     "param 'condition' failed to parse"),
    ("date_window: neither start nor end", _case_date_window_neither_bound,
     "requires at least one of 'start'/'end'"),
    ("date_window: malformed date", _case_date_window_malformed_date,
     "not a valid YYYY-MM-DD date"),
    ("actor_role: empty roles", _case_actor_role_empty_roles,
     "param 'roles' must be a non-empty list"),
    ("commit_sections: empty section_ids", _case_commit_sections_empty_section_ids,
     "param 'section_ids' must be a non-empty list"),
    ("set_entity_field: missing ref", _case_set_entity_field_missing_ref,
     "missing required param 'ref'"),
    ("set_entity_field: missing field", _case_set_entity_field_missing_field,
     "missing required param 'field'"),
    ("set_entity_field: instance + engine-owned field", _case_set_entity_field_instance_engine_owned,
     "targets engine-owned field 'state' on ref 'instance'"),
    ("send_email: missing template", _case_send_email_missing_template,
     "missing required param 'template'"),
    ("start_due_clocks: empty step_ids", _case_start_due_clocks_empty_step_ids,
     "param 'step_ids' must be a non-empty list"),
    ("start_due_clocks: undeclared step", _case_start_due_clocks_undeclared_step,
     "references undeclared step 'ghost_step'"),
    ("set_context: missing key", _case_set_context_missing_key,
     "missing required param 'key'"),
]


@pytest.mark.parametrize(
    "name,case_fn,expected_substring",
    PARAM_VALIDATION_CASES,
    ids=[c[0] for c in PARAM_VALIDATION_CASES],
)
def test_guard_effect_param_validation(name, case_fn, expected_substring):
    m, s, md = case_fn()
    machine, steps, models = _build(m, s, md)
    errors = validate_definition(machine, steps, models)
    assert errors, f"{name}: expected at least one error, got none"
    assert any(expected_substring in e for e in errors), (
        f"{name}: expected an error containing {expected_substring!r}, got {errors}"
    )


def test_set_entity_field_non_instance_ref_not_subject_to_engine_owned_ban():
    # ENGINE_OWNED_FIELDS (e.g. "state") is an instance-only concept -- a
    # set_entity_field targeting a non-instance ref (e.g. "student") is
    # never subject to this ban, even if the field name happens to collide.
    m = _minimal_machine(effects=[{
        "primitive": "set_entity_field",
        "params": {"ref": "student", "field": "state", "value": "x"},
    }])
    machine, steps, models = _build(m, [], {})
    errors = validate_definition(machine, steps, models)
    assert not any("engine-owned" in e for e in errors)


def test_start_due_clocks_step_ids_referencing_declared_step_is_valid():
    step = {
        "step_id": "docs_step", "type": "documents", "title": "Docs",
        "required": True, "blocking": True, "available_in": ["draft"],
        "show_if": None, "review": None, "config": {"docs": []},
    }
    m = _minimal_machine(effects=[{
        "primitive": "start_due_clocks", "params": {"step_ids": ["docs_step"]},
    }])
    machine, steps, models = _build(m, [step], {})
    errors = validate_definition(machine, steps, models)
    assert not any("start_due_clocks" in e for e in errors)


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


# --- items_in_status vocabulary validation ----------------------------------


def test_items_in_status_rejects_unknown_status():
    errors = _guard_params_items_in_status({"status": "verifyed"})
    assert any("verifyed" in e for e in errors)


def test_items_in_status_rejects_unknown_in_a_list():
    errors = _guard_params_items_in_status({"status": ["submitted", "bogus"]})
    assert any("bogus" in e for e in errors)


def test_items_in_status_accepts_every_real_template_value():
    """The enrollment template's actual guard params must still pass."""
    for value in ("rejected", ["submitted", "verified"], ["verified", "waived"]):
        assert _guard_params_items_in_status({"status": value}) == []
