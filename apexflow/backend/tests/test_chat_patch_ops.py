# apexflow/backend/tests/test_chat_patch_ops.py
"""Patch-op vocabulary + editor-context loader (Plan 4 / Task 6).

Two units, one file, because they are the two halves of the same seam: the
context block tells the model which ids exist, and the op vocabulary is what
it may say about them.

`validate_ops` is STRUCTURAL only — it answers "is this a well-formed op",
not "does this op make sense against the open draft". Semantic validation
rides the save PUT the admin's Apply click triggers, exactly as it does for
a hand-edit in the designer. The ops' field names are a wire contract with
Tasks 9/11 (the TS types and the patch card), so the alias spellings are
asserted here rather than assumed.
"""
import json

import pytest
from pydantic import ValidationError

from app.chat.context import load_editor_context
from app.chat.patch_ops import validate_ops
from app.workflows import definitions as defs

TENANT = "acme"
TOKEN = "Bearer test-token"


# --- op fixtures -----------------------------------------------------------
#
# One of every op in the vocabulary. Kept as a dict-of-dicts (not a list) so a
# failure names the op that broke.

ONE_OF_EACH: dict[str, dict] = {
    "add_stage": {"op": "add_stage", "stage_id": "review", "name": "Review",
                  "kind": "active"},
    "rename_stage": {"op": "rename_stage", "stage_id": "review", "name": "In review"},
    "set_stage_kind": {"op": "set_stage_kind", "stage_id": "review", "kind": "terminal"},
    "remove_stage": {"op": "remove_stage", "stage_id": "review"},
    "add_move": {"op": "add_move", "transition_id": "t_review", "from": "draft",
                 "to": "review", "action": "send_for_review", "actor": "staff",
                 "guards": [], "effects": []},
    "update_move": {"op": "update_move", "transition_id": "t_review",
                    "patch": {"actor": "family"}},
    "remove_move": {"op": "remove_move", "transition_id": "t_review"},
    "add_step": {"op": "add_step", "step": {"step_id": "s1", "type": "message",
                                            "title": "Welcome", "required": False,
                                            "blocking": False, "available_in": ["draft"],
                                            "config": {"body": "hi"}},
                 "position": 0},
    "update_step": {"op": "update_step", "step_id": "s1", "patch": {"title": "Hello"}},
    "remove_step": {"op": "remove_step", "step_id": "s1"},
    "add_section": {"op": "add_section", "step_id": "s1",
                    "section": {"section_id": "sec1", "entity_model": "student",
                                "fields": [], "mode": "create"}},
    "update_section": {"op": "update_section", "step_id": "s1", "section_id": "sec1",
                       "patch": {"mode": "match_or_create"}},
    "remove_section": {"op": "remove_section", "step_id": "s1", "section_id": "sec1"},
    "set_channel_access": {"op": "set_channel_access", "value": "family"},
}


def test_validate_ops_accepts_one_of_every_op_in_the_vocabulary():
    """The whole vocabulary must round-trip in ONE call — the model sends a
    list, and an op the union forgot would reject the entire patch."""
    out = validate_ops(list(ONE_OF_EACH.values()))

    assert [o["op"] for o in out] == list(ONE_OF_EACH)
    assert len(out) == 14


@pytest.mark.parametrize("name,op", list(ONE_OF_EACH.items()))
def test_validate_ops_accepts_each_op_individually(name, op):
    assert validate_ops([op])[0]["op"] == name


def test_validate_ops_round_trips_the_from_alias():
    """`from` is a Python keyword, so `AddMove` names the field `from_` — but
    the wire key on both sides (the model's call, and the transition the card
    builds) is `from`, matching `TransitionDef`'s own alias."""
    out = validate_ops([ONE_OF_EACH["add_move"]])[0]

    assert out["from"] == "draft"
    assert "from_" not in out


def test_validate_ops_accepts_the_python_name_for_from_too():
    """`populate_by_name=True`: a model that emits `from_` is not punished for
    it — but the DUMP is still the wire spelling."""
    op = dict(ONE_OF_EACH["add_move"])
    op.pop("from")
    op["from_"] = "draft"

    out = validate_ops([op])[0]

    assert out["from"] == "draft"


def test_validate_ops_defaults_add_move_actor_guards_and_effects():
    out = validate_ops([{"op": "add_move", "transition_id": "t", "from": "a",
                         "to": "b", "action": "go"}])[0]

    assert out["actor"] == "staff"
    assert out["guards"] == [] and out["effects"] == []


def test_validate_ops_defaults_add_stage_kind_to_active():
    out = validate_ops([{"op": "add_stage", "stage_id": "x", "name": "X"}])[0]

    assert out["kind"] == "active"


def test_validate_ops_defaults_add_step_position_to_none_meaning_append():
    out = validate_ops([{"op": "add_step", "step": ONE_OF_EACH["add_step"]["step"]}])[0]

    assert out["position"] is None


def test_validate_ops_rejects_an_unknown_op():
    with pytest.raises(ValidationError):
        validate_ops([{"op": "delete_everything", "stage_id": "x"}])


def test_validate_ops_rejects_a_remove_stage_missing_its_stage_id():
    with pytest.raises(ValidationError):
        validate_ops([{"op": "remove_stage"}])


def test_validate_ops_rejects_an_unknown_field_on_a_known_op():
    """`extra="forbid"`: a model that invents `stage_name` must be told, not
    silently have it dropped on the way to a card the admin then applies."""
    with pytest.raises(ValidationError):
        validate_ops([{"op": "remove_stage", "stage_id": "x", "stage_name": "X"}])


def test_validate_ops_rejects_a_bad_enum_value():
    with pytest.raises(ValidationError):
        validate_ops([{"op": "set_channel_access", "value": "public"}])
    with pytest.raises(ValidationError):
        validate_ops([{"op": "set_stage_kind", "stage_id": "x", "kind": "final"}])


def test_validate_ops_rejects_a_non_list():
    """The model can hand a bare dict; that must be a ValidationError the
    caller converts to text, not a TypeError through the stream."""
    with pytest.raises(ValidationError):
        validate_ops({"op": "remove_stage", "stage_id": "x"})


def test_validate_ops_output_is_json_serializable():
    """It rides the SSE wire verbatim (`json.dumps` in stream.py's `_sse`)."""
    json.dumps(validate_ops(list(ONE_OF_EACH.values())))


# --- load_editor_context ---------------------------------------------------


def _valid_machine():
    return {
        "states": [
            {"state_id": "draft", "name": "Draft", "kind": "initial"},
            {"state_id": "enrolled", "name": "Enrolled", "kind": "terminal"},
        ],
        "transitions": [
            {"transition_id": "t_submit", "from": "draft", "to": "enrolled",
             "action": "submit", "actor": "family", "guards": [],
             "effects": [{"primitive": "commit_sections",
                          "params": {"section_ids": ["student_section"]}}]},
        ],
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
            "config": {"sections": [{
                "section_id": "student_section",
                "entity_model": "student",
                "fields": [{"name": "first_name", "required": True},
                           {"name": "last_name", "required": True}],
                "mode": "create",
                "repeat": None,
            }]},
        }
    ]


def _student_model():
    return {
        "base_fields": [
            {"name": "student_id", "type": "str", "required": True},
            {"name": "first_name", "type": "str", "required": True},
            {"name": "last_name", "type": "str", "required": True},
        ],
        "custom_fields": [{"name": "allergies", "type": "str", "required": False}],
    }


def _seed(fake_dc, *, status="draft", machine=None, steps=None,
          channel_access="staff_only", name="Enrollment"):
    return fake_dc.dc_create(TENANT, "workflow_definition", {
        "definition_id": "wd-1",
        "name": name,
        "version": 1,
        "status": status,
        "lineage_status": "active",
        "channel_access": channel_access,
        "machine": json.dumps(machine if machine is not None else _valid_machine()),
        "steps": json.dumps(steps if steps is not None else _valid_steps()),
    })["entity_id"]


def test_load_editor_context_returns_the_draft_truth_as_json(fake_dc):
    fake_dc.set_model(TENANT, "student", _student_model())
    eid = _seed(fake_dc, channel_access="family")

    payload = json.loads(load_editor_context(TENANT, eid, TOKEN))

    assert payload["name"] == "Enrollment"
    assert payload["status"] == "draft"
    assert payload["read_only"] is False
    assert payload["channel_access"] == "family"
    # The FULL machine and steps — the model patches by id, so every id it
    # may reference has to be in the block.
    assert [s["state_id"] for s in payload["machine"]["states"]] == ["draft", "enrolled"]
    assert payload["machine"]["transitions"][0]["from"] == "draft"
    assert payload["steps"][0]["step_id"] == "student_details"
    assert payload["validation_errors"] == []


def test_load_editor_context_lists_real_field_names_per_entity_model(fake_dc):
    """`entity_model_fields` exists so the model proposes sections against
    fields that EXIST. Base and custom fields are validated identically, so
    both must appear (this is `validate.py::_model_fields`'s merge, reused
    rather than re-derived)."""
    fake_dc.set_model(TENANT, "student", _student_model())
    eid = _seed(fake_dc)

    payload = json.loads(load_editor_context(TENANT, eid, TOKEN))

    assert payload["entity_model_fields"] == {
        "student": ["allergies", "first_name", "last_name", "student_id"]
    }


def test_load_editor_context_reports_a_model_the_tenant_never_set_up(fake_dc):
    """`fetch_models` yields None for an unknown model. That must not crash,
    and the emptiness has to be visible — otherwise the model reads "no
    fields" as "a model with no fields" and proposes against nothing."""
    eid = _seed(fake_dc)

    payload = json.loads(load_editor_context(TENANT, eid, TOKEN))

    assert payload["entity_model_fields"] == {"student": []}


def test_load_editor_context_marks_a_published_row_read_only(fake_dc):
    fake_dc.set_model(TENANT, "student", _student_model())
    eid = _seed(fake_dc, status="published")

    payload = json.loads(load_editor_context(TENANT, eid, TOKEN))

    assert payload["status"] == "published"
    assert payload["read_only"] is True


def test_load_editor_context_surfaces_validation_errors(fake_dc):
    fake_dc.set_model(TENANT, "student", _student_model())
    eid = _seed(fake_dc, machine={"states": [{"state_id": "draft", "name": "D",
                                              "kind": "initial"}],
                                  "transitions": []}, steps=[])

    payload = json.loads(load_editor_context(TENANT, eid, TOKEN))

    assert any("terminal" in e for e in payload["validation_errors"]), payload


def test_load_editor_context_on_a_corrupt_row_says_so_instead_of_raising(fake_dc):
    """A row whose stored `machine` is not JSON is writable today through the
    generic entities proxy. It must come back as prose the model can act on —
    a raise here ends the SSE stream in `error` before a single token."""
    eid = fake_dc.dc_create(TENANT, "workflow_definition", {
        "definition_id": "wd-corrupt", "name": "Corrupt", "version": 1,
        "status": "draft", "lineage_status": "active", "channel_access": "staff_only",
        "machine": "not json", "steps": json.dumps(_valid_steps()),
    })["entity_id"]

    out = load_editor_context(TENANT, eid, TOKEN)

    assert "corrupt" in out.lower()
    assert "Corrupt" in out  # names the workflow


def test_load_editor_context_on_an_unloadable_row_degrades_to_prose(fake_dc):
    """A stale `entity_id` (draft deleted in another tab, or a client-claimed
    id for another tenant) 404s out of `require_definition_row`. The chat must
    still run — the admin asked a question, and the assistant can still answer
    it from `list_workflows`/`get_workflow`."""
    out = load_editor_context(TENANT, "no-such-row", TOKEN)

    assert "could not" in out.lower()
    assert "no-such-row" in out


def test_load_editor_context_degrades_when_the_model_read_fails(fake_dc, monkeypatch):
    """The definition itself parsed; only the model-coherence pass failed
    (DataCore's models table unreachable). The machine/steps are still worth
    handing over — the model can reason about structure without them — so this
    mirrors `get_workflow`'s identical degrade rather than losing the block."""
    def _boom(*a, **kw):
        raise RuntimeError("models table unreachable")

    monkeypatch.setattr(defs, "fetch_models", _boom)
    eid = _seed(fake_dc)

    payload = json.loads(load_editor_context(TENANT, eid, TOKEN))

    assert payload["steps"][0]["step_id"] == "student_details"
    assert any("models table unreachable" in e for e in payload["validation_errors"])
    assert payload["entity_model_fields"] == {}


def test_load_editor_context_is_tenant_scoped(fake_dc):
    """`entity_id` is client-claimed. The row read is tenant-scoped, so another
    tenant's definition is unreachable — it degrades exactly like a missing
    row rather than leaking a name."""
    fake_dc.set_model("other", "student", _student_model())
    eid = fake_dc.dc_create("other", "workflow_definition", {
        "definition_id": "wd-theirs", "name": "Theirs", "version": 1,
        "status": "draft", "lineage_status": "active", "channel_access": "staff_only",
        "machine": json.dumps(_valid_machine()), "steps": json.dumps(_valid_steps()),
    })["entity_id"]

    out = load_editor_context(TENANT, eid, TOKEN)

    assert "Theirs" not in out
    assert "could not" in out.lower()
