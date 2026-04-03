"""User management endpoints — admin-only CRUD for tenant users."""
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from app.api.auth import require_role, VALID_ROLES
from app.storage import get_registry_store
from app.storage.registry_store import RegistryStore

router = APIRouter()

class CreateUserRequest(BaseModel):
    name: str
    email: str
    password: str
    role: str

class UpdateUserRequest(BaseModel):
    name: str | None = None
    role: str | None = None

@router.get("/tenants/{tenant_id}/users")
def list_users(tenant_id: str, user=Depends(require_role("admin")), registry: RegistryStore = Depends(get_registry_store)):
    if user.tenant_id != tenant_id:
        raise HTTPException(status_code=403, detail="Tenant mismatch")
    users = registry.list_users_by_tenant(tenant_id)
    return [{k: v for k, v in u.model_dump().items() if k != "password_hash"} for u in users]

@router.post("/tenants/{tenant_id}/users", status_code=201)
def create_user(tenant_id: str, body: CreateUserRequest, user=Depends(require_role("admin")), registry: RegistryStore = Depends(get_registry_store)):
    if user.tenant_id != tenant_id:
        raise HTTPException(status_code=403, detail="Tenant mismatch")
    if body.role not in VALID_ROLES:
        raise HTTPException(status_code=422, detail=f"Invalid role. Must be one of: {', '.join(VALID_ROLES)}")
    if registry.get_user_by_email(body.email):
        raise HTTPException(status_code=409, detail="Email already registered")
    new_user = registry.create_user(
        name=body.name, email=body.email, password=body.password,
        tenant_id=tenant_id, tenant_name=user.tenant_name, role=body.role,
    )
    data = new_user.model_dump()
    del data["password_hash"]
    return data

@router.put("/tenants/{tenant_id}/users/{user_id}")
def update_user(tenant_id: str, user_id: str, body: UpdateUserRequest, user=Depends(require_role("admin")), registry: RegistryStore = Depends(get_registry_store)):
    if user.tenant_id != tenant_id:
        raise HTTPException(status_code=403, detail="Tenant mismatch")
    if body.role and body.role not in VALID_ROLES:
        raise HTTPException(status_code=422, detail="Invalid role")
    if body.role and body.role != "admin" and user_id == user.user_id:
        if registry.count_admins(tenant_id) <= 1:
            raise HTTPException(status_code=400, detail="Cannot remove the last admin")
    fields = {k: v for k, v in body.model_dump().items() if v is not None}
    try:
        updated = registry.update_user(user_id, **fields)
    except ValueError:
        raise HTTPException(status_code=404, detail="User not found")
    data = updated.model_dump()
    del data["password_hash"]
    return data

@router.delete("/tenants/{tenant_id}/users/{user_id}", status_code=204)
def delete_user(tenant_id: str, user_id: str, user=Depends(require_role("admin")), registry: RegistryStore = Depends(get_registry_store)):
    if user.tenant_id != tenant_id:
        raise HTTPException(status_code=403, detail="Tenant mismatch")
    target = registry.get_user_by_id(user_id)
    if target and target.role == "admin" and registry.count_admins(tenant_id) <= 1:
        raise HTTPException(status_code=400, detail="Cannot remove the last admin")
    if not registry.delete_user(user_id):
        raise HTTPException(status_code=404, detail="User not found")
