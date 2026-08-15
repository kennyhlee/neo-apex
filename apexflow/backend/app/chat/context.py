# apexflow/backend/app/chat/context.py
"""The editor-context block: condensed truth about the open draft, injected
into the system prompt on every turn from the editor page.

LOADED SERVER-SIDE, FROM THE ROW. The client sends `{page, entity_id}` and
nothing else — it does not send the definition. Two reasons, and the second
is the one that matters: a client-supplied definition would let any caller
dictate what the assistant believes it is editing, and the read here is
tenant-scoped (`require_definition_row` -> `get_entity`), so a client-claimed
`entity_id` for another tenant's row resolves to nothing rather than into the
prompt.

It reads through the same helpers `app/api/designer.py`'s bundle route does
(`require_definition_row` -> `parse_machine_steps` -> `fetch_models(...,
referenced_entity_models(steps), ...)` -> `validate_definition`), so what the
assistant is told about a draft is what the designer would show for it. A
second, chat-only read path would be free to drift.

NEVER RAISES for a failure it can name. This function is called inside
`_guarded_sse_chat`, so a raise IS reported as `error` + `done` rather than a
bare 500 — but "the draft you had open is gone" and "DataCore's models table
is down" are not reasons to refuse the whole conversation. The admin asked a
question; the assistant can still answer it (and can still reach the
definition through `get_workflow`). So each known failure degrades to prose
or to a partial block, exactly as `tools.py::get_workflow` degrades, and the
guarded wrapper stays the backstop for the unforeseen.
"""
import json

from app.workflows import definitions as defs
from app.workflows.validate import _model_fields, validate_definition

# `_model_fields` is private to validate.py but imported deliberately rather
# than re-derived: it is the definition of "a field of this model" that
# `validate_definition` itself uses (base_fields + custom_fields merged, since
# the two are validated identically). This block exists to tell the model
# which field names will pass validation — a second merge here could disagree
# with the one that actually decides, which is the whole failure mode.


def load_editor_context(tenant_id: str, entity_id: str, token: str | None) -> str:
    """The open draft as a system-prompt block: what it is, what is in it,
    what fields its entity models have, and what is currently wrong with it.

    Returns JSON on the happy path and a plain sentence on the degraded ones —
    both are just text to the model, and the sentence tells it what to do
    instead.
    """
    try:
        row = defs.require_definition_row(tenant_id, entity_id, token)
    except Exception as exc:  # noqa: BLE001 — a stale/foreign id is ordinary
        return (f"The open draft ({entity_id}) could not be loaded: {exc}. "
                f"Use list_workflows / get_workflow before proposing changes, "
                f"and do not guess ids.")

    try:
        machine, steps = defs.parse_machine_steps(row)
    except Exception as exc:  # noqa: BLE001
        return (f"The open definition '{row.get('name')}' is corrupt and cannot "
                f"be patched: {exc}")

    try:
        models = defs.fetch_models(tenant_id, defs.referenced_entity_models(steps),
                                   token)
        errors = validate_definition(machine, steps, models)
    except Exception as exc:  # noqa: BLE001
        # The definition parsed; only the model-coherence pass failed (e.g.
        # DataCore unreachable). The machine and steps are still worth handing
        # over — the model can reason about structure without them — so the
        # block survives with the failure named in place of the errors.
        models, errors = {}, [f"validation could not run: {exc}"]

    return json.dumps({
        "name": row.get("name"),
        "status": row.get("status"),
        # Only a draft is editable (`save_definition` 409s `not_draft` on any
        # other row), so the model must know before it offers to patch.
        "read_only": row.get("status") != "draft",
        "channel_access": row.get("channel_access"),
        "machine": machine.model_dump(by_alias=True),
        "steps": [s.model_dump(by_alias=True) for s in steps],
        # `fetch_models` yields None for a model the tenant never set up; that
        # reads as an empty field list, and `validation_errors` is where the
        # consequences show up.
        "entity_model_fields": {name: sorted(_model_fields(model))
                                for name, model in models.items()},
        "validation_errors": errors,
    })
