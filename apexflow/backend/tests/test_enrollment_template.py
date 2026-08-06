# apexflow/backend/tests/test_enrollment_template.py
"""Table-driven lifecycle acceptance suite for the enrollment template
(Task 9) — app.templates.enrollment's machine/steps exercised end to end
against the generic engine (Tasks 1-8), proving nothing about the template
is engine-special.

Covers, per task-9-brief.md Step 1: the template's own `validate_definition`
zero-errors check; the happy path draft->submit->in_review->approve->
post-approval items->enrolled (via system auto-advance); the waitlist branch
at the exact capacity boundary; reject->pending_items->resubmit->in_review;
waive; cancel; the family-actor permission matrix (including family cannot
approve/verify/reject/promote); and commit_sections' linked-entity fan-out
(student/family/contact/registration_application, entity-id links stamped,
repeat contacts fan-out).

Models are read directly from launchpad/backend/app/data/base_model.json
(not hand-copied) — the accumulated-decisions note for this task: "Read
base_model.json to bind field picks exactly — required-field coverage
validation will fail your template otherwise."
"""
import json
from pathlib import Path

import pytest
from fastapi import HTTPException

from app.templates import enrollment
from app.workflows import engine, machine
from app.workflows.schema import MachineDef, StepDef
from app.workflows.validate import validate_definition
from tests.fakes import FakeDataCore

TENANT = "acme"

BASE_MODEL_PATH = (
    Path(__file__).resolve().parents[3] / "launchpad" / "backend" / "app" / "data" / "base_model.json"
)
_TEMPLATE_ENTITY_TYPES = ("student", "family", "contact", "registration_application")


def _load_base_models() -> dict:
    all_models = json.loads(BASE_MODEL_PATH.read_text())
    return {et: all_models[et] for et in _TEMPLATE_ENTITY_TYPES}


# --- fixture helpers ---------------------------------------------------------


def _seed_models(fake_dc: FakeDataCore) -> None:
    for entity_type, definition in _load_base_models().items():
        fake_dc.set_model(TENANT, entity_type, definition)


def _seed_tenant_capacity(fake_dc: FakeDataCore, capacity: int) -> None:
    fake_dc.rows.append(FakeDataCore._store_row(TENANT, "tenant", TENANT, {"capacity": capacity}))


def _seed_template(fake_dc: FakeDataCore) -> dict:
    _seed_models(fake_dc)
    return enrollment.seed_enrollment_template(TENANT)


def _seed_capacity_instance(fake_dc: FakeDataCore, state: str, school_year: str = "2026-2027") -> None:
    """A bare workflow_instance row for the capacity_available guard to
    count against — not created via engine.create_instance (no items/machine
    needed), matching test_primitives.py's `_seed_instance` pattern."""
    fake_dc.dc_create(TENANT, "workflow_instance", {
        "definition_id": enrollment.DEFINITION_ID,
        "definition_version": 1,
        "state": state,
        "context": json.dumps({"school_year": school_year}),
        "subject_refs": "{}",
        "channel_started": "staff",
        "token_version": 1,
        "draft_data": "{}",
        "opened_at": "2026-01-01T00:00:00+00:00",
    })


def _create_instance(fake_dc: FakeDataCore, *, school_year: str = "2026-2027",
                     channel: str = "family", applicant_email: str | None = None) -> dict:
    result = engine.create_instance(
        TENANT, enrollment.DEFINITION_ID, {"school_year": school_year}, channel,
        applicant_email=applicant_email,
    )
    instance_eid = result["instance"]["entity_id"]
    return fake_dc.get_entity(TENANT, "workflow_instance", instance_eid)


def _item_by_step(fake_dc: FakeDataCore, instance_row: dict, step_id: str) -> dict:
    items = fake_dc.find("workflow_item", instance_id=instance_row["entity_id"])
    return next(i for i in items if i["step_id"] == step_id)


def _set_payload_ref(fake_dc: FakeDataCore, item_eid: str, ref: str = "doc-1") -> None:
    item = fake_dc.get_entity(TENANT, "workflow_item", item_eid)
    base = engine._item_base_data(item)
    base["payload_ref"] = ref
    fake_dc.dc_update(TENANT, "workflow_item", item_eid, base)


def _draft_answers(*, family_name: str = "Ng Family", contacts: list[dict] | None = None) -> dict:
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
        "contacts_section": contacts if contacts is not None else [
            {"first_name": "Pat", "last_name": "Ng", "relationship": "Parent",
             "phone": "555-1000", "is_emergency": True},
        ],
        "application_section": {
            "school_year": "2026-2027",
            "handbook_acknowledged": True,
            "liability_waiver_signed": True,
            "tuition_agreement_signed": True,
            "signature_name": "Pat Ng",
            "signature_date": "2026-06-01",
        },
    }


def _fill_and_submit(fake_dc, instance_row, *, contacts=None) -> dict:
    """family: save_draft + complete_item(application_form) + submit ->
    lands in_review (below capacity) or waitlisted (over capacity)."""
    ctx = machine.build_eval_context(TENANT, instance_row, actor="family:tok1")
    machine.execute_action(ctx, "save_draft", {"section_answers": _draft_answers(contacts=contacts)})
    form_item = _item_by_step(fake_dc, instance_row, "application_form")
    machine.execute_action(ctx, "complete_item", {"item_id": form_item["entity_id"]})
    return machine.execute_action(ctx, "submit", {})


def _to_in_review(fake_dc, *, capacity: int = 10, contacts=None) -> tuple[dict, str]:
    """Full family-side setup, ending in_review. Returns (instance_row,
    application_form_item_entity_id)."""
    _seed_tenant_capacity(fake_dc, capacity)
    instance_row = _create_instance(fake_dc)
    form_item_eid = _item_by_step(fake_dc, instance_row, "application_form")["entity_id"]
    updated = _fill_and_submit(fake_dc, instance_row, contacts=contacts)
    assert updated["state"] == "in_review"
    return updated, form_item_eid


def _to_approved(fake_dc, *, capacity: int = 10, contacts=None) -> tuple[dict, dict]:
    """Full flow through approve. Returns (approved_instance_row, staff_ctx)."""
    in_review_row, _ = _to_in_review(fake_dc, capacity=capacity, contacts=contacts)
    staff_ctx = machine.build_eval_context(TENANT, in_review_row, actor="staff-1")
    approved = machine.execute_action(staff_ctx, "approve", {})
    assert approved["state"] == "approved"
    return approved, staff_ctx


# --- publish-time validation: the template's own dedicated test ------------


def test_enrollment_template_validates_with_zero_errors():
    machine_def = MachineDef.model_validate(enrollment.build_machine())
    steps = [StepDef.model_validate(s) for s in enrollment.build_steps()]
    errors = validate_definition(machine_def, steps, _load_base_models())
    assert errors == []


def test_seed_enrollment_template_publishes_via_the_real_gate(fake_dc):
    published = _seed_template(fake_dc)
    base = published["base_data"]  # dc_update envelope, not a flattened row
    assert base["status"] == "published"
    assert base["definition_id"] == enrollment.DEFINITION_ID
    assert base["channel_access"] == "family"


# --- happy path: draft -> submit -> in_review -> approve -> enrolled -------


def test_happy_path_draft_to_enrolled_via_auto_advance(fake_dc):
    _seed_template(fake_dc)
    approved, staff_ctx = _to_approved(fake_dc)

    # commit_sections + link injection already exercised — see the dedicated
    # commit/fan-out test below for those assertions in isolation.
    docs_item = _item_by_step(fake_dc, approved, "documents")
    assert docs_item["due_at"]  # start_due_clocks ran at approve

    _set_payload_ref(fake_dc, docs_item["entity_id"])
    machine.execute_action(staff_ctx, "complete_item", {"item_id": docs_item["entity_id"]})
    docs_item = _item_by_step(fake_dc, approved, "documents")
    assert docs_item["status"] == "submitted"  # documents review default: staff

    enrolled = machine.execute_action(staff_ctx, "verify_item", {"item_id": docs_item["entity_id"]})
    assert enrolled["state"] == "enrolled"  # system auto-advance: approved -> enrolled


# --- waitlist branch: exact capacity boundary -------------------------------


def test_submit_below_capacity_reaches_in_review(fake_dc):
    _seed_template(fake_dc)
    _seed_tenant_capacity(fake_dc, 2)
    _seed_capacity_instance(fake_dc, "approved")  # 1 of 2 used

    instance_row = _create_instance(fake_dc)
    updated = _fill_and_submit(fake_dc, instance_row)
    assert updated["state"] == "in_review"


def test_submit_at_exact_capacity_boundary_goes_to_waitlisted(fake_dc):
    _seed_template(fake_dc)
    _seed_tenant_capacity(fake_dc, 2)
    _seed_capacity_instance(fake_dc, "approved")
    _seed_capacity_instance(fake_dc, "enrolled")  # 2 of 2 used -- AT capacity

    instance_row = _create_instance(fake_dc)
    updated = _fill_and_submit(fake_dc, instance_row)
    assert updated["state"] == "waitlisted"


# --- submit gates on application_form completion (coordinator review fix) --
# Both submit branches (capacity-available -> submitted, capacity-full ->
# waitlisted) carry an items_in_status guard on the application_form item —
# neither should fire while that item is still "not_started".


def test_submit_409_when_application_form_never_completed_capacity_available(fake_dc):
    _seed_template(fake_dc)
    _seed_tenant_capacity(fake_dc, 10)  # plenty of room -- would take the "submitted" branch
    instance_row = _create_instance(fake_dc)

    ctx = machine.build_eval_context(TENANT, instance_row, actor="family:tok1")
    with pytest.raises(HTTPException) as exc:
        machine.execute_action(ctx, "submit", {})  # application_form item still not_started
    assert exc.value.status_code == 409
    assert fake_dc.get_entity(TENANT, "workflow_instance", instance_row["entity_id"])["state"] == "draft"


def test_submit_409_when_application_form_never_completed_capacity_full(fake_dc):
    _seed_template(fake_dc)
    _seed_tenant_capacity(fake_dc, 1)
    _seed_capacity_instance(fake_dc, "enrolled")  # AT capacity -- would take the "waitlisted" branch
    instance_row = _create_instance(fake_dc)

    ctx = machine.build_eval_context(TENANT, instance_row, actor="family:tok1")
    with pytest.raises(HTTPException) as exc:
        machine.execute_action(ctx, "submit", {})  # application_form item still not_started
    assert exc.value.status_code == 409
    assert fake_dc.get_entity(TENANT, "workflow_instance", instance_row["entity_id"])["state"] == "draft"


def test_promote_waitlist_moves_to_in_review(fake_dc):
    _seed_template(fake_dc)
    _seed_tenant_capacity(fake_dc, 1)
    _seed_capacity_instance(fake_dc, "enrolled")

    instance_row = _create_instance(fake_dc)
    updated = _fill_and_submit(fake_dc, instance_row)
    assert updated["state"] == "waitlisted"

    staff_ctx = machine.build_eval_context(TENANT, updated, actor="staff-1")
    promoted = machine.execute_action(staff_ctx, "promote_waitlist", {})
    assert promoted["state"] == "in_review"


# --- reject -> pending_items -> resubmit -> in_review -----------------------


def test_reject_item_flips_to_pending_items_then_resubmit_returns_to_review(fake_dc):
    _seed_template(fake_dc)
    in_review_row, form_item_eid = _to_in_review(fake_dc)

    staff_ctx = machine.build_eval_context(TENANT, in_review_row, actor="staff-1")
    rejected = machine.execute_action(staff_ctx, "reject_item", {"item_id": form_item_eid})
    assert rejected["state"] == "pending_items"

    family_ctx = machine.build_eval_context(TENANT, rejected, actor="family:tok1")
    # Resubmit: family resaves + re-completes the previously-rejected item,
    # then explicitly fires "resubmit" (family action, not system auto-advance
    # -- see app.templates.enrollment's module docstring, decision 5).
    machine.execute_action(family_ctx, "save_draft", {"section_answers": _draft_answers()})
    machine.execute_action(family_ctx, "complete_item", {"item_id": form_item_eid})
    resumed = machine.execute_action(family_ctx, "resubmit", {})
    assert resumed["state"] == "in_review"


def test_resubmit_family_action_requires_item_completed_first(fake_dc):
    _seed_template(fake_dc)
    in_review_row, form_item_eid = _to_in_review(fake_dc)
    staff_ctx = machine.build_eval_context(TENANT, in_review_row, actor="staff-1")
    rejected = machine.execute_action(staff_ctx, "reject_item", {"item_id": form_item_eid})
    assert rejected["state"] == "pending_items"

    family_ctx = machine.build_eval_context(TENANT, rejected, actor="family:tok1")
    with pytest.raises(HTTPException) as exc:
        machine.execute_action(family_ctx, "resubmit", {})  # item still "rejected" -- guard fails
    assert exc.value.status_code == 409
    assert fake_dc.get_entity(TENANT, "workflow_instance", rejected["entity_id"])["state"] == "pending_items"


def test_request_changes_alone_does_not_auto_bounce_back_to_in_review(fake_dc):
    """The bug this template's design avoids: request_changes with no item
    actually rejected must NOT immediately snap back to in_review (see
    app.templates.enrollment's module docstring, decision 5)."""
    _seed_template(fake_dc)
    in_review_row, _ = _to_in_review(fake_dc)
    staff_ctx = machine.build_eval_context(TENANT, in_review_row, actor="staff-1")
    updated = machine.execute_action(staff_ctx, "request_changes", {})
    assert updated["state"] == "pending_items"


def test_decline_from_pending_items(fake_dc):
    _seed_template(fake_dc)
    in_review_row, form_item_eid = _to_in_review(fake_dc)
    staff_ctx = machine.build_eval_context(TENANT, in_review_row, actor="staff-1")
    rejected = machine.execute_action(staff_ctx, "reject_item", {"item_id": form_item_eid})
    assert rejected["state"] == "pending_items"

    declined = machine.execute_action(staff_ctx, "decline", {})
    assert declined["state"] == "declined"
    assert declined["closed_at"]


def test_request_changes_staff_action_from_in_review(fake_dc):
    _seed_template(fake_dc)
    in_review_row, _ = _to_in_review(fake_dc)
    staff_ctx = machine.build_eval_context(TENANT, in_review_row, actor="staff-1")
    updated = machine.execute_action(staff_ctx, "request_changes", {})
    assert updated["state"] == "pending_items"


# --- waive -------------------------------------------------------------------


def test_waive_post_approval_item_lets_enrollment_proceed(fake_dc):
    _seed_template(fake_dc)
    approved, staff_ctx = _to_approved(fake_dc)
    docs_item = _item_by_step(fake_dc, approved, "documents")

    waived = machine.execute_action(staff_ctx, "waive_item", {"item_id": docs_item["entity_id"]})
    assert waived["state"] == "enrolled"


def test_family_cannot_waive_item(fake_dc):
    _seed_template(fake_dc)
    approved, _ = _to_approved(fake_dc)
    docs_item = _item_by_step(fake_dc, approved, "documents")

    family_ctx = machine.build_eval_context(TENANT, approved, actor="family:tok1")
    with pytest.raises(HTTPException) as exc:
        machine.execute_action(family_ctx, "waive_item", {"item_id": docs_item["entity_id"]})
    assert exc.value.status_code == 403


# --- cancel --------------------------------------------------------------------


def test_cancel_instance_from_in_review(fake_dc):
    _seed_template(fake_dc)
    in_review_row, _ = _to_in_review(fake_dc)
    staff_ctx = machine.build_eval_context(TENANT, in_review_row, actor="staff-1")

    cancelled = machine.execute_action(staff_ctx, "cancel_instance", {})
    assert cancelled["state"] == "cancelled"
    assert cancelled["closed_at"]


def test_cancel_instance_family_actor_403(fake_dc):
    _seed_template(fake_dc)
    in_review_row, _ = _to_in_review(fake_dc)
    family_ctx = machine.build_eval_context(TENANT, in_review_row, actor="family:tok1")

    with pytest.raises(HTTPException) as exc:
        machine.execute_action(family_ctx, "cancel_instance", {})
    assert exc.value.status_code == 403


# --- withdraw ------------------------------------------------------------------


def test_family_withdraw_from_draft(fake_dc):
    _seed_template(fake_dc)
    _seed_tenant_capacity(fake_dc, 10)
    instance_row = _create_instance(fake_dc)

    family_ctx = machine.build_eval_context(TENANT, instance_row, actor="family:tok1")
    updated = machine.execute_action(family_ctx, "withdraw", {})
    assert updated["state"] == "withdrawn"


def test_staff_withdraw_from_in_review(fake_dc):
    _seed_template(fake_dc)
    in_review_row, _ = _to_in_review(fake_dc)
    staff_ctx = machine.build_eval_context(TENANT, in_review_row, actor="staff-1")

    updated = machine.execute_action(staff_ctx, "withdraw", {})
    assert updated["state"] == "withdrawn"


def test_staff_withdraw_from_approved(fake_dc):
    """Coordinator review fix: withdraw must be available from `approved`
    too — spec §5 (2026-08-03 design): "Withdrawn (parent or admin, any
    pre-enrolled state)"; `approved` is not yet `enrolled`."""
    _seed_template(fake_dc)
    approved, staff_ctx = _to_approved(fake_dc)

    updated = machine.execute_action(staff_ctx, "withdraw", {})
    assert updated["state"] == "withdrawn"


def test_family_withdraw_from_approved(fake_dc):
    _seed_template(fake_dc)
    approved, _ = _to_approved(fake_dc, contacts=[
        {"first_name": "Robin", "last_name": "Lee", "relationship": "Parent"},
    ])

    family_ctx = machine.build_eval_context(TENANT, approved, actor="family:tok1")
    updated = machine.execute_action(family_ctx, "withdraw", {})
    assert updated["state"] == "withdrawn"


# --- family-actor permission matrix ------------------------------------------


def test_family_cannot_approve(fake_dc):
    _seed_template(fake_dc)
    in_review_row, _ = _to_in_review(fake_dc)
    family_ctx = machine.build_eval_context(TENANT, in_review_row, actor="family:tok1")
    with pytest.raises(HTTPException) as exc:
        machine.execute_action(family_ctx, "approve", {})
    assert exc.value.status_code == 403


def test_family_cannot_decline(fake_dc):
    _seed_template(fake_dc)
    in_review_row, _ = _to_in_review(fake_dc)
    family_ctx = machine.build_eval_context(TENANT, in_review_row, actor="family:tok1")
    with pytest.raises(HTTPException) as exc:
        machine.execute_action(family_ctx, "decline", {})
    assert exc.value.status_code == 403


def test_family_cannot_request_changes(fake_dc):
    _seed_template(fake_dc)
    in_review_row, _ = _to_in_review(fake_dc)
    family_ctx = machine.build_eval_context(TENANT, in_review_row, actor="family:tok1")
    with pytest.raises(HTTPException) as exc:
        machine.execute_action(family_ctx, "request_changes", {})
    assert exc.value.status_code == 403


def test_family_cannot_verify_item(fake_dc):
    _seed_template(fake_dc)
    in_review_row, form_item_eid = _to_in_review(fake_dc)
    family_ctx = machine.build_eval_context(TENANT, in_review_row, actor="family:tok1")
    with pytest.raises(HTTPException) as exc:
        machine.execute_action(family_ctx, "verify_item", {"item_id": form_item_eid})
    assert exc.value.status_code == 403


def test_family_cannot_reject_item(fake_dc):
    _seed_template(fake_dc)
    in_review_row, form_item_eid = _to_in_review(fake_dc)
    family_ctx = machine.build_eval_context(TENANT, in_review_row, actor="family:tok1")
    with pytest.raises(HTTPException) as exc:
        machine.execute_action(family_ctx, "reject_item", {"item_id": form_item_eid})
    assert exc.value.status_code == 403


def test_family_cannot_promote_waitlist(fake_dc):
    _seed_template(fake_dc)
    _seed_tenant_capacity(fake_dc, 1)
    _seed_capacity_instance(fake_dc, "enrolled")
    instance_row = _create_instance(fake_dc)
    updated = _fill_and_submit(fake_dc, instance_row)
    assert updated["state"] == "waitlisted"

    family_ctx = machine.build_eval_context(TENANT, updated, actor="family:tok1")
    with pytest.raises(HTTPException) as exc:
        machine.execute_action(family_ctx, "promote_waitlist", {})
    assert exc.value.status_code == 403


def test_family_can_submit_and_complete_item(fake_dc):
    """The affirmative half of the matrix: family-permitted actions succeed."""
    _seed_template(fake_dc)
    _seed_tenant_capacity(fake_dc, 10)
    instance_row = _create_instance(fake_dc)
    updated = _fill_and_submit(fake_dc, instance_row)
    assert updated["state"] == "in_review"


def test_staff_can_fire_family_only_submit_on_behalf(fake_dc):
    _seed_template(fake_dc)
    _seed_tenant_capacity(fake_dc, 10)
    instance_row = _create_instance(fake_dc)

    staff_ctx = machine.build_eval_context(TENANT, instance_row, actor="staff-1")
    machine.execute_action(staff_ctx, "save_draft", {"section_answers": _draft_answers()})
    form_item = _item_by_step(fake_dc, instance_row, "application_form")
    machine.execute_action(staff_ctx, "complete_item", {"item_id": form_item["entity_id"]})
    updated = machine.execute_action(staff_ctx, "submit", {})
    assert updated["state"] == "in_review"


# --- commit_sections: linked entities + repeat contacts fan-out ------------


def test_commit_produces_linked_entities_with_stamped_ids(fake_dc):
    _seed_template(fake_dc)
    approved, _ = _to_approved(fake_dc)

    families = fake_dc.find("family", family_name="Ng Family")
    assert len(families) == 1
    family = families[0]

    students = fake_dc.find("student", first_name="Alex", last_name="Ng")
    assert len(students) == 1
    student = students[0]
    assert student["family_id"] == family["entity_id"]
    assert student["status"] == "Enrolled"

    contacts = fake_dc.find("contact", first_name="Pat")
    assert len(contacts) == 1
    assert contacts[0]["family_id"] == family["entity_id"]

    applications = fake_dc.find("registration_application")
    assert len(applications) == 1
    application = applications[0]
    assert application["student_id"] == student["entity_id"]
    assert application["family_id"] == family["entity_id"]
    assert application["signature_name"] == "Pat Ng"

    subject_refs = json.loads(approved["subject_refs"])
    assert subject_refs["family_id"] == family["entity_id"]
    assert subject_refs["student_id"] == student["entity_id"]
    assert subject_refs["registration_application_id"] == application["entity_id"]
    assert subject_refs["contact_id"] == [contacts[0]["entity_id"]]


def test_commit_repeat_contacts_fan_out_to_multiple_entities(fake_dc):
    _seed_template(fake_dc)
    two_contacts = [
        {"first_name": "Pat", "last_name": "Ng", "relationship": "Parent", "is_emergency": True},
        {"first_name": "Sam", "last_name": "Ng", "relationship": "Grandparent",
         "is_authorized_pickup": True},
    ]
    approved, _ = _to_approved(fake_dc, contacts=two_contacts)

    family = fake_dc.find("family", family_name="Ng Family")[0]
    contacts = fake_dc.find("contact")
    assert len(contacts) == 2
    names = {(c["first_name"], c["last_name"]) for c in contacts}
    assert names == {("Pat", "Ng"), ("Sam", "Ng")}
    for c in contacts:
        assert c["family_id"] == family["entity_id"]

    subject_refs = json.loads(approved["subject_refs"])
    assert set(subject_refs["contact_id"]) == {c["entity_id"] for c in contacts}
