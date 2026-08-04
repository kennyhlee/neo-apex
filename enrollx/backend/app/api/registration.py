"""Registration lifecycle routes: application creation + the single typed
action endpoint (the action route is added in the next task)."""
from typing import Literal

from fastapi import APIRouter, Depends
from pydantic import BaseModel

from app.registration import engine
from app.tenancy import require_staff_tenant

router = APIRouter()


class ApplicationCreate(BaseModel):
    program_id: str
    school_year: str
    channel: Literal["parent", "admin"]
    applicant_email: str | None = None


@router.post("/registration/{tenant_id}/applications", status_code=201)
def create_application(tenant_id: str, body: ApplicationCreate,
                       user=Depends(require_staff_tenant)):
    return engine.create_application(
        tenant_id, body.program_id, body.school_year, body.channel,
        body.applicant_email, actor=user.get("user_id", "staff"),
        token=user.get("_token"))
