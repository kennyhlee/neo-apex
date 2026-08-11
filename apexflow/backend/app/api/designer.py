# apexflow/backend/app/api/designer.py
"""Designer read API (Task 2): definitions list w/ computed health, editor
bundle fetch, dry-run validate, and the guard/effect primitives catalog.

Structural call (task-2-brief.md: "either a new api/designer.py or extend
api/definitions.py — implementer's call, one place"): a NEW file. This
module is a pure READ surface (no writes anywhere below) layered on top of
`app.workflows.definitions`'s existing service functions, while
`api/definitions.py` is the lineage-ACTION surface (publish/deprecate/
reactivate/retire, all writes) plus model-impact. Keeping them apart mirrors
that read/write split rather than growing `api/definitions.py` into both —
the four routes here share no request/response shapes with the action
routes, and every one of them is a GET or a side-effect-free POST.

All routes below reuse `app.workflows.definitions`'s existing helpers rather
than re-deriving definition/model-loading logic (per this task's binding
decisions): `parse_machine_steps`, `referenced_entity_models`,
`fetch_models`, `require_definition_row`, `count_open_instances` — all of
which were made module-public (dropped their leading underscore) by this
task specifically so this module could reuse them instead of re-implementing
the same walk (`app.workflows.definitions`'s own `publish_definition` is the
other caller of the parse/fetch/referenced trio; `count_open_instances` is
shared with `archive_definition`'s gate, via this same module's own function
of that name).

`GET .../validate` (POST, actually — see below) reuses this EXACT recipe —
`require_definition_row` -> `parse_machine_steps` -> `fetch_models(...,
referenced_entity_models(steps), ...)` -> `validate_definition` — because
`publish_definition` (app/workflows/definitions.py) uses the identical
sequence to build the errors it 409s with. Any divergence here (e.g.
including the bundle's extra standard-set models) would break the binding
equality contract task-2-brief.md's Step 1 requires: "validate returns
exactly the errors publish would 409 with."
"""
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import ValidationError

from app.auth import require_staff_tenant
from app.config import settings
from app.templates.catalog import template_catalog
from app.workflows import datacore as dc
from app.workflows import definitions as defs
from app.workflows.primitives import EFFECTS, GUARDS
from app.workflows.schema import MachineDef, StepDef
from app.workflows.validate import PARAM_SPECS, definition_health, validate_definition

router = APIRouter(prefix="/api/workflows")

# The picker's menu (task-2-brief.md): every bundle response's `models` dict
# includes these regardless of whether the definition's sections reference
# them, so the section-editor's "add a section" picker always has the full
# entity-model menu to offer, not just whatever's already used.
STANDARD_BUNDLE_MODELS = ("student", "family", "contact", "registration_application", "lead")


def _health_for_row(row: dict, machine, steps, models: dict[str, Any]) -> str:
    """Superseded rows get the literal string with NO computation (per this
    task's binding decision) — `definition_health` is never even called in
    that branch, so a superseded row with a since-deleted model (which
    would otherwise degrade to "broken") never triggers that computation."""
    if row.get("status") == "superseded":
        return "superseded"
    return definition_health(machine, steps, models)


def _parse_or_422(row: dict) -> tuple[MachineDef, list[StepDef]]:
    """`defs.parse_machine_steps` raises `pydantic.ValidationError` when a
    row's stored `machine`/`steps` JSON no longer parses against the Task 3
    schemas — e.g. a hand-authored (or bugged-editor-produced) `show_if`
    with two non-null combinator keys, which `schema.py`'s `ConditionGroup`
    validator (`_exactly_one_key`) rejects. Left uncaught, that surfaces as
    FastAPI's default unhandled-exception 500 on EVERY future read of that
    row, not just once — a single bad autosave bricks the draft permanently
    (code-review follow-up: the editor's edit-as-JSON escape hatch could
    write exactly this shape before its own stricter validation landed).

    `parse_machine_steps` can ALSO raise `json.JSONDecodeError` (a
    `ValueError` subclass) before it ever reaches pydantic — `machine`/
    `steps` are stored as JSON-serialized strings, and `json.loads()` on a
    row whose stored value isn't valid JSON at all (e.g. `machine: "not
    json"`, writable through the generic entities proxy which enforces no
    schema) raises that, not `ValidationError` (final-review fix wave: this
    exact gap 500'd the same "corrupt row" case the `ValidationError` catch
    above was already built to handle). `TypeError` is included too, as
    defense in depth for a stored value of an unexpected type that neither
    `json.loads` nor pydantic's `model_validate` rejects the way a `dict`/
    `ValidationError` would. Widening the `except` here (rather than making
    `parse_machine_steps` itself normalize `JSONDecodeError` into a
    `ValidationError`-compatible shape) keeps this degrade-to-422 behavior
    scoped to this READ-only module's call sites — `parse_machine_steps`'s
    other caller, `publish_definition` (app/workflows/definitions.py), is a
    WRITE path with its own error-handling shape that this task does not
    touch.

    Every read route below that needs the parsed shape goes through this
    wrapper instead of calling `defs.parse_machine_steps` directly, so a
    corrupt row degrades to a machine-readable 422 (`{"parse_error": ...}`)
    the editor can show as a distinct "this draft's data is invalid" state,
    rather than an opaque 500."""
    try:
        return defs.parse_machine_steps(row)
    except (ValidationError, ValueError, TypeError) as exc:
        raise HTTPException(status_code=422, detail={"parse_error": str(exc)}) from exc


def _family_url(tenant_id: str, row: dict) -> str | None:
    """Family channel entry point — only for published + channel_access ==
    "family" rows (binding decision). Base URL from Settings.familyhub_base_url
    (interface map §7 config-facts table); pattern matches familyhub-frontend's
    own route (`App.tsx`: `/w/:tenantId/:definitionId`) — `definition_id`
    here is the LINEAGE id (row['definition_id']), the same id
    `internal.py`'s `/internal/workflows/{tenant_id}/{definition_id}/...`
    routes and the magic-link "link" field (config.py's own comment) use,
    never the DataCore row `entity_id`."""
    if row.get("status") != "published" or row.get("channel_access") != "family":
        return None
    return f"{settings.familyhub_base_url}/w/{tenant_id}/{row.get('definition_id')}"


@router.get("/{tenant_id}/definitions")
def list_definitions(tenant_id: str, user: dict = Depends(require_staff_tenant)):
    """One row per lineage-version row (frontend groups by `definition_id`
    into lineages) — draft/published/superseded all included.

    `machine`/`steps` are free-text JSON on the DataCore row (the generic
    entities proxy — `app/api/entities.py` — writes them with no schema
    enforcement of its own), so a single malformed row is always reachable
    in practice, not just a theoretical edge case. Per-row parse is wrapped
    so ONE bad row degrades to health "broken" (with a `parse_error` detail)
    for that row alone, rather than an unhandled `ValidationError` (or, per
    `_parse_or_422`'s docstring, `json.JSONDecodeError`/`TypeError` — widened
    here too, same reasoning) 500ing every other (valid) row out of the list
    too — see `_parse_or_422`'s docstring for the same "corrupt row bricks
    reads" failure mode this mirrors, one route up."""
    token = user.get("_token")
    rows = dc.list_entities(tenant_id, "workflow_definition", "", token)

    open_instance_counts: dict[str, int] = {}
    out = []
    for row in rows:
        lineage_id = row.get("definition_id")

        parse_error: str | None = None
        try:
            # _health_for_row itself short-circuits superseded rows before
            # ever calling definition_health — no separate outer check
            # needed here (code-review follow-up: the outer check
            # duplicated that same branch instead of just trusting the
            # helper to make it).
            machine, steps = defs.parse_machine_steps(row)
            models = defs.fetch_models(tenant_id, defs.referenced_entity_models(steps), token)
            health = _health_for_row(row, machine, steps, models)
        # Widened past ValidationError (final-review fix wave): a row whose
        # stored `machine`/`steps` string isn't even valid JSON (e.g.
        # machine="not json") makes parse_machine_steps's json.loads raise
        # json.JSONDecodeError — a ValueError subclass, not a
        # ValidationError — which this except previously let through
        # unhandled, 500ing the whole list. Same reasoning as
        # _parse_or_422's docstring, applied to this route's own inline
        # try/except.
        except (ValidationError, ValueError, TypeError) as exc:
            health = "broken"
            parse_error = str(exc)

        if lineage_id not in open_instance_counts:
            open_instance_counts[lineage_id] = defs.count_open_instances(
                tenant_id, lineage_id, token)

        entry = {
            "entity_id": row.get("entity_id"),
            "definition_id": lineage_id,
            "name": row.get("name"),
            "version": row.get("version"),
            "status": row.get("status"),
            "lineage_status": row.get("lineage_status"),
            "channel_access": row.get("channel_access"),
            "health": health,
            "open_instances": open_instance_counts[lineage_id],
        }
        if parse_error is not None:
            entry["parse_error"] = parse_error
        family_url = _family_url(tenant_id, row)
        if family_url is not None:
            entry["family_url"] = family_url
        out.append(entry)

    return {"definitions": out}


@router.get("/{tenant_id}/definitions/{entity_id}/bundle")
def get_bundle(tenant_id: str, entity_id: str, user: dict = Depends(require_staff_tenant)):
    """The single fetch the editor mounts from: parsed machine/steps, every
    entity model the editor's section picker could possibly need, computed
    health, and the current dry-run validation errors."""
    token = user.get("_token")
    row = defs.require_definition_row(tenant_id, entity_id, token)
    machine, steps = _parse_or_422(row)

    model_types = defs.referenced_entity_models(steps) | set(STANDARD_BUNDLE_MODELS)
    models = defs.fetch_models(tenant_id, model_types, token)

    health = _health_for_row(row, machine, steps, models)
    errors = validate_definition(machine, steps, models)

    return {
        "definition": {
            "entity_id": row.get("entity_id"),
            "definition_id": row.get("definition_id"),
            "name": row.get("name"),
            "version": row.get("version"),
            "status": row.get("status"),
            "lineage_status": row.get("lineage_status"),
            "channel_access": row.get("channel_access"),
            "machine": machine.model_dump(by_alias=True),
            "steps": [s.model_dump(by_alias=True) for s in steps],
        },
        "models": models,
        "health": health,
        "errors": errors,
    }


@router.post("/{tenant_id}/definitions/{entity_id}/validate")
def validate_definition_route(tenant_id: str, entity_id: str,
                              user: dict = Depends(require_staff_tenant)):
    """Dry-run `validate_definition` — no writes. MUST return exactly the
    errors `publish_definition` (app/workflows/definitions.py) would 409
    with: same row load, same referenced-models set (NOT the bundle's wider
    standard-set union), same `validate_definition` call, in the same order.
    """
    token = user.get("_token")
    row = defs.require_definition_row(tenant_id, entity_id, token)
    machine, steps = _parse_or_422(row)
    models = defs.fetch_models(tenant_id, defs.referenced_entity_models(steps), token)

    errors = validate_definition(machine, steps, models)
    health = _health_for_row(row, machine, steps, models)

    return {"errors": errors, "health": health}


def _param_dict(name: str) -> list[dict[str, Any]]:
    out = []
    for spec in PARAM_SPECS.get(name, []):
        entry: dict[str, Any] = {"name": spec.name, "kind": spec.kind, "required": spec.required}
        if spec.enum:
            entry["enum"] = list(spec.enum)
        if spec.constraint:
            entry["constraint"] = spec.constraint
        out.append(entry)
    return out


@router.get("/{tenant_id}/primitives")
def primitives_catalog(tenant_id: str, user: dict = Depends(require_staff_tenant)):
    """Guard/effect primitive catalog, GENERATED from
    `app.workflows.validate.PARAM_SPECS` (itself derived from — and
    cross-check-tested against — `GUARD_PARAM_VALIDATORS`/
    `EFFECT_PARAM_VALIDATORS`) and `app.workflows.primitives`'s `GUARDS`/
    `EFFECTS` registries. No hand-written duplicate primitive-name or
    param-shape table lives in this module."""
    return {
        "guards": [{"name": name, "params": _param_dict(name)} for name in GUARDS],
        "effects": [{"name": name, "params": _param_dict(name)} for name in EFFECTS],
    }


@router.get("/{tenant_id}/templates")
def templates_route(tenant_id: str, user: dict = Depends(require_staff_tenant)):
    """Shipped workflow template catalog for the designer's template gallery
    (Task 6) — `app.templates.catalog.template_catalog()`, unwrapped by
    `require_staff_tenant`'s auth check only. The catalog itself is
    platform-wide, not tenant-scoped data (`tenant_id` exists purely for
    route-shape/auth consistency with the rest of this router, same as every
    other route above)."""
    return {"templates": template_catalog()}
