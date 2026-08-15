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
from pydantic import BaseModel, ValidationError

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
    reads" failure mode this mirrors, one route up.

    READ COUNT (perf, and the property `test_designer_api.py::
    test_list_definitions_datacore_read_count_is_flat_in_rows` pins): this
    route makes `1 + O(distinct referenced models) + 1` DataCore reads, NOT
    O(rows). It used to make O(rows × models-per-row) + O(lineages), because
    the model fetch and the open-instance count both sat INSIDE the row loop:
    a tenant with eight workflows at two or three versions each, all built on
    the same handful of entity models, re-fetched `student` a dozen times and
    re-scanned the whole `workflow_instance` table once per lineage. Hence the
    two passes below — parse every row first to learn the UNION of referenced
    models, fetch that union once, and take every lineage's open count from
    one grouped read (`defs.open_instance_counts_by_lineage`).

    Sharing ONE models map across rows is behavior-preserving, not merely
    cheaper: `validate_definition`/`definition_health` only ever reach into
    `models` via `models.get(section.entity_model)`, so entries a given row
    does not reference are invisible to it — the same reason `get_bundle`
    below can hand them a map padded with `STANDARD_BUNDLE_MODELS`.
    """
    token = user.get("_token")
    rows = dc.list_entities(tenant_id, "workflow_definition", "", token)

    # Pass 1 — pure CPU, no I/O: parse each row and collect the union of every
    # entity model any row references. A row that fails to parse contributes
    # no models and carries its error into pass 2; one bad row must neither
    # deprive the others of their models nor 500 the list (docstring above).
    parsed: list[tuple[Any, Any, str | None]] = []
    referenced: set[str] = set()
    for row in rows:
        try:
            machine, steps = defs.parse_machine_steps(row)
            # Inside the try, exactly as before this route was batched:
            # `referenced_entity_models` parses each declared SECTION, which
            # `StepDef.model_validate` does not (`config` is dict[str, Any]),
            # so a malformed section raises HERE and must degrade this one row
            # to "broken" rather than escape the loop.
            referenced |= defs.referenced_entity_models(steps)
            parsed.append((machine, steps, None))
        # Widened past ValidationError (final-review fix wave): a row whose
        # stored `machine`/`steps` string isn't even valid JSON (e.g.
        # machine="not json") makes parse_machine_steps's json.loads raise
        # json.JSONDecodeError — a ValueError subclass, not a
        # ValidationError — which this except previously let through
        # unhandled, 500ing the whole list. Same reasoning as
        # _parse_or_422's docstring, applied to this route's own inline
        # try/except.
        except (ValidationError, ValueError, TypeError) as exc:
            parsed.append((None, None, str(exc)))

    models = defs.fetch_models(tenant_id, referenced, token)
    open_instance_counts = defs.open_instance_counts_by_lineage(tenant_id, token)

    out = []
    for row, (machine, steps, parse_error) in zip(rows, parsed):
        lineage_id = row.get("definition_id")

        if parse_error is not None:
            health = "broken"
        else:
            try:
                # _health_for_row itself short-circuits superseded rows before
                # ever calling definition_health — no separate outer check
                # needed here (code-review follow-up: the outer check
                # duplicated that same branch instead of just trusting the
                # helper to make it).
                health = _health_for_row(row, machine, steps, models)
            # Still under a degrade-to-"broken" guard, exactly as when this
            # call shared one try with the parse above: `definition_health`
            # re-validates sections and guard conditions off the same
            # free-text row, so anything it rejects that pass 1 accepted must
            # brick ONE row's health, never the whole list.
            except (ValidationError, ValueError, TypeError) as exc:
                health = "broken"
                parse_error = str(exc)

        entry = {
            "entity_id": row.get("entity_id"),
            "definition_id": lineage_id,
            "name": row.get("name"),
            "version": row.get("version"),
            "status": row.get("status"),
            "lineage_status": row.get("lineage_status"),
            "channel_access": row.get("channel_access"),
            "health": health,
            # The same key expression `open_instance_counts_by_lineage` groups
            # on (and `list_open_instances` matches on), so the list and the
            # retire gate agree row for row; a lineage with nothing in flight
            # is absent from the map, hence the 0 default.
            "open_instances": open_instance_counts.get(str(row.get("definition_id", "")), 0),
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


class SaveDefinitionRequest(BaseModel):
    """The editor's authored content. `machine`/`steps` are the parsed shapes,
    NOT the JSON-encoded strings the row stores — `save_definition` does the
    encoding, so the client never hand-serialises into a field the generic
    proxy would have accepted unchecked."""

    machine: dict[str, Any]
    steps: list[dict[str, Any]] = []
    channel_access: str | None = None


@router.put("/{tenant_id}/definitions/{entity_id}")
def save_definition_route(tenant_id: str, entity_id: str, body: SaveDefinitionRequest,
                          user: dict = Depends(require_staff_tenant)):
    """Write a draft and return its validation in the same response.

    This is deliberately the ONLY way the editor learns whether a definition is
    valid: validation rides the save rather than being separately triggerable,
    so its cost is bounded by how often someone actually saves. See
    `defs.save_definition` for why the old debounced validate route was
    expensive (a row read plus one read per referenced model, per edit burst).
    """
    return defs.save_definition(
        tenant_id, entity_id, body.machine, body.steps, body.channel_access,
        user.get("_token"),
    )


class CreateDefinitionRequest(BaseModel):
    """A brand-new workflow's authored content. Same field contract as
    `SaveDefinitionRequest` — `machine`/`steps` are the PARSED shapes, never
    the JSON-encoded strings the row stores — plus the `name` and
    `channel_access` a create has to choose. Everything else about a v1 draft
    (`definition_id`, `version`, `status`, `lineage_status`) is the server's to
    decide, so it isn't accepted here."""

    name: str
    machine: dict[str, Any]
    steps: list[dict[str, Any]] = []
    channel_access: str = "staff_only"


@router.post("/{tenant_id}/definitions", status_code=201)
def create_definition_route(tenant_id: str, body: CreateDefinitionRequest,
                            user: dict = Depends(require_staff_tenant)):
    """Create a version-1 draft and return its validation in the same response.

    The write half of this module's otherwise-read surface, and the counterpart
    to `save_definition_route`'s PUT: the designer's blank/template creation
    and the chat assistant's create-draft proposal both land here, so the
    lineage invariants and the JSON encoding live server-side in one place
    instead of being re-derived by each client against the schema-less generic
    entities proxy. 422 `{"parse_error": ...}` and the errors/health payload
    come straight from `defs.create_definition` — see its docstring.
    """
    return defs.create_definition(
        tenant_id, body.name, body.machine, body.steps, body.channel_access,
        user.get("_token"),
    )


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
    (Task 6), each entry annotated with `missing_models` for THIS tenant.

    The catalog itself is platform-wide, but the annotation is not: a
    template binds sections to entity models (`signup`'s `signup_section` ->
    `enrollment`), and a tenant that has not set that model up can apply the
    template and only discover the problem at publish, as
    `section '...' references unknown entity model '...'` — an error that
    reads like an authoring mistake rather than a missing prerequisite.

    DERIVED, never declared. `referenced_entity_models` reads the models
    straight off the template's own form sections, so this can never drift
    out of sync with the steps the way a hand-maintained `required_models`
    field on each `catalog_entry()` would.

    `fetch_models` yields `None` for a model the tenant never set up
    (`definitions.py:84-85`), which is exactly the diff signal.
    `referenced_entity_models` returns an unordered `set`, so `missing_models`
    is sorted here explicitly — that guarantee is this route's own, and does
    not depend on `fetch_models` happening to iterate the set in sorted
    order.

    `STANDARD_BUNDLE_MODELS` is deliberately NOT unioned in here: that
    constant exists to give the section-editor's picker a full menu, whereas
    this asks a per-template question, and a standard model the tenant lacks
    is just as missing as any other.

    No longer a route that cannot fail: this now calls `fetch_models`, which
    calls `dc_query` against DataCore, and raises on a non-200 response.
    """
    token = user.get("_token")

    entries = []
    for entry in template_catalog():
        steps = [StepDef.model_validate(s) for s in entry["definition"]["steps"]]
        models = defs.fetch_models(tenant_id, defs.referenced_entity_models(steps), token)
        entries.append({
            **entry,
            "missing_models": sorted(et for et, model in models.items() if model is None),
        })

    return {"templates": entries}
