"""Pydantic model for user records from the DataCore global registry table."""
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
