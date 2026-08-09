# apexflow/backend/app/workflows/primitives.py
"""Guard and effect primitive registries (Task 7) — the library machine
execution (Task 8) runs transitions' `GuardRef`/`EffectRef`s against.

Spec: docs/superpowers/specs/2026-08-05-apexflow-workflow-platform-design.md
§4 "Engine semantics" (primitive lists, verbatim names/params) and §3
"Steps and declared sections" (link-field injection, `subject_refs` shape,
orphan-tolerant commit). Interface map:
docs/superpowers/plans/2026-08-05-apexflow-plan1-interface-map.md.

IMPORT-CYCLE CONSTRAINT (load-bearing, do not "clean up" by importing
engine.py/definitions.py here): `app.workflows.validate` imports this
module's `GUARDS`/`EFFECTS` to derive its `GUARD_PRIMITIVES`/
`EFFECT_PRIMITIVES` name sets (single source of truth, per this task's
brief). Both `app.workflows.engine` and `app.workflows.definitions` import
`app.workflows.validate` (for `definition_health`/`validate_definition`).
So importing either of those two modules from here would close a cycle:
primitives -> engine -> validate -> primitives. This module therefore only
imports `schema`, `conditions`, `datacore`, `tokens`, `emails`, `shared` —
none of which import `validate` — and gets the handful of small helpers it
needs that otherwise live on `engine`/`definitions` (`is_family_actor`, item
"done" statuses, `applicable_items`, flattened-row -> base_data stripping)
from `app.workflows.shared`, a leaf module built specifically so these
helpers have exactly one implementation instead of being hand-duplicated
per module (code-review follow-up to this task's first pass — see
shared.py's own docstring for the full rationale).

EvalContext.definition is `{"machine": MachineDef, "steps": list[StepDef],
"definition_id": str, "version": int}` — the CALLER (Task 8's action
dispatcher) is responsible for parsing `workflow_definition.machine`/
`.steps` (via `app.workflows.definitions.parse_machine_steps`, which this
module does not have access to) and populating `items`/`draft`/`context`/
`models` before invoking a guard or effect. This module treats all of those
as already-resolved, in-memory data.

DECISIONS this task makes (surfaced prominently in task-7-report.md for
Task 8/9):

1. **Link-field / subject_refs identifier form: DataCore `entity_id`, not
   the business `{model}_id`.** The task brief's default guess was the
   business id; the interface map's own worked example (§1 "entity_id vs.
   business-id trap", citing `enrollx/backend/app/registration/actions.py`
   `_approve`) shows the REAL precedent stamps `student.family_id =
   family_id` where `family_id` is `match_or_create_family(...)`'s return
   value — which is `created["entity_id"]` / the matched candidate's
   `c["entity_id"]`, i.e. DataCore's opaque id, never `FA-XX26####`. Ditto
   `registration_application.student_id = student["entity_id"]`. Followed
   here: `subject_refs` keys are `f"{entity_model}_id"` (matches the spec's
   literal example shape `{student_id?, family_id?, …}`) and their VALUES
   are DataCore entity_ids. # ADJUST(bindings)
2. **`match_or_create` heuristic: minimal, hand-written here, not ported.**
   Task 1 did not port enrollx's `family.py` orchestration (no such module
   exists under `app/workflows/` — confirmed by directory listing before
   this task started). Per this task's brief, a minimal version is
   implemented directly below: `family` matches by exact
   (case-insensitive, whitespace-normalized) `family_name`; `student`
   matches by (`first_name`, `last_name`, `dob`) — same normalization,
   all three must be present and equal. Any other `entity_model` has no
   match strategy and `match_or_create` always creates for it.
   # ADJUST(bindings)
3. **`start_due_clocks`' due-days source: `documents` step config,
   per-doc `due_days_after_state`.** `StepDef` (schema.py) has no
   `due_days` field; the spec's `documents` config shape is `docs: [{name,
   description, sensitive, blocking, due_days_after_state?}]`. Items
   derived from a `documents` step (`engine._derive_item_specs`) carry no
   doc-index/id, only `title = doc["name"]` — so this effect resolves an
   item's due-days value by matching `item["title"]` back against
   `step.config["docs"][i]["name"]`. Non-`documents` steps have no
   due-days concept in the spec and are skipped.
"""
import html
import json
import logging
import re
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Any, Callable

from fastapi import HTTPException

from app.workflows import datacore as dc
from app.workflows.conditions import evaluate_condition
from app.workflows.emails import send_email
from app.workflows.rows import WorkflowItem
from app.workflows.schema import ConditionGroup, ENGINE_OWNED_FIELDS, SectionDef, StepDef
from app.workflows.shared import (
    ITEM_DONE_STATUSES,
    applicable_items,
    as_bool,
    condition_data,
    entity_base_data,
    is_family_actor,
)
from app.workflows.tokens import make_link_token

logger = logging.getLogger("apexflow.primitives")

_EMPTY_VALUES = (None, "", [], {})


# --- EvalContext -------------------------------------------------------


@dataclass
class EvalContext:
    """Everything a guard/effect primitive needs, assembled by the caller
    (Task 8's action dispatcher) before evaluating one transition's guards
    or applying its effects.

    `instance` is the FLATTENED row shape (`dc.get_entity`/`list_entities`'s
    return value — see engine.py's row-shape convention note), never the
    create/update envelope. `items` are those same flattened rows PARSED
    into `rows.WorkflowItem` (typed `status`, real `bool` `blocking`, int
    `version`), so guards read attributes rather than stringly-typed keys.
    Effects that mutate an entity also update the corresponding in-memory
    object here (`instance`'s dict, an `items` entry's fields) so later
    guards/effects in the SAME action see the change without a re-fetch —
    the spec's "applies effects atomically-per-entity" wording. That is why
    `WorkflowItem` must stay mutable.

    `issued_link` is a side-channel the `issue_link` effect writes to
    (nothing is stored beyond the instance's existing `token_version`) —
    the caller reads it off `ctx` after running effects to surface the
    minted token to whichever route triggered the action.

    `item_result` (Task 8): a second side-channel, written by
    `app.workflows.machine`'s item-built-in dispatch (`complete_item`/
    `verify_item`/`reject_item`/`waive_item`) to the updated `workflow_item`
    dc_update envelope, or left `None` for every other action (including
    `save_draft`, which mutates the instance, not an item). Lets
    `execute_action`'s return type stay "the instance row" (per its own
    Produces contract) while still giving `api/instances.py`'s route a way
    to surface the item op's result under the response's `"item"` key
    without a second DataCore round-trip.
    """

    tenant_id: str
    instance: dict
    items: list[WorkflowItem]
    definition: dict  # {"machine": MachineDef, "steps": list[StepDef], "definition_id": str, "version": int}
    draft: dict
    context: dict
    models: dict[str, Any]  # entity_type -> {"base_fields": [...], "custom_fields": [...]}
    actor: str
    now: datetime
    token: str | None = None
    issued_link: str | None = None
    item_result: dict | None = None


# --- small EvalContext-flavored wrappers around app.workflows.shared -----


def _applicable_items(ctx: EvalContext) -> list[WorkflowItem]:
    """Thin wrapper: `shared.applicable_items` takes its four inputs
    explicitly (engine.py's original signature); here they all live on one
    `EvalContext`."""
    return applicable_items(ctx.definition["steps"], ctx.items, ctx.draft, ctx.context)


def _row_version(row: dict) -> int | None:
    """Local duplicate of `engine.row_version` — see this module's docstring
    (IMPORT-CYCLE CONSTRAINT) for why `engine.py` can't be imported here.
    Every write below that round-trips `ctx.instance`/an item row passes
    `expected_version=_row_version(row)` (Plan 3 Task 2's CAS precondition),
    and refreshes the row's `_version` from the write's return envelope
    afterward so a LATER write in the same transition (e.g. `_write_state`
    after an effect's own instance write) uses the current version, not a
    stale one from context-assembly time."""
    return _as_version(row.get("_version"))


def _as_version(raw: Any) -> int | None:
    """`_version` as an int, tolerating DataCore's stringified scalars."""
    try:
        return int(raw) if raw not in (None, "") else None
    except (TypeError, ValueError):
        return None


def _parse_json(raw: Any) -> dict:
    if isinstance(raw, dict):
        return raw
    if not raw:
        return {}
    try:
        parsed = json.loads(raw)
    except (TypeError, json.JSONDecodeError):
        return {}
    return parsed if isinstance(parsed, dict) else {}


# --- guard primitives ----------------------------------------------------


def _guard_all_blocking_items_complete(ctx: EvalContext, params: dict) -> bool:
    items = _applicable_items(ctx)
    blocking = [i for i in items if i.blocking]
    return all(i.status in ITEM_DONE_STATUSES for i in blocking)


def _guard_items_in_status(ctx: EvalContext, params: dict) -> bool:
    """`items_in_status{step_ids?, status, quantifier?}` — true iff the
    quantifier ("all", default, or "any") of the applicable
    (optionally step_ids-scoped) items has a status IN `status` (a single
    status string, preserving Task 7's original shape, or a list of
    acceptable statuses).

    # ADJUST(bindings) (Task 9): extended beyond Task 7's original
    single-status/ALL-only shape in two ways, both needed by the enrollment
    template and neither a new primitive name (per this task's accumulated
    decisions — "Do NOT invent a new primitive name"):
    - `status` may be a list (e.g. `["verified", "waived"]` for
      `approved -> enrolled`'s post-approval tier — no single status value
      can express "verified OR waived").
    - `quantifier: "all"|"any"` (default `"all"`, so every existing
      caller/test — which never passed this key — is unaffected):
      `in_review -> pending_items` needs `"any"` ("ANY item rejected"; the
      default `"all"` would require EVERY applicable item to be rejected,
      which a single staff `reject_item` call on one item never makes true).
    """
    raw_status = params["status"]
    statuses = set(raw_status) if isinstance(raw_status, list) else {raw_status}
    quantifier = params.get("quantifier", "all")
    step_ids = params.get("step_ids")
    items = _applicable_items(ctx)
    if step_ids:
        step_id_set = set(step_ids)
        items = [i for i in items if i.step_id in step_id_set]
    if quantifier == "any":
        return any(i.status in statuses for i in items)
    return all(i.status in statuses for i in items)


def _guard_capacity_available(ctx: EvalContext, params: dict) -> bool:
    capacity_field = params["capacity_field"]
    tenant_row = dc.get_entity(ctx.tenant_id, "tenant", ctx.tenant_id, ctx.token)
    raw_capacity = (tenant_row or {}).get(capacity_field)
    try:
        capacity = int(raw_capacity) if raw_capacity not in (None, "", "None") else 0
    except (TypeError, ValueError):
        capacity = 0
    if not capacity:
        return True  # missing/0/None capacity -> unlimited

    count_states = set(params.get("count_states") or [])
    scope_key = params.get("scope_context_key")
    scope_value = ctx.context.get(scope_key) if scope_key else None
    lineage_id = ctx.definition["definition_id"]
    self_entity_id = ctx.instance.get("entity_id")

    rows = dc.list_entities(ctx.tenant_id, "workflow_instance", "", ctx.token)
    count = 0
    for row in rows:
        if row.get("entity_id") == self_entity_id:
            # The evaluating instance never counts against its own capacity
            # check — a guard invoked while the instance's OWN current state
            # is already one of count_states (e.g. re-evaluating a
            # transition out of an approved-like state) must not have that
            # row inflate the count it's being measured against.
            continue
        if str(row.get("definition_id", "")) != str(lineage_id):
            continue
        if row.get("state") not in count_states:
            continue
        if scope_key:
            row_context = _parse_json(row.get("context"))
            if row_context.get(scope_key) != scope_value:
                continue
        count += 1
    return count < capacity  # exactly-at-capacity -> False


def _guard_data_condition(ctx: EvalContext, params: dict) -> bool:
    group = ConditionGroup.model_validate(params.get("condition"))
    data = condition_data(ctx.draft, ctx.context)
    return evaluate_condition(group, data)


def _parse_date_bound(value: str, *, end_of_day: bool) -> datetime:
    dt = datetime.strptime(value, "%Y-%m-%d").replace(tzinfo=timezone.utc)
    if end_of_day:
        dt = dt.replace(hour=23, minute=59, second=59, microsecond=999999)
    return dt


def _guard_date_window(ctx: EvalContext, params: dict) -> bool:
    start = params.get("start")
    end = params.get("end")
    if start and ctx.now < _parse_date_bound(start, end_of_day=False):
        return False
    if end and ctx.now > _parse_date_bound(end, end_of_day=True):
        return False
    return True


def _guard_actor_role(ctx: EvalContext, params: dict) -> bool:
    """"family" matches family actors; "staff"/"admin" both match any
    non-family actor — Phase 1 has no finer role data in EvalContext (no
    staff role/permission set is threaded through), so the two are
    indistinguishable here. Documented for Task 8/9: a machine authored
    with `actor_role{roles:["admin"]}` will currently pass for ANY staff
    user_id, not just admins."""
    roles = params.get("roles") or []
    is_family = is_family_actor(ctx.actor)
    for role in roles:
        if role == "family" and is_family:
            return True
        if role in ("staff", "admin") and not is_family:
            return True
    return False


GUARDS: dict[str, Callable[[EvalContext, dict], bool]] = {
    "all_blocking_items_complete": _guard_all_blocking_items_complete,
    "items_in_status": _guard_items_in_status,
    "capacity_available": _guard_capacity_available,
    "data_condition": _guard_data_condition,
    "date_window": _guard_date_window,
    "actor_role": _guard_actor_role,
}


# --- effect primitives: shared commit_sections helpers --------------------


def _norm(v: Any) -> str:
    return re.sub(r"\s+", " ", str(v or "").strip()).lower()


def _match_family_by_name(payload: dict, candidates: list[dict]) -> str | None:
    name = _norm(payload.get("family_name"))
    if not name:
        return None
    for c in candidates:
        if _norm(c.get("family_name")) == name:
            return c["entity_id"]
    return None


def _match_student_by_name_dob(payload: dict, candidates: list[dict]) -> str | None:
    key = (_norm(payload.get("first_name")), _norm(payload.get("last_name")), _norm(payload.get("dob")))
    if not any(key):
        return None
    for c in candidates:
        ckey = (_norm(c.get("first_name")), _norm(c.get("last_name")), _norm(c.get("dob")))
        if ckey == key:
            return c["entity_id"]
    return None


# See module docstring, decision 2, for why this is minimal/hand-written
# rather than a ported orchestration.
_MATCH_STRATEGIES: dict[str, Callable[[dict, list[dict]], str | None]] = {
    "family": _match_family_by_name,
    "student": _match_student_by_name_dob,
}


def _match_or_create(tenant_id: str, entity_model: str, payload: dict, token: str | None) -> str:
    strategy = _MATCH_STRATEGIES.get(entity_model)
    if strategy is not None:
        candidates = dc.list_entities(tenant_id, entity_model, "", token)
        matched = strategy(payload, candidates)
        if matched:
            return matched
    created = dc.dc_create(tenant_id, entity_model, payload, token)
    return created["entity_id"]


def _declared_sections_in_order(steps: list[StepDef]) -> list[tuple[StepDef, SectionDef]]:
    """Every declared section across `form` steps, in the definition's
    declaration order (steps in list order, then each step's
    `config["sections"]` in list order) — mirrors validate.py's
    `_iter_sections` / engine.py's `_section_map` (each module keeps its
    own copy of this small walk; see this module's docstring for why this
    one can't just import theirs)."""
    out: list[tuple[StepDef, SectionDef]] = []
    for step in steps:
        if step.type != "form":
            continue
        for raw in step.config.get("sections", []) or []:
            out.append((step, SectionDef.model_validate(raw)))
    return out


def _missing_section_fields(section: SectionDef, entry: dict) -> list[str]:
    return [pick.name for pick in section.fields
            if pick.required and entry.get(pick.name) in _EMPTY_VALUES]


def _model_field_names(model_def: dict | None) -> set[str]:
    if not model_def:
        return set()
    names = {f["name"] for f in model_def.get("base_fields", []) or []}
    names |= {f["name"] for f in model_def.get("custom_fields", []) or []}
    return names


def _section_payload(section: SectionDef, entry: dict, resolved: dict, model_def: dict | None) -> dict:
    """Picked fields present in `entry` (orphan-tolerant: NOT filtered by
    whether `model_def` still declares them — a field the model no longer
    has is still written, per spec "Model evolution": "the commit still
    writes it"), minus any engine-owned field name (defense in depth —
    `save_draft` already rejects these, this strips again before the
    write), plus link-field injection: for every earlier-resolved
    `{entity_model}_id` in `resolved` whose value is a single id (not a
    repeat section's list) and whose key IS a field the current model
    declares, stamp it."""
    payload = {pick.name: entry[pick.name] for pick in section.fields if pick.name in entry}
    payload = {k: v for k, v in payload.items() if k not in ENGINE_OWNED_FIELDS}

    self_key = f"{section.entity_model}_id"
    declared = _model_field_names(model_def)
    for ref_key, value in resolved.items():
        if ref_key == self_key or isinstance(value, list):
            continue
        if ref_key in declared:
            payload[ref_key] = value
    return payload


def _write_section_entity(tenant_id: str, entity_model: str, mode: str, payload: dict,
                          token: str | None) -> str:
    if mode == "match_or_create":
        return _match_or_create(tenant_id, entity_model, payload, token)
    created = dc.dc_create(tenant_id, entity_model, payload, token)
    return created["entity_id"]


def _persist_subject_refs(ctx: EvalContext, resolved: dict) -> None:
    """Called once per section inside `_effect_commit_sections`'s loop — each
    call must precondition on and then refresh `ctx.instance["_version"]`
    (not just once at the end), or the SECOND section's persist call would
    409 against the FIRST section's already-applied write."""
    encoded = json.dumps(resolved)
    base = entity_base_data(ctx.instance)
    base["subject_refs"] = encoded
    updated = dc.dc_update(ctx.tenant_id, "workflow_instance", ctx.instance["entity_id"], base,
                           ctx.token, expected_version=_row_version(ctx.instance))
    ctx.instance["subject_refs"] = encoded
    if "_version" in updated:
        ctx.instance["_version"] = updated["_version"]


def _effect_commit_sections(ctx: EvalContext, params: dict) -> None:
    """Commits declared sections in DEFINITION declaration order (filtered
    to `params["section_ids"]`, not the order given in that list — spec:
    "Sections commit in declaration order"). `subject_refs` is persisted
    to the instance after EACH section (not once at the end): a required-
    field 409 partway through leaves earlier sections' entities created and
    recorded, matching the spec's "applies effects atomically-per-entity"
    (atomicity is per entity, not across the whole commit_sections call)."""
    section_ids = params.get("section_ids") or []
    declared = _declared_sections_in_order(ctx.definition["steps"])
    targets = [(step, section) for step, section in declared if section.section_id in section_ids]

    resolved = _parse_json(ctx.instance.get("subject_refs"))

    for step, section in targets:
        entity_model = section.entity_model
        raw_answer = ctx.draft.get(section.section_id)
        model_def = ctx.models.get(entity_model)
        key = f"{entity_model}_id"

        if section.repeat is not None:
            entries = raw_answer if isinstance(raw_answer, list) else []
            entry_ids: list[str] = []
            for idx, raw_entry in enumerate(entries):
                entry = raw_entry if isinstance(raw_entry, dict) else {}
                missing = _missing_section_fields(section, entry)
                if missing:
                    raise HTTPException(409, {
                        "missing": [f"{section.section_id}[{idx}].{f}" for f in missing],
                    })
                payload = _section_payload(section, entry, resolved, model_def)
                entry_ids.append(
                    _write_section_entity(ctx.tenant_id, entity_model, section.mode, payload, ctx.token)
                )
            resolved[key] = entry_ids
        else:
            entry = raw_answer if isinstance(raw_answer, dict) else {}
            missing = _missing_section_fields(section, entry)
            if missing:
                raise HTTPException(409, {
                    "missing": [f"{section.section_id}.{f}" for f in missing],
                })
            payload = _section_payload(section, entry, resolved, model_def)
            resolved[key] = _write_section_entity(ctx.tenant_id, entity_model, section.mode,
                                                   payload, ctx.token)

        _persist_subject_refs(ctx, resolved)


def _effect_set_entity_field(ctx: EvalContext, params: dict) -> None:
    ref = params["ref"]
    field = params["field"]
    value = params.get("value")

    if ref == "instance":
        base = entity_base_data(ctx.instance)
        base[field] = value
        updated = dc.dc_update(ctx.tenant_id, "workflow_instance", ctx.instance["entity_id"], base,
                               ctx.token, expected_version=_row_version(ctx.instance))
        ctx.instance[field] = value
        if "_version" in updated:
            ctx.instance["_version"] = updated["_version"]
        return

    # ref != "instance": writes an arbitrary resolved entity (student,
    # family, ...) from `subject_refs`, NOT a workflow_instance/workflow_item
    # row — out of Plan 3 Task 2's scope (its brief: "entity-model commits
    # ... are NOT preconditioned"; this is the same category of write,
    # a resolved-entity update rather than a commit_sections create, but
    # still not an instance/item round-trip). Left unpreconditioned.
    resolved = _parse_json(ctx.instance.get("subject_refs"))
    entity_id = resolved.get(f"{ref}_id")
    if not entity_id or isinstance(entity_id, list):
        raise HTTPException(409, {"error": f"set_entity_field: no resolved entity for ref {ref!r}"})

    row = dc.get_entity(ctx.tenant_id, ref, entity_id, ctx.token)
    if row is None:
        raise HTTPException(409, {
            "error": f"set_entity_field: resolved entity {entity_id!r} for ref {ref!r} not found",
        })
    base = entity_base_data(row)
    base[field] = value
    dc.dc_update(ctx.tenant_id, ref, entity_id, base, ctx.token)


def _log_activity(ctx: EvalContext, type_: str, from_value: str, to_value: str) -> None:
    """Local duplicate of engine._log_activity's write shape — see module
    docstring for why this doesn't just import engine.py."""
    activity_id = dc.next_id(ctx.tenant_id, "workflow_activity", ctx.token)
    dc.dc_create(ctx.tenant_id, "workflow_activity", {
        "activity_id": activity_id,
        "workflow_activity_id": activity_id,
        "instance_id": ctx.instance.get("entity_id"),
        "type": type_,
        "from_value": from_value or "",
        "to_value": to_value or "",
        "actor": ctx.actor,
        "at": ctx.now.isoformat(),
    }, ctx.token)


def _render_template(template: str, ctx: EvalContext) -> tuple[str, str]:
    """Placeholder renderer — no per-`template`-name content library
    exists yet (emails.py's docstring: the four registration-era v1
    templates were dropped on purpose, "a later task can reintroduce
    ... once that engine exists"). Renders a generic status-update notice
    so `send_email`'s no-op/escaping/activity-log contract is testable now;
    Task 8/9 (or a template-authoring task) should replace this with real
    per-template copy. Every interpolated value is `html.escape()`d — the
    Plan 3 escaping gap (raw interpolation into email HTML) must not recur.
    # ADJUST(bindings)
    """
    state = html.escape(str(ctx.instance.get("state", "")))
    template_label = html.escape(str(template))
    subject = f"Update on your application ({template_label})"
    body_html = f"<p>Your application status is now: <strong>{state}</strong>.</p>"
    return subject, body_html


def _effect_send_email(ctx: EvalContext, params: dict) -> None:
    template = params.get("template", "")
    recipient = ctx.instance.get("applicant_email")
    if not recipient:
        logger.warning(
            "send_email effect no-op: instance %s has no applicant_email (template=%r)",
            ctx.instance.get("entity_id"), template,
        )
        return
    subject, body_html = _render_template(template, ctx)
    outcome = send_email(recipient, subject, body_html)  # never raises; degrades to "logged"/"failed"
    _log_activity(ctx, "email_sent", "", f"{template}:{recipient}:{outcome}")


def _effect_issue_link(ctx: EvalContext, params: dict) -> None:
    try:
        token_version = int(ctx.instance.get("token_version") or 1)
    except (TypeError, ValueError):
        token_version = 1
    ctx.issued_link = make_link_token(ctx.tenant_id, ctx.instance["entity_id"], token_version)


def _due_days_for_item(step: StepDef, item: WorkflowItem) -> Any:
    for doc in step.config.get("docs", []) or []:
        if doc.get("name", "") == item.title:
            return doc.get("due_days_after_state")
    return None


def _effect_start_due_clocks(ctx: EvalContext, params: dict) -> None:
    step_ids = set(params.get("step_ids") or [])
    steps_by_id = {s.step_id: s for s in ctx.definition["steps"]}
    for item in ctx.items:
        if item.step_id not in step_ids or item.due_at:
            continue
        step = steps_by_id.get(item.step_id)
        if step is None or step.type != "documents":
            continue
        due_days = _due_days_for_item(step, item)
        if due_days in _EMPTY_VALUES:
            continue
        try:
            days = int(due_days)
        except (TypeError, ValueError):
            continue
        due_at = (ctx.now + timedelta(days=days)).isoformat()
        base = entity_base_data(item.raw)
        base["due_at"] = due_at
        updated = dc.dc_update(ctx.tenant_id, "workflow_item", item.entity_id, base, ctx.token,
                               expected_version=item.version)
        # In place, so later guards/effects in the SAME action see the new
        # due_at and the refreshed version without a re-fetch.
        item.due_at = due_at
        item.raw["due_at"] = due_at
        if "_version" in updated:
            item.version = _as_version(updated["_version"])
            item.raw["_version"] = updated["_version"]


def _effect_set_context(ctx: EvalContext, params: dict) -> None:
    """The canonical intra-transition sequencing-hazard effect (Plan 3 Task
    2 brief): when this effect runs before `machine.py::_write_state` in the
    SAME transition, this write's refreshed `_version` is what
    `_write_state`'s own precondition must see, not the stale version
    `ctx.instance` carried at context-assembly time."""
    key = params["key"]
    value = params.get("value")
    context = dict(ctx.context)
    context[key] = value
    encoded = json.dumps(context)
    base = entity_base_data(ctx.instance)
    base["context"] = encoded
    updated = dc.dc_update(ctx.tenant_id, "workflow_instance", ctx.instance["entity_id"], base,
                           ctx.token, expected_version=_row_version(ctx.instance))
    ctx.context[key] = value
    ctx.instance["context"] = encoded
    if "_version" in updated:
        ctx.instance["_version"] = updated["_version"]


EFFECTS: dict[str, Callable[[EvalContext, dict], None]] = {
    "commit_sections": _effect_commit_sections,
    "set_entity_field": _effect_set_entity_field,
    "send_email": _effect_send_email,
    "issue_link": _effect_issue_link,
    "start_due_clocks": _effect_start_due_clocks,
    "set_context": _effect_set_context,
}
