# apexflow/backend/app/chat/tools.py
"""Chat agent tool registrations.

`register_read_tools` is the model's whole view of tenant workflow data, of
the tenant's entity models, and of the shipped template catalog. Two
properties every tool here must keep:

1. RETURNS A STRING, NEVER RAISES. A tool exception propagates out of
   `agent.run_stream` and the SSE stream ends in an `error` frame — a row
   whose stored `machine`/`steps` no longer parses, or an `entity_id` the
   model hallucinated, are both ordinary, model-correctable situations, so
   they come back as text the model can read and retry from. This mirrors
   `app/api/designer.py`'s `_parse_or_422` (a corrupt row degrades to a
   machine-readable 422 there rather than 500ing every read) — same failure
   mode, different surface, so the same widened `(ValidationError, ValueError,
   TypeError)` reasoning applies; here the catch is broader still (`Exception`)
   because there is no upstream handler at all.
2. READS THROUGH THE SAME HELPERS THE DESIGNER API DOES. `dc`/`defs`/
   `validate_definition` are imported exactly as `app/api/designer.py`
   imports them, so what the assistant reports about a definition is what
   the designer's own bundle/validate routes would report. A second, chat-only
   read path would be free to drift.

`register_proposal_tools` holds the write-PROPOSAL tools — see its own
docstring; property 1 applies there too, property 2 does not (a proposal
reads nothing).
"""
import json
import re
from dataclasses import dataclass
from typing import Callable

from fastapi import HTTPException
from pydantic import ValidationError
from pydantic_ai import Agent, RunContext

from app.api.designer import STANDARD_BUNDLE_MODELS
from app.chat.deps import ChatDeps
from app.chat.patch_ops import validate_ops
from app.templates.catalog import template_catalog
from app.workflows import datacore as dc
from app.workflows import definitions as defs
from app.workflows.schema import (
    ENGINE_OWNED_FIELDS,
    FieldPick,
    MachineDef,
    SectionDef,
    StepDef,
)
from app.workflows.validate import (
    _is_link_or_id_field,
    _model_fields,
    validate_definition,
)

# `_model_fields` and `_is_link_or_id_field` are private to validate.py and
# imported deliberately rather than re-derived, for the reason context.py
# already states about the first: they ARE validate_definition's own
# definitions of "a field of this model" and "a field the engine supplies".
# These tools exist to tell the model which field names will pass validation,
# so a second implementation here could disagree with the one that decides.
#
# `STANDARD_BUNDLE_MODELS` is the designer's section-picker menu; unioning it
# into the listing keeps the assistant's menu and the picker's the same menu.
# The import direction is safe: `app.api.designer` imports nothing from
# `app.chat`.


def register_read_tools(agent: Agent) -> None:
    @agent.tool
    def list_workflows(ctx: RunContext[ChatDeps]) -> str:
        """List this tenant's workflow definitions (every version row):
        name, status, version, entity_id, definition_id."""
        try:
            rows = dc.list_entities(ctx.deps.tenant_id, "workflow_definition", "",
                                    ctx.deps.token)
        except Exception as exc:  # noqa: BLE001 — surface to the model, never raise
            return f"Could not list workflows: {exc}"
        if not rows:
            return "No workflow definitions exist yet."
        return "\n".join(
            f"- {r.get('name')} (v{r.get('version')}, {r.get('status')}, "
            f"entity_id={r.get('entity_id')}, lineage={r.get('definition_id')})"
            for r in rows
        )

    @agent.tool
    def get_workflow(ctx: RunContext[ChatDeps], entity_id: str) -> str:
        """Full definition of one workflow row: machine, steps, channel, and
        current validation errors. Use before proposing changes."""
        try:
            row = defs.require_definition_row(ctx.deps.tenant_id, entity_id,
                                              ctx.deps.token)
        # ONLY a 404 may be reported as "not found". `require_definition_row`
        # also surfaces DataCore outages and auth rejections as HTTPExceptions
        # with other status codes (`dc_query` re-raises DataCore's own status),
        # and `dc._validate_id` raises ValueError on a malformed id. Reporting
        # any of those as "no such workflow" would push the model toward
        # propose_create_draft for a workflow that already exists — a
        # transient outage would silently become a duplicate draft. Every
        # branch still returns a string; nothing raises through the stream.
        except HTTPException as exc:
            if exc.status_code == 404:
                return (f"Workflow {entity_id} was not found in this tenant. "
                        f"Call list_workflows for the valid ids.")
            return (f"Could not load workflow {entity_id}: {exc.detail} "
                    f"(status {exc.status_code}). The workflow may well exist — "
                    f"do not treat this as missing.")
        except Exception as exc:  # noqa: BLE001
            return (f"Could not load workflow {entity_id}: {exc}. The workflow "
                    f"may well exist — do not treat this as missing.")
        try:
            machine, steps = defs.parse_machine_steps(row)
        except Exception as exc:  # noqa: BLE001 — surface to the model
            return f"This row's stored definition does not parse: {exc}"
        try:
            models = defs.fetch_models(ctx.deps.tenant_id,
                                       defs.referenced_entity_models(steps),
                                       ctx.deps.token)
            errors = validate_definition(machine, steps, models)
        except Exception as exc:  # noqa: BLE001
            # The definition itself parsed; only the model-coherence pass
            # failed (e.g. DataCore unreachable). Still worth returning the
            # definition — the model can reason about structure without it.
            errors = [f"validation could not run: {exc}"]
        return json.dumps({
            "entity_id": row.get("entity_id"),
            "definition_id": row.get("definition_id"),
            "name": row.get("name"),
            "status": row.get("status"),
            "version": row.get("version"),
            "channel_access": row.get("channel_access"),
            "machine": machine.model_dump(by_alias=True),
            "steps": [s.model_dump(by_alias=True) for s in steps],
            "validation_errors": errors,
        })

    @agent.tool
    def list_entity_models(ctx: RunContext[ChatDeps]) -> str:
        """The entity models this tenant has, with their field names — the
        only models a form section may bind to. CALL THIS BEFORE AUTHORING
        ANY FORM SECTION (creating a workflow from scratch or adding a step):
        outside the editor nothing else tells you which models exist or what
        they hold, and a section bound to a model this does not list, or
        picking no fields at all, is rejected."""
        # Two sources, unioned: the tenant's OWN model types (a camp or
        # program model no hardcoded list could know about) and the designer
        # picker's standard menu (so the assistant offers what the picker
        # offers). The enumeration is the optional half — if that read fails,
        # the standard menu is still worth returning, so the failure is
        # reported inline rather than replacing the answer.
        note = ""
        try:
            types = set(dc.list_model_types(ctx.deps.tenant_id, ctx.deps.token))
        except Exception as exc:  # noqa: BLE001 — surface to the model, never raise
            types = set()
            note = (f"\n(This tenant's own model list could not be read ({exc}), so "
                    f"only the standard models are shown — there may be more.)")
        types |= set(STANDARD_BUNDLE_MODELS)
        try:
            models = defs.fetch_models(ctx.deps.tenant_id, types, ctx.deps.token)
        except Exception as exc:  # noqa: BLE001
            return f"Could not load this tenant's entity models: {exc}"
        lines, absent = [], []
        for name in sorted(models):
            # `fetch_models` yields None for a type the tenant never set up;
            # a model with no fields is equally unusable for a section.
            fields = _model_fields(models[name])
            if fields:
                lines.append(f"- {name}: " + ", ".join(sorted(fields)))
            else:
                absent.append(name)
        if not lines:
            return ("This tenant has no entity models set up, so no form section "
                    "can be authored yet. Tell the admin their entity models "
                    "(student, family, ...) must exist before a form step can "
                    "collect anything." + note)
        out = "\n".join(lines)
        if absent:
            # Named, not hidden: "not set up here" is precisely the fact that
            # stops the model inventing a section against one of them.
            out += ("\nNot set up in this tenant — do NOT bind a section to these: "
                    + ", ".join(absent))
        return out + note

    @agent.tool
    def get_entity_model(ctx: RunContext[ChatDeps], entity_type: str) -> str:
        """One entity model's fields with their type and required-ness — what
        a section's `fields: [{name, required}]` must be drawn from. Call this
        for every model you are about to author a section against, and pick
        real field names from it; never invent a field, and never leave a
        section's fields empty."""
        try:
            model = dc.get_model_definition(ctx.deps.tenant_id, entity_type,
                                            ctx.deps.token)
        except Exception as exc:  # noqa: BLE001 — an outage is not an absent model
            return (f"Could not load entity model '{entity_type}': {exc}. The model "
                    f"may well exist — do not treat this as missing.")
        fields = _model_fields(model)
        if not fields:
            return (f"This tenant has no entity model '{entity_type}' (or it declares "
                    f"no fields). Call list_entity_models for the models that do "
                    f"exist, and do not bind a section to '{entity_type}'.")
        lines = []
        for name in sorted(fields):
            f = fields[name]
            line = f"- {name}: {f.get('type') or 'unknown'}"
            if f.get("required"):
                line += " (required)"
            # The engine supplies these; validate_definition rejects a section
            # that names an engine-owned field, and link/id fields are never
            # section-writable in practice.
            if name in ENGINE_OWNED_FIELDS or _is_link_or_id_field(name):
                line += " [engine-supplied — do not pick]"
            lines.append(line)
        return f"Fields of entity model '{entity_type}':\n" + "\n".join(lines)

    @agent.tool
    def list_templates(ctx: RunContext[ChatDeps]) -> str:
        """List available workflow templates (template_id, name, description)."""
        return "\n".join(
            f"- {t['template_id']}: {t['name']} — {t['description']}"
            for t in template_catalog()
        )

    @agent.tool
    def get_template(ctx: RunContext[ChatDeps], template_id: str) -> str:
        """Full machine/steps/channel_access of one template — the base for a
        create-draft proposal."""
        for t in template_catalog():
            if t["template_id"] == template_id:
                return json.dumps(t["definition"])
        return f"No template named {template_id}. Call list_templates."


# --- form-section enrichment -------------------------------------------------
#
# WHY THIS IS ENRICHMENT AND NOT A GATE. The first pass at this problem
# (commit 9d9ac58) added the two model-reading tools and REFUSED a section
# whose `fields` was empty. It did not hold: a refusal only helps if the
# model's next attempt is better, and the two shapes that actually reach a
# card are ones a refusal never sees —
#
#   1. a section bound to a model the tenant does not have (`students`,
#      `student_info`, `family_info`) with plausible INVENTED field names. It
#      has fields, so the empty-fields gate passes it; `validate_definition`
#      has nothing to say about it either (its rules are about the fields a
#      section names against a model that exists), and the editor's field
#      picker resolves the model to nothing and renders the section with no
#      fields at all — the observed "empty form".
#   2. the same thing arriving through `update_section` / `update_step`,
#      which the gate never inspected.
#
# The tenant's models are readable from right here (the same helpers the read
# tools use), so the honest fix is to RESOLVE rather than complain: map the
# near-miss to the real model, intersect the picks with that model's real
# fields, and fill from the model when nothing survives. Refusal is kept for
# the single case this cannot answer — a model name that resembles nothing
# the tenant has — because guessing there would bind a form to the wrong
# entity, which is worse than asking.
#
# Enrichment runs on the PARSED copy that gets queued, so the card, the
# create/save request the admin's click sends, and the resulting draft all
# carry the enriched sections. An enrichment visible only in the string the
# model reads would be a no-op for the admin.

# Noise words a model appends to an entity name when it is describing a form
# rather than naming a type ("student_info", "family details"). Stripped from
# the TAIL only, so a genuine model called `session_data` is still matched
# exactly before any stripping happens.
_MODEL_NAME_NOISE = frozenset({
    "info", "information", "details", "detail", "data", "model", "section",
    "fields", "form", "record",
})


def _normalize_model_name(name: str) -> str:
    """Case/spacing/punctuation-insensitive form: `"Family Info"` ->
    `"family_info"`. Matching happens on this, never on the raw string."""
    return re.sub(r"[^a-z0-9]+", "_", (name or "").strip().lower()).strip("_")


def _number_forms(token: str) -> set[str]:
    """`{token}` plus its singular/plural counterparts — enough for the
    English shapes an LLM produces for entity names (`students`, `families`,
    `addresses`). Not a stemmer: over-generating here is harmless because
    every candidate is checked against the tenant's REAL model names, and a
    form that matches nothing is simply never used."""
    forms = {token, token + "s"}
    if token.endswith("ies") and len(token) > 3:
        forms.add(token[:-3] + "y")
    if token.endswith("es") and len(token) > 2:
        forms.add(token[:-2])
    if token.endswith("s") and not token.endswith("ss") and len(token) > 1:
        forms.add(token[:-1])
    return {f for f in forms if f}


def _name_variants(name: str) -> set[str]:
    """Every normalized spelling of `name` worth matching a model against."""
    base = _normalize_model_name(name)
    if not base:
        return set()
    stems = {base}
    parts = base.split("_")
    while len(parts) > 1 and parts[-1] in _MODEL_NAME_NOISE:
        parts = parts[:-1]
        stems.add("_".join(parts))
    variants: set[str] = set()
    for stem in stems:
        variants |= _number_forms(stem)
        segments = stem.split("_")
        if len(segments) > 1:
            # `student_information` -> student; `emergency_contact` -> contact.
            variants |= _number_forms(segments[0])
            variants |= _number_forms(segments[-1])
    return variants


def _resolve_entity_model(authored: str, available: list[str]) -> str | None:
    """The tenant model `authored` means, or None if it resembles none.

    Four passes, narrowest first, so an exact name can never lose to a fuzzy
    one. Ties inside a pass are broken by LONGEST normalized model name then
    alphabetically — the longest match is the most specific
    (`registration_application` over `registration`), and the alphabetical
    tiebreak keeps the result deterministic rather than dict-order dependent.
    """
    if authored in available:
        return authored
    by_norm: dict[str, str] = {}
    for model in available:
        by_norm.setdefault(_normalize_model_name(model), model)
    authored_norm = _normalize_model_name(authored)
    if authored_norm in by_norm:
        return by_norm[authored_norm]

    def _best(candidates: list[str]) -> str | None:
        if not candidates:
            return None
        return by_norm[sorted(candidates, key=lambda n: (-len(n), n))[0]]

    authored_variants = _name_variants(authored)
    # A spelling of the authored name IS a model name.
    hit = _best([n for n in by_norm if n in authored_variants])
    if hit is not None:
        return hit
    # A spelling of a model name and a spelling of the authored name agree.
    hit = _best([n for n in by_norm if _name_variants(n) & authored_variants])
    if hit is not None:
        return hit
    # Containment, either direction (`student_emergency` -> student).
    return _best([n for n in by_norm
                  if n and (n in authored_norm or authored_norm in n)])


def _pickable_model_fields(fields: dict[str, dict], conditional: bool) -> dict[str, dict]:
    """The subset of a model's fields a section may legally pick, in
    declaration order (base fields then custom — `_model_fields`' own order).

    Mirrors the editor's `fieldPicker.ts::pickableFields`, which mirrors
    validate.py: engine-owned fields are rejected outright
    (`_engine_owned_field_errors`), `{model}_id`-shaped fields are
    engine-supplied (`_is_link_or_id_field`), and a CONDITIONAL section may
    only include model-optional fields (`_coverage_errors`' conditional
    branch), where "optional" means not required or required-with-a-default.

    NO CAP, deliberately: the unconditional coverage rule requires every
    model-required field to be included+required by some unconditional
    section, so a truncated auto-fill would produce a draft that fails
    validation — and this is exactly the menu the editor's own picker offers,
    so the admin sees no more here than they would there.
    """
    out: dict[str, dict] = {}
    for name, fdef in fields.items():
        if name in ENGINE_OWNED_FIELDS or _is_link_or_id_field(name):
            continue
        if conditional and fdef.get("required") and "default" not in fdef:
            continue
        out[name] = fdef
    return out


def _enrich_fields(section: SectionDef, model_fields: dict[str, dict],
                   conditional: bool) -> list[str]:
    """Reconcile `section.fields` against its model. Mutates the section;
    returns one summary bullet per change made (empty when nothing changed).

    Three moves, in order: drop picks the model does not have (they render as
    nothing), fill from the model when nothing survives, and force-include
    the model-required fields a partial pick missed — the last being exactly
    what the editor does to a section on open (`syncModelRequiredFields`), so
    a proposal lands in the same shape a hand-edit would.
    """
    label = f"Section '{section.section_id}' ({section.entity_model})"
    pickable = _pickable_model_fields(model_fields, conditional)
    notes: list[str] = []

    kept: list[FieldPick] = []
    seen: set[str] = set()
    dropped: list[str] = []
    for pick in section.fields:
        if pick.name in pickable:
            if pick.name not in seen:
                seen.add(pick.name)
                kept.append(pick)
        else:
            dropped.append(pick.name)
    if dropped:
        notes.append(f"{label}: dropped field(s) the model does not have — "
                     + ", ".join(dropped) + ".")

    if not kept:
        kept = [FieldPick(name=name, required=bool(fdef.get("required")))
                for name, fdef in pickable.items()]
        seen = {pick.name for pick in kept}
        if kept:
            notes.append(f"{label}: default fields applied — "
                         + ", ".join(pick.name for pick in kept) + ".")
    else:
        added = [name for name, fdef in pickable.items()
                 if fdef.get("required") and "default" not in fdef and name not in seen]
        for name in added:
            kept.append(FieldPick(name=name, required=True))
        if added:
            notes.append(f"{label}: added model-required field(s) — "
                         + ", ".join(added) + ".")

    # A model-required field picked as optional does not satisfy the coverage
    # rule ("included+required by any unconditional section"), so the model's
    # own flag wins over the authored one. Never on a conditional section —
    # `pickable` has already excluded that class there.
    for pick in kept:
        fdef = pickable[pick.name]
        if fdef.get("required") and "default" not in fdef:
            pick.required = True

    section.fields = kept
    return notes


@dataclass
class _SectionSlot:
    """A parsed section plus the way to write the enriched copy back into the
    dict that will be QUEUED. The write-back is a callback because the four
    doors a section arrives through (a create step, `add_step`,
    `add_section`, `update_step.patch.config.sections`) each nest it
    somewhere different."""

    section: SectionDef
    conditional: bool
    write: Callable[[SectionDef], None]


def _list_slot(raw_list: list, index: int, conditional: bool) -> _SectionSlot:
    def write(section: SectionDef) -> None:
        raw_list[index] = section.model_dump(by_alias=True)

    return _SectionSlot(SectionDef.model_validate(raw_list[index]), conditional, write)


def _key_slot(container: dict, key: str, conditional: bool) -> _SectionSlot:
    """`add_section`'s door: the section sits under one key of the op dict
    that gets queued, so the write-back replaces that key."""
    def write(section: SectionDef) -> None:
        container[key] = section.model_dump(by_alias=True)

    return _SectionSlot(SectionDef.model_validate(container[key]), conditional, write)


def _step_section_slots(steps: list[StepDef]) -> list[_SectionSlot]:
    """Every declared section across `form` steps.

    The same walk `defs.referenced_entity_models` does, with the same
    `SectionDef.model_validate`, so it raises on exactly the payloads that
    function raises on — which is why callers run it INSIDE their parse-guard
    try. `step.config["sections"]` is mutated in place by the write-backs, so
    a later `step.model_dump(by_alias=True)` emits the enriched sections.
    """
    slots: list[_SectionSlot] = []
    for step in steps:
        if step.type != "form":
            continue
        raw_list = step.config.get("sections") or []
        for index in range(len(raw_list)):
            slots.append(_list_slot(raw_list, index, step.show_if is not None))
    return slots


def _patch_section_slots(op: dict) -> list[_SectionSlot]:
    """Sections carried whole inside an `update_step` patch.

    `UpdateStep.patch` is a free-form subset of StepDef, so `config.sections`
    reaches it as a complete section list — the third door into the same
    empty form, and the one the 9d9ac58 gate never looked at. `show_if` is
    read from the patch when it sets one; a patch that leaves it alone is
    treated as unconditional, which is the permissive direction (a
    conditional section is the strictly narrower field menu, and getting it
    wrong here can only mean auto-filling a field the admin can remove).
    """
    patch = op.get("patch")
    if not isinstance(patch, dict):
        return []
    config = patch.get("config")
    if not isinstance(config, dict):
        return []
    raw_list = config.get("sections") or []
    conditional = patch.get("show_if") is not None
    return [_list_slot(raw_list, index, conditional) for index in range(len(raw_list))]


def _load_model_fields(ctx: RunContext[ChatDeps]) -> dict[str, dict[str, dict]] | None:
    """`{model name: {field name: field def}}` for every model this tenant
    has, or None when that cannot be established.

    None is not "no models" — it is "do not enrich". An unreadable model list
    would make every tenant-specific model (`camp_session`) look like a name
    the tenant does not have, and enrichment would then REFUSE a perfectly
    good section over a DataCore blip. So the enumeration failing stands the
    whole pass down and leaves the payload exactly as authored; the
    empty-fields net below is what still runs.

    Models the tenant never set up come back from `fetch_models` as None and
    are filtered out here: a model with no fields cannot resolve a section
    and must not appear in the "available models" list a refusal offers.
    """
    try:
        types = set(dc.list_model_types(ctx.deps.tenant_id, ctx.deps.token))
    except Exception:  # noqa: BLE001 — see docstring: stand down, never refuse
        return None
    types |= set(STANDARD_BUNDLE_MODELS)
    try:
        models = defs.fetch_models(ctx.deps.tenant_id, types, ctx.deps.token)
    except Exception:  # noqa: BLE001
        return None
    fields = {name: _model_fields(model) for name, model in models.items()}
    return {name: f for name, f in fields.items() if f}


def _unresolvable(section_id: str, authored: str, available: list[str]) -> str:
    """The one refusal enrichment still issues. It names the models that DO
    exist, because a refusal the model cannot act on just produces the same
    proposal again."""
    return (f"Proposal rejected — section '{section_id}' binds to entity model "
            f"'{authored}', which is not one of this tenant's entity models and "
            f"does not resemble any of them. This tenant has: "
            f"{', '.join(available)}. Pick one of those (call get_entity_model "
            f"for its fields) and propose again.")


def _open_draft_section_models(ctx: RunContext[ChatDeps]) -> dict[str, str]:
    """`{section_id: entity_model}` for the draft open in the editor.

    An `update_section` patch that only touches `fields` still has a model —
    the one the section is already bound to — and without it that patch could
    not be enriched at all. Read through the same helpers `context.py` uses,
    and best-effort: a failed read means "enrich what you can", never a
    refusal.
    """
    if not ctx.deps.entity_id:
        return {}
    try:
        row = defs.require_definition_row(ctx.deps.tenant_id, ctx.deps.entity_id,
                                          ctx.deps.token)
        _machine, steps = defs.parse_machine_steps(row)
        return {slot.section.section_id: slot.section.entity_model
                for slot in _step_section_slots(steps)}
    except Exception:  # noqa: BLE001 — best-effort, see docstring
        return {}


def _enrich_section_patch(op: dict, index: dict[str, dict[str, dict]],
                          available: list[str], current: dict[str, str],
                          notes: list[str]) -> str | None:
    """`update_section` — a partial patch, so it is enriched key by key
    rather than through a whole SectionDef. Returns a refusal or None.

    Setting `entity_model` without `fields` deliberately rewrites `fields`
    too: the old picks belong to the old model, exactly the reasoning behind
    the editor's own `setEntityModel` resetting them.
    """
    patch = op.get("patch")
    if not isinstance(patch, dict):
        return None
    section_id = str(op.get("section_id") or "")
    authored = patch.get("entity_model")
    names_model = isinstance(authored, str) and bool(authored)

    if names_model:
        resolved = _resolve_entity_model(authored, available)
        if resolved is None:
            return _unresolvable(section_id, authored, available)
        if resolved != authored:
            notes.append(f"Section '{section_id}': entity model '{authored}' is not "
                         f"one of this tenant's models — bound to '{resolved}'.")
        patch["entity_model"] = resolved
    else:
        existing = current.get(section_id)
        resolved = _resolve_entity_model(existing, available) if existing else None

    if resolved is None or ("fields" not in patch and not names_model):
        return None
    try:
        picks = [FieldPick.model_validate(f) for f in (patch.get("fields") or [])]
    except (ValidationError, ValueError, TypeError) as exc:
        return (f"Proposal rejected — update_section '{section_id}' has a malformed "
                f"`fields` list: {exc}. Each entry is "
                "{\"name\": ..., \"required\": ...}.")
    probe = SectionDef(section_id=section_id, entity_model=resolved,
                       fields=picks, mode="create")
    notes.extend(_enrich_fields(probe, index[resolved], conditional=False))
    patch["fields"] = [pick.model_dump(by_alias=True) for pick in probe.fields]
    return None


def _enrich_sections(ctx: RunContext[ChatDeps], slots: list[_SectionSlot],
                     section_patch_ops: list[dict],
                     notes: list[str]) -> str | None:
    """Resolve every proposed section's model and fields against the tenant's
    real models. Returns a refusal string, or None when the payload is now
    good (enriched in place, ready to queue)."""
    if not slots and not section_patch_ops:
        return None
    index = _load_model_fields(ctx)
    if not index:
        return None  # unreadable or genuinely modelless — see _load_model_fields
    available = sorted(index)

    for slot in slots:
        section = slot.section
        resolved = _resolve_entity_model(section.entity_model, available)
        if resolved is None:
            return _unresolvable(section.section_id, section.entity_model, available)
        if resolved != section.entity_model:
            notes.append(f"Section '{section.section_id}': entity model "
                         f"'{section.entity_model}' is not one of this tenant's "
                         f"models — bound to '{resolved}'.")
            section.entity_model = resolved
        notes.extend(_enrich_fields(section, index[resolved], slot.conditional))
        slot.write(section)

    if section_patch_ops:
        # Read the open draft only when a patch needs it — one op naming its
        # own entity_model needs no lookup at all.
        current = ({} if all(o.get("patch", {}).get("entity_model")
                             for o in section_patch_ops)
                   else _open_draft_section_models(ctx))
        for op in section_patch_ops:
            refusal = _enrich_section_patch(op, index, available, current, notes)
            if refusal is not None:
                return refusal
    return None


def _empty_section_rejection(sections: list[SectionDef]) -> str | None:
    """Refusal text for the first section that STILL picks no fields, else
    None. The net under enrichment, not the primary defence any more.

    `fields: []` parses — an empty list is a valid `list[FieldPick]` — and it
    passes publish-time validation too, since every rule there is about the
    fields a section DOES name. So nothing downstream stops it, and the
    workflow the admin confirms contains a form step that renders blank.

    Two cases reach here now: enrichment stood down (the tenant's model list
    could not be read — see `_load_model_fields`), or the resolved model has
    no pickable fields at all, in which case there is nothing to fill from
    and asking is the only honest move.
    """
    for section in sections:
        if not section.fields:
            return (f"Proposal rejected — section '{section.section_id}' picks no "
                    f"fields, so its form would render empty. Call "
                    f"get_entity_model('{section.entity_model}') and put real field "
                    f"names into the section's `fields` list "
                    f"([{{\"name\": ..., \"required\": ...}}]), then propose again.")
    return None


def _with_notes(message: str, notes: list[str]) -> str:
    """The card carries the enrichment bullets in its summary; the model needs
    them too, or it will describe the workflow it authored rather than the one
    the admin is about to confirm."""
    if not notes:
        return message
    return message + "\nAdjusted before queueing:\n" + "\n".join(f"- {n}" for n in notes)


def register_proposal_tools(agent: Agent) -> None:
    """The write-PROPOSAL tools. Nothing here writes.

    A proposal tool appends a dict to `ctx.deps.pending_proposals`; `sse_chat`
    drains that list into `proposal` SSE frames after the run, the frontend
    renders a confirmation card from it, and the ADMIN's click is what calls
    the create/patch endpoint. So the queued dict is a wire contract, and it
    is validated here rather than trusted: a payload that would 422 at the
    create endpoint must never reach a card, because at that point the admin
    is the one holding a broken request. Same two properties as the read
    tools — returns a string, never raises — with the rejection text written
    so the model can correct itself and call again.
    """

    @agent.tool
    def propose_create_draft(
        ctx: RunContext[ChatDeps],
        name: str,
        machine: dict,
        steps: list[dict],
        channel_access: str = "staff_only",
        template_id: str | None = None,
        summary: list[str] | None = None,
    ) -> str:
        """Open a create-draft confirmation card. Call for ANY request to
        create/build a new workflow, passing the COMPLETE machine and steps
        (start from a template via get_template, or from the minimal skeleton
        for scratch builds) and a short human-readable summary of what you
        set up. Do NOT create the draft yourself — the admin confirms."""
        # The same models the create endpoint parses with, so "it parses here"
        # means "it parses there" — and `model_dump(by_alias=True)` re-emits
        # the wire keys (`from`, not `from_`) the card posts back.
        #
        # `referenced_entity_models` is in the try for a reason: `StepDef.config`
        # is `dict[str, Any]`, so a form step whose section is missing
        # entity_model/fields/mode validates as a StepDef and would otherwise
        # reach a card. It is a pure function over the PARSED steps whose only
        # work is `SectionDef.model_validate` on each declared section — the
        # same parse `create_definition` does — so calling it here is exactly
        # the "would this 422 downstream?" question, asked before the admin is
        # holding the request. It reads nothing.
        #
        # The catch is widened past ValidationError for the same reason
        # `app/api/designer.py` widens `_parse_or_422`'s: `config` is untyped
        # and entirely model-authored, so `{"sections": 5}` raises TypeError
        # while iterating rather than ValidationError. Every malformed payload
        # must come back as text — a raise here ends the SSE stream in `error`.
        try:
            m = MachineDef.model_validate(machine)
            s = [StepDef.model_validate(x) for x in steps]
            defs.referenced_entity_models(s)
            slots = _step_section_slots(s)
        except (ValidationError, ValueError, TypeError) as exc:
            return (f"Proposal rejected — the definition does not parse: {exc}. "
                    "Fix the payload and call propose_create_draft again.")
        # Best-effort enrichment on EVERY step's sections, before anything is
        # queued — see the "form-section enrichment" block above. It mutates
        # the parsed steps in place, so the by-alias dumps below carry the
        # resolved models and fields into the card and the created draft.
        notes: list[str] = []
        refusal = _enrich_sections(ctx, slots, [], notes)
        if refusal is not None:
            return refusal
        rejection = _empty_section_rejection([slot.section for slot in slots])
        if rejection is not None:
            return rejection
        if channel_access not in ("staff_only", "family"):
            return "channel_access must be 'staff_only' or 'family'."
        ctx.deps.pending_proposals.append({
            "action": "create_draft",
            "name": name,
            "template_id": template_id,
            "machine": m.model_dump(by_alias=True),
            "steps": [x.model_dump(by_alias=True) for x in s],
            "channel_access": channel_access,
            "summary": (summary or []) + notes,
        })
        return _with_notes(
            "Create-draft card is ready for the admin to confirm. Tell them "
            "to review and click Create draft — do not claim it exists yet.",
            notes)

    @agent.tool
    def propose_patch(ctx: RunContext[ChatDeps], ops: list[dict],
                      summary: list[str]) -> str:
        """Open a patch confirmation card changing the OPEN DRAFT. Only valid
        in editor context, and only when the open row is a draft (the editor
        context's `read_only` must be false). ops is a list of operations
        (add_stage, rename_stage,
        set_stage_kind, remove_stage, add_move, update_move, remove_move,
        add_step, update_step, remove_step, add_section, update_section,
        remove_section, set_channel_access) using ids from the editor context.
        summary: short human-readable bullet per meaningful change. Do NOT
        apply changes yourself — the admin confirms."""
        # The page guard is not a nicety. Every op addresses the open draft by
        # id, so off the editor page there is no draft for those ids to mean
        # anything against — the patch would be built entirely out of guesses.
        # The refusal names the tool that DOES work there so the model can
        # recover in one turn instead of retrying the same call.
        if ctx.deps.page != "editor":
            return ("No draft is open. Patching works only in the editor — for a "
                    "new workflow use propose_create_draft instead.")
        # The read-only guard, and it is not belt-and-braces either. Only a
        # draft can be saved (`save_definition` 409s `not_draft`), so a patch
        # queued against a published or superseded row is an offer that CANNOT
        # be taken: the card would render, Apply would write into the
        # editor's in-memory store — whose mutators silently no-op on a
        # non-draft row — and the admin would be told it worked. Refusing here
        # keeps that card from ever existing. The editor context already
        # carries the flag (`read_only`), so this costs no extra read.
        if ctx.deps.editor_read_only:
            return ("The open version is read-only — only a draft can be "
                    "patched. Tell the admin to create a new draft version of "
                    "this workflow (the New version action on the workflow "
                    "list) and ask again there; or use propose_create_draft "
                    "for a brand-new workflow. Do not re-call propose_patch "
                    "for this version.")
        # Structural validation only (see patch_ops.py): whether these ids
        # exist in the draft is the save PUT's question, asked when the admin
        # applies, exactly as it is for a hand-edit.
        #
        # `add_step` is the one op carrying a whole schema shape, so it is
        # parsed here against the same `StepDef` the save PUT parses, and its
        # sections with it — `StepDef.config` is `dict[str, Any]`, so a section
        # missing entity_model/fields/mode survives `StepDef.model_validate`
        # and is only ever parsed by `referenced_entity_models`. Without that
        # second call the malformed step reaches a card whose Apply then 422s,
        # with the admin holding the broken request.
        #
        # The catch is widened past ValidationError for the same reason
        # propose_create_draft's is: `config` is untyped and model-authored, so
        # `{"sections": 5}` raises TypeError while iterating rather than
        # ValidationError. Every malformed payload must come back as text — a
        # raise here ends the SSE stream in `error`.
        #
        # `add_section` carries a whole SectionDef in an equally untyped
        # `dict[str, Any]` and is parsed here for the same reason — it is the
        # other door to the same step content, and a half-built section
        # reaching a card fails at Apply exactly as a half-built step would.
        try:
            validated = validate_ops(ops)
            # `o["step"]` is `validate_ops`' by-alias dump, NOT the dict the
            # StepDef parsed from, so the parsed step is re-dumped over it
            # after enrichment (below) — mutating the StepDef alone would
            # leave the queued op carrying the un-enriched sections.
            added = [(o, StepDef.model_validate(o["step"])) for o in validated
                     if o["op"] == "add_step"]
            defs.referenced_entity_models([step for _o, step in added])
            slots = _step_section_slots([step for _o, step in added])
            for o in validated:
                if o["op"] == "add_section":
                    slots.append(_key_slot(o, "section", False))
                elif o["op"] == "update_step":
                    slots.extend(_patch_section_slots(o))
            section_patch_ops = [o for o in validated if o["op"] == "update_section"]
        except (ValidationError, ValueError, TypeError) as exc:
            return (f"Proposal rejected — invalid ops: {exc}. Fix the ops and "
                    "call propose_patch again.")
        # Enrichment on all FOUR doors a section reaches a draft through:
        # `add_step`'s own sections, `add_section`, `update_step`'s
        # `config.sections`, and `update_section`'s partial patch. The last
        # two were never inspected before, and they are how the assistant
        # edits a form it has already proposed.
        notes: list[str] = []
        refusal = _enrich_sections(ctx, slots, section_patch_ops, notes)
        if refusal is not None:
            return refusal
        for o, step in added:
            o["step"] = step.model_dump(by_alias=True)
        # The net under enrichment, on the doors that carry a whole section.
        rejection = _empty_section_rejection([slot.section for slot in slots])
        if rejection is not None:
            return rejection
        ctx.deps.pending_proposals.append(
            {"action": "patch", "ops": validated, "summary": summary + notes})
        return _with_notes(
            "Patch card is ready for the admin to review and Apply. Do not "
            "claim the change is applied yet.", notes)


def register_view_tools(agent: Agent) -> None:
    """Tools that SHOW the admin something. Nothing here writes, and nothing
    here offers to write.

    The card travels on `ChatDeps.pending_proposals` because that list is the
    only thing `sse_chat` drains, and `stream.py` is a VERBATIM port shared
    with admindash — adding an SSE frame type here would fork the wire
    protocol for both services over a card only one of them has. "Proposal"
    is therefore the transport's name, not this card's meaning; the frontend
    draws the distinction in `renderProposalCard`, which routes `show_flow`
    to a read-only card with no Apply.
    """

    @agent.tool
    def show_flow(ctx: RunContext[ChatDeps], entity_id: str | None = None) -> str:
        """Show the admin a diagram card for a workflow, with a button that
        opens the editor's Flow view. Call this INSTEAD of describing a
        workflow's shape at length, and never draw the flow yourself.
        Defaults to the workflow open in the editor; pass an entity_id from
        list_workflows to show a different one."""
        target = entity_id or ctx.deps.entity_id
        if not target:
            return ("No workflow is open, so there is nothing to show. Ask which "
                    "workflow they mean, or call list_workflows and pass its "
                    "entity_id.")
        try:
            row = defs.require_definition_row(ctx.deps.tenant_id, target,
                                              ctx.deps.token)
        # Same split as `get_workflow`: only a 404 is "not found". Reporting a
        # DataCore outage as missing would push the model toward offering to
        # CREATE a workflow that already exists.
        except HTTPException as exc:
            if exc.status_code == 404:
                return (f"Workflow {target} was not found in this tenant. "
                        f"Call list_workflows for the valid ids.")
            return (f"Could not load workflow {target}: {exc.detail} "
                    f"(status {exc.status_code}). The workflow may well exist — "
                    f"do not treat this as missing.")
        except Exception as exc:  # noqa: BLE001 — surface to the model, never raise
            return (f"Could not load workflow {target}: {exc}. The workflow may "
                    f"well exist — do not treat this as missing.")

        # A row whose stored definition does not parse would render as an
        # empty diagram that explains nothing. Refuse it here, where the
        # reason can still be said out loud.
        try:
            defs.parse_machine_steps(row)
        except Exception as exc:  # noqa: BLE001
            return (f"This row's stored definition does not parse, so it cannot "
                    f"be drawn: {exc}")

        resolved = row.get("entity_id")
        # The model narrating a flow tends to call this more than once in a
        # turn; the admin should not get the same card twice.
        already = any(p.get("action") == "show_flow" and p.get("entity_id") == resolved
                      for p in ctx.deps.pending_proposals)
        if not already:
            ctx.deps.pending_proposals.append({
                "action": "show_flow",
                "entity_id": resolved,
                "name": row.get("name"),
            })
        return (f"A flow card for {row.get('name')} is ready — the admin can open "
                f"the full diagram from it. Say what the workflow does in a "
                f"sentence or two; do not draw it.")
