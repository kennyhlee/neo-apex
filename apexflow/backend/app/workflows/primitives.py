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
imports `schema`, `conditions`, `datacore`, `tokens`, `emails`, `config` —
none of which import `validate` — and reimplements the handful of small
helpers it needs that otherwise live on `engine`/`definitions`
(`is_family_actor`, item "done" statuses, `applicable_items`'s condition-data
flattening, and flattened-row -> base_data stripping). Each duplicate is
commented at its definition with the canonical copy it mirrors.

EvalContext.definition is `{"machine": MachineDef, "steps": list[StepDef],
"definition_id": str, "version": int}` — the CALLER (Task 8's action
dispatcher) is responsible for parsing `workflow_definition.machine`/
`.steps` (via `app.workflows.definitions._parse_machine_steps`, which this
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
from app.workflows.schema import ConditionGroup, ENGINE_OWNED_FIELDS, SectionDef, StepDef
from app.workflows.tokens import make_link_token

logger = logging.getLogger("apexflow.primitives")

_EMPTY_VALUES = (None, "", [], {})
_TRUTHY_STRINGS = {"true", "1", "yes"}

# Mirrors engine.ITEM_DONE_STATUSES exactly (duplicated, not imported — see
# module docstring's import-cycle note).
ITEM_DONE_STATUSES = frozenset({"submitted", "verified", "waived"})

# Flattened-row columns that are never part of base_data — mirrors
# definitions.py's SYSTEM_COLS (duplicated for the same reason).
_SYSTEM_COLS = {"entity_id", "entity_type", "base_data", "custom_fields", "vector", "_tenant"}


# --- EvalContext -------------------------------------------------------


@dataclass
class EvalContext:
    """Everything a guard/effect primitive needs, assembled by the caller
    (Task 8's action dispatcher) before evaluating one transition's guards
    or applying its effects.

    `instance`/`items` are the FLATTENED row shape (`dc.get_entity`/
    `list_entities`'s return value — see engine.py's row-shape convention
    note), never the create/update envelope. Effects that mutate an entity
    also update the corresponding in-memory dict here (`instance`, an
    `items` entry) so later guards/effects in the SAME action see the
    change without a re-fetch — the spec's "applies effects atomically-per-
    entity" wording.

    `issued_link` is a side-channel the `issue_link` effect writes to
    (nothing is stored beyond the instance's existing `token_version`) —
    the caller reads it off `ctx` after running effects to surface the
    minted token to whichever route triggered the action.
    """

    tenant_id: str
    instance: dict
    items: list[dict]
    definition: dict  # {"machine": MachineDef, "steps": list[StepDef], "definition_id": str, "version": int}
    draft: dict
    context: dict
    models: dict[str, Any]  # entity_type -> {"base_fields": [...], "custom_fields": [...]}
    actor: str
    now: datetime
    token: str | None = None
    issued_link: str | None = None


# --- small local duplicates of engine.py/definitions.py helpers --------
# (see module docstring for why these are copies, not imports)


def _is_family_actor(actor: str) -> bool:
    """Duplicate of engine.is_family_actor — same exact-prefix contract."""
    return actor == "family" or actor.startswith("family:")


def _as_bool(v: Any) -> bool:
    """Duplicate of engine._as_bool (interface map Gotcha C: a flattened
    query row's bool field reads back as the STRING "false"/"true")."""
    if isinstance(v, bool):
        return v
    if v is None:
        return False
    return str(v).strip().lower() in _TRUTHY_STRINGS


def _base_data(row: dict) -> dict:
    """Duplicate of definitions.entity_base_data — flattened row -> a dict
    safe to hand to `dc.dc_update` as a full-replace `base_data` payload."""
    return {k: v for k, v in row.items()
            if k not in _SYSTEM_COLS and not k.startswith("_") and v is not None}


def _condition_data(draft: dict, context: dict) -> dict[str, Any]:
    """Duplicate of engine._condition_data. Repeat sections (list-shaped
    draft answers) contribute nothing — see that function's docstring for
    the full rationale; unchanged here."""
    data: dict[str, Any] = {}
    for section_id, fields in (draft or {}).items():
        if not isinstance(fields, dict):
            continue
        for field, value in fields.items():
            data[f"{section_id}.{field}"] = value
    for key, value in (context or {}).items():
        data[f"context.{key}"] = value
    return data


def _applicable_items(ctx: EvalContext) -> list[dict]:
    """Duplicate of engine.applicable_items, specialized to read straight
    off an EvalContext."""
    data = _condition_data(ctx.draft, ctx.context)
    steps_by_id = {s.step_id: s for s in ctx.definition["steps"]}
    result = []
    for item in ctx.items:
        step = steps_by_id.get(item.get("step_id"))
        if step is None or step.show_if is None:
            result.append(item)
            continue
        if evaluate_condition(step.show_if, data):
            result.append(item)
    return result


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
    blocking = [i for i in items if _as_bool(i.get("blocking"))]
    return all(i.get("status") in ITEM_DONE_STATUSES for i in blocking)


def _guard_items_in_status(ctx: EvalContext, params: dict) -> bool:
    status = params["status"]
    step_ids = params.get("step_ids")
    items = _applicable_items(ctx)
    if step_ids:
        step_id_set = set(step_ids)
        items = [i for i in items if i.get("step_id") in step_id_set]
    return all(i.get("status") == status for i in items)


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

    rows = dc.list_entities(ctx.tenant_id, "workflow_instance", "", ctx.token)
    count = 0
    for row in rows:
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
    data = _condition_data(ctx.draft, ctx.context)
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
    is_family = _is_family_actor(ctx.actor)
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
    encoded = json.dumps(resolved)
    base = _base_data(ctx.instance)
    base["subject_refs"] = encoded
    dc.dc_update(ctx.tenant_id, "workflow_instance", ctx.instance["entity_id"], base, ctx.token)
    ctx.instance["subject_refs"] = encoded


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
        base = _base_data(ctx.instance)
        base[field] = value
        dc.dc_update(ctx.tenant_id, "workflow_instance", ctx.instance["entity_id"], base, ctx.token)
        ctx.instance[field] = value
        return

    resolved = _parse_json(ctx.instance.get("subject_refs"))
    entity_id = resolved.get(f"{ref}_id")
    if not entity_id or isinstance(entity_id, list):
        raise HTTPException(409, {"error": f"set_entity_field: no resolved entity for ref {ref!r}"})

    row = dc.get_entity(ctx.tenant_id, ref, entity_id, ctx.token)
    if row is None:
        raise HTTPException(409, {
            "error": f"set_entity_field: resolved entity {entity_id!r} for ref {ref!r} not found",
        })
    base = _base_data(row)
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


def _due_days_for_item(step: StepDef, item: dict) -> Any:
    for doc in step.config.get("docs", []) or []:
        if doc.get("name", "") == item.get("title"):
            return doc.get("due_days_after_state")
    return None


def _effect_start_due_clocks(ctx: EvalContext, params: dict) -> None:
    step_ids = set(params.get("step_ids") or [])
    steps_by_id = {s.step_id: s for s in ctx.definition["steps"]}
    for item in ctx.items:
        if item.get("step_id") not in step_ids or item.get("due_at"):
            continue
        step = steps_by_id.get(item.get("step_id"))
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
        base = _base_data(item)
        base["due_at"] = due_at
        dc.dc_update(ctx.tenant_id, "workflow_item", item["entity_id"], base, ctx.token)
        item["due_at"] = due_at


def _effect_set_context(ctx: EvalContext, params: dict) -> None:
    key = params["key"]
    value = params.get("value")
    context = dict(ctx.context)
    context[key] = value
    encoded = json.dumps(context)
    base = _base_data(ctx.instance)
    base["context"] = encoded
    dc.dc_update(ctx.tenant_id, "workflow_instance", ctx.instance["entity_id"], base, ctx.token)
    ctx.context[key] = value
    ctx.instance["context"] = encoded


EFFECTS: dict[str, Callable[[EvalContext, dict], None]] = {
    "commit_sections": _effect_commit_sections,
    "set_entity_field": _effect_set_entity_field,
    "send_email": _effect_send_email,
    "issue_link": _effect_issue_link,
    "start_due_clocks": _effect_start_due_clocks,
    "set_context": _effect_set_context,
}
