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

from fastapi import HTTPException
from pydantic import ValidationError
from pydantic_ai import Agent, RunContext

from app.api.designer import STANDARD_BUNDLE_MODELS
from app.chat.deps import ChatDeps
from app.chat.patch_ops import validate_ops
from app.templates.catalog import template_catalog
from app.workflows import datacore as dc
from app.workflows import definitions as defs
from app.workflows.schema import ENGINE_OWNED_FIELDS, MachineDef, SectionDef, StepDef
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


def _step_sections(steps: list[StepDef]) -> list[SectionDef]:
    """Every declared section across `form` steps, parsed.

    The same walk `defs.referenced_entity_models` does (and the same
    `SectionDef.model_validate`), so on steps that function has already
    accepted this cannot raise — which is why the callers below run it
    outside their parse-guard try.
    """
    return [SectionDef.model_validate(raw)
            for step in steps if step.type == "form"
            for raw in step.config.get("sections", []) or []]


def _empty_section_rejection(sections: list[SectionDef]) -> str | None:
    """Refusal text for the first section that picks NO fields, else None.

    `fields: []` parses — an empty list is a valid `list[FieldPick]` — and it
    passes publish-time validation too, since every rule there is about the
    fields a section DOES name. So nothing downstream stops it, and the
    workflow the admin confirms contains a form step that renders blank. This
    was not hypothetical: an assistant with no way to read the tenant's entity
    models (before `list_entity_models`/`get_entity_model` existed) emitted
    exactly this, and the empty form only showed up when someone opened the
    step.

    Refusing at the proposal is the only place it can be caught before the
    admin is the one holding it, and the text names the section, the model to
    ask about, and the tool that answers — enough for the model to fix it in
    one turn instead of re-proposing the same shape.
    """
    for section in sections:
        if not section.fields:
            return (f"Proposal rejected — section '{section.section_id}' picks no "
                    f"fields, so its form would render empty. Call "
                    f"get_entity_model('{section.entity_model}') and put real field "
                    f"names into the section's `fields` list "
                    f"([{{\"name\": ..., \"required\": ...}}]), then propose again.")
    return None


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
        except (ValidationError, ValueError, TypeError) as exc:
            return (f"Proposal rejected — the definition does not parse: {exc}. "
                    "Fix the payload and call propose_create_draft again.")
        rejection = _empty_section_rejection(_step_sections(s))
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
            "summary": summary or [],
        })
        return ("Create-draft card is ready for the admin to confirm. Tell them "
                "to review and click Create draft — do not claim it exists yet.")

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
            added = [StepDef.model_validate(o["step"]) for o in validated
                     if o["op"] == "add_step"]
            defs.referenced_entity_models(added)
            sections = _step_sections(added) + [
                SectionDef.model_validate(o["section"]) for o in validated
                if o["op"] == "add_section"]
        except (ValidationError, ValueError, TypeError) as exc:
            return (f"Proposal rejected — invalid ops: {exc}. Fix the ops and "
                    "call propose_patch again.")
        # Same empty-form gate propose_create_draft applies, on both doors:
        # a step whose section picks nothing, and a section added to a step
        # that picks nothing, render identically blank.
        rejection = _empty_section_rejection(sections)
        if rejection is not None:
            return rejection
        ctx.deps.pending_proposals.append(
            {"action": "patch", "ops": validated, "summary": summary})
        return ("Patch card is ready for the admin to review and Apply. Do not "
                "claim the change is applied yet.")
