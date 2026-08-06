"""Machine-execution tests (Task 8): `build_eval_context`, `execute_action`
(item built-ins, guarded transition branching, actor gating, the 409 allowed-
actions listing), `run_system_transitions` (auto-advance + cycle guard), and
`cancel_instance`.

Written first per TDD: `app.workflows.machine` does not exist yet at the time
these were drafted. Fixtures deliberately stay small (2-3 transitions) rather
than reusing the full enrollment machine (Task 9's job) — per task-8-brief.md
Step 1: "use a small 2-transition fixture, not the full enrollment machine".

Unit-tested directly against `app.workflows.machine` (mirrors test_items.py's
/ test_primitives.py's pattern) — route-level tests live in
test_actions_api.py.
"""
import json

import pytest
from fastapi import HTTPException

from app.workflows import engine, machine

TENANT = "acme"


# --- fixture builders -------------------------------------------------------


def _seed_definition(fake_dc, *, definition_id, machine_def, steps=None, status="published",
                     lineage_status="active", version=1):
    base = {
        "definition_id": definition_id,
        "name": "Test machine",
        "version": version,
        "status": status,
        "lineage_status": lineage_status,
        "channel_access": "staff_only",
        "machine": json.dumps(machine_def),
        "steps": json.dumps(steps if steps is not None else []),
    }
    created = fake_dc.dc_create(TENANT, "workflow_definition", base)
    return created["entity_id"]


def _create_instance(fake_dc, definition_id, *, context=None, channel="staff"):
    result = engine.create_instance(TENANT, definition_id, context or {}, channel)
    instance_eid = result["instance"]["entity_id"]
    return fake_dc.get_entity(TENANT, "workflow_instance", instance_eid)


def _refresh(fake_dc, instance_row):
    return fake_dc.get_entity(TENANT, "workflow_instance", instance_row["entity_id"])


def _activities(fake_dc, instance_row):
    return fake_dc.find("workflow_activity", instance_id=instance_row["entity_id"])


# --- guarded-alternative ordering (Branching, spec §3) ----------------------


def _ordering_machine():
    return {
        "states": [
            {"state_id": "draft", "name": "Draft", "kind": "initial"},
            {"state_id": "waitlisted", "name": "Waitlisted", "kind": "terminal"},
            {"state_id": "submitted", "name": "Submitted", "kind": "terminal"},
        ],
        "transitions": [
            {
                "transition_id": "t_waitlist",
                "from": "draft", "to": "waitlisted", "action": "submit", "actor": "staff",
                "guards": [{
                    "primitive": "data_condition",
                    "params": {"condition": {
                        "all": [{"source": "context.at_capacity", "op": "eq", "value": True}]
                    }},
                }],
                "effects": [],
            },
            {
                "transition_id": "t_submit_default",
                "from": "draft", "to": "submitted", "action": "submit", "actor": "staff",
                "guards": [], "effects": [],
            },
        ],
    }


def test_guarded_alternative_full_capacity_takes_first_branch(fake_dc):
    _seed_definition(fake_dc, definition_id="wd-ordering-1", machine_def=_ordering_machine())
    instance_row = _create_instance(fake_dc, "wd-ordering-1", context={"at_capacity": True})

    ctx = machine.build_eval_context(TENANT, instance_row, actor="staff-u1")
    updated = machine.execute_action(ctx, "submit", {})

    assert updated["state"] == "waitlisted"


def test_guarded_alternative_falls_through_to_unguarded_default(fake_dc):
    _seed_definition(fake_dc, definition_id="wd-ordering-2", machine_def=_ordering_machine())
    instance_row = _create_instance(fake_dc, "wd-ordering-2", context={"at_capacity": False})

    ctx = machine.build_eval_context(TENANT, instance_row, actor="staff-u1")
    updated = machine.execute_action(ctx, "submit", {})

    assert updated["state"] == "submitted"


# --- actor gating -----------------------------------------------------------


def _actor_gate_machine():
    return {
        "states": [
            {"state_id": "draft", "name": "Draft", "kind": "initial"},
            {"state_id": "approved", "name": "Approved", "kind": "terminal"},
            {"state_id": "confirmed", "name": "Confirmed", "kind": "terminal"},
            {"state_id": "auto_done", "name": "Auto done", "kind": "terminal"},
        ],
        "transitions": [
            {"transition_id": "t_approve", "from": "draft", "to": "approved", "action": "approve",
             "actor": "staff", "guards": [], "effects": []},
            {"transition_id": "t_confirm", "from": "draft", "to": "confirmed", "action": "confirm",
             "actor": "family", "guards": [], "effects": []},
            {"transition_id": "t_system_only", "from": "draft", "to": "auto_done",
             "action": "system_advance", "actor": "system", "guards": [], "effects": []},
        ],
    }


def test_family_actor_cannot_fire_staff_only_transition_403(fake_dc):
    _seed_definition(fake_dc, definition_id="wd-gate-1", machine_def=_actor_gate_machine())
    instance_row = _create_instance(fake_dc, "wd-gate-1")

    ctx = machine.build_eval_context(TENANT, instance_row, actor="family:tok1")
    with pytest.raises(HTTPException) as exc:
        machine.execute_action(ctx, "approve", {})
    assert exc.value.status_code == 403


def test_staff_actor_can_fire_family_transition_on_behalf(fake_dc):
    _seed_definition(fake_dc, definition_id="wd-gate-2", machine_def=_actor_gate_machine())
    instance_row = _create_instance(fake_dc, "wd-gate-2")

    ctx = machine.build_eval_context(TENANT, instance_row, actor="staff-u1")
    updated = machine.execute_action(ctx, "confirm", {})
    assert updated["state"] == "confirmed"


def test_system_transition_never_fireable_by_explicit_action_call(fake_dc):
    """spec §4: `actor: system` transitions "NEVER fireable by explicit
    action call (only auto-advance) -- if the only candidates are system
    ones, treat as no-match" -- 409, not 403, and not a state change."""
    _seed_definition(fake_dc, definition_id="wd-gate-3", machine_def=_actor_gate_machine())
    instance_row = _create_instance(fake_dc, "wd-gate-3")

    ctx = machine.build_eval_context(TENANT, instance_row, actor="staff-u1")
    with pytest.raises(HTTPException) as exc:
        machine.execute_action(ctx, "system_advance", {})
    assert exc.value.status_code == 409

    refreshed = _refresh(fake_dc, instance_row)
    assert refreshed["state"] == "draft"


# --- 409 allowed-actions listing --------------------------------------------


def _allowed_listing_machine():
    return {
        "states": [
            {"state_id": "draft", "name": "Draft", "kind": "initial"},
            {"state_id": "approved", "name": "Approved", "kind": "terminal"},
            {"state_id": "declined", "name": "Declined", "kind": "terminal"},
        ],
        "transitions": [
            {
                "transition_id": "t_approve",
                "from": "draft", "to": "approved", "action": "approve", "actor": "staff",
                "guards": [], "effects": [],  # always satisfiable
            },
            {
                "transition_id": "t_reject",
                "from": "draft", "to": "declined", "action": "reject", "actor": "staff",
                "guards": [{
                    "primitive": "data_condition",
                    "params": {"condition": {
                        "all": [{"source": "context.never_true", "op": "eq", "value": "nope"}]
                    }},
                }],  # never satisfiable -- context.never_true is never set to "nope"
                "effects": [],
            },
        ],
    }


def test_409_lists_currently_satisfiable_actions_honestly_for_staff(fake_dc):
    _seed_definition(fake_dc, definition_id="wd-allowed-1", machine_def=_allowed_listing_machine())
    instance_row = _create_instance(fake_dc, "wd-allowed-1")

    ctx = machine.build_eval_context(TENANT, instance_row, actor="staff-u1")
    with pytest.raises(HTTPException) as exc:
        machine.execute_action(ctx, "nonexistent_action", {})

    assert exc.value.status_code == 409
    assert exc.value.detail["allowed"] == [
        "approve", "save_draft", "complete_item", "verify_item", "reject_item", "waive_item",
    ]


def test_409_lists_currently_satisfiable_actions_honestly_for_family(fake_dc):
    """Neither transition in this fixture is `actor: family`, so a family
    actor's allowed list is just the two family-permitted item built-ins."""
    _seed_definition(fake_dc, definition_id="wd-allowed-2", machine_def=_allowed_listing_machine())
    instance_row = _create_instance(fake_dc, "wd-allowed-2", channel="family")

    ctx = machine.build_eval_context(TENANT, instance_row, actor="family:tok1")
    with pytest.raises(HTTPException) as exc:
        machine.execute_action(ctx, "nonexistent_action", {})

    assert exc.value.status_code == 409
    assert exc.value.detail["allowed"] == ["save_draft", "complete_item"]


# --- item built-ins: family gating, terminal-state block --------------------


def _student_model():
    return {
        "base_fields": [
            {"name": "student_id", "type": "str", "required": True},
            {"name": "first_name", "type": "str", "required": False},
        ],
        "custom_fields": [],
    }


def _form_step_fixture():
    return [
        {
            "step_id": "form_step", "type": "form", "title": "Form", "required": True,
            "blocking": True, "available_in": ["draft"], "show_if": None, "review": "staff",
            "config": {"sections": [{
                "section_id": "s1", "entity_model": "student", "mode": "create",
                "fields": [{"name": "first_name", "required": False}], "repeat": None,
            }]},
        }
    ]


def _form_item_entity_id(fake_dc, instance_row):
    items = fake_dc.find("workflow_item", instance_id=instance_row["entity_id"])
    return items[0]["entity_id"]


def test_family_actor_cannot_verify_item_via_action_endpoint_403(fake_dc):
    fake_dc.set_model(TENANT, "student", _student_model())
    _seed_definition(fake_dc, definition_id="wd-builtin-1", machine_def=_allowed_listing_machine(),
                     steps=_form_step_fixture())
    instance_row = _create_instance(fake_dc, "wd-builtin-1")
    item_eid = _form_item_entity_id(fake_dc, instance_row)

    ctx = machine.build_eval_context(TENANT, instance_row, actor="family:tok1")
    with pytest.raises(HTTPException) as exc:
        machine.execute_action(ctx, "verify_item", {"item_id": item_eid})
    assert exc.value.status_code == 403


def test_item_builtin_blocked_once_instance_terminal(fake_dc):
    fake_dc.set_model(TENANT, "student", _student_model())
    _seed_definition(fake_dc, definition_id="wd-builtin-2", machine_def=_allowed_listing_machine(),
                     steps=_form_step_fixture())
    instance_row = _create_instance(fake_dc, "wd-builtin-2")
    item_eid = _form_item_entity_id(fake_dc, instance_row)

    ctx = machine.build_eval_context(TENANT, instance_row, actor="staff-u1")
    machine.execute_action(ctx, "approve", {})  # -> terminal "approved"
    assert ctx.instance["state"] == "approved"

    with pytest.raises(HTTPException) as exc:
        machine.execute_action(ctx, "complete_item", {"item_id": item_eid})
    assert exc.value.status_code == 409


# --- complete_item threads payload_ref (Plan 3 Task 3 — the write-path gap
# `docs/superpowers/plans/2026-08-06-apexflow-plan3-interface-map.md` §10
# finding 2 identified: nothing forwarded params["payload_ref"] past this
# dispatcher, so document-item completion was unreachable through either
# channel) -------------------------------------------------------------


def _docs_step_fixture():
    return [
        {
            "step_id": "docs_step", "type": "documents", "title": "Docs", "required": True,
            "blocking": True, "available_in": ["draft"], "show_if": None, "review": None,
            "config": {"docs": [{"name": "ID"}]},
        }
    ]


def test_complete_item_threads_payload_ref_writes_and_validates_document_ref(fake_dc):
    fake_dc.set_model(TENANT, "student", _student_model())
    _seed_definition(fake_dc, definition_id="wd-payload-ref", machine_def=_allowed_listing_machine(),
                     steps=_docs_step_fixture())
    instance_row = _create_instance(fake_dc, "wd-payload-ref", channel="family")
    item_eid = _form_item_entity_id(fake_dc, instance_row)
    fake_dc.rows.append(fake_dc._store_row("doc-1", "document", TENANT, {
        "document_id": "DC-1", "application_id": instance_row["entity_id"], "filename": "id.pdf",
        "uploaded_by": "family:tok1", "sensitive": False, "item_id": "",
    }))

    ctx = machine.build_eval_context(TENANT, instance_row, actor="family:tok1")
    machine.execute_action(ctx, "complete_item", {"item_id": item_eid, "payload_ref": "doc-1"})
    assert ctx.item_result["base_data"]["payload_ref"] == "doc-1"
    assert ctx.item_result["base_data"]["status"] == "submitted"  # documents default review: staff

    with pytest.raises(HTTPException) as exc:
        machine.execute_action(ctx, "complete_item",
                               {"item_id": item_eid, "payload_ref": "does-not-exist"})
    assert exc.value.status_code == 409
    assert exc.value.detail == {"reason": "payload_ref_invalid"}


# --- system auto-advance: fires after the item mutation that satisfies it --


def _auto_advance_machine():
    return {
        "states": [
            {"state_id": "draft", "name": "Draft", "kind": "initial"},
            {"state_id": "done", "name": "Done", "kind": "terminal"},
        ],
        "transitions": [
            {
                "transition_id": "t_auto",
                "from": "draft", "to": "done", "action": "auto_advance", "actor": "system",
                # items_in_status{status: verified} (not all_blocking_items_complete, which
                # already counts "submitted" as done per ITEM_DONE_STATUSES) so this guard only
                # passes once the item is specifically VERIFIED -- distinguishing the
                # complete_item (-> submitted) step from the verify_item (-> verified) step below.
                "guards": [{"primitive": "items_in_status", "params": {"status": "verified"}}],
                "effects": [],
            },
        ],
    }


def test_system_auto_advance_fires_after_verify_item_satisfies_guard(fake_dc):
    fake_dc.set_model(TENANT, "student", _student_model())
    _seed_definition(fake_dc, definition_id="wd-auto-1", machine_def=_auto_advance_machine(),
                     steps=_form_step_fixture())
    instance_row = _create_instance(fake_dc, "wd-auto-1")
    item_eid = _form_item_entity_id(fake_dc, instance_row)

    ctx = machine.build_eval_context(TENANT, instance_row, actor="staff-u1")
    machine.execute_action(ctx, "complete_item", {"item_id": item_eid})  # -> submitted (review: staff)
    assert ctx.instance["state"] == "draft"  # not yet -- item only submitted, not verified

    updated = machine.execute_action(ctx, "verify_item", {"item_id": item_eid})
    assert updated["state"] == "done"

    activities = _activities(fake_dc, instance_row)
    types_in_order = [a["type"] for a in activities]
    # state_change(draft, from create_instance), item_change(submitted), item_change(verified),
    # state_change(done) -- the causal item_change immediately precedes the auto-advance state_change.
    assert types_in_order[-2:] == ["item_change", "state_change"]
    assert activities[-1]["from_value"] == "draft"
    assert activities[-1]["to_value"] == "done"


# --- closed_at auto-set on ANY terminal landing (machine.py decision 5) -----


def test_staff_transition_landing_on_terminal_state_sets_closed_at(fake_dc):
    """`_write_state` sets `closed_at` whenever a transition (explicit here)
    lands on a `kind: "terminal"` state -- not only via `cancel_instance`."""
    _seed_definition(fake_dc, definition_id="wd-closed-1", machine_def=_cancel_machine())
    instance_row = _create_instance(fake_dc, "wd-closed-1")
    assert not instance_row.get("closed_at")

    ctx = machine.build_eval_context(TENANT, instance_row, actor="staff-u1")
    updated = machine.execute_action(ctx, "finish", {})

    assert updated["state"] == "done"
    assert updated["closed_at"]
    refreshed = _refresh(fake_dc, instance_row)
    assert refreshed["closed_at"] == updated["closed_at"]


def test_system_auto_advance_landing_on_terminal_state_sets_closed_at(fake_dc):
    """Same as above, but for the SYSTEM-auto-advance path specifically
    (run_system_transitions -> `_apply_transition` -> `_write_state`), not
    just an explicit user-invoked transition."""
    fake_dc.set_model(TENANT, "student", _student_model())
    _seed_definition(fake_dc, definition_id="wd-closed-2", machine_def=_auto_advance_machine(),
                     steps=_form_step_fixture())
    instance_row = _create_instance(fake_dc, "wd-closed-2")
    item_eid = _form_item_entity_id(fake_dc, instance_row)
    assert not instance_row.get("closed_at")

    ctx = machine.build_eval_context(TENANT, instance_row, actor="staff-u1")
    machine.execute_action(ctx, "complete_item", {"item_id": item_eid})
    updated = machine.execute_action(ctx, "verify_item", {"item_id": item_eid})  # triggers auto-advance

    assert updated["state"] == "done"
    assert updated["closed_at"]
    refreshed = _refresh(fake_dc, instance_row)
    assert refreshed["closed_at"] == updated["closed_at"]


# --- auto-advance cycle guard terminates ------------------------------------


def _cycle_machine():
    return {
        "states": [
            {"state_id": "A", "name": "A", "kind": "initial"},
            {"state_id": "B", "name": "B", "kind": "active"},
        ],
        "transitions": [
            {"transition_id": "t_ab", "from": "A", "to": "B", "action": "advance", "actor": "system",
             "guards": [], "effects": []},
            {"transition_id": "t_ba", "from": "B", "to": "A", "action": "advance", "actor": "system",
             "guards": [], "effects": []},
        ],
    }


def test_auto_advance_cycle_guard_terminates_two_state_loop(fake_dc):
    _seed_definition(fake_dc, definition_id="wd-cycle-1", machine_def=_cycle_machine())
    instance_row = _create_instance(fake_dc, "wd-cycle-1")

    ctx = machine.build_eval_context(TENANT, instance_row, actor="staff-u1")
    updated = machine.run_system_transitions(ctx)

    assert updated["state"] == "B"  # exactly one hop (A -> B), then the cycle guard halts
    state_changes = [a for a in _activities(fake_dc, instance_row) if a["type"] == "state_change"]
    # one from create_instance ("" -> A) plus exactly one auto-advance hop (A -> B).
    assert len(state_changes) == 2
    assert state_changes[-1]["from_value"] == "A"
    assert state_changes[-1]["to_value"] == "B"


# --- cancel_instance ---------------------------------------------------------


def _cancel_machine():
    return {
        "states": [
            {"state_id": "draft", "name": "Draft", "kind": "initial"},
            {"state_id": "done", "name": "Done", "kind": "terminal"},
        ],
        "transitions": [
            {"transition_id": "t_finish", "from": "draft", "to": "done", "action": "finish",
             "actor": "staff", "guards": [], "effects": []},
        ],
    }


def test_cancel_instance_from_non_terminal_state_succeeds(fake_dc):
    _seed_definition(fake_dc, definition_id="wd-cancel-1", machine_def=_cancel_machine())
    instance_row = _create_instance(fake_dc, "wd-cancel-1")

    ctx = machine.build_eval_context(TENANT, instance_row, actor="staff-u1")
    updated = machine.cancel_instance(ctx)

    assert updated["state"] == "cancelled"
    assert updated["closed_at"]
    assert int(updated["token_version"]) == 2  # started at 1 (create_instance)

    activities = _activities(fake_dc, instance_row)
    assert activities[-1]["type"] == "state_change"
    assert activities[-1]["to_value"] == "cancelled"


def test_cancel_instance_from_terminal_state_409(fake_dc):
    _seed_definition(fake_dc, definition_id="wd-cancel-2", machine_def=_cancel_machine())
    instance_row = _create_instance(fake_dc, "wd-cancel-2")

    ctx = machine.build_eval_context(TENANT, instance_row, actor="staff-u1")
    machine.execute_action(ctx, "finish", {})
    assert ctx.instance["state"] == "done"

    with pytest.raises(HTTPException) as exc:
        machine.cancel_instance(ctx)
    assert exc.value.status_code == 409


def test_cancel_instance_family_actor_403(fake_dc):
    _seed_definition(fake_dc, definition_id="wd-cancel-3", machine_def=_cancel_machine())
    instance_row = _create_instance(fake_dc, "wd-cancel-3")

    ctx = machine.build_eval_context(TENANT, instance_row, actor="family:tok1")
    with pytest.raises(HTTPException) as exc:
        machine.cancel_instance(ctx)
    assert exc.value.status_code == 403


def test_cancel_instance_via_execute_action_builtin(fake_dc):
    _seed_definition(fake_dc, definition_id="wd-cancel-4", machine_def=_cancel_machine())
    instance_row = _create_instance(fake_dc, "wd-cancel-4")

    ctx = machine.build_eval_context(TENANT, instance_row, actor="staff-u1")
    updated = machine.execute_action(ctx, "cancel_instance", {})
    assert updated["state"] == "cancelled"


# --- effect exception: no state write, failed-action note activity ---------


def _failing_effect_machine():
    return {
        "states": [
            {"state_id": "draft", "name": "Draft", "kind": "initial"},
            {"state_id": "reviewed", "name": "Reviewed", "kind": "terminal"},
        ],
        "transitions": [
            {
                "transition_id": "t_submit",
                "from": "draft", "to": "reviewed", "action": "submit", "actor": "staff",
                "guards": [],
                # set_entity_field on an unresolved ref raises HTTPException(409) --
                # a real effect failure, no monkeypatching needed.
                "effects": [{
                    "primitive": "set_entity_field",
                    "params": {"ref": "nonexistent_ref", "field": "x", "value": "y"},
                }],
            },
        ],
    }


def test_effect_exception_leaves_state_unchanged_and_logs_failed_action_note(fake_dc):
    _seed_definition(fake_dc, definition_id="wd-fail-1", machine_def=_failing_effect_machine())
    instance_row = _create_instance(fake_dc, "wd-fail-1")

    ctx = machine.build_eval_context(TENANT, instance_row, actor="staff-u1")
    with pytest.raises(HTTPException) as exc:
        machine.execute_action(ctx, "submit", {})
    assert exc.value.status_code == 409

    refreshed = _refresh(fake_dc, instance_row)
    assert refreshed["state"] == "draft"  # state write never happened

    activities = _activities(fake_dc, instance_row)
    note = activities[-1]
    assert note["type"] == "note"
    assert note["from_value"] == "draft"
    assert note["to_value"] == "action_failed:submit"


# --- build_eval_context: pinned superseded version --------------------------


def test_build_eval_context_runs_on_pinned_superseded_version(fake_dc):
    """spec §3: "in-flight instances always run and commit per their pinned
    version" -- publishing v2 supersedes v1, but an instance pinned to v1
    must still resolve via build_eval_context (status IN (published,
    superseded))."""
    from app.workflows.definitions import publish_definition

    v1_eid = _seed_definition(fake_dc, definition_id="wd-pin-1", machine_def=_cancel_machine(),
                              version=1, status="published")
    instance_row = _create_instance(fake_dc, "wd-pin-1")
    assert instance_row["definition_version"] == "1"

    v2_eid = _seed_definition(fake_dc, definition_id="wd-pin-1", machine_def=_cancel_machine(),
                              version=2, status="draft")
    publish_definition(TENANT, v2_eid)
    v1_row = fake_dc.get_entity(TENANT, "workflow_definition", v1_eid)
    assert v1_row["status"] == "superseded"

    ctx = machine.build_eval_context(TENANT, instance_row, actor="staff-u1")
    assert ctx.definition["version"] == 1
