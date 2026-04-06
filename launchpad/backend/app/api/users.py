"""User management endpoints — admin-only CRUD for tenant users."""
import httpx
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from app.api.auth import require_role, VALID_ROLES
from app.config import settings

router = APIRouter()


class CreateUserRequest(BaseModel):
    name: str
    email: str
    password: str
    role: str


class UpdateUserRequest(BaseModel):
    name: str | None = None
    role: str | None = None


def _registry_url(path: str) -> str:
    return f"{settings.datacore_api_url}/registry{path}"


@router.get("/tenants/{tenant_id}/users")
def list_users(tenant_id: str, user=Depends(require_role("admin"))):
    if user["tenant_id"] != tenant_id:
        raise HTTPException(status_code=403, detail="Tenant mismatch")
    resp = httpx.get(_registry_url("/users"), params={"tenant_id": tenant_id})
    if resp.status_code != 200:
        raise HTTPException(status_code=502, detail="Failed to fetch users")
    return resp.json()


@router.post("/tenants/{tenant_id}/users", status_code=201)
def create_user(tenant_id: str, body: CreateUserRequest, user=Depends(require_role("admin"))):
    if user["tenant_id"] != tenant_id:
        raise HTTPException(status_code=403, detail="Tenant mismatch")
    if body.role not in VALID_ROLES:
        raise HTTPException(status_code=422, detail=f"Invalid role. Must be one of: {', '.join(VALID_ROLES)}")

    existing = httpx.get(_registry_url("/users"), params={"email": body.email})
    if existing.status_code == 200 and len(existing.json()) > 0:
        raise HTTPException(status_code=409, detail="Email already registered")

    resp = httpx.post(_registry_url("/users"), json={
        "name": body.name,
        "email": body.email,
        "password": body.password,
        "tenant_id": tenant_id,
        "tenant_name": user["tenant_name"],
        "role": body.role,
    })
    if resp.status_code == 409:
        raise HTTPException(status_code=409, detail="Email already registered")
    if resp.status_code != 201:
        raise HTTPException(status_code=502, detail="Failed to create user")
    return resp.json()


@router.put("/tenants/{tenant_id}/users/{user_id}")
def update_user(tenant_id: str, user_id: str, body: UpdateUserRequest, user=Depends(require_role("admin"))):
    if user["tenant_id"] != tenant_id:
        raise HTTPException(status_code=403, detail="Tenant mismatch")
    if body.role and body.role not in VALID_ROLES:
        raise HTTPException(status_code=422, detail="Invalid role")

    if body.role and body.role != "admin" and user_id == user["user_id"]:
        users_resp = httpx.get(_registry_url("/users"), params={"tenant_id": tenant_id})
        if users_resp.status_code == 200:
            admin_count = sum(1 for u in users_resp.json() if u["role"] == "admin")
            if admin_count <= 1:
                raise HTTPException(status_code=400, detail="Cannot remove the last admin")

    fields = {k: v for k, v in body.model_dump().items() if v is not None}
    resp = httpx.put(_registry_url(f"/users/{user_id}"), json=fields)
    if resp.status_code == 404:
        raise HTTPException(status_code=404, detail="User not found")
    if resp.status_code != 200:
        raise HTTPException(status_code=502, detail="Failed to update user")
    return resp.json()


@router.delete("/tenants/{tenant_id}/users/{user_id}", status_code=204)
def delete_user(tenant_id: str, user_id: str, user=Depends(require_role("admin"))):
    if user["tenant_id"] != tenant_id:
        raise HTTPException(status_code=403, detail="Tenant mismatch")

    target_resp = httpx.get(_registry_url(f"/users/{user_id}"))
    if target_resp.status_code == 200:
        target = target_resp.json()
        if target.get("role") == "admin":
            users_resp = httpx.get(_registry_url("/users"), params={"tenant_id": tenant_id})
            if users_resp.status_code == 200:
                admin_count = sum(1 for u in users_resp.json() if u["role"] == "admin")
                if admin_count <= 1:
                    raise HTTPException(status_code=400, detail="Cannot remove the last admin")

    resp = httpx.delete(_registry_url(f"/users/{user_id}"))
    if resp.status_code == 404:
        raise HTTPException(status_code=404, detail="User not found")
