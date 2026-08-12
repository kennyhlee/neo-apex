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


def _instance_op(op):
    """Build one of `archive_definition`/`unarchive_definition`'s per-instance
    collaborators. These live at the API layer (not in
    `app.workflows.definitions`) specifically to avoid a `definitions.py ->
    machine.py` import cycle; see `definitions.archive_definition`'s
    docstring."""
    def run(tenant_id: str, instance_row: dict, actor: str, token: str | None) -> None:
        ctx = machine.build_eval_context(tenant_id, instance_row, actor=actor, token=token)
        op(ctx)
    return run


_freeze_one = _instance_op(machine.freeze_instance)
_unfreeze_one = _instance_op(machine.unfreeze_instance)
_abandon_one = _instance_op(machine.abandon_instance)


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
    if body.action in ("archive", "retire"):
        # `retire` is retained for one release as an alias so an unmigrated
        # caller does not break mid-deploy; its legacy `force_cancel` param
        # maps onto `force`. Remove both once no caller sends it.
        force = bool(params.get("force") or params.get("force_cancel"))
        return defs.archive_definition(
            tenant_id, entity_id, force=force, actor=actor, token=token,
            freeze_instance_fn=_freeze_one, abandon_instance_fn=_abandon_one)
    if body.action == "unarchive":
        return defs.unarchive_definition(
            tenant_id, entity_id, actor=actor, token=token,
            unfreeze_instance_fn=_unfreeze_one)
    if body.action == "delete":
        return defs.delete_definition(tenant_id, entity_id, token)

    raise HTTPException(400, f"Unknown action: {body.action!r}")


@router.get("/{tenant_id}/model-impact")
def model_impact(tenant_id: str, entity_type: str, field: str | None = None,
                 user: dict = Depends(require_staff_tenant)):
    references = defs.model_impact(tenant_id, entity_type, field, user.get("_token"))
    return {"references": references}
