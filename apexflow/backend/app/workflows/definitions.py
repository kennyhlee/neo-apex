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
from typing import Any, Callable

from fastapi import HTTPException

from app.workflows import datacore as dc
from app.workflows.schema import ConditionGroup, MachineDef, SectionDef, StepDef
from app.workflows.shared import entity_base_data
from app.workflows.validate import validate_definition

# `entity_base_data` now lives in app.workflows.shared (code-review follow-up
# to Task 7 — was duplicated between here and engine.py/primitives.py; see
# shared.py's module docstring for why it's a leaf module none of the other
# workflows modules can safely have duplicated instead). Imported by name
# above so this module's own `entity_base_data(...)` call sites, and
# `defs.entity_base_data(...)` as called from engine.py, keep working
# unchanged. (`SYSTEM_COLS` itself has no consumer outside shared.py/this
# module's old body, so it isn't re-imported here.)


def parse_machine_steps(row: dict) -> tuple[MachineDef, list[StepDef]]:
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


# `retired` was this value's name before archive/unarchive made the state
# reversible (spec D1). Rows written under the old name are still valid and
# are NOT migrated — every read goes through `is_archived`, so the alias has
# exactly one definition. Never string-compare either value at a call site.
ARCHIVED_STATUSES: frozenset[str] = frozenset({"archived", "retired"})


def is_archived(row: dict) -> bool:
    """True when this definition row's lineage is out of circulation.

    Tolerates a row with no `lineage_status` key at all — a tenant whose
    table predates the column reads back sparse, and `.get` returning None
    must be False rather than a KeyError (same tolerance the recent
    `due_at` fix established for flattened rows generally)."""
    return row.get("lineage_status") in ARCHIVED_STATUSES


def referenced_entity_models(steps: list[StepDef]) -> set[str]:
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


def fetch_models(tenant_id: str, entity_types: set[str], token: str | None) -> dict[str, Any]:
    return {et: dc.get_model_definition(tenant_id, et, token) for et in sorted(entity_types)}


def require_definition_row(tenant_id: str, entity_id: str, token: str | None = None) -> dict:
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
    row = require_definition_row(tenant_id, entity_id, token)

    machine, steps = parse_machine_steps(row)
    models = fetch_models(tenant_id, referenced_entity_models(steps), token)
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
    # Carry the lineage's current lineage_status forward across a publish:
    # without this, publishing a new version of a deprecated/retired lineage
    # silently reverts it to "active" (the fresh draft row's own default),
    # undoing a prior deprecate/retire. Fall back to "active" only when
    # there is no prior published row at all (first publish of a lineage).
    base["lineage_status"] = (prior_published or {}).get("lineage_status", "active")
    return dc.dc_update(tenant_id, "workflow_definition", entity_id, base, token)


def _require_published_row(tenant_id: str, entity_id: str, token: str | None, action: str) -> dict:
    """Load a workflow_definition row and require `status == "published"`.

    deprecate/reactivate/retire all operate on "the published row" of a
    lineage (spec §3 "Definition lifecycle": lineage_status is read from the
    published row) — calling one of these against a draft or superseded row
    doesn't have a coherent meaning (there is no "the" lineage state to flip
    on a row that was never, or is no longer, the live version), so it 409s
    with an actionable message instead of silently mutating a row nothing
    reads lineage state from.
    """
    row = require_definition_row(tenant_id, entity_id, token)
    if row.get("status") != "published":
        raise HTTPException(
            409,
            f"cannot {action} workflow_definition {entity_id!r}: status is "
            f"{row.get('status')!r}, not 'published'",
        )
    return row


def _set_lineage_status(tenant_id: str, entity_id: str, new_lineage_status: str,
                         action: str, token: str | None = None) -> dict:
    row = _require_published_row(tenant_id, entity_id, token, action)
    base = entity_base_data(row)
    base["lineage_status"] = new_lineage_status
    return dc.dc_update(tenant_id, "workflow_definition", entity_id, base, token)


def deprecate_definition(tenant_id: str, entity_id: str, token: str | None = None) -> dict:
    """lineage_status -> deprecated. Reversible (spec §3): stops new
    instances, in-flight instances and their magic links continue."""
    return _set_lineage_status(tenant_id, entity_id, "deprecated", "deprecate", token)


def reactivate_definition(tenant_id: str, entity_id: str, token: str | None = None) -> dict:
    """lineage_status -> active. Inverse of deprecate."""
    return _set_lineage_status(tenant_id, entity_id, "active", "reactivate", token)


def list_open_instances(tenant_id: str, lineage_definition_id: str,
                        token: str | None = None) -> list[dict]:
    """Open (`closed_at` empty/absent) `workflow_instance` rows of one
    lineage — the same query `count_open_instances` and `archive_definition`
    gate on, exposed as rows (not just a count) so `archive_definition`'s
    force path can abandon each one by name."""
    rows = dc.list_entities(tenant_id, "workflow_instance", "", token)
    rows = [r for r in rows if str(r.get("definition_id", "")) == str(lineage_definition_id)]
    return [r for r in rows if not r.get("closed_at")]


def list_frozen_instances(tenant_id: str, lineage_definition_id: str,
                          token: str | None = None) -> list[dict]:
    """Instances of one lineage currently suspended by an archive — the set
    `unarchive_definition` thaws.

    Filtered in Python, never a SQL `where`: `frozen_at` is a column a tenant's
    table only materializes once something has been frozen there, and a `where`
    naming an unmaterialized column is a DuckDB binder error (400), not an
    empty result."""
    rows = dc.list_entities(tenant_id, "workflow_instance", "", token)
    rows = [r for r in rows if str(r.get("definition_id", "")) == str(lineage_definition_id)]
    return [r for r in rows if r.get("frozen_at")]


def count_open_instances(tenant_id: str, lineage_definition_id: str,
                         token: str | None = None) -> int:
    """Open-instance count for one lineage, gating `retire`.

    task-5-brief's simplification (workflow_instance rows don't exist yet —
    Task 6 creates them): "instances of this lineage (definition_id match)
    with empty/absent closed_at" — no per-instance machine/terminal-state
    check here, since a diligently-maintained engine (Task 6/8) only ever
    leaves closed_at empty while an instance is genuinely open (Task 8's
    `app.workflows.machine` keeps that promise: it sets `closed_at` on any
    transition — explicit or system-auto-advanced — landing on a
    `kind: "terminal"` state, and on `cancel_instance`).
    """
    return len(list_open_instances(tenant_id, lineage_definition_id, token))


def archive_definition(tenant_id: str, entity_id: str, force: bool = False, *,
                       actor: str | None = None, token: str | None = None,
                       freeze_instance_fn: Callable[[str, dict, str, str | None], None] | None = None,
                       abandon_instance_fn: Callable[[str, dict, str, str | None], None] | None = None,
                       ) -> dict:
    """lineage_status: deprecated -> archived.

    Reachable ONLY from `deprecated` (409 `{"reason": "not_deprecated"}`
    otherwise). That ordering is the whole point: deprecating stops new intake
    while letting mid-flight work run, so it is the window in which a workflow
    drains naturally. Archiving is what you do once you are done waiting.

    Whatever is still in flight when the archive lands is SUSPENDED, not
    destroyed — each open instance goes through `freeze_instance_fn`, and
    `unarchive_definition` thaws them. `force=True` swaps that for
    `abandon_instance_fn`, the destructive escape hatch: those instances are
    closed permanently and unarchive will NOT revive them (an administrator
    restores each by hand via `machine.restore_instance`).

    Both collaborators are dependency-injected by the caller (`app.api
    .definitions`) rather than this module importing `app.workflows.machine`
    directly — `machine.py` imports THIS module (`parse_machine_steps`/
    `fetch_models`/`referenced_entity_models`/`_as_int`), so a
    `definitions.py -> machine.py` import back would close a cycle. A missing
    collaborator or actor with open instances present is a RuntimeError, not
    an HTTPException: that is the API layer failing to wire itself, a
    programming error rather than a bad request. (A bare `assert` would strip
    under `python -O`, silently archiving with the instances never touched.)
    """
    row = _require_published_row(tenant_id, entity_id, token, "archive")
    if row.get("lineage_status") != "deprecated":
        raise HTTPException(409, {
            "reason": "not_deprecated",
            "lineage_status": row.get("lineage_status"),
        })

    lineage_id = row.get("definition_id")
    open_rows = list_open_instances(tenant_id, lineage_id, token)
    if open_rows:
        handler = abandon_instance_fn if force else freeze_instance_fn
        if handler is None or not actor:
            raise RuntimeError(
                "archive_definition requires an actor plus freeze_instance_fn "
                "(or abandon_instance_fn when force=True)"
            )
        for instance_row in open_rows:
            handler(tenant_id, instance_row, actor, token)

    base = entity_base_data(row)
    base["lineage_status"] = "archived"
    return dc.dc_update(tenant_id, "workflow_definition", entity_id, base, token)


def unarchive_definition(tenant_id: str, entity_id: str, *, actor: str | None = None,
                         token: str | None = None,
                         unfreeze_instance_fn: Callable[[str, dict, str, str | None], None] | None = None,
                         ) -> dict:
    """lineage_status: archived -> deprecated, thawing every frozen work item.

    Returns to `deprecated`, NOT `active`, because that is provably where the
    archive was entered from (archive is only reachable from deprecated).
    Landing on `active` would silently reopen intake the operator never asked
    to reopen; `reactivate` is the separate, deliberate step for that.

    Frozen work items resume exactly where they paused — freezing never
    changed their state, so there is nothing to restore. Instances ABANDONED
    by a force-archive are deliberately left alone: those are closed, and
    reviving them here would silently reopen work families were told was
    finished. An administrator restores each one via
    `machine.restore_instance`.
    """
    row = _require_published_row(tenant_id, entity_id, token, "unarchive")
    frozen_rows = list_frozen_instances(tenant_id, row.get("definition_id"), token)
    if frozen_rows:
        if unfreeze_instance_fn is None or not actor:
            raise RuntimeError(
                "unarchive_definition requires both actor and unfreeze_instance_fn"
            )
        for instance_row in frozen_rows:
            unfreeze_instance_fn(tenant_id, instance_row, actor, token)

    base = entity_base_data(row)
    base["lineage_status"] = "deprecated"
    return dc.dc_update(tenant_id, "workflow_definition", entity_id, base, token)


def delete_definition(tenant_id: str, entity_id: str, token: str | None = None) -> dict:
    """Delete an unpublished workflow version outright.

    Only a `draft` row may go (409 `{"reason": "not_draft"}` otherwise):

    - a `published` row is live, and its lineage is the thing instances bind to;
    - a `superseded` row is the PINNED definition for every instance still
      running on that version, so deleting it would strand them with an
      unresolvable machine (`machine._pinned_definition_row` 404s).

    Implemented as DataCore's row-level `/archive` soft delete — the row keeps
    existing with `_status="archived"` and drops out of every read, and
    DataCore's `/restore` is the inverse. Beware the vocabulary clash: that is
    DataCore's *row* archive, unrelated to this module's lineage `archived`
    status (see `dc.dc_archive`'s own warning).
    """
    row = require_definition_row(tenant_id, entity_id, token)
    if row.get("status") != "draft":
        raise HTTPException(409, {
            "reason": "not_draft",
            "status": row.get("status"),
        })
    dc.dc_archive(tenant_id, "workflow_definition", entity_id, token)
    return {"deleted": entity_id}


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
        machine, steps = parse_machine_steps(row)

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
