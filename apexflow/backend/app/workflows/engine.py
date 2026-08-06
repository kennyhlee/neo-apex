# apexflow/backend/app/workflows/engine.py
"""Instance creation and item operations — the per-kind authority matrix
(Task 6).

No FastAPI/route concerns live here (that's app/api/instances.py) — mirrors
app/workflows/definitions.py's split. This module talks to DataCore via
app.workflows.datacore and raises HTTPException directly, same rationale as
definitions.py: the 404/409 *is* the domain outcome.

Spec: docs/superpowers/specs/2026-08-05-apexflow-workflow-platform-design.md
§3 "Steps and declared sections" / "Model evolution", §4 "Engine semantics"
(item authority matrix bullet). Interface map's identifier trap (Gotcha A),
generalized here: `workflow_item.instance_id` and `workflow_activity.instance_id`
both hold the parent INSTANCE's DataCore `entity_id`, never its business
`instance_id` field — the same convention `application_id` follows on
enrollx's `application_item`/`application_activity`.

Row shape convention (load-bearing for every function below): `instance_row`
and any row this module is handed as an argument (as opposed to one it just
created) is the FLATTENED shape returned by `dc.get_entity`/`list_entities`
— never the create/update envelope (`{entity_id, entity_type, base_data}`).
`app.workflows.definitions.entity_base_data` (reused here) only knows how to
rebuild `base_data` from a flattened row; handing it an envelope silently
returns `{}` and would erase every existing field on the next write. Callers
(Task 8's action dispatcher, this module's own tests) must re-fetch via
`dc.get_entity` before calling `save_draft`/`complete_item`/etc. — the
envelope returned by `create_instance` itself is for the HTTP response body
only.
"""
import json
from datetime import datetime, timezone
from typing import Any

from fastapi import HTTPException

from app.workflows import datacore as dc
from app.workflows import definitions as defs
from app.workflows.conditions import evaluate_condition
from app.workflows.schema import ENGINE_OWNED_FIELDS, SectionDef, StepDef
from app.workflows.validate import definition_health

# `review` defaults by step type (spec §3 "Steps and declared sections":
# "review defaults: auto for form/message, staff for documents"). Exported —
# Task 7's EvalContext / Task 8's dispatcher read this rather than
# re-deriving it.
REVIEW_DEFAULTS: dict[str, str] = {"form": "auto", "documents": "staff", "message": "auto"}

# Statuses documents/other blocking-completeness checks treat as "done"
# (mirrors enrollx's ITEM_DONE_STATUSES) — not consumed by this module
# directly (Task 8's guards own blocking-completeness), exported for reuse
# so a later task doesn't restate the set.
ITEM_DONE_STATUSES = frozenset({"submitted", "verified", "waived"})

_TRUTHY_STRINGS = {"true", "1", "yes"}
_EMPTY_VALUES = (None, "", [], {})


def is_family_actor(actor: str) -> bool:
    """`actor` strings are `"family:{...}"` on the family channel, a staff
    `user_id` otherwise (task-6-brief's binding convention) — BINDING name,
    Task 8's actor-gating and Task 10's internal routes both call this."""
    return actor.startswith("family")


def _now(now: datetime | None) -> datetime:
    return now or datetime.now(timezone.utc)


def _as_bool(v: Any) -> bool:
    """Coerce a DataCore-flattened value to a real bool — same rationale and
    implementation as enrollx's `engine.as_bool` (interface map Gotcha C):
    a bool `False` reads back from a flattened query row as the STRING
    "false", which is truthy in Python."""
    if isinstance(v, bool):
        return v
    if v is None:
        return False
    return str(v).strip().lower() in _TRUTHY_STRINGS


def _item_base_data(item_row: dict) -> dict:
    """`entity_base_data` (definitions.py) has no bool-coercion table since
    `workflow_definition` declares no bool fields — `workflow_item.blocking`
    IS bool-typed (base_model.json), so a round-trip through the bare helper
    would permanently rewrite stored `blocking` from real bool to the string
    "true"/"false" (interface map Gotcha C, and enrollx's own
    BOOLEAN_FIELDS_BY_TYPE precedent for `application_item.blocking`)."""
    base = defs.entity_base_data(item_row)
    if "blocking" in base:
        base["blocking"] = _as_bool(base["blocking"])
    return base


def _log_activity(tenant_id: str, instance_entity_id: str, type_: str, from_value: str,
                   to_value: str, actor: str, token: str | None, now: datetime) -> dict:
    activity_id = dc.next_id(tenant_id, "workflow_activity", token)
    return dc.dc_create(tenant_id, "workflow_activity", {
        "activity_id": activity_id,
        "workflow_activity_id": activity_id,
        "instance_id": instance_entity_id,
        "type": type_,
        "from_value": from_value or "",
        "to_value": to_value or "",
        "actor": actor,
        "at": now.isoformat(),
    }, token)


# --- creation -----------------------------------------------------------


def _derive_item_specs(steps: list[StepDef]) -> list[dict]:
    """One `workflow_item` field-dict per requirement instance, derived from
    the pinned definition's steps (spec §3, §4 — mirrors enrollx's
    `derive_items` roadmap contract, generalized to apexflow's step types).

    form -> exactly one `form` item. documents -> one `documents` item per
    `config["docs"]` entry (fan-out), title = doc name, blocking = the doc's
    own `blocking` flag if present else the step's; `payload_ref` starts
    empty (upload happens later, Task 10's routes). message -> a
    `message-ack` item ONLY when `config.get("ack")` is truthy; otherwise no
    item at all (an un-acked message step is informational, nothing to
    complete). Returned dicts carry no `item_id`/`instance_id` — the caller
    (`create_instance`) adds those before persisting, same split enrollx's
    `derive_items` uses.
    """
    specs: list[dict] = []
    for step in steps:
        if step.type == "form":
            specs.append({
                "step_id": step.step_id, "kind": "form",
                "title": step.title, "blocking": bool(step.blocking),
            })
        elif step.type == "documents":
            docs = step.config.get("docs", []) or []
            for i, doc in enumerate(docs):
                specs.append({
                    "step_id": step.step_id, "kind": "documents",
                    "title": doc.get("name", f"Document {i + 1}"),
                    "blocking": bool(doc.get("blocking", step.blocking)),
                    "payload_ref": "",
                })
        elif step.type == "message":
            if step.config.get("ack"):
                specs.append({
                    "step_id": step.step_id, "kind": "message-ack",
                    "title": step.title, "blocking": bool(step.blocking),
                })
        # else: unknown step type -- StepDef's Literal already rejects this
        # at parse time (_parse_machine_steps), unreachable here.
    return specs


def _create_item(tenant_id: str, instance_entity_id: str, fields: dict, token: str | None) -> dict:
    item_id = dc.next_id(tenant_id, "workflow_item", token)
    base = {
        "item_id": item_id,
        "workflow_item_id": item_id,
        "instance_id": instance_entity_id,
        "status": "not_started",
        **fields,
    }
    return dc.dc_create(tenant_id, "workflow_item", base, token)


def create_instance(tenant_id: str, lineage_definition_id: str, context: dict, channel: str,
                     applicant_email: str | None = None, *, token: str | None = None,
                     now: datetime | None = None) -> dict:
    """Create a `workflow_instance` (+ derived `workflow_item` rows) for the
    currently published version of one definition LINEAGE.

    404 if the lineage has no published row (`get_published_definition`
    returns None). 409 `{"reason": "lineage_not_active", "lineage_status": ...}`
    if the lineage isn't `active` (spec §3 "Definition lifecycle": deprecated
    stops new instances; retired is terminal). 409
    `{"reason": "definition_stale"|"definition_broken"}` if
    `definition_health` against CURRENT models isn't `"current"` (spec
    "Model evolution": "instance creation re-validates and refuses"). Note
    this is deliberately `definition_health`, not the full structural
    `validate_definition` — the latter is publish-time only; a published
    definition is already structurally sound, what can go stale/broken
    post-publish is model coherence.
    """
    now = _now(now)
    row = defs.get_published_definition(tenant_id, lineage_definition_id, token)
    if row is None:
        raise HTTPException(404, "No published workflow_definition for this lineage")
    if row.get("lineage_status") != "active":
        raise HTTPException(409, {
            "reason": "lineage_not_active",
            "lineage_status": row.get("lineage_status"),
        })

    machine, steps = defs._parse_machine_steps(row)
    models = defs._fetch_models(tenant_id, defs._referenced_entity_models(steps), token)
    health = definition_health(machine, steps, models)
    if health != "current":
        raise HTTPException(409, {"reason": f"definition_{health}"})

    initial_states = [s.state_id for s in machine.states if s.kind == "initial"]
    if not initial_states:
        # Should be impossible post-publish (validate_definition's
        # _state_errors requires exactly one) -- defensive, not reachable
        # via any test fixture in this suite.
        raise HTTPException(500, "Published definition has no initial state")
    initial_state = initial_states[0]

    instance_id = dc.next_id(tenant_id, "workflow_instance", token)
    base = {
        "instance_id": instance_id,
        "workflow_instance_id": instance_id,
        "definition_id": lineage_definition_id,
        "definition_version": defs._as_int(row.get("version")),
        "state": initial_state,
        "subject_refs": "{}",
        "context": json.dumps(context or {}),
        "channel_started": channel,
        "token_version": 1,
        "draft_data": "{}",
        "opened_at": now.isoformat(),
    }
    if applicant_email:
        base["applicant_email"] = applicant_email
    created = dc.dc_create(tenant_id, "workflow_instance", base, token)
    instance_entity_id = created["entity_id"]

    items = [_create_item(tenant_id, instance_entity_id, fields, token)
             for fields in _derive_item_specs(steps)]

    _log_activity(tenant_id, instance_entity_id, "state_change", "", initial_state, channel, token, now)

    return {"instance": created, "items": items}


# --- pinned-version step lookup (item ops always run against the pinned
# version, spec §3: "in-flight instances always run and commit per their
# pinned version" -- never the currently-published row, which may have
# moved on) --------------------------------------------------------------


def _pinned_definition_row(tenant_id: str, instance_row: dict, token: str | None = None) -> dict:
    lineage_id = instance_row.get("definition_id")
    version = instance_row.get("definition_version")
    rows = dc.list_entities(tenant_id, "workflow_definition", "", token)
    rows = [r for r in rows if str(r.get("definition_id", "")) == str(lineage_id)
            and str(r.get("version", "")) == str(version)]
    if not rows:
        raise HTTPException(404, "Pinned workflow_definition version not found for this instance")
    return rows[0]


def _pinned_steps(tenant_id: str, instance_row: dict, token: str | None = None) -> list[StepDef]:
    row = _pinned_definition_row(tenant_id, instance_row, token)
    _, steps = defs._parse_machine_steps(row)
    return steps


def _require_step(steps: list[StepDef], step_id: str) -> StepDef:
    for step in steps:
        if step.step_id == step_id:
            return step
    raise HTTPException(404, f"step {step_id!r} not found on the instance's pinned definition")


# --- draft answers --------------------------------------------------------


def save_draft(tenant_id: str, instance_row: dict, section_answers: dict, actor: str, *,
               token: str | None = None, now: datetime | None = None) -> dict:
    """Shallow-merge `section_answers` (`{section_id: {field: value}}`) into
    `draft_data`. `"context"` is NOT a writable section — context is
    creation-time only (spec §3) — and any field named in
    `ENGINE_OWNED_FIELDS`, wherever it appears, is rejected with 400 naming
    it (spec: "Engine-owned instance fields are never section-writable").
    Writes no activity (registration's autosave-noise-avoidance precedent —
    a save_draft on every keystroke/blur would flood the activity log).
    """
    _now(now)  # validated/normalized even though unused below, for signature symmetry
    if "context" in section_answers:
        raise HTTPException(400, {
            "error": "context is not writable via save_draft (creation-time only)",
        })

    owned = sorted({
        field
        for fields in section_answers.values()
        if isinstance(fields, dict)
        for field in fields
        if field in ENGINE_OWNED_FIELDS
    })
    if owned:
        raise HTTPException(400, {
            "error": "engine-owned fields cannot be written via save_draft",
            "fields": owned,
        })

    try:
        draft = json.loads(instance_row.get("draft_data") or "{}")
    except json.JSONDecodeError:
        draft = {}
    for section_id, fields in section_answers.items():
        if not isinstance(fields, dict):
            continue
        section = draft.setdefault(section_id, {})
        section.update(fields)

    base = defs.entity_base_data(instance_row)
    base["draft_data"] = json.dumps(draft)
    return dc.dc_update(tenant_id, "workflow_instance", instance_row["entity_id"], base, token)


# --- item lookups + shared update path ------------------------------------


def _require_item(tenant_id: str, instance_row: dict, item_entity_id: str,
                   token: str | None = None) -> dict:
    item = dc.get_entity(tenant_id, "workflow_item", item_entity_id, token)
    if item is None or item.get("instance_id") != instance_row.get("entity_id"):
        raise HTTPException(404, "workflow_item not found on this instance")
    return item


def _update_item(tenant_id: str, instance_row: dict, item_row: dict, changes: dict,
                  actor: str, token: str | None, now: datetime) -> dict:
    base = _item_base_data(item_row)
    old_status = base.get("status", "not_started")
    base.update(changes)
    updated = dc.dc_update(tenant_id, "workflow_item", item_row["entity_id"], base, token)
    _log_activity(tenant_id, instance_row.get("entity_id"), "item_change",
                 old_status, changes.get("status", old_status), actor, token, now)
    return updated


def _require_staff_actor(actor: str) -> None:
    if is_family_actor(actor):
        raise HTTPException(403, "family actor may not perform this action")


# --- complete_item (family or staff; per-kind validation) ------------------


def _missing_required_fields(step: StepDef, draft: dict) -> list[str]:
    """`"{section_id}.{field}"` for every required FieldPick on `step`'s
    declared sections whose draft answer is absent/empty (spec §3:
    "complete_item ... re-validate required fields server-side against the
    pinned definition version")."""
    missing: list[str] = []
    for raw in step.config.get("sections", []) or []:
        section = SectionDef.model_validate(raw)
        section_draft = draft.get(section.section_id) or {}
        for pick in section.fields:
            if not pick.required:
                continue
            if section_draft.get(pick.name) in _EMPTY_VALUES:
                missing.append(f"{section.section_id}.{pick.name}")
    return missing


def complete_item(tenant_id: str, instance_row: dict, item_entity_id: str, actor: str, *,
                   token: str | None = None, now: datetime | None = None) -> dict:
    """Family- or staff-completable for every kind (spec §4: "form:
    family/staff complete"; documents and message-ack items follow the same
    open authority — only `verify_item`/`reject_item`/`waive_item` are
    staff-only). Per-kind validation before the status write:

    - `form`: every required field of the step's declared sections must be
      present+non-empty in `draft_data` -> 409 `{"missing": [...]}` naming
      each as `"{section_id}.{field}"`.
    - `documents`: `payload_ref` must already be set on the item (upload
      happens via Task 10's routes, before this is called) -> 409 if empty.
    - `message-ack`: nothing to validate beyond the item existing.

    Resulting status: `"verified"` if the step's effective `review`
    (`step.review` or `REVIEW_DEFAULTS[step.type]`) is `"auto"`, else
    `"submitted"`. Sets `completed_by = actor` and logs an `item_change`
    activity either way.
    """
    now = _now(now)
    item = _require_item(tenant_id, instance_row, item_entity_id, token)
    steps = _pinned_steps(tenant_id, instance_row, token)
    step = _require_step(steps, item.get("step_id"))

    if step.type == "form":
        try:
            draft = json.loads(instance_row.get("draft_data") or "{}")
        except json.JSONDecodeError:
            draft = {}
        missing = _missing_required_fields(step, draft)
        if missing:
            raise HTTPException(409, {"missing": missing})
    elif step.type == "documents":
        if not item.get("payload_ref"):
            raise HTTPException(409, {"reason": "payload_ref_missing"})
    # message-ack: no further validation.

    effective_review = step.review or REVIEW_DEFAULTS[step.type]
    new_status = "verified" if effective_review == "auto" else "submitted"

    return _update_item(tenant_id, instance_row, item,
                        {"status": new_status, "completed_by": actor}, actor, token, now)


# --- staff-only review actions ---------------------------------------------


def verify_item(tenant_id: str, instance_row: dict, item_entity_id: str, actor: str, *,
                 token: str | None = None, now: datetime | None = None) -> dict:
    """Staff-only (403 for a family actor). Valid from `submitted` or
    `in_progress` only -> 409 `{"error": ..., "allowed": [...]}` otherwise
    (spec §4 authority matrix: "verified means confirmed")."""
    now = _now(now)
    _require_staff_actor(actor)
    item = _require_item(tenant_id, instance_row, item_entity_id, token)
    current = item.get("status", "not_started")
    if current not in ("submitted", "in_progress"):
        raise HTTPException(409, {
            "error": f"cannot verify item from status {current!r}",
            "allowed": ["submitted", "in_progress"],
        })
    return _update_item(tenant_id, instance_row, item, {"status": "verified"}, actor, token, now)


def reject_item(tenant_id: str, instance_row: dict, item_entity_id: str, actor: str, *,
                 token: str | None = None, now: datetime | None = None) -> dict:
    """Staff-only (403 for a family actor). No source-status restriction —
    staff may send an item back for correction from whatever state it's in."""
    now = _now(now)
    _require_staff_actor(actor)
    item = _require_item(tenant_id, instance_row, item_entity_id, token)
    return _update_item(tenant_id, instance_row, item, {"status": "rejected"}, actor, token, now)


def waive_item(tenant_id: str, instance_row: dict, item_entity_id: str, actor: str, *,
               token: str | None = None, now: datetime | None = None) -> dict:
    """Staff-only (403 for a family actor). Any NON-verified status may be
    waived (spec §3: "required: false steps are skippable independently of
    conditions, and staff may waive_item on any item") -- 409 if the item is
    already `verified` (waiving a confirmed item has no meaning)."""
    now = _now(now)
    _require_staff_actor(actor)
    item = _require_item(tenant_id, instance_row, item_entity_id, token)
    if item.get("status") == "verified":
        raise HTTPException(409, {"error": "cannot waive an already-verified item"})
    return _update_item(tenant_id, instance_row, item, {"status": "waived"}, actor, token, now)


# --- applicability (show_if, dynamic — items are never mutated) ------------


def _condition_data(draft_data: dict, context: dict) -> dict:
    data: dict[str, Any] = {}
    for section_id, fields in (draft_data or {}).items():
        if not isinstance(fields, dict):
            continue
        for field, value in fields.items():
            data[f"{section_id}.{field}"] = value
    for key, value in (context or {}).items():
        data[f"context.{key}"] = value
    return data


def applicable_items(definition_steps: list[StepDef], items: list[dict], draft_data: dict,
                     context: dict) -> list[dict]:
    """Filter `items` to those whose owning step is currently applicable:
    steps without a `show_if` are always included; steps with one are
    included iff it evaluates true against the flat
    `{section.field: value} | {context.key: value}` view of `draft_data`/
    `context` (spec §3: "computed dynamically from current draft data —
    items are not mutated as answers change"). Purely a read-time filter;
    never writes anything.
    """
    data = _condition_data(draft_data, context)
    steps_by_id = {s.step_id: s for s in definition_steps}
    result = []
    for item in items:
        step = steps_by_id.get(item.get("step_id"))
        if step is None or step.show_if is None:
            result.append(item)
            continue
        if evaluate_condition(step.show_if, data):
            result.append(item)
    return result
