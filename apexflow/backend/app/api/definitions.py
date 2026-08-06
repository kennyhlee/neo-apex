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

router = APIRouter(prefix="/api/workflows")


class ActionRequest(BaseModel):
    model_config = ConfigDict(extra="allow")

    action: str


@router.post("/{tenant_id}/definitions/{entity_id}/actions")
def definition_action(tenant_id: str, entity_id: str, body: ActionRequest,
                      user: dict = Depends(require_staff_tenant)):
    token = user.get("_token")
    params = body.model_dump(exclude={"action"})

    if body.action == "publish":
        return defs.publish_definition(tenant_id, entity_id, token)
    if body.action == "deprecate":
        return defs.deprecate_definition(tenant_id, entity_id, token)
    if body.action == "reactivate":
        return defs.reactivate_definition(tenant_id, entity_id, token)
    if body.action == "retire":
        return defs.retire_definition(
            tenant_id, entity_id, force_cancel=bool(params.get("force_cancel")), token=token)

    raise HTTPException(400, f"Unknown action: {body.action!r}")


@router.get("/{tenant_id}/model-impact")
def model_impact(tenant_id: str, entity_type: str, field: str | None = None,
                 user: dict = Depends(require_staff_tenant)):
    references = defs.model_impact(tenant_id, entity_type, field, user.get("_token"))
    return {"references": references}
