# apexflow/backend/app/templates/signup.py
"""The program-signup template — the platform's SECOND shipped workflow
template, and the reason it exists is not "another template would be nice".

Spec: docs/superpowers/specs/2026-08-10-stage-centric-workflow-editor-design.md
"Risks": *"Coverage is unproven at n=1. Enrollment is the only template that
exists ... Removing the Machine tab on the strength of one fitting example
is the main risk in this design. Mitigation: write a second template
(signup) before building the editor."* This module is that mitigation. The
written ruling it produced is
`docs/superpowers/rulings/2026-08-10-stage-model-coverage-signup.md`.

Like `app.templates.enrollment`, nothing here is engine-special: a `machine`
dict + a `steps` list (exactly the shapes `app.workflows.schema.MachineDef`/
`StepDef` validate) plus `seed_signup_template`, which publishes through the
SAME `publish_definition` service function the definitions API uses — so
"zero validator errors" is a structural property of the seed path, not a
claim this module makes about itself.

WHAT MAKES THIS TEMPLATE DIFFERENT FROM ENROLLMENT (this is the point — a
second template that merely restated the first would have proven nothing):

1. **No staff review tier.** A program signup is self-serve: the family's
   own `submit` confirms the signup outright when there is room. Enrollment
   routes every application through `in_review`; signup has no equivalent
   stage, so the spine is two stages long (`draft -> confirmed`) with the
   waitlist hanging off it.
2. **`confirmed` is a RESTING stage, not the finish.** A confirmed signup
   sits in `confirmed` for the length of the program and still accepts
   `drop` and `complete_program`. It is therefore `kind: "active"` even
   though it is where the spine's forward progress ends — the finish is
   `completed`, which nothing leaves. Enrollment never exercised this: its
   `enrolled` stage really is the end.
3. **A backward move that is not a send-back pair.**
   `offered --decline_offer--> waitlisted` returns a family to the list it
   came from, keeping its place. Enrollment's only backward edge is the
   `in_review <-> pending_items` send-back/resubmit pair.
4. **One edge, two actions, two actors.** `offered -> waitlisted` is
   reached by BOTH `decline_offer` (family) and `rescind_offer` (staff).
   Any inference that groups transitions by `(from, to)` merges these and
   loses an actor and an effect.
5. **A non-uniform exit.** `drop` reaches every non-terminal stage for both
   actors (8 transitions, one rule) — but dropping from `confirmed` must
   ALSO mark the committed `enrollment` row `Withdrawn`, while dropping
   from `draft`/`waitlisted`/`offered` must not (there is no committed row
   yet, and `set_entity_field` raises 409 when it cannot resolve the ref).
   So the eight transitions share an action and a target but split into TWO
   effect shapes. See the ruling: this is the finding that changes the
   Exits panel's grouping key.
6. **No documents tier.** Signup declares no `documents` step, so
   `start_due_clocks` never appears. Enrollment could not demonstrate a
   template without one.

DESIGN DECISIONS this module makes:

A. **`program_id` is a plain, family-typed form field.** ApexFlow has no
   way for a form to reference an EXISTING entity: there is no `entity_ref`
   field type, `set_entity_field.value` is a static authoring-time literal
   with no context templating (`app.templates.enrollment`'s docstring,
   decision 7, hit the same wall for `school_year`), and a section bound to
   `program` in `match_or_create` mode would CREATE a program per signup
   (`primitives._MATCH_STRATEGIES` has no `program` strategy). So the
   `signup_section` picks `program_id` directly and the family supplies it.
   This is honest about a real gap rather than papering over it; it is
   logged as a follow-up, and it needs no engine change to ship.
B. **Capacity is scoped on `context.program_id`.** `capacity_available`
   reads its ceiling from the TENANT row's `capacity` field (the only place
   the primitive looks) and counts sibling instances of the same
   `definition_id` whose `context[scope_context_key]` matches. Scoping on
   `program_id` means one signup definition per program shares a single
   tenant-level ceiling — imprecise, and the same imprecision enrollment
   already lives with. Recorded, not worked around.
C. **`drop` rather than `withdraw`, `dropped` rather than `cancelled`.**
   `cancelled` is a SYNTHETIC state the engine writes for its built-in
   `cancel_instance` action (`app.workflows.machine`, `_is_terminal_state`);
   declaring a state with that id would shadow it. A distinct action name
   also keeps this template's exit from colliding with enrollment's
   `withdraw` when both are read side by side in the designer.
D. **Both `submit` branches are guarded, so the group has zero unguarded
   transitions** — legal per `validate.py`'s `_unguarded_branch_errors`
   ("at most one", not "exactly one"), and the same shape enrollment uses.
   Declaration order is load-bearing: `capacity_available` is declared
   FIRST so the confirm branch wins when there is room, and the waitlist
   branch is the fallback.
E. **`student` commits in `match_or_create` mode with `dob` required.**
   `primitives._match_student_by_name_dob` keys on
   (first_name, last_name, dob) and needs all three, so a section that left
   `dob` optional would silently fall through to creating a duplicate
   student on a household's second signup.
"""
import json
from typing import Any

from app.workflows import datacore as dc
from app.workflows import definitions as defs

DEFINITION_ID = "signup"
DEFINITION_NAME = "Program Signup"

DESCRIPTION = (
    "Family self-serve program signup: one short form, instant confirmation "
    "when there is room, a waitlist with staff-issued offers, and a drop "
    "path from every stage."
)

# --- state machine -----------------------------------------------------------


def _states() -> list[dict]:
    return [
        {"state_id": "draft", "name": "Draft", "kind": "initial"},
        {"state_id": "waitlisted", "name": "Waitlisted", "kind": "active"},
        {"state_id": "offered", "name": "Spot Offered", "kind": "active"},
        # `active`, not `terminal`, deliberately -- see module docstring,
        # difference 2. A signup rests here and still accepts moves.
        {"state_id": "confirmed", "name": "Confirmed", "kind": "active"},
        {"state_id": "completed", "name": "Completed", "kind": "terminal"},
        {"state_id": "dropped", "name": "Dropped", "kind": "terminal"},
    ]


# Every non-terminal stage, in spine order. Single source for the `drop`
# exit's scope so a stage added later cannot silently become un-droppable --
# the exact failure the Exits panel's "rule, not a checkbox list" decision
# exists to prevent (design spec, "Scope is a rule with exceptions").
DROPPABLE_STATES: tuple[str, ...] = ("draft", "waitlisted", "offered", "confirmed")


def _signup_form_complete_guard() -> dict:
    """The `signup_form` item at `submitted` or `verified`. Scoped to that
    one step for the same reason enrollment scopes its equivalent guard:
    `all_blocking_items_complete` sweeps every applicable blocking item with
    no per-stage concept."""
    return {
        "primitive": "items_in_status",
        "params": {
            "step_ids": ["signup_form"], "status": ["submitted", "verified"],
            "quantifier": "all",
        },
    }


def _capacity_guard() -> dict:
    """Module docstring, decision B: tenant-level ceiling, per-program
    scope."""
    return {
        "primitive": "capacity_available",
        "params": {
            "count_states": ["offered", "confirmed"],
            "capacity_field": "capacity",
            "scope_context_key": "program_id",
        },
    }


def _confirm_effects() -> list[dict]:
    """Commit the three sections (family before student before signup --
    link-field injection order), then mark the freshly-committed enrollment
    row active and notify."""
    return [
        {
            "primitive": "commit_sections",
            "params": {"section_ids": ["family_section", "student_section", "signup_section"]},
        },
        {
            "primitive": "set_entity_field",
            "params": {"ref": "enrollment", "field": "status", "value": "Active"},
        },
        {"primitive": "send_email", "params": {"template": "signup_confirmed"}},
    ]


def _drop_pair(from_state: str) -> list[dict]:
    """Two `drop` transitions from `from_state` -> `dropped`: family and
    staff, each `actor_role`-guarded.

    `TransitionDef.actor` is single-valued, so "family or staff may drop"
    needs two rows; and both would otherwise be structurally unguarded under
    the same `(from, action)` key, which `validate.py`'s
    `_unguarded_branch_errors` rejects. The `actor_role` guard is what makes
    the pair legal AND makes staff-fires-family-transition dispatch resolve
    to the staff row regardless of declaration order.

    Only the `confirmed` source carries the enrollment-status effect -- the
    other three stages have no committed `enrollment` row, and
    `set_entity_field` raises 409 when it cannot resolve `enrollment_id`
    out of `subject_refs` (module docstring, difference 5).
    """
    effects: list[dict] = []
    if from_state == "confirmed":
        effects = [{
            "primitive": "set_entity_field",
            "params": {"ref": "enrollment", "field": "status", "value": "Withdrawn"},
        }]
    return [
        {
            "transition_id": f"t_drop_{from_state}_family",
            "from": from_state, "to": "dropped", "action": "drop", "actor": "family",
            "guards": [{"primitive": "actor_role", "params": {"roles": ["family"]}}],
            "effects": list(effects),
        },
        {
            "transition_id": f"t_drop_{from_state}_staff",
            "from": from_state, "to": "dropped", "action": "drop", "actor": "staff",
            "guards": [{"primitive": "actor_role", "params": {"roles": ["staff", "admin"]}}],
            "effects": list(effects),
        },
    ]


def _transitions() -> list[dict]:
    return [
        # --- submit: confirm outright when there is room, else waitlist.
        # Both branches guarded (decision D); capacity declared first so it
        # picks the branch. ---
        {
            "transition_id": "t_submit_confirmed",
            "from": "draft", "to": "confirmed", "action": "submit", "actor": "family",
            "guards": [_capacity_guard(), _signup_form_complete_guard()],
            "effects": _confirm_effects(),
        },
        {
            "transition_id": "t_submit_waitlisted",
            "from": "draft", "to": "waitlisted", "action": "submit", "actor": "family",
            "guards": [_signup_form_complete_guard()],
            "effects": [{"primitive": "send_email", "params": {"template": "signup_waitlisted"}}],
        },
        *_drop_pair("draft"),

        # --- waitlist: staff issues an offer, which mints a fresh family
        # link so the offer email can carry one. ---
        {
            "transition_id": "t_offer_spot",
            "from": "waitlisted", "to": "offered", "action": "offer_spot", "actor": "staff",
            "guards": [],
            "effects": [
                {"primitive": "issue_link", "params": {}},
                {"primitive": "send_email", "params": {"template": "signup_offer"}},
            ],
        },
        *_drop_pair("waitlisted"),

        # --- offered: accept, or go back on the list two different ways
        # (module docstring, difference 4). ---
        {
            "transition_id": "t_accept_offer",
            "from": "offered", "to": "confirmed", "action": "accept_offer", "actor": "family",
            "guards": [_signup_form_complete_guard()],
            "effects": _confirm_effects(),
        },
        {
            "transition_id": "t_decline_offer",
            "from": "offered", "to": "waitlisted", "action": "decline_offer", "actor": "family",
            "guards": [], "effects": [],
        },
        {
            "transition_id": "t_rescind_offer",
            "from": "offered", "to": "waitlisted", "action": "rescind_offer", "actor": "staff",
            "guards": [],
            "effects": [{"primitive": "send_email", "params": {"template": "signup_offer_expired"}}],
        },
        *_drop_pair("offered"),

        # --- confirmed rests here until the program ends. ---
        {
            "transition_id": "t_complete_program",
            "from": "confirmed", "to": "completed", "action": "complete_program", "actor": "staff",
            "guards": [],
            "effects": [{
                "primitive": "set_entity_field",
                "params": {"ref": "enrollment", "field": "status", "value": "Completed"},
            }],
        },
        *_drop_pair("confirmed"),
    ]


def build_machine() -> dict:
    return {"states": _states(), "transitions": _transitions()}


# --- steps + declared sections ------------------------------------------------


def _family_section() -> dict:
    return {
        "section_id": "family_section", "entity_model": "family", "mode": "match_or_create",
        "title": "Your Family",
        "description": (
            "Already with us? Enter your family exactly as it appears on your other "
            "records and we'll attach this signup to it instead of creating a duplicate."
        ),
        "fields": [
            {"name": "family_name", "required": True},
            {"name": "primary_address", "required": True},
            {"name": "primary_phone", "required": False},
            {"name": "primary_email", "required": False},
        ],
        "repeat": None,
    }


def _student_section() -> dict:
    return {
        "section_id": "student_section", "entity_model": "student", "mode": "match_or_create",
        "title": "Who's Signing Up",
        "description": (
            "The child joining this program. Date of birth is how we match an "
            "existing student record, so please enter it even if we already have it."
        ),
        "fields": [
            {"name": "first_name", "required": True},
            {"name": "last_name", "required": True},
            # Required here (not on the model) because it is the match key --
            # module docstring, decision E.
            {"name": "dob", "required": True},
            {"name": "primary_address", "required": True},
            {"name": "grade_level", "required": False},
        ],
        "repeat": None,
    }


def _signup_section() -> dict:
    return {
        "section_id": "signup_section", "entity_model": "enrollment", "mode": "create",
        "title": "Program & Start Date",
        "description": (
            "Which program, and when you'd like to start. Anything we should know "
            "about days or pickup goes in the notes."
        ),
        "fields": [
            # A plain typed field, not an entity picker -- module docstring,
            # decision A.
            {"name": "program_id", "required": True},
            {"name": "enrollment_date", "required": True},
            {"name": "notes", "required": False},
        ],
        "repeat": None,
    }


def _steps() -> list[dict]:
    return [
        {
            "step_id": "welcome", "type": "message", "title": "Welcome",
            "required": False, "blocking": False, "available_in": ["draft"],
            "show_if": None, "review": None,
            "config": {"body": "Fill in the form below to sign up for a program."},
        },
        {
            "step_id": "signup_form", "type": "form", "title": "Signup Details",
            "required": True, "blocking": True, "available_in": ["draft"],
            # `review: None` -> the form-type default ("auto"), so a family's
            # own completion verifies immediately. There is no staff review
            # tier in this template (module docstring, difference 1), so an
            # override to "staff" would leave the item parked forever.
            "show_if": None, "review": None,
            "config": {"sections": [_family_section(), _student_section(), _signup_section()]},
        },
        {
            "step_id": "waitlist_notice", "type": "message", "title": "You're on the Waitlist",
            "required": False, "blocking": False, "available_in": ["waitlisted"],
            "show_if": None, "review": None,
            "config": {"body": "This program is full. We'll contact you as soon as a spot opens."},
        },
        {
            "step_id": "offer_notice", "type": "message", "title": "A Spot Is Open",
            "required": False, "blocking": False, "available_in": ["offered"],
            "show_if": None, "review": None,
            "config": {"body": "A spot has opened up. Accept below to confirm your place."},
        },
        {
            "step_id": "confirmation_notice", "type": "message", "title": "You're Signed Up",
            "required": False, "blocking": False, "available_in": ["confirmed"],
            "show_if": None, "review": None,
            "config": {"body": "Your signup is confirmed. We'll see you on the start date."},
        },
    ]


def build_steps() -> list[dict]:
    return _steps()


# --- catalog + seeding ---------------------------------------------------------


def catalog_entry() -> dict[str, Any]:
    """This template's entry in `app.templates.catalog.template_catalog()`.
    `machine`/`steps` are plain nested dicts/lists here, NOT the JSON-encoded
    strings `seed_signup_template` writes to a `workflow_definition` row —
    the frontend does its own `JSON.stringify` at instantiate time."""
    return {
        "template_id": DEFINITION_ID,
        "name": DEFINITION_NAME,
        "description": DESCRIPTION,
        "definition": {
            "machine": build_machine(),
            "steps": build_steps(),
            "channel_access": "family",
        },
    }


def seed_signup_template(tenant_id: str, *, token: str | None = None) -> dict[str, Any]:
    """Write a DRAFT `workflow_definition` row for the signup template and
    publish it through `app.workflows.definitions.publish_definition` — the
    same service function the definitions API uses, so "the template passes
    `validate_definition` with zero errors" is a structural property of this
    seed path rather than a claim. Raises `HTTPException(409,
    {"errors": [...]})` if the template fails to validate against the
    tenant's CURRENT `student`/`family`/`enrollment` models."""
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
