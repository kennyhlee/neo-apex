"""Pydantic models for registry records — users and onboarding status."""

from pydantic import BaseModel


class UserRecord(BaseModel):
    user_id: str
    name: str
    email: str
    password_hash: str
    tenant_id: str
    tenant_name: str
    role: str  # admin, staff, teacher, parent
    created_at: str


class OnboardingStatus(BaseModel):
    tenant_id: str
    steps: list[dict]  # [{"id": "model_setup", "label": "...", "completed": bool}]
    is_complete: bool = False
