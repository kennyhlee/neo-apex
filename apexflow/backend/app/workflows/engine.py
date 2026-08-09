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

from fastapi import HTTPException

from app.workflows import datacore as dc
from app.workflows import definitions as defs
from app.workflows.schema import ENGINE_OWNED_FIELDS, SectionDef, StepDef
from app.workflows.shared import (
    ITEM_DONE_STATUSES,
    ItemStatus,
    applicable_items,
    as_bool,
    is_family_actor,
)
from app.workflows.validate import definition_health

# `is_family_actor`, `ITEM_DONE_STATUSES`, and `applicable_items` now live in
# app.workflows.shared (code-review follow-up to Task 7 — this module,
# definitions.py, and primitives.py each carried their own duplicate before;
# see shared.py's module docstring for the import-cycle constraint that
# forced the duplication in the first place). Imported by name above and
# re-exported here (not just used internally) because Tasks 8-10 were told
# to import these from `engine` — `from app.workflows.engine import
# is_family_actor` / `engine.applicable_items(...)` call sites keep working
# unchanged.

# `review` defaults by step type (spec §3 "Steps and declared sections":
# "review defaults: auto for form/message, staff for documents"). Exported —
# Task 7's EvalContext / Task 8's dispatcher read this rather than
# re-deriving it.
REVIEW_DEFAULTS: dict[str, str] = {"form": "auto", "documents": "staff", "message": "auto"}

# Source statuses complete_item may act from. Re-completing after a staff
# rejection (resubmit) or re-submitting an already-submitted item
# (idempotent-ok) are both legitimate; completing an already-verified or
# already-waived item is not — the latter would silently regress a
# confirmed/waived item back to submitted/verified (coordinator review
# finding, Critical: a second complete_item call on a verified item used to
# do exactly that with no guard at all).
COMPLETABLE_STATUSES = frozenset(
    {ItemStatus.NOT_STARTED, ItemStatus.SUBMITTED, ItemStatus.REJECTED}
)

# Source statuses `verify_item` may act from. `submitted` is the only one:
# an item reaches staff review by being completed, and `verified`/`waived`/
# `rejected`/`not_started` are all either terminal-for-verify or not yet
# reviewable.
VERIFIABLE_STATUSES = frozenset({ItemStatus.SUBMITTED})

_EMPTY_VALUES = (None, "", [], {})


def _now(now: datetime | None) -> datetime:
    return now or datetime.now(timezone.utc)


def row_version(row: dict) -> int | None:
    """The _version a previously-read flattened row carries, or None.

    DataCore flattens all scalars to strings; tolerate int or str. Every
    write in this module that round-trips a previously-read
    `workflow_instance`/`workflow_item` row passes
    `expected_version=row_version(row)` to `dc.dc_update` (Plan 3 Task 2's
    CAS precondition) so a lost-update race surfaces as a 409 conflict
    instead of silently overwriting a concurrent write. `None` (row has no
    `_version`, e.g. a freshly-created row this call never re-fetched) skips
    the precondition — same as passing no `expected_version` at all."""
    raw = row.get("_version")
    try:
        return int(raw) if raw not in (None, "") else None
    except (TypeError, ValueError):
        return None


def _item_base_data(item_row: dict) -> dict:
    """`entity_base_data` (definitions.py, re-exported from shared.py) has
    no bool-coercion table since `workflow_definition` declares no bool
    fields — `workflow_item.blocking` IS bool-typed (base_model.json), so a
    round-trip through the bare helper would permanently rewrite stored
    `blocking` from real bool to the string "true"/"false" (interface map
    Gotcha C, and enrollx's own BOOLEAN_FIELDS_BY_TYPE precedent for
    `application_item.blocking`)."""
    base = defs.entity_base_data(item_row)
    if "blocking" in base:
        base["blocking"] = as_bool(base["blocking"])
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
        # at parse time (parse_machine_steps), unreachable here.
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

    machine, steps = defs.parse_machine_steps(row)
    models = defs.fetch_models(tenant_id, defs.referenced_entity_models(steps), token)
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
    _, steps = defs.parse_machine_steps(row)
    return steps


def _require_step(steps: list[StepDef], step_id: str) -> StepDef:
    for step in steps:
        if step.step_id == step_id:
            return step
    raise HTTPException(404, f"step {step_id!r} not found on the instance's pinned definition")


def _section_map(steps: list[StepDef]) -> dict[str, SectionDef]:
    """Every declared section across all `form` steps, keyed by
    `section_id` — used to validate `save_draft` answers against what the
    pinned definition actually declares (shape per section: repeat vs.
    single, which fields exist)."""
    section_map: dict[str, SectionDef] = {}
    for step in steps:
        if step.type != "form":
            continue
        for raw in step.config.get("sections", []) or []:
            section = SectionDef.model_validate(raw)
            section_map[section.section_id] = section
    return section_map


# --- draft answers --------------------------------------------------------


def save_draft(tenant_id: str, instance_row: dict, section_answers: dict, actor: str, *,
               token: str | None = None, now: datetime | None = None) -> dict:
    """Merge `section_answers` into `draft_data`, one entry per declared
    section:

    - Non-repeat sections: `{section_id: {field: value}}`, shallow-merged
      into whatever's already staged for that section. A list-shaped answer
      for a non-repeat section is rejected with 400.
    - Repeat sections (`SectionDef.repeat` set): `{section_id: [{field:
      value}, ...]}` — REPLACE-list semantics (the whole list overwrites
      whatever was staged, no per-entry merge — add-another lists don't have
      a stable per-entry identity to merge against). A dict-shaped answer
      for a repeat section is rejected with 400.

    `"context"` is NOT a writable section — context is creation-time only
    (spec §3). An answer naming a `section_id` the pinned definition doesn't
    declare -> 400 naming it. Any field named in `ENGINE_OWNED_FIELDS`,
    wherever it appears (including inside every entry of a repeat section),
    is rejected with 400 naming it (spec: "Engine-owned instance fields are
    never section-writable"). Writes no activity (registration's
    autosave-noise-avoidance precedent — a save_draft on every
    keystroke/blur would flood the activity log).
    """
    _now(now)  # validated/normalized even though unused below, for signature symmetry
    if "context" in section_answers:
        raise HTTPException(400, {
            "error": "context is not writable via save_draft (creation-time only)",
        })

    steps = _pinned_steps(tenant_id, instance_row, token)
    section_map = _section_map(steps)

    owned_fields: set[str] = set()
    for section_id, answer in section_answers.items():
        section = section_map.get(section_id)
        if section is None:
            raise HTTPException(400, {
                "error": f"section {section_id!r} is not declared by the pinned definition",
            })
        if section.repeat is not None:
            if not isinstance(answer, list):
                raise HTTPException(400, {
                    "error": f"section {section_id!r} is a repeat section; "
                             "answer must be a list of objects",
                })
            for entry in answer:
                if not isinstance(entry, dict):
                    raise HTTPException(400, {
                        "error": f"section {section_id!r} repeat entries must be objects",
                    })
                owned_fields |= {f for f in entry if f in ENGINE_OWNED_FIELDS}
        else:
            if not isinstance(answer, dict):
                raise HTTPException(400, {
                    "error": f"section {section_id!r} is not a repeat section; "
                             "answer must be an object",
                })
            owned_fields |= {f for f in answer if f in ENGINE_OWNED_FIELDS}

    if owned_fields:
        raise HTTPException(400, {
            "error": "engine-owned fields cannot be written via save_draft",
            "fields": sorted(owned_fields),
        })

    try:
        draft = json.loads(instance_row.get("draft_data") or "{}")
    except json.JSONDecodeError:
        draft = {}
    for section_id, answer in section_answers.items():
        section = section_map[section_id]
        if section.repeat is not None:
            draft[section_id] = answer  # replace-list, no per-entry merge
        else:
            existing = draft.setdefault(section_id, {})
            existing.update(answer)

    base = defs.entity_base_data(instance_row)
    base["draft_data"] = json.dumps(draft)
    return dc.dc_update(tenant_id, "workflow_instance", instance_row["entity_id"], base, token,
                        expected_version=row_version(instance_row))


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
    updated = dc.dc_update(tenant_id, "workflow_item", item_row["entity_id"], base, token,
                           expected_version=row_version(item_row))
    _log_activity(tenant_id, instance_row.get("entity_id"), "item_change",
                 old_status, changes.get("status", old_status), actor, token, now)
    return updated


def _require_staff_actor(actor: str) -> None:
    if is_family_actor(actor):
        raise HTTPException(403, "family actor may not perform this action")


# --- complete_item (family or staff; per-kind validation) ------------------


def _entries_word(n: int) -> str:
    return "entry" if n == 1 else "entries"


def _missing_required_fields(step: StepDef, draft: dict) -> list[str]:
    """Missing-field/entry markers for every declared section on `step`,
    checked against `draft` (spec §3: "complete_item ... re-validate
    required fields server-side against the pinned definition version").

    Non-repeat sections: `"{section_id}.{field}"` for every required
    FieldPick whose draft answer is absent/empty.

    Repeat sections (`SectionDef.repeat` set): each STAGED entry is checked
    the same way (required fields per entry); additionally, when
    `repeat.min >= 1` and fewer than `min` entries are staged, that itself
    is reported as `"{section_id} requires at least {min} entry/entries"`
    (both problems can be reported together — a too-short repeat section
    whose few entries are also incomplete lists both).
    """
    missing: list[str] = []
    for raw in step.config.get("sections", []) or []:
        section = SectionDef.model_validate(raw)
        if section.repeat is not None:
            entries = draft.get(section.section_id)
            entries = entries if isinstance(entries, list) else []
            if section.repeat.min >= 1 and len(entries) < section.repeat.min:
                missing.append(
                    f"{section.section_id} requires at least {section.repeat.min} "
                    f"{_entries_word(section.repeat.min)}"
                )
            for entry in entries:
                entry_dict = entry if isinstance(entry, dict) else {}
                for pick in section.fields:
                    if not pick.required:
                        continue
                    if entry_dict.get(pick.name) in _EMPTY_VALUES:
                        missing.append(f"{section.section_id}.{pick.name}")
        else:
            section_draft = draft.get(section.section_id) or {}
            for pick in section.fields:
                if not pick.required:
                    continue
                if section_draft.get(pick.name) in _EMPTY_VALUES:
                    missing.append(f"{section.section_id}.{pick.name}")
    return missing


def _document_belongs_to_instance(tenant_id: str, instance_row: dict, payload_ref: str,
                                   token: str | None) -> bool:
    """True iff `payload_ref` names a `document` row (by `entity_id`) whose
    `application_id` equals THIS instance's `entity_id` (Plan 3 Task 3 — the
    write path that closes the "payload_ref has no write path" gap: spec §4
    "payload_ref must reference a document uploaded to this instance").
    `dc.get_entity` returning `None` (unknown id, or an id belonging to a
    different tenant — lookups are tenant-scoped) is treated the same as a
    cross-instance document: both are "not a valid reference", 409
    `payload_ref_invalid`, not a 404 — the caller supplied a value, it's
    just not usable here."""
    doc = dc.get_entity(tenant_id, "document", payload_ref, token)
    return doc is not None and doc.get("application_id") == instance_row.get("entity_id")


def complete_item(tenant_id: str, instance_row: dict, item_entity_id: str, actor: str, *,
                   token: str | None = None, now: datetime | None = None,
                   payload_ref: str | None = None) -> dict:
    """Family- or staff-completable for every kind (spec §4: "form:
    family/staff complete"; documents and message-ack items follow the same
    open authority — only `verify_item`/`reject_item`/`waive_item` are
    staff-only). Per-kind validation before the status write:

    - `form`: every required field of the step's declared sections must be
      present+non-empty in `draft_data` -> 409 `{"missing": [...]}` naming
      each as `"{section_id}.{field}"`.
    - `documents`: the caller-supplied `payload_ref` kwarg (Plan 3 Task 3;
      threaded from `machine._run_item_builtin`'s `params.get("payload_ref")`)
      OR an already-set `item.payload_ref` (pre-Task-3 callers, e.g. test
      helpers that poke it directly) must be present -> 409
      `{"reason": "payload_ref_missing"}` if both are empty. When the kwarg
      IS supplied, it must resolve to a `document` row of THIS instance
      (`_document_belongs_to_instance`) -> 409 `{"reason":
      "payload_ref_invalid"}` otherwise; on success it is written onto the
      item alongside the status change (same `_update_item` call, so it
      shares that write's CAS precondition — no separate round trip). A
      pre-existing `item.payload_ref` with no fresh kwarg is left as-is
      (nothing new to validate or write).
    - `message-ack`: nothing to validate beyond the item existing.

    Resulting status: `"verified"` if the step's effective `review`
    (`step.review` or `REVIEW_DEFAULTS[step.type]`) is `"auto"`, else
    `"submitted"`. Sets `completed_by = actor` and logs an `item_change`
    activity either way.

    Source-status guard: only callable from `COMPLETABLE_STATUSES`
    (`not_started`/`submitted`/`rejected`) -> 409 otherwise.
    Re-completing a `submitted` item is idempotent-ok (re-answering the same
    form and resubmitting), and completing a `rejected` item is the resubmit
    path after staff sends it back. `verified`/`waived` are terminal from
    complete_item's point of view — re-completing either would silently
    regress a confirmed/waived item, which only `verify_item`/`reject_item`/
    `waive_item` (staff-only) may ever move away from.
    """
    now = _now(now)
    item = _require_item(tenant_id, instance_row, item_entity_id, token)
    current = item.get("status", "not_started")
    if current not in COMPLETABLE_STATUSES:
        raise HTTPException(409, {
            "error": f"cannot complete item from status {current!r}",
            "allowed": sorted(COMPLETABLE_STATUSES),
        })
    steps = _pinned_steps(tenant_id, instance_row, token)
    step = _require_step(steps, item.get("step_id"))

    changes = {"status": None, "completed_by": actor}  # status filled in below

    if step.type == "form":
        try:
            draft = json.loads(instance_row.get("draft_data") or "{}")
        except json.JSONDecodeError:
            draft = {}
        missing = _missing_required_fields(step, draft)
        if missing:
            raise HTTPException(409, {"missing": missing})
    elif step.type == "documents":
        if not (payload_ref or item.get("payload_ref")):
            raise HTTPException(409, {"reason": "payload_ref_missing"})
        if payload_ref is not None:
            if not _document_belongs_to_instance(tenant_id, instance_row, payload_ref, token):
                raise HTTPException(409, {"reason": "payload_ref_invalid"})
            changes["payload_ref"] = payload_ref
    # message-ack: no further validation. Non-documents kinds ignore payload_ref entirely.

    effective_review = step.review or REVIEW_DEFAULTS[step.type]
    changes["status"] = "verified" if effective_review == "auto" else "submitted"

    return _update_item(tenant_id, instance_row, item, changes, actor, token, now)


# --- staff-only review actions ---------------------------------------------


def verify_item(tenant_id: str, instance_row: dict, item_entity_id: str, actor: str, *,
                 token: str | None = None, now: datetime | None = None) -> dict:
    """Staff-only (403 for a family actor). Valid from `submitted` only ->
    409 `{"error": ..., "allowed": [...]}` otherwise (spec §4 authority
    matrix: "verified means confirmed")."""
    now = _now(now)
    _require_staff_actor(actor)
    item = _require_item(tenant_id, instance_row, item_entity_id, token)
    current = item.get("status", ItemStatus.NOT_STARTED)
    if current not in VERIFIABLE_STATUSES:
        raise HTTPException(409, {
            "error": f"cannot verify item from status {current!r}",
            "allowed": sorted(VERIFIABLE_STATUSES),
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
#
# `applicable_items` (and its `_condition_data` helper) now live in
# app.workflows.shared — imported and re-exported at the top of this module.
