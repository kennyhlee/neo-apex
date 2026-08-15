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
import re
import uuid
from typing import Any, Callable

from fastapi import HTTPException

from app.workflows import datacore as dc
from app.workflows.schema import ConditionGroup, MachineDef, SectionDef, StepDef
from app.workflows.shared import entity_base_data
from app.workflows.validate import definition_health, validate_definition

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
    lineage — exposed as rows (not just a count) so `archive_definition` can
    freeze each one by name."""
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


def open_instance_counts_by_lineage(tenant_id: str,
                                    token: str | None = None) -> dict[str, int]:
    """Open-instance counts for EVERY lineage of this tenant, in ONE read.

    The batched twin of `count_open_instances` above, for callers that need
    the count of many lineages at once (`api/designer.py::list_definitions`,
    which renders one row per lineage VERSION). `count_open_instances` scans
    the tenant's whole `workflow_instance` table and then throws away every
    row belonging to another lineage, so asking it per lineage re-reads the
    same table once per lineage — O(lineages) DataCore round-trips for data
    a single read already contains.

    Same open-ness definition as `list_open_instances` (empty/absent
    `closed_at`) and the same lineage key expression
    (`str(row.get("definition_id", ""))`), so a lineage's count here is
    identical to `count_open_instances`'s for that lineage — the
    designer list and the retire gate must never disagree about how much
    work is in flight.

    Grouped in Python rather than with a SQL `GROUP BY definition_id`, for
    the same reason every other read in this module filters in Python:
    `definition_id`/`closed_at` are flattened columns a tenant's table only
    materializes once something has written them, and a predicate (or
    grouping) naming an unmaterialized column is a DuckDB binder error
    (400), not an empty result. Lineages with no open instances are simply
    absent from the returned dict — callers default to 0.
    """
    counts: dict[str, int] = {}
    for row in dc.list_entities(tenant_id, "workflow_instance", "", token):
        if row.get("closed_at"):
            continue
        key = str(row.get("definition_id", ""))
        counts[key] = counts.get(key, 0) + 1
    return counts


def save_definition(tenant_id: str, entity_id: str, machine_raw: Any, steps_raw: Any,
                     channel_access: str | None = None, token: str | None = None) -> dict:
    """Write a draft's authored content and return its validation in one call.

    Replaces the editor's previous pair of operations — a write through the
    GENERIC entities proxy plus a separately-triggered validate — and the
    reason is cost as much as tidiness. The old validate route re-read the
    definition row AND every referenced entity model on a debounce, so a
    four-model workflow cost one query plus four model reads per edit burst.
    Here the content arrives in the body, so nothing is read back to validate
    it, and validation rides a write that was going to happen anyway rather
    than being independently triggerable.

    422 if `machine`/`steps` do not parse — the generic proxy enforces no
    schema, so `machine: "not json"` was previously storable and bricked every
    later read of the row (see `app/api/designer.py::_parse_or_422`). Refusing
    here makes that unreachable through the product.

    409 `{"reason": "not_draft"}` on a published or superseded row: those are
    live or pinned-to by running instances, and are edited by publishing a new
    version, never in place.

    Validation errors do NOT refuse the write. A draft is allowed to be
    invalid — that is what draft means — and losing an author's work because
    their half-built machine has no terminal state yet would be perverse.
    `publish_definition` remains the gate that actually refuses.
    """
    row = require_definition_row(tenant_id, entity_id, token)
    if row.get("status") != "draft":
        raise HTTPException(409, {"reason": "not_draft", "status": row.get("status")})

    try:
        machine = MachineDef.model_validate(machine_raw)
        steps = [StepDef.model_validate(s) for s in (steps_raw or [])]
        # Sections are parsed HERE — before the write, inside the 422 — and not
        # left to the `fetch_models` call below, for the same reason
        # `create_definition` parses them before its own write. `StepDef.config`
        # is `dict[str, Any]`, so a section missing entity_model/fields/mode
        # survives `StepDef.model_validate` and is only ever parsed by
        # `referenced_entity_models`. With that call sitting after `dc_update`
        # and outside this try, such a request PERSISTED the malformed section
        # to the row and then raised out of the route as a 500 — the write had
        # already happened, so "422 if machine/steps do not parse" was true of
        # the machine only. It has to hold for the whole payload.
        entity_types = referenced_entity_models(steps)
    except Exception as exc:
        raise HTTPException(422, {"parse_error": str(exc)}) from exc

    base = entity_base_data(row)
    base["machine"] = json.dumps(machine.model_dump(by_alias=True))
    base["steps"] = json.dumps([s.model_dump(by_alias=True) for s in steps])
    if channel_access is not None:
        base["channel_access"] = channel_access
    updated = dc.dc_update(tenant_id, "workflow_definition", entity_id, base, token)

    models = fetch_models(tenant_id, entity_types, token)
    return {
        "row": updated,
        "errors": validate_definition(machine, steps, models),
        "health": definition_health(machine, steps, models),
    }


def archive_definition(tenant_id: str, entity_id: str, *,
                       actor: str | None = None, token: str | None = None,
                       freeze_instance_fn: Callable[[str, dict, str, str | None], None] | None = None,
                       ) -> dict:
    """lineage_status: deprecated -> archived.

    Reachable ONLY from `deprecated` (409 `{"reason": "not_deprecated"}`
    otherwise). That ordering is the whole point: deprecating stops new intake
    while letting mid-flight work run, so it is the window in which a workflow
    drains naturally. Archiving is what you do once you are done waiting.

    Whatever is still in flight when the archive lands is SUSPENDED, not
    destroyed — each open instance goes through `freeze_instance_fn`, and
    `unarchive_definition` thaws them. There is deliberately NO destructive
    variant: an archive is always reversible, so the state set stays small and
    every path is either reversible or explicitly final, with nothing in
    between. Staff who genuinely want a work item ended cancel it first
    (`machine.cancel_instance`), which is visible and per-item.

    The collaborator is dependency-injected by the caller (`app.api
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
        if freeze_instance_fn is None or not actor:
            raise RuntimeError(
                "archive_definition requires both actor and freeze_instance_fn"
            )
        for instance_row in open_rows:
            freeze_instance_fn(tenant_id, instance_row, actor, token)

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
    changed their state, so there is nothing to restore. Instances that were
    already closed before the archive (terminal or cancelled) stay closed:
    they are not frozen, so there is nothing to thaw.
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


def get_draft_definition(tenant_id: str, lineage_definition_id: str,
                         token: str | None = None) -> dict | None:
    """The tenant's current draft row for one lineage, or None.

    Filtered in Python rather than via a SQL `where`, for the same reason
    `get_published_definition` is: on a new tenant those flattened columns may
    not be materialized yet, and a predicate naming one is a DuckDB binder
    error (400), not an empty result.
    """
    rows = dc.list_entities(tenant_id, "workflow_definition", "", token)
    rows = [r for r in rows if str(r.get("definition_id", "")) == str(lineage_definition_id)]
    rows = [r for r in rows if r.get("status") == "draft"]
    return rows[0] if rows else None


def _new_definition_id(name: str) -> str:
    """A fresh LINEAGE id from a human-typed workflow name.

    Slug + short random suffix, mirroring the designer's client-side
    `slugify`/`uniqueSuffix` pair (frontend/src/pages/DefinitionsPage.tsx)
    that this function replaces. The suffix is what keeps two workflows a
    person happened to name the same thing from becoming ONE lineage — every
    lineage read (`get_published_definition`, `get_draft_definition`,
    `model_impact`) matches on `definition_id`, so a collision would silently
    merge them. Collisions are otherwise harmless (DataCore assigns the real
    `entity_id`; this is a lineage label), so a non-cryptographic suffix is
    enough.

    A name with no alphanumerics at all slugs to the empty string, which
    would leave a `definition_id` of just `-abc123`; `"workflow"` is the
    fallback rather than accepting that.
    """
    slug = re.sub(r"[^a-z0-9]+", "-", name.strip().lower()).strip("-") or "workflow"
    return f"{slug}-{uuid.uuid4().hex[:6]}"


def create_definition(tenant_id: str, name: str, machine_raw: Any, steps_raw: Any,
                      channel_access: str = "staff_only",
                      token: str | None = None) -> dict:
    """Create a version-1 draft lineage from a parsed definition object.

    The other end of `save_definition`'s contract, and deliberately the same
    one: `machine`/`steps` arrive as PARSED shapes and are JSON-encoded here,
    server-side, in exactly one place. The designer previously created drafts
    through the GENERIC entities proxy (`app/api/entities.py`), which enforces
    no schema — it hand-`JSON.stringify`d both fields and picked `version`/
    `status`/`lineage_status` itself, so the invariants that make a lineage
    coherent lived in a browser. Any client that got one wrong wrote a row
    every later read chokes on.

    422 (`{"parse_error": ...}`) if `machine`/`steps` don't validate against
    schema.py, raised BEFORE the write — same shape and same reasoning as
    `save_definition`'s, and the reason a corrupt row is not creatable through
    the product either.

    Validation ERRORS do not refuse the write, for the same reason they don't
    in `save_definition`: a draft is allowed to be incomplete. They come back
    alongside the row, and `publish_definition` stays the gate that refuses.
    """
    try:
        machine = MachineDef.model_validate(machine_raw)
        steps = [StepDef.model_validate(s) for s in (steps_raw or [])]
        # Sections are parsed HERE — before the write, inside the 422 — and
        # not left to the `fetch_models` call below. `StepDef.config` is
        # `dict[str, Any]`, so a section missing entity_model/fields/mode
        # survives `StepDef.model_validate` and is only ever parsed by
        # `referenced_entity_models`. With that call sitting after `dc_create`
        # and outside this try, such a request raised out of the route as a
        # 500 AND left behind a draft row nothing cleans up — the write had
        # already happened. "422 raised BEFORE the write" has to hold for the
        # whole payload, not just `machine`.
        entity_types = referenced_entity_models(steps)
    except Exception as exc:
        raise HTTPException(422, {"parse_error": str(exc)}) from exc

    created = dc.dc_create(tenant_id, "workflow_definition", {
        "definition_id": _new_definition_id(name),
        "name": name,
        "version": 1,
        "status": "draft",
        "lineage_status": "active",
        "channel_access": channel_access,
        "machine": json.dumps(machine.model_dump(by_alias=True)),
        "steps": json.dumps([s.model_dump(by_alias=True) for s in steps]),
    }, token)
    # Re-fetched for the same reason `new_draft_definition` re-fetches:
    # `dc_create` echoes DataCore's write-response envelope
    # (`{entity_id, entity_type, base_data, _version}`), not the flattened row
    # shape every read in this module returns. Callers must not have to care
    # which function produced the row they're holding.
    row = require_definition_row(tenant_id, created["entity_id"], token)

    models = fetch_models(tenant_id, entity_types, token)
    return {
        "row": row,
        "errors": validate_definition(machine, steps, models),
        "health": definition_health(machine, steps, models),
    }


def new_draft_definition(tenant_id: str, entity_id: str,
                         token: str | None = None) -> dict:
    """Open the next draft version of a published lineage.

    AT MOST ONE DRAFT PER LINEAGE. This is not tidiness — it is what keeps
    `version` unique within a lineage. The version of a new draft is
    `published.version + 1`, and `publish_definition` only ever supersedes the
    PRIOR PUBLISHED row, so no superseded row can sit above the published one.
    Allow a second concurrent draft and both get the same number; once both are
    published in turn, `machine._pinned_definition_row` — which matches on
    `(definition_id, version)` and returns `rows[0]` — resolves every running
    instance's machine from whichever row `list_entities` happens to return
    first.

    This lives here rather than in the browser because the frontend previously
    created drafts with a direct generic `createEntity` write, bypassing this
    module entirely: a UI-only guard would be advisory, and two tabs open on the
    list would both see "no draft" and both create one.

    409 `not_published` on any other row (lifecycle reads the published row);
    409 `lineage_archived` because a copy would carry `archived` forward onto a
    fresh draft; 409 `draft_exists` carrying the existing draft's `entity_id`
    so the caller can navigate to it.
    """
    row = require_definition_row(tenant_id, entity_id, token)

    if row.get("status") != "published":
        raise HTTPException(409, {
            "reason": "not_published",
            "status": row.get("status"),
        })

    if is_archived(row):
        raise HTTPException(409, {
            "reason": "lineage_archived",
            "lineage_status": row.get("lineage_status"),
        })

    existing = get_draft_definition(tenant_id, row.get("definition_id"), token)
    if existing is not None:
        raise HTTPException(409, {
            "reason": "draft_exists",
            "entity_id": existing.get("entity_id"),
        })

    base = entity_base_data(row)
    base["status"] = "draft"
    base["version"] = _as_int(row.get("version")) + 1
    created = dc.dc_create(tenant_id, "workflow_definition", base, token)
    # `dc_create` echoes DataCore's write-response envelope
    # (`{entity_id, entity_type, base_data, _version}`, unflattened — see
    # `datacore.dc_create`), not the flattened row shape every other read in
    # this module returns (`require_definition_row`/`get_published_definition`
    # /`get_draft_definition`). Re-fetch through `require_definition_row` so
    # callers get the same flattened shape (`row["status"]`, stringified
    # `row["version"]`) regardless of which of those functions produced it.
    return require_definition_row(tenant_id, created["entity_id"], token)


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
