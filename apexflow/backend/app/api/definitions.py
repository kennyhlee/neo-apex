# apexflow/backend/app/api/definitions.py
"""Definitions API routes (Task 5): publish/lineage lifecycle actions +
model-impact scan.

Single typed-action endpoint, same shape as enrollx's
app/api/registration.py `application_action` (interface map's registration
precedent: `ActionRequest` with `extra="allow"` so action-specific params
like `force_cancel` ride alongside `action` without a per-action pydantic
model). All business logic lives in app.workflows.definitions — this module
is HTTP wiring only: parse the request, call the service function, let its
HTTPException (404/409/501) propagate.
"""
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict

from app.auth import require_staff_tenant
from app.workflows import definitions as defs
from app.workflows import machine

router = APIRouter(prefix="/api/workflows")


class ActionRequest(BaseModel):
    model_config = ConfigDict(extra="allow")

    action: str


def _cancel_one(tenant_id: str, instance_row: dict, actor: str, token: str | None) -> None:
    """`retire_definition`'s `cancel_instance_fn` collaborator (Task 8) —
    lives at the API layer (not in `app.workflows.definitions`) specifically
    to avoid a `definitions.py -> machine.py` import cycle; see
    `definitions.retire_definition`'s docstring."""
    ctx = machine.build_eval_context(tenant_id, instance_row, actor=actor, token=token)
    machine.cancel_instance(ctx)


@router.post("/{tenant_id}/definitions/{entity_id}/actions")
def definition_action(tenant_id: str, entity_id: str, body: ActionRequest,
                      user: dict = Depends(require_staff_tenant)):
    token = user.get("_token")
    actor = user.get("user_id", "staff")
    params = body.model_dump(exclude={"action"})

    if body.action == "publish":
        return defs.publish_definition(tenant_id, entity_id, token)
    if body.action == "deprecate":
        return defs.deprecate_definition(tenant_id, entity_id, token)
    if body.action == "reactivate":
        return defs.reactivate_definition(tenant_id, entity_id, token)
    if body.action == "retire":
        return defs.retire_definition(
            tenant_id, entity_id, force_cancel=bool(params.get("force_cancel")),
            actor=actor, token=token, cancel_instance_fn=_cancel_one)

    raise HTTPException(400, f"Unknown action: {body.action!r}")


@router.get("/{tenant_id}/model-impact")
def model_impact(tenant_id: str, entity_type: str, field: str | None = None,
                 user: dict = Depends(require_staff_tenant)):
    references = defs.model_impact(tenant_id, entity_type, field, user.get("_token"))
    return {"references": references}
