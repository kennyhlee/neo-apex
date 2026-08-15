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

`register_proposal_tools` stays a no-op until Tasks 5-6; `build_chat_agent`
calls it unconditionally, so it must exist.
"""
import json

from pydantic_ai import Agent, RunContext

from app.chat.deps import ChatDeps
from app.templates.catalog import template_catalog
from app.workflows import datacore as dc
from app.workflows import definitions as defs
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
        # `require_definition_row` raises HTTPException(404) for an absent row
        # — routine here, since the model addresses rows by an entity_id it
        # read from `list_workflows` (or guessed). Caught broadly so a
        # DataCore-side failure is reported rather than killing the stream.
        except Exception as exc:  # noqa: BLE001
            return (f"No workflow row with entity_id={entity_id} was found "
                    f"({exc}). Call list_workflows for the valid ids.")
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
    """filled in by Tasks 5-6"""
