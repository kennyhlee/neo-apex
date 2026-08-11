# apexflow/backend/app/templates/enrollment.py
"""The enrollment template (Task 9) — seed data for the platform's first
`workflow_definition`, proving the whole engine end to end. Nothing about
this module is engine-special: it is plain data (a `machine` dict + a
`steps` list, exactly the shapes `app.workflows.schema.MachineDef`/`StepDef`
already validate) plus one helper, `seed_enrollment_template`, that writes a
draft `workflow_definition` row and publishes it through the SAME
`publish_definition` service function the definitions API uses — so "the
template passes validate_definition with zero errors" is a structural
property of how it gets seeded, not a claim this module makes about itself.

Spec: docs/superpowers/specs/2026-08-05-apexflow-workflow-platform-design.md
§7 "The enrollment template" (machine states/branching, steps, context) and
§8 "Default model enrichment" (the student/family/contact/registration_
application field set this template's sections draw from — already reflected
in launchpad/backend/app/data/base_model.json's committed fields, read
directly rather than hand-copied here to avoid drift). Original transition
intent: docs/superpowers/specs/2026-08-03-student-registration-flow-design.md
§5 (status lifecycle diagram) and enrollx/backend/app/registration/statuses.py
(ALLOWED_TRANSITIONS — pre-engine precedent for which states each staff
action fires from).

DESIGN DECISIONS this module makes (full rationale in task-9-report.md):

1. **`submitted` is a real, declared, but structurally transient state.**
   The 2026-08-03 diagram's `Submitted ──► In Review` arrow is unlabeled
   (every other arrow names its action) — read here as an unconditional
   `actor: system` transition (`t_route_to_review`). Since
   `machine.execute_action` runs `run_system_transitions` once at the end of
   EVERY call (including the `submit` action itself), a family's `submit`
   call lands the instance in `in_review` within that same call — `submitted`
   is never the RESTING state of a real instance, only a structural waypoint
   satisfying the spec's exact state list and the original diagram's shape.
2. **Waitlist branch: NO guard negation exists** (Task 8's `machine.py`
   docstring, decision 8). Encoded as the accumulated-decisions text
   requires: `submit → submitted` GUARDED by `capacity_available` declared
   FIRST, then `submit → waitlisted` declared LAST — the guarded branch wins
   when there's room (`capacity_available` is true = room available), the
   fallback is what a full school hits. BOTH branches additionally carry
   `_application_form_complete_guard()` (coordinator review fix — both
   source specs require "all blocking items done" at submit; see decision 6,
   below, for why this is a per-branch guard rather than a shared
   precondition and why it doesn't sweep in the post-approval `documents`
   item). This makes the `(from="draft", action="submit")` group have ZERO
   unguarded transitions — legal per `validate.py`'s
   `_unguarded_branch_errors` ("at most one," not "exactly one"); ordering
   still matters, since `capacity_available` is what continues to pick
   the submitted-vs-waitlisted branch between two form-complete candidates.
3. **Two `withdraw` transitions per state (family + staff), each carrying an
   `actor_role` guard.** `TransitionDef.actor` is single-valued, so "family
   or staff may withdraw" needs two rows. Both would otherwise be
   `guards: []` (structurally "unguarded") sharing the SAME `(from, action)`
   pair — `validate.py`'s `_unguarded_branch_errors` allows AT MOST ONE
   unguarded transition per `(from, action)` group (it does not consider
   `actor`), so two truly-unguarded withdraw rows from the same state fail
   publish. Giving each an `actor_role` guard (`{"roles": ["family"]}` /
   `{"roles": ["staff", "admin"]}`) is not just a validation workaround: it
   also makes `_run_transition_action`'s "staff may fire family transitions
   too" dispatch resolve correctly regardless of declaration order — a staff
   actor's guard-pass search skips the family-only row (its `actor_role`
   guard fails for a non-family actor) and lands on the staff row.
   Withdraw is offered from every pre-enrolled state (spec §5 of the
   2026-08-03 design: "Withdrawn (parent or admin, any pre-enrolled
   state)"): `draft, submitted, in_review, pending_items, approved,
   waitlisted` — `approved` included per coordinator review (a first pass
   narrowed this to "pre-approval only," which the source spec does not
   say; `approved` is not yet `enrolled`, so it is still pre-enrolled).
4. **`items_in_status`'s `quantifier`/status-list extension** (this task,
   `app.workflows.primitives`) is what makes two guards possible without a
   new primitive: `in_review → pending_items` needs "ANY item rejected"
   (`quantifier: "any"`); `approved → enrolled` needs "ALL post-approval
   items verified OR waived" (`status: ["verified", "waived"]`). Both guards
   are scoped to `step_ids` naming exactly one step each
   (`application_form`, `documents`) — deliberately NOT
   `all_blocking_items_complete`, which sweeps every currently-applicable
   blocking item across the WHOLE instance with no per-stage concept: the
   `documents` step's item is blocking (immunization records are genuinely
   required to enroll) but only becomes relevant POST-approval
   (`start_due_clocks` starts its due-date clock at `approve`) — a blanket
   blocking-item guard would incorrectly gate `pending_items → in_review` on
   a document nobody can have uploaded yet.
5. **`pending_items → in_review` is an explicit family `resubmit` ACTION**
   (`actor: "family"`, staff may also fire it on the family's behalf per the
   normal dispatch rule), guarded `items_in_status{step_ids:
   ["application_form"], status: ["submitted", "verified"], quantifier:
   "all"}` — NOT a `system` auto-advance, despite `in_review → pending_items`
   (the other direction) being exactly that. A first attempt made this
   symmetric (`actor: "system"`, same guard) and it is WRONG: the guard can
   only see an item's CURRENT status, not why the instance is in
   `pending_items` — staff's plain `request_changes` action (no item
   actually rejected) leaves the `application_form` item sitting at
   `"submitted"` the whole time, so a system transition with this guard
   fires the INSTANT `request_changes` lands the instance in `pending_items`,
   inside the very same `execute_action` call (`run_system_transitions`
   runs once at the end of every call) — `request_changes` would have zero
   observable effect. No effect primitive can flip a `workflow_item`'s
   status (the `EFFECTS` registry only reaches committed entities/the
   instance/context — items aren't addressable that way), so there is no
   way to mark "this pending_items landing came from an actual rejection"
   for a system guard to key off. Making the return an explicit
   family-fired action sidesteps the whole problem: `run_system_transitions`
   only ever auto-fires `actor: "system"` transitions, so `resubmit` never
   fires on its own — the family must explicitly resave/complete the form
   and then click "resubmit," regardless of whether they got to
   `pending_items` via `reject_item` or `request_changes`.
6. **`submit` DOES gate on `application_form` item completion**
   (`_application_form_complete_guard()`, coordinator review fix — both the
   2026-08-05 spec's engine semantics and the 2026-08-03 spec's status
   lifecycle require "all blocking items done" at submit; a first pass
   dropped this guard entirely, reasoning that `commit_sections`' own
   required-field 409 at `approve` was gate enough — that left a family free
   to `submit` an empty draft into `in_review`/`waitlisted` with nothing for
   staff to act on). Scoped to `step_ids: ["application_form"]` — same
   per-stage reasoning as decision 4's `items_in_status` guards
   (`all_blocking_items_complete` would sweep in the post-approval
   `documents` item, which cannot be done pre-approval) — checking
   `status: ["submitted", "verified"]` (the item is at least as far along as
   the family's own `complete_item` call takes it, since `application_form`'s
   `review: "staff"` override means first completion lands at `"submitted"`,
   never `"verified"`). Applied to BOTH `submit` branches (decision 2) so a
   family cannot dodge the check by landing on the waitlisted branch.
7. **`registration_application`'s own `school_year` field is a plain,
   optional form field** (model `required: false`), independent of the
   INSTANCE-level `context.school_year` the `capacity_available` guard
   scopes on (spec §7: "Context: school_year"). `set_entity_field`'s
   `value` param is a static, authoring-time literal (no context
   templating exists in the effect primitive), so there is no mechanism to
   copy `context.school_year` onto the committed application entity at
   publish time — out of scope for this template; the two are allowed to
   diverge or for the form-level one to be left blank.
8. **`channel_access: "family"`** — the enrollment template is the public,
   family-self-serve flow (spec §6: `familyhub.floatify.com/w/{tenant}/
   enrollment`); `DEFINITION_ID = "enrollment"` matches that URL segment
   literally.
"""
import json
from typing import Any

from app.workflows import datacore as dc
from app.workflows import definitions as defs

DEFINITION_ID = "enrollment"
DEFINITION_NAME = "Enrollment"

# --- state machine -----------------------------------------------------------


def _states() -> list[dict]:
    return [
        {"state_id": "draft", "name": "Draft", "kind": "initial"},
        {"state_id": "submitted", "name": "Submitted", "kind": "active"},
        {"state_id": "in_review", "name": "In Review", "kind": "active"},
        {"state_id": "pending_items", "name": "Pending Items", "kind": "active"},
        {"state_id": "approved", "name": "Approved", "kind": "active"},
        {"state_id": "enrolled", "name": "Enrolled", "kind": "terminal"},
        {"state_id": "waitlisted", "name": "Waitlisted", "kind": "active"},
        {"state_id": "declined", "name": "Declined", "kind": "terminal"},
        {"state_id": "withdrawn", "name": "Withdrawn", "kind": "terminal"},
    ]


def _withdraw_pair(from_state: str) -> list[dict]:
    """Two `withdraw` transitions from `from_state` -> `withdrawn`: family
    and staff, each `actor_role`-guarded (module docstring, decision 3)."""
    return [
        {
            "transition_id": f"t_withdraw_{from_state}_family",
            "from": from_state, "to": "withdrawn", "action": "withdraw", "actor": "family",
            "guards": [{"primitive": "actor_role", "params": {"roles": ["family"]}}],
            "effects": [],
        },
        {
            "transition_id": f"t_withdraw_{from_state}_staff",
            "from": from_state, "to": "withdrawn", "action": "withdraw", "actor": "staff",
            "guards": [{"primitive": "actor_role", "params": {"roles": ["staff", "admin"]}}],
            "effects": [],
        },
    ]


def _approve_effects() -> list[dict]:
    """spec §7 / accumulated decisions, exact order: commit the four sections
    (family before student before contacts before application — link-field
    injection order), set the newly-committed student's status, start the
    post-approval documents due-clock, notify."""
    return [
        {
            "primitive": "commit_sections",
            "params": {"section_ids": [
                "family_section", "student_section", "contacts_section", "application_section",
            ]},
        },
        {
            "primitive": "set_entity_field",
            "params": {"ref": "student", "field": "status", "value": "Enrolled"},
        },
        {"primitive": "start_due_clocks", "params": {"step_ids": ["documents"]}},
        {"primitive": "send_email", "params": {"template": "approved"}},
    ]


def _application_form_complete_guard() -> dict:
    """`application_form` item at `submitted` or `verified` — the same
    scoped-to-one-step pattern `t_resubmit` uses, deliberately NOT
    `all_blocking_items_complete` (module docstring, decision 4's rationale
    applies identically here: that guard sweeps in the `documents` step's
    item too, which cannot be done pre-approval)."""
    return {
        "primitive": "items_in_status",
        "params": {
            "step_ids": ["application_form"], "status": ["submitted", "verified"],
            "quantifier": "all",
        },
    }


def _transitions() -> list[dict]:
    return [
        # --- submit: both branches require the application_form item done
        # (coordinator review fix — the source specs both require "all
        # blocking items done" at submit; a scoped items_in_status guard on
        # BOTH branches gets this without sweeping in the post-approval
        # documents item). Zero unguarded transitions in this (from, action)
        # group is legal (validate.py's rule is "at most one", not
        # "exactly one") — capacity_available is what still picks the
        # submitted-vs-waitlisted branch. ---
        {
            "transition_id": "t_submit_submitted",
            "from": "draft", "to": "submitted", "action": "submit", "actor": "family",
            "guards": [
                {
                    "primitive": "capacity_available",
                    "params": {
                        "count_states": ["approved", "enrolled"],
                        "capacity_field": "capacity",
                        "scope_context_key": "school_year",
                    },
                },
                _application_form_complete_guard(),
            ],
            "effects": [],
        },
        {
            "transition_id": "t_submit_waitlisted",
            "from": "draft", "to": "waitlisted", "action": "submit", "actor": "family",
            "guards": [_application_form_complete_guard()],
            "effects": [{"primitive": "send_email", "params": {"template": "waitlisted"}}],
        },
        *_withdraw_pair("draft"),

        # --- submitted is transient: unconditional system route to review (decision 1) ---
        {
            "transition_id": "t_route_to_review",
            "from": "submitted", "to": "in_review", "action": "route_to_review", "actor": "system",
            "guards": [], "effects": [],
        },
        *_withdraw_pair("submitted"),

        # --- waitlisted: staff manually promotes back into review ---
        {
            "transition_id": "t_promote_waitlist",
            "from": "waitlisted", "to": "in_review", "action": "promote_waitlist", "actor": "staff",
            "guards": [], "effects": [],
        },
        *_withdraw_pair("waitlisted"),

        # --- in_review: staff decisions + the reject-driven system detour ---
        {
            "transition_id": "t_approve",
            "from": "in_review", "to": "approved", "action": "approve", "actor": "staff",
            "guards": [], "effects": _approve_effects(),
        },
        {
            "transition_id": "t_decline_review",
            "from": "in_review", "to": "declined", "action": "decline", "actor": "staff",
            "guards": [], "effects": [{"primitive": "send_email", "params": {"template": "declined"}}],
        },
        {
            "transition_id": "t_request_changes",
            "from": "in_review", "to": "pending_items", "action": "request_changes", "actor": "staff",
            "guards": [],
            "effects": [{"primitive": "send_email", "params": {"template": "changes_requested"}}],
        },
        {
            "transition_id": "t_flag_pending_items",
            "from": "in_review", "to": "pending_items", "action": "flag_pending_items", "actor": "system",
            "guards": [{
                "primitive": "items_in_status",
                "params": {"step_ids": ["application_form"], "status": "rejected", "quantifier": "any"},
            }],
            "effects": [],
        },
        *_withdraw_pair("in_review"),

        # --- pending_items: decline still possible; system auto-resumes review ---
        {
            "transition_id": "t_decline_pending",
            "from": "pending_items", "to": "declined", "action": "decline", "actor": "staff",
            "guards": [], "effects": [{"primitive": "send_email", "params": {"template": "declined"}}],
        },
        {
            "transition_id": "t_resubmit",
            "from": "pending_items", "to": "in_review", "action": "resubmit", "actor": "family",
            "guards": [{
                "primitive": "items_in_status",
                "params": {
                    "step_ids": ["application_form"], "status": ["submitted", "verified"],
                    "quantifier": "all",
                },
            }],
            "effects": [],
        },
        *_withdraw_pair("pending_items"),

        # --- approved -> enrolled once every post-approval (documents) item clears ---
        {
            "transition_id": "t_finalize_enrollment",
            "from": "approved", "to": "enrolled", "action": "finalize_enrollment", "actor": "system",
            "guards": [{
                "primitive": "items_in_status",
                "params": {
                    "step_ids": ["documents"], "status": ["verified", "waived"], "quantifier": "all",
                },
            }],
            "effects": [],
        },
        *_withdraw_pair("approved"),
    ]


def build_machine() -> dict:
    return {"states": _states(), "transitions": _transitions()}


# --- steps + declared sections ------------------------------------------------


def _family_section() -> dict:
    return {
        "section_id": "family_section", "entity_model": "family", "mode": "match_or_create",
        "title": "Family Information",
        "description": (
            "Who we contact about billing, closures, and pickup changes. "
            "If your family is already enrolled, we'll match this to your existing record."
        ),
        "fields": [
            {"name": "family_name", "required": True},
            {"name": "primary_address", "required": True},
            {"name": "mailing_address", "required": False},
            {"name": "primary_phone", "required": False},
            {"name": "primary_email", "required": False},
            {"name": "guardian2_name", "required": False},
            {"name": "guardian2_phone", "required": False},
            {"name": "guardian2_email", "required": False},
            {"name": "address_street", "required": False},
            {"name": "address_city", "required": False},
            {"name": "address_state", "required": False},
            {"name": "address_zip", "required": False},
        ],
        "repeat": None,
    }


def _student_section() -> dict:
    return {
        "section_id": "student_section", "entity_model": "student", "mode": "create",
        "title": "Student Information",
        "description": (
            "Tell us about the child you're enrolling. "
            "Enrolling more than one child? Submit a separate application for each."
        ),
        "fields": [
            {"name": "first_name", "required": True},
            {"name": "last_name", "required": True},
            {"name": "primary_address", "required": True},
            {"name": "dob", "required": False},
            {"name": "grade_level", "required": False},
            {"name": "allergies", "required": False},
            {"name": "medications", "required": False},
            {"name": "physician_name", "required": False},
            {"name": "physician_phone", "required": False},
            {"name": "special_needs_notes", "required": False},
            {"name": "photo_media_release", "required": False},
        ],
        "repeat": None,
    }


def _contacts_section() -> dict:
    return {
        "section_id": "contacts_section", "entity_model": "contact", "mode": "create",
        "title": "Emergency Contacts",
        "description": (
            "At least one adult besides a guardian who may be called in an emergency "
            "or collect your child. You can add up to five."
        ),
        "fields": [
            {"name": "first_name", "required": True},
            {"name": "last_name", "required": True},
            {"name": "relationship", "required": True},
            {"name": "phone", "required": False},
            {"name": "email", "required": False},
            {"name": "is_emergency", "required": False},
            {"name": "is_authorized_pickup", "required": False},
            {"name": "is_pickup_excluded", "required": False},
        ],
        "repeat": {"min": 1, "max": 5},
    }


def _application_section() -> dict:
    return {
        "section_id": "application_section", "entity_model": "registration_application", "mode": "create",
        "title": "Agreements & Signature",
        "description": (
            "Review and accept the enrollment agreements, then sign to submit."
        ),
        "fields": [
            {"name": "school_year", "required": False},
            {"name": "requested_start_date", "required": False},
            {"name": "schedule_days", "required": False},
            {"name": "pickup_method", "required": False},
            {"name": "handbook_acknowledged", "required": True},
            {"name": "liability_waiver_signed", "required": True},
            {"name": "tuition_agreement_signed", "required": True},
            {"name": "signature_name", "required": True},
            {"name": "signature_date", "required": True},
        ],
        "repeat": None,
    }


def _steps() -> list[dict]:
    return [
        {
            "step_id": "welcome", "type": "message", "title": "Welcome",
            "required": False, "blocking": False, "available_in": ["draft"],
            "show_if": None, "review": None,
            "config": {"body": "Welcome! Complete the sections below to apply for enrollment."},
        },
        {
            "step_id": "application_form", "type": "form", "title": "Application Details",
            "required": True, "blocking": True, "available_in": ["draft", "pending_items"],
            "show_if": None,
            # Override the form-type default ("auto") -- an application_form
            # completion should await staff review, not auto-verify (module
            # docstring, decision 5's resubmit path depends on this landing
            # at "submitted", not "verified", on first completion).
            "review": "staff",
            "config": {"sections": [
                _family_section(), _student_section(), _contacts_section(), _application_section(),
            ]},
        },
        {
            "step_id": "documents", "type": "documents", "title": "Required Documents",
            "required": True, "blocking": True, "available_in": ["approved"],
            "show_if": None, "review": None,  # default: staff (REVIEW_DEFAULTS["documents"])
            "config": {"docs": [
                {
                    "name": "Immunization Record",
                    "description": "Up-to-date immunization records for the student.",
                    "sensitive": True, "blocking": True, "due_days_after_state": 14,
                },
            ]},
        },
        {
            "step_id": "review_notice", "type": "message", "title": "Application Under Review",
            "required": False, "blocking": False,
            "available_in": ["in_review", "pending_items", "approved"],
            "show_if": None, "review": None,
            "config": {"body": "Thanks for applying! Our team is reviewing your application."},
        },
    ]


def build_steps() -> list[dict]:
    return _steps()


# --- seeding ------------------------------------------------------------------


def catalog_entry() -> dict[str, Any]:
    """This template's entry in `app.templates.catalog.template_catalog()`
    — the designer's template gallery (Task 6).

    Was `template_catalog() -> list[...]` while enrollment was the only
    shipped template; the list now lives in `app.templates.catalog`, which
    is the only module that knows how many templates there are.

    `definition.machine`/`.steps` are plain nested dicts/lists here, NOT the
    JSON-encoded strings `seed_enrollment_template` writes to a
    `workflow_definition` row's wire format (map §3/§8) — the frontend does
    its own `JSON.stringify` at instantiate time, the same boundary
    `DefinitionsPage.tsx`'s `submitNewWorkflow`/`handleNewDraft` already
    draw (task-5). The catalog itself is platform-wide, not tenant data —
    nothing here reads from or writes to DataCore."""
    return {
        "template_id": DEFINITION_ID,
        "name": DEFINITION_NAME,
        "description": (
            "Family self-serve enrollment: application form, staff review, "
            "waitlist, required documents, and enrollment."
        ),
        "definition": {
            "machine": build_machine(),
            "steps": build_steps(),
            "channel_access": "family",
        },
    }


def seed_enrollment_template(tenant_id: str, *, token: str | None = None) -> dict[str, Any]:
    """Write a DRAFT `workflow_definition` row for the enrollment template
    and publish it — through `app.workflows.definitions.publish_definition`,
    the SAME service function the definitions API uses, so "the template
    passes `validate_definition` with zero errors" is a structural property
    of this seed path (task-9-brief.md Step 2), not a claim this module
    makes about itself. Returns the published row. Raises `HTTPException(409,
    {"errors": [...]})` (propagated from `publish_definition`) if the
    template fails to validate against the tenant's CURRENT models — the
    tenant must already carry the §8-enriched `student`/`family`/`contact`/
    `registration_application` model definitions (see
    `scripts/apexflow-reseed-dev.py`, which pushes them first)."""
    base = {
        "definition_id": DEFINITION_ID,
        "name": DEFINITION_NAME,
        "version": 1,
        "status": "draft",
        "lineage_status": "active",
        "channel_access": "family",
        "machine": json.dumps(build_machine()),
        "steps": json.dumps(build_steps()),
    }
    created = dc.dc_create(tenant_id, "workflow_definition", base, token)
    return defs.publish_definition(tenant_id, created["entity_id"], token)
