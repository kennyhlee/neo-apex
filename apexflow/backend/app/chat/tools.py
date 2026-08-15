# apexflow/backend/app/chat/tools.py
"""Chat agent tool registrations.

`register_read_tools` is the model's whole view of tenant workflow data and
of the shipped template catalog. Two properties every tool here must keep:

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

from app.chat.deps import ChatDeps
from app.chat.patch_ops import validate_ops
from app.templates.catalog import template_catalog
from app.workflows import datacore as dc
from app.workflows import definitions as defs
from app.workflows.schema import MachineDef, StepDef
from app.workflows.validate import validate_definition


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
        try:
            validated = validate_ops(ops)
            added = [StepDef.model_validate(o["step"]) for o in validated
                     if o["op"] == "add_step"]
            defs.referenced_entity_models(added)
        except (ValidationError, ValueError, TypeError) as exc:
            return (f"Proposal rejected — invalid ops: {exc}. Fix the ops and "
                    "call propose_patch again.")
        ctx.deps.pending_proposals.append(
            {"action": "patch", "ops": validated, "summary": summary})
        return ("Patch card is ready for the admin to review and Apply. Do not "
                "claim the change is applied yet.")
