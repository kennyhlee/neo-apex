"""Registration lifecycle routes: application creation + the single typed
action endpoint."""
from typing import Literal

from fastapi import APIRouter, Depends
from pydantic import BaseModel, ConfigDict

from app.registration import engine
from app.registration.actions import perform_action
from app.tenancy import require_staff_tenant

router = APIRouter()


class ApplicationCreate(BaseModel):
    """Whole-school application creation (spec §3).

    `extra="forbid"` is load-bearing, not tidiness: this is a shim-free
    cutover, so a caller still sending `program_id` must get a loud 422
    rather than have it silently dropped and a subtly wrong application
    created.
    """
    model_config = ConfigDict(extra="forbid")

    school_year: str
    channel: Literal["parent", "admin"]
    applicant_email: str | None = None


@router.post("/registration/{tenant_id}/applications", status_code=201)
def create_application(tenant_id: str, body: ApplicationCreate,
                       user=Depends(require_staff_tenant)):
    return engine.create_application(
        tenant_id, body.school_year, body.channel, body.applicant_email,
        actor=user.get("user_id", "staff"), token=user.get("_token"))


class ActionRequest(BaseModel):
    model_config = ConfigDict(extra="allow")

    action: str


@router.post("/registration/{tenant_id}/applications/{application_id}/actions")
def application_action(tenant_id: str, application_id: str, body: ActionRequest,
                       user=Depends(require_staff_tenant)):
    params = body.model_dump(exclude={"action"})
    return perform_action(tenant_id, application_id, body.action, params,
                          actor=user.get("user_id", "staff"), token=user.get("_token"))
