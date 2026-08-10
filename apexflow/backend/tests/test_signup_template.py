# apexflow/backend/tests/test_signup_template.py
"""Lifecycle acceptance suite for the program-signup template — the SECOND
shipped template, written to test whether the stage-centric editor's
abstraction holds at n=2 rather than n=1.

Spec: docs/superpowers/specs/2026-08-10-stage-centric-workflow-editor-design.md
"Risks" ("Coverage is unproven at n=1. ... Mitigation: write a second
template (signup) before building the editor.").

Same structure and model-loading discipline as
tests/test_enrollment_template.py: models are read from
launchpad/backend/app/data/base_model.json rather than hand-copied, and the
publish gate is exercised through the real `publish_definition` service
function, so "zero validator errors" is a structural property of the seed
path rather than a claim this file makes.
"""
import json
from pathlib import Path

import pytest
from fastapi import HTTPException

from app.templates import catalog, enrollment, signup
from app.workflows import engine, machine
from app.workflows.schema import MachineDef, StepDef
from app.workflows.validate import validate_definition
from tests.fakes import FakeDataCore

TENANT = "acme"

BASE_MODEL_PATH = (
    Path(__file__).resolve().parents[3] / "launchpad" / "backend" / "app" / "data" / "base_model.json"
)
# The signup template binds three models. `contact` is deliberately absent —
# a program signup reuses the family's existing emergency contacts rather
# than re-collecting them, which is one of the ways this template's shape
# differs from enrollment's.
_TEMPLATE_ENTITY_TYPES = ("student", "family", "enrollment")


def _load_base_models() -> dict:
    all_models = json.loads(BASE_MODEL_PATH.read_text())
    return {et: all_models[et] for et in _TEMPLATE_ENTITY_TYPES}


def _all_base_models() -> dict:
    return json.loads(BASE_MODEL_PATH.read_text())


# --- fixture helpers ---------------------------------------------------------


def _seed_models(fake_dc: FakeDataCore) -> None:
    for entity_type, definition in _load_base_models().items():
        fake_dc.set_model(TENANT, entity_type, definition)


def _seed_tenant_capacity(fake_dc: FakeDataCore, capacity: int) -> None:
    fake_dc.rows.append(FakeDataCore._store_row(TENANT, "tenant", TENANT, {"capacity": capacity}))


def _seed_template(fake_dc: FakeDataCore) -> dict:
    _seed_models(fake_dc)
    return signup.seed_signup_template(TENANT)


def _seed_capacity_instance(fake_dc: FakeDataCore, state: str, program_id: str = "PR-0001") -> None:
    """A bare workflow_instance row for the capacity_available guard to count
    against — same pattern as tests/test_enrollment_template.py's helper,
    scoped on `context.program_id` rather than `context.school_year`."""
    fake_dc.dc_create(TENANT, "workflow_instance", {
        "definition_id": signup.DEFINITION_ID,
        "definition_version": 1,
        "state": state,
        "context": json.dumps({"program_id": program_id}),
        "subject_refs": "{}",
        "channel_started": "staff",
        "token_version": 1,
        "draft_data": "{}",
        "opened_at": "2026-01-01T00:00:00+00:00",
    })


def _create_instance(fake_dc: FakeDataCore, *, program_id: str = "PR-0001",
                     channel: str = "family") -> dict:
    result = engine.create_instance(
        TENANT, signup.DEFINITION_ID, {"program_id": program_id}, channel,
        applicant_email="parent@example.com",
    )
    instance_eid = result["instance"]["entity_id"]
    return fake_dc.get_entity(TENANT, "workflow_instance", instance_eid)


def _item_by_step(fake_dc: FakeDataCore, instance_row: dict, step_id: str) -> dict:
    items = fake_dc.find("workflow_item", instance_id=instance_row["entity_id"])
    return next(i for i in items if i["step_id"] == step_id)


def _draft_answers(*, family_name: str = "Ng Family", program_id: str = "PR-0001") -> dict:
    return {
        "family_section": {
            "family_name": family_name,
            "primary_address": "1 Main St, Springfield",
            "primary_phone": "555-1000",
            "primary_email": "parent@example.com",
        },
        "student_section": {
            "first_name": "Alex",
            "last_name": "Ng",
            "primary_address": "1 Main St, Springfield",
            "dob": "2019-04-01",
        },
        "signup_section": {
            "program_id": program_id,
            "enrollment_date": "2026-09-01",
            "notes": "Tuesdays and Thursdays only",
        },
    }


def _fill_and_submit(fake_dc, instance_row, **kwargs) -> dict:
    ctx = machine.build_eval_context(TENANT, instance_row, actor="family:tok1")
    machine.execute_action(ctx, "save_draft", {"section_answers": _draft_answers(**kwargs)})
    form_item = _item_by_step(fake_dc, instance_row, "signup_form")
    machine.execute_action(ctx, "complete_item", {"item_id": form_item["entity_id"]})
    return machine.execute_action(ctx, "submit", {})


def _to_waitlisted(fake_dc) -> dict:
    """Capacity 1, already filled -> submit lands on the waitlist branch."""
    _seed_tenant_capacity(fake_dc, 1)
    _seed_capacity_instance(fake_dc, "confirmed")
    instance_row = _create_instance(fake_dc)
    updated = _fill_and_submit(fake_dc, instance_row)
    assert updated["state"] == "waitlisted"
    return updated


def _to_offered(fake_dc) -> dict:
    waitlisted = _to_waitlisted(fake_dc)
    staff_ctx = machine.build_eval_context(TENANT, waitlisted, actor="staff-1")
    offered = machine.execute_action(staff_ctx, "offer_spot", {})
    assert offered["state"] == "offered"
    return offered


# --- publish-time validation --------------------------------------------------


def test_signup_template_validates_with_zero_errors():
    machine_def = MachineDef.model_validate(signup.build_machine())
    steps = [StepDef.model_validate(s) for s in signup.build_steps()]
    errors = validate_definition(machine_def, steps, _load_base_models())
    assert errors == []


def test_signup_template_validates_against_the_whole_base_model_set():
    """Zero errors when every base model is present, not only the three the
    template binds — a tenant's real model set is the full file."""
    machine_def = MachineDef.model_validate(signup.build_machine())
    steps = [StepDef.model_validate(s) for s in signup.build_steps()]
    assert validate_definition(machine_def, steps, _all_base_models()) == []


def test_seed_signup_template_publishes_via_the_real_gate(fake_dc):
    published = _seed_template(fake_dc)
    base = published["base_data"]
    assert base["status"] == "published"
    assert base["definition_id"] == signup.DEFINITION_ID
    assert base["channel_access"] == "family"


# --- the catalog now carries two entries, not one ---------------------------


def test_template_catalog_returns_two_entries():
    """The n=1 risk in the stage-editor design, closed: the shipped catalog
    contains both templates."""
    entries = catalog.template_catalog()
    assert [e["template_id"] for e in entries] == [enrollment.DEFINITION_ID, signup.DEFINITION_ID]


def test_every_catalog_entry_validates_with_zero_errors():
    models = _all_base_models()
    for entry in catalog.template_catalog():
        machine_def = MachineDef.model_validate(entry["definition"]["machine"])
        steps = [StepDef.model_validate(s) for s in entry["definition"]["steps"]]
        errors = validate_definition(machine_def, steps, models)
        assert errors == [], f"{entry['template_id']}: {errors}"


def test_every_catalog_entry_has_name_description_and_channel_access():
    for entry in catalog.template_catalog():
        assert entry["name"].strip()
        assert entry["description"].strip()
        assert entry["definition"]["channel_access"] in ("family", "staff")


# --- happy path: instant confirmation when there is room --------------------


def test_submit_below_capacity_confirms_immediately(fake_dc):
    """Signup's defining difference from enrollment: no staff review tier.
    A family with room available is confirmed by their own submit."""
    _seed_template(fake_dc)
    _seed_tenant_capacity(fake_dc, 10)
    instance_row = _create_instance(fake_dc)

    updated = _fill_and_submit(fake_dc, instance_row)
    assert updated["state"] == "confirmed"


def test_submit_commits_family_student_and_enrollment(fake_dc):
    _seed_template(fake_dc)
    _seed_tenant_capacity(fake_dc, 10)
    instance_row = _create_instance(fake_dc)
    confirmed = _fill_and_submit(fake_dc, instance_row)

    family = fake_dc.find("family", family_name="Ng Family")[0]
    student = fake_dc.find("student", first_name="Alex")[0]
    assert student["family_id"] == family["entity_id"]

    enrollments = fake_dc.find("enrollment")
    assert len(enrollments) == 1
    row = enrollments[0]
    assert row["student_id"] == student["entity_id"]  # link-field injection
    assert row["program_id"] == "PR-0001"             # authored on the form
    assert row["enrollment_date"] == "2026-09-01"
    assert row["status"] == "Active"                  # set_entity_field at confirm

    subject_refs = json.loads(confirmed["subject_refs"])
    assert subject_refs["enrollment_id"] == row["entity_id"]


def test_submit_409_when_signup_form_never_completed(fake_dc):
    _seed_template(fake_dc)
    _seed_tenant_capacity(fake_dc, 10)
    instance_row = _create_instance(fake_dc)

    ctx = machine.build_eval_context(TENANT, instance_row, actor="family:tok1")
    with pytest.raises(HTTPException) as exc:
        machine.execute_action(ctx, "submit", {})
    assert exc.value.status_code == 409
    assert fake_dc.get_entity(TENANT, "workflow_instance", instance_row["entity_id"])["state"] == "draft"


def test_a_second_signup_reuses_the_existing_family_and_student(fake_dc):
    """`match_or_create` on BOTH the family and the student section: signing
    the same child up for a second program must add one enrollment row and
    zero duplicate people. Enrollment's student section is `create` mode
    (every application is a new child); signup's is not, and that difference
    is what this pins."""
    _seed_template(fake_dc)
    _seed_tenant_capacity(fake_dc, 10)
    _fill_and_submit(fake_dc, _create_instance(fake_dc))
    _fill_and_submit(fake_dc, _create_instance(fake_dc, program_id="PR-0002"),
                     program_id="PR-0002")

    assert len(fake_dc.find("family", family_name="Ng Family")) == 1
    assert len(fake_dc.find("student", first_name="Alex", last_name="Ng")) == 1
    assert len(fake_dc.find("enrollment")) == 2
    assert {e["program_id"] for e in fake_dc.find("enrollment")} == {"PR-0001", "PR-0002"}


def test_student_section_requires_the_dob_it_matches_on():
    """`primitives._match_student_by_name_dob` keys on
    (first_name, last_name, dob) and needs all three. A section that left
    `dob` optional would silently create a duplicate student whenever a
    family skipped it (signup.py module docstring, decision E)."""
    form = next(s for s in signup.build_steps() if s["step_id"] == "signup_form")
    student = next(s for s in form["config"]["sections"] if s["section_id"] == "student_section")
    assert student["mode"] == "match_or_create"
    by_name = {f["name"]: f["required"] for f in student["fields"]}
    assert by_name["first_name"] and by_name["last_name"] and by_name["dob"]


# --- waitlist branch ---------------------------------------------------------


def test_submit_at_capacity_goes_to_waitlisted_and_commits_nothing(fake_dc):
    _seed_template(fake_dc)
    waitlisted = _to_waitlisted(fake_dc)
    assert json.loads(waitlisted["subject_refs"]) == {}
    assert fake_dc.find("enrollment") == []


def test_staff_offers_a_spot_then_family_accepts(fake_dc):
    _seed_template(fake_dc)
    offered = _to_offered(fake_dc)

    family_ctx = machine.build_eval_context(TENANT, offered, actor="family:tok1")
    confirmed = machine.execute_action(family_ctx, "accept_offer", {})
    assert confirmed["state"] == "confirmed"
    assert len(fake_dc.find("enrollment")) == 1


def test_family_declining_an_offer_returns_to_the_waitlist(fake_dc):
    """The backward move: `offered --decline_offer--> waitlisted`. The family
    keeps its place rather than leaving the workflow."""
    _seed_template(fake_dc)
    offered = _to_offered(fake_dc)

    family_ctx = machine.build_eval_context(TENANT, offered, actor="family:tok1")
    back = machine.execute_action(family_ctx, "decline_offer", {})
    assert back["state"] == "waitlisted"
    assert not back.get("closed_at")


def test_staff_rescinding_an_offer_returns_to_the_waitlist(fake_dc):
    """Same (from, to) pair as decline_offer, different action and actor —
    two transitions that an exit-grouping rule keyed only on `to` would
    wrongly merge."""
    _seed_template(fake_dc)
    offered = _to_offered(fake_dc)

    staff_ctx = machine.build_eval_context(TENANT, offered, actor="staff-1")
    back = machine.execute_action(staff_ctx, "rescind_offer", {})
    assert back["state"] == "waitlisted"


def test_family_cannot_offer_a_spot(fake_dc):
    _seed_template(fake_dc)
    waitlisted = _to_waitlisted(fake_dc)
    family_ctx = machine.build_eval_context(TENANT, waitlisted, actor="family:tok1")
    with pytest.raises(HTTPException) as exc:
        machine.execute_action(family_ctx, "offer_spot", {})
    assert exc.value.status_code == 403


def test_family_cannot_rescind_an_offer(fake_dc):
    _seed_template(fake_dc)
    offered = _to_offered(fake_dc)
    family_ctx = machine.build_eval_context(TENANT, offered, actor="family:tok1")
    with pytest.raises(HTTPException) as exc:
        machine.execute_action(family_ctx, "rescind_offer", {})
    assert exc.value.status_code == 403


# --- confirmed is a RESTING stage, not the finish ---------------------------


def test_confirmed_still_accepts_moves_and_is_not_closed(fake_dc):
    """The finding that motivates this template: a signup rests in
    `confirmed` for the length of the program and still accepts `drop` and
    `complete_program`. `confirmed` therefore cannot be `kind: terminal`,
    even though it is where the spine's forward progress ends."""
    _seed_template(fake_dc)
    _seed_tenant_capacity(fake_dc, 10)
    confirmed = _fill_and_submit(fake_dc, _create_instance(fake_dc))

    assert confirmed["state"] == "confirmed"
    assert not confirmed.get("closed_at")

    ctx = machine.build_eval_context(TENANT, confirmed, actor="staff-1")
    assert set(machine.allowed_actions(ctx)) >= {"drop", "complete_program"}


def test_complete_program_closes_the_signup(fake_dc):
    _seed_template(fake_dc)
    _seed_tenant_capacity(fake_dc, 10)
    confirmed = _fill_and_submit(fake_dc, _create_instance(fake_dc))

    staff_ctx = machine.build_eval_context(TENANT, confirmed, actor="staff-1")
    completed = machine.execute_action(staff_ctx, "complete_program", {})
    assert completed["state"] == "completed"
    assert completed["closed_at"]
    assert fake_dc.find("enrollment")[0]["status"] == "Completed"


# --- the drop exit ------------------------------------------------------------


def test_family_drop_from_draft(fake_dc):
    _seed_template(fake_dc)
    _seed_tenant_capacity(fake_dc, 10)
    instance_row = _create_instance(fake_dc)

    family_ctx = machine.build_eval_context(TENANT, instance_row, actor="family:tok1")
    dropped = machine.execute_action(family_ctx, "drop", {})
    assert dropped["state"] == "dropped"
    assert dropped["closed_at"]


def test_staff_drop_from_waitlisted(fake_dc):
    _seed_template(fake_dc)
    waitlisted = _to_waitlisted(fake_dc)
    staff_ctx = machine.build_eval_context(TENANT, waitlisted, actor="staff-1")
    assert machine.execute_action(staff_ctx, "drop", {})["state"] == "dropped"


def test_family_drop_from_offered(fake_dc):
    _seed_template(fake_dc)
    offered = _to_offered(fake_dc)
    family_ctx = machine.build_eval_context(TENANT, offered, actor="family:tok1")
    assert machine.execute_action(family_ctx, "drop", {})["state"] == "dropped"


def test_drop_from_confirmed_marks_the_enrollment_withdrawn(fake_dc):
    """The drop exit is NOT one uniform rule: dropping from `confirmed` must
    also mark the committed enrollment row, while dropping from `draft`,
    `waitlisted`, or `offered` must not (there is no committed row yet, and
    `set_entity_field` 409s when the ref cannot be resolved)."""
    _seed_template(fake_dc)
    _seed_tenant_capacity(fake_dc, 10)
    confirmed = _fill_and_submit(fake_dc, _create_instance(fake_dc))

    family_ctx = machine.build_eval_context(TENANT, confirmed, actor="family:tok1")
    dropped = machine.execute_action(family_ctx, "drop", {})
    assert dropped["state"] == "dropped"
    assert fake_dc.find("enrollment")[0]["status"] == "Withdrawn"


def test_drop_from_draft_does_not_touch_any_enrollment_row(fake_dc):
    _seed_template(fake_dc)
    _seed_tenant_capacity(fake_dc, 10)
    instance_row = _create_instance(fake_dc)

    family_ctx = machine.build_eval_context(TENANT, instance_row, actor="family:tok1")
    machine.execute_action(family_ctx, "drop", {})
    assert fake_dc.find("enrollment") == []


def test_drop_is_available_from_every_pre_completion_stage():
    """The Exits panel's scope rule, asserted against the machine itself:
    `drop` reaches every non-terminal stage, for both actors."""
    machine_def = MachineDef.model_validate(signup.build_machine())
    non_terminal = {s.state_id for s in machine_def.states if s.kind != "terminal"}
    by_actor = {"family": set(), "staff": set()}
    for t in machine_def.transitions:
        if t.action == "drop":
            by_actor[t.actor].add(t.from_)
    assert by_actor["family"] == non_terminal
    assert by_actor["staff"] == non_terminal


# --- shape assertions the coverage ruling cites ------------------------------


def test_exactly_one_initial_and_two_terminal_stages():
    machine_def = MachineDef.model_validate(signup.build_machine())
    kinds: dict[str, list[str]] = {}
    for s in machine_def.states:
        kinds.setdefault(s.kind, []).append(s.state_id)
    assert kinds["initial"] == ["draft"]
    assert sorted(kinds["terminal"]) == ["completed", "dropped"]


def test_two_distinct_actions_share_the_offered_to_waitlisted_edge():
    """Pinned because exit inference that groups on (from, to) alone would
    collapse these two into one card and lose an actor and an effect."""
    machine_def = MachineDef.model_validate(signup.build_machine())
    edge = [t for t in machine_def.transitions if t.from_ == "offered" and t.to == "waitlisted"]
    assert {t.action for t in edge} == {"decline_offer", "rescind_offer"}
    assert {t.actor for t in edge} == {"family", "staff"}


def test_the_drop_exit_is_not_uniform_across_its_scope():
    """The single most important finding for the Exits panel: transitions
    sharing (action, target) do NOT all share the same effects, so an exit
    card keyed on (action, target) alone cannot round-trip this machine."""
    machine_def = MachineDef.model_validate(signup.build_machine())
    drops = [t for t in machine_def.transitions if t.action == "drop" and t.to == "dropped"]
    effect_shapes = {
        tuple(sorted((e.primitive, json.dumps(e.params, sort_keys=True)) for e in t.effects))
        for t in drops
    }
    assert len(effect_shapes) == 2, "expected two distinct effect shapes under one (action, target)"


def test_signup_declares_no_documents_step():
    """A template with no document tier at all — the second shape enrollment
    could not demonstrate."""
    assert [s for s in signup.build_steps() if s["type"] == "documents"] == []


def test_every_section_has_a_title_and_description():
    form = next(s for s in signup.build_steps() if s["step_id"] == "signup_form")
    sections = form["config"]["sections"]
    assert len(sections) == 3
    for section in sections:
        assert section["title"].strip(), f"{section['section_id']} has no title"
        assert section["description"].strip(), f"{section['section_id']} has no description"
