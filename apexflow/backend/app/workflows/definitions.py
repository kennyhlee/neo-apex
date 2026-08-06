# apexflow/backend/app/workflows/definitions.py
"""Service functions backing the definitions API (Task 5): publish + lineage
lifecycle actions, model-impact scanning, and `get_published_definition`
(Task 6's binding read path).

No FastAPI/route concerns live here (that's app/api/definitions.py) — this
module talks to DataCore via app.workflows.datacore and raises HTTPException
directly for the same reason enrollx/backend/app/registration/engine.py does
(e.g. `require_application`): the 404/409 *is* the domain outcome, not an
HTTP-layer translation of one.

Spec: docs/superpowers/specs/2026-08-05-apexflow-workflow-platform-design.md
§3 "Definition lifecycle" / "Model evolution". Row vs. lineage identity
(interface map Gotcha A, generalized): the workflow_definition ROW is
addressed by DataCore's opaque `entity_id`; the LINEAGE (all versions of one
authored workflow) is identified by the business-style `base_data.definition_id`,
which is constant across a lineage's draft/published/superseded rows while
`entity_id` and `version` change per row.
"""
import json
from typing import Any

from fastapi import HTTPException

from app.workflows import datacore as dc
from app.workflows.schema import ConditionGroup, MachineDef, SectionDef, StepDef
from app.workflows.validate import validate_definition

# Columns a flattened DataCore query row carries that are NOT part of
# base_data — same set enrollx/backend/app/registration/engine.py's
# entity_base_data strips (interface map's "entity_base_data" precedent).
SYSTEM_COLS = {"entity_id", "entity_type", "base_data", "custom_fields", "vector", "_tenant"}


def entity_base_data(row: dict) -> dict:
    """Rebuild a full base_data dict from a flattened query row, dropping
    system columns, other-entity-type null padding, and any `_`-prefixed
    column — precedent: enrollx engine.py::entity_base_data. DataCore's PUT
    is a full replace, so any caller writing back ONE changed field must
    round-trip every other field through this helper first, or lose them.

    No boolean-field coercion table here (unlike the enrollx precedent):
    every workflow_definition base field is str/number/selection per
    launchpad's base_model.json — none are declared `"type": "bool"` — so
    there is nothing to coerce back from the flattened "true"/"false" string
    representation.
    """
    return {k: v for k, v in row.items()
            if k not in SYSTEM_COLS and not k.startswith("_") and v is not None}


def _parse_machine_steps(row: dict) -> tuple[MachineDef, list[StepDef]]:
    """`machine`/`steps` are stored JSON-serialized string fields (task
    brief, `registration_config.blocks` precedent) — decode then validate
    against the Task 3 schemas."""
    machine_raw = row.get("machine")
    steps_raw = row.get("steps")
    machine_dict = json.loads(machine_raw) if isinstance(machine_raw, str) else (machine_raw or {})
    steps_list = json.loads(steps_raw) if isinstance(steps_raw, str) else (steps_raw or [])
    machine = MachineDef.model_validate(machine_dict)
    steps = [StepDef.model_validate(s) for s in steps_list]
    return machine, steps


def _referenced_entity_models(steps: list[StepDef]) -> set[str]:
    """Every `entity_model` named by a declared section across `form`
    steps — the set of models publish must fetch to build validate_definition's
    `models` argument (task brief: "fetch via get_model_definition for each
    entity_model referenced by sections")."""
    models: set[str] = set()
    for step in steps:
        if step.type != "form":
            continue
        for raw in step.config.get("sections", []) or []:
            models.add(SectionDef.model_validate(raw).entity_model)
    return models


def _fetch_models(tenant_id: str, entity_types: set[str], token: str | None) -> dict[str, Any]:
    return {et: dc.get_model_definition(tenant_id, et, token) for et in sorted(entity_types)}


def _require_definition_row(tenant_id: str, entity_id: str, token: str | None = None) -> dict:
    """Load one workflow_definition row by DataCore entity_id, scoped to
    `tenant_id` (get_entity already tenant-scopes via list_entities). 404 if
    absent — this is also what makes a business-id-shaped `entity_id` (the
    Plan 4 contract test, generalized) 404 rather than silently matching:
    `entity_id` equality never matches `definition_id`'s value."""
    row = dc.get_entity(tenant_id, "workflow_definition", entity_id, token)
    if row is None:
        raise HTTPException(404, "workflow_definition not found")
    return row


def get_published_definition(tenant_id: str, lineage_definition_id: str,
                              token: str | None = None) -> dict | None:
    """The tenant's currently published row for one lineage, or None.

    BINDING for Task 6 (`create_instance` reads lineage `active`ness and the
    pinned machine/steps through this). Filtered in Python (rows_matching
    pattern, enrollx engine.py precedent) rather than a SQL `where` naming
    `definition_id`/`status`: on a brand-new tenant those flattened columns
    may not exist yet, and a `where` predicate on an unmaterialized column is
    a DuckDB binder error (400), not an empty result.
    """
    rows = dc.list_entities(tenant_id, "workflow_definition", "", token)
    rows = [r for r in rows if str(r.get("definition_id", "")) == str(lineage_definition_id)]
    rows = [r for r in rows if r.get("status") == "published"]
    return rows[0] if rows else None


def publish_definition(tenant_id: str, entity_id: str, token: str | None = None) -> dict:
    """Validate and publish one draft row.

    404 if the row doesn't exist for this tenant (business-id-instead-of-
    entity-id included). 409 with `{"errors": [...]}` on validation failure
    — the row is NEVER touched in that path, so it stays exactly as it was
    (draft, most commonly). On success: supersede the prior published row of
    the same lineage (if any, and if it isn't this same row), flip this row
    to `status="published"`, and return the updated row.
    """
    row = _require_definition_row(tenant_id, entity_id, token)

    machine, steps = _parse_machine_steps(row)
    models = _fetch_models(tenant_id, _referenced_entity_models(steps), token)
    errors = validate_definition(machine, steps, models)
    if errors:
        raise HTTPException(409, {"errors": errors})

    lineage_id = row.get("definition_id")
    prior_published = get_published_definition(tenant_id, lineage_id, token)
    if prior_published and prior_published.get("entity_id") != entity_id:
        prior_base = entity_base_data(prior_published)
        prior_base["status"] = "superseded"
        dc.dc_update(tenant_id, "workflow_definition", prior_published["entity_id"],
                    prior_base, token)

    base = entity_base_data(row)
    base["status"] = "published"
    return dc.dc_update(tenant_id, "workflow_definition", entity_id, base, token)


def _set_lineage_status(tenant_id: str, entity_id: str, new_lineage_status: str,
                         token: str | None = None) -> dict:
    row = _require_definition_row(tenant_id, entity_id, token)
    base = entity_base_data(row)
    base["lineage_status"] = new_lineage_status
    return dc.dc_update(tenant_id, "workflow_definition", entity_id, base, token)


def deprecate_definition(tenant_id: str, entity_id: str, token: str | None = None) -> dict:
    """lineage_status -> deprecated. Reversible (spec §3): stops new
    instances, in-flight instances and their magic links continue."""
    return _set_lineage_status(tenant_id, entity_id, "deprecated", token)


def reactivate_definition(tenant_id: str, entity_id: str, token: str | None = None) -> dict:
    """lineage_status -> active. Inverse of deprecate."""
    return _set_lineage_status(tenant_id, entity_id, "active", token)


def count_open_instances(tenant_id: str, lineage_definition_id: str,
                         token: str | None = None) -> int:
    """Open-instance count for one lineage, gating `retire`.

    task-5-brief's simplification (workflow_instance rows don't exist yet —
    Task 6 creates them): "instances of this lineage (definition_id match)
    with empty/absent closed_at" — no per-instance machine/terminal-state
    check here, since a diligently-maintained engine (Task 6/8) only ever
    leaves closed_at empty while an instance is genuinely open.
    """
    rows = dc.list_entities(tenant_id, "workflow_instance", "", token)
    rows = [r for r in rows if str(r.get("definition_id", "")) == str(lineage_definition_id)]
    return len([r for r in rows if not r.get("closed_at")])


def retire_definition(tenant_id: str, entity_id: str, force_cancel: bool = False,
                      token: str | None = None) -> dict:
    """lineage_status -> retired, gated on zero open instances.

    409 `{"open_instances": N}` when any are open and `force_cancel` is not
    set. `force_cancel=True` with open instances present returns 501 in this
    task — Task 8 owns `cancel_instance`/bulk-cancel and wires this branch
    for real. # ADJUST: Task 8
    """
    row = _require_definition_row(tenant_id, entity_id, token)
    lineage_id = row.get("definition_id")
    open_count = count_open_instances(tenant_id, lineage_id, token)
    if open_count > 0:
        if force_cancel:
            # ADJUST: Task 8 wires force_cancel via cancel_instance/bulk-cancel.
            raise HTTPException(501, "force_cancel is not implemented yet (Task 8)")
        raise HTTPException(409, {"open_instances": open_count})

    base = entity_base_data(row)
    base["lineage_status"] = "retired"
    return dc.dc_update(tenant_id, "workflow_definition", entity_id, base, token)


# --- model-impact ------------------------------------------------------------


def _iter_leaf_conditions(group: ConditionGroup | None):
    """Recursively yield every leaf Condition under a ConditionGroup
    (mirrors validate.py's `_condition_sources`, but yields the Condition
    itself rather than just `.source`, since model-impact also needs the
    caller-facing source string for `detail`)."""
    if group is None:
        return
    for items in (group.all_, group.any_, group.not_):
        if not items:
            continue
        for item in items:
            if isinstance(item, ConditionGroup):
                yield from _iter_leaf_conditions(item)
            else:
                yield item


def _as_int(value: Any) -> Any:
    """Best-effort int coercion for a flattened (stringified) `version`
    column — falls back to the raw value if it isn't int-shaped, rather than
    raising, since this is a read-only reporting endpoint."""
    try:
        return int(value)
    except (TypeError, ValueError):
        return value


def model_impact(tenant_id: str, entity_type: str, field: str | None = None,
                 token: str | None = None) -> list[dict]:
    """Every reference to `entity_type` (optionally narrowed to one `field`)
    across the tenant's PUBLISHED definitions: section field picks, `show_if`
    sources, and `data_condition` guard sources (spec §3 "Model evolution":
    "a model-impact read endpoint ... for model-setup surfaces to warn before
    destructive edits"). Read-only; talks only to list_entities.
    """
    rows = dc.list_entities(tenant_id, "workflow_definition", "", token)
    rows = [r for r in rows if r.get("status") == "published"]

    references: list[dict] = []
    for row in rows:
        machine, steps = _parse_machine_steps(row)

        section_map: dict[str, SectionDef] = {}
        for step in steps:
            if step.type != "form":
                continue
            for raw in step.config.get("sections", []) or []:
                section = SectionDef.model_validate(raw)
                section_map[section.section_id] = section

        meta = {
            "definition_id": row.get("definition_id"),
            "entity_id": row.get("entity_id"),
            "version": _as_int(row.get("version")),
        }

        for section in section_map.values():
            if section.entity_model != entity_type:
                continue
            for pick in section.fields:
                if field is not None and pick.name != field:
                    continue
                references.append({
                    **meta,
                    "kind": "section",
                    "detail": f"section '{section.section_id}' field '{pick.name}'",
                })

        for step in steps:
            for cond in _iter_leaf_conditions(step.show_if):
                prefix, sep, cond_field = cond.source.partition(".")
                if not sep:
                    continue
                section = section_map.get(prefix)
                if section is None or section.entity_model != entity_type:
                    continue
                if field is not None and cond_field != field:
                    continue
                references.append({
                    **meta,
                    "kind": "show_if",
                    "detail": f"step '{step.step_id}' show_if references '{cond.source}'",
                })

        for t in machine.transitions:
            for g in t.guards:
                if g.primitive != "data_condition":
                    continue
                raw_condition = g.params.get("condition")
                if not raw_condition:
                    continue
                try:
                    group = ConditionGroup.model_validate(raw_condition)
                except Exception:
                    continue
                for cond in _iter_leaf_conditions(group):
                    prefix, sep, cond_field = cond.source.partition(".")
                    if not sep:
                        continue
                    section = section_map.get(prefix)
                    if section is None or section.entity_model != entity_type:
                        continue
                    if field is not None and cond_field != field:
                        continue
                    references.append({
                        **meta,
                        "kind": "guard",
                        "detail": f"transition '{t.transition_id}' guard references '{cond.source}'",
                    })

    return references
