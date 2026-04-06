"""Registry API routes — user CRUD and onboarding endpoints."""
import copy
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from datacore.auth.passwords import hash_password
from datacore.store import Store

router = APIRouter(prefix="/api/registry", tags=["registry"])

_store: Store | None = None
REGISTRY_TABLE = "registry"

ONBOARDING_STEPS = [
    {"id": "model_setup", "label": "Set Up Model", "completed": False},
    {"id": "tenant_details", "label": "Tenant Details", "completed": False},
]


def register_registry_routes(app, store: Store) -> None:
    global _store
    _store = store
    app.include_router(router)


# ---------------------------------------------------------------------------
# Shared helper functions (may be imported by auth_routes in Task 3)
# ---------------------------------------------------------------------------

def get_user_by_email(email: str) -> dict | None:
    """Scan registry for a user matching email (case-insensitive)."""
    results = _store.query_global(REGISTRY_TABLE)
    for row in results:
        if not row["record_key"].startswith("user:"):
            continue
        if row["data"].get("email", "").lower() == email.lower():
            return row["data"]
    return None


def get_user_by_id(user_id: str) -> dict | None:
    """Fetch user by ID from the global registry table."""
    result = _store.get_global(REGISTRY_TABLE, f"user:{user_id}")
    if not result:
        return None
    return result["data"]


def create_user_record(
    name: str,
    email: str,
    password: str,
    tenant_id: str,
    tenant_name: str,
    role: str,
) -> dict:
    """Create and persist a user record. Returns the stored dict WITH password_hash — caller sanitizes."""
    user_id = f"u-{uuid.uuid4().hex[:8]}"
    now = datetime.now(timezone.utc).isoformat()
    user_data = {
        "user_id": user_id,
        "name": name,
        "email": email.lower(),
        "password_hash": hash_password(password),
        "tenant_id": tenant_id,
        "tenant_name": tenant_name,
        "role": role,
        "created_at": now,
    }
    _store.put_global(REGISTRY_TABLE, f"user:{user_id}", user_data)
    return user_data


def get_users_by_email_domain(domain: str) -> list[dict]:
    """Return all users whose email matches the given domain (case-insensitive)."""
    results = _store.query_global(REGISTRY_TABLE)
    users = []
    for row in results:
        if not row["record_key"].startswith("user:"):
            continue
        email = row["data"].get("email", "")
        if email.split("@")[-1].lower() == domain.lower():
            users.append(row["data"])
    return users


def get_onboarding(tenant_id: str) -> dict | None:
    """Fetch onboarding record for a tenant."""
    result = _store.get_global(REGISTRY_TABLE, f"onboarding:{tenant_id}")
    if not result:
        return None
    return result["data"]


def create_onboarding(tenant_id: str) -> dict:
    """Create default onboarding record for a tenant."""
    onboarding = {
        "tenant_id": tenant_id,
        "steps": copy.deepcopy(ONBOARDING_STEPS),
        "is_complete": False,
    }
    _store.put_global(REGISTRY_TABLE, f"onboarding:{tenant_id}", onboarding)
    return onboarding


def mark_step_complete(tenant_id: str, step_id: str) -> dict:
    """Mark a step as complete; set is_complete if all steps are done. Returns updated onboarding."""
    onboarding = get_onboarding(tenant_id)
    if onboarding is None:
        raise HTTPException(status_code=404, detail="Onboarding not found")

    updated = copy.deepcopy(onboarding)
    for step in updated["steps"]:
        if step["id"] == step_id:
            step["completed"] = True

    updated["is_complete"] = all(s["completed"] for s in updated["steps"])
    _store.put_global(REGISTRY_TABLE, f"onboarding:{tenant_id}", updated)
    return updated


# ---------------------------------------------------------------------------
# Pydantic models
# ---------------------------------------------------------------------------

class CreateUserRequest(BaseModel):
    name: str
    email: str
    password: str
    tenant_id: str
    tenant_name: str
    role: str


class UpdateUserRequest(BaseModel):
    name: str | None = None
    role: str | None = None


class CompleteStepRequest(BaseModel):
    step_id: str


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _sanitize_user(user_data: dict) -> dict:
    return {k: v for k, v in user_data.items() if k != "password_hash"}


# ---------------------------------------------------------------------------
# User endpoints
# ---------------------------------------------------------------------------

@router.get("/users")
def query_users(
    tenant_id: str | None = Query(default=None),
    email: str | None = Query(default=None),
):
    """List users with optional filters by tenant_id or email."""
    results = _store.query_global(REGISTRY_TABLE)
    users = []
    for row in results:
        if not row["record_key"].startswith("user:"):
            continue
        data = row["data"]
        if tenant_id and data.get("tenant_id") != tenant_id:
            continue
        if email and data.get("email", "").lower() != email.lower():
            continue
        users.append(_sanitize_user(data))
    return users


@router.post("/users")
def create_user(req: CreateUserRequest):
    """Create a new user. Returns 409 if email already exists."""
    if get_user_by_email(req.email):
        raise HTTPException(status_code=409, detail="Email already registered")
    user_data = create_user_record(
        name=req.name,
        email=req.email,
        password=req.password,
        tenant_id=req.tenant_id,
        tenant_name=req.tenant_name,
        role=req.role,
    )
    return JSONResponse(status_code=201, content=_sanitize_user(user_data))


@router.get("/users/{user_id}")
def get_user(user_id: str):
    """Get a single user by ID."""
    user = get_user_by_id(user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    return _sanitize_user(user)


@router.put("/users/{user_id}")
def update_user(user_id: str, req: UpdateUserRequest):
    """Partially update a user (name and/or role)."""
    user = get_user_by_id(user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    if req.name is not None:
        user["name"] = req.name
    if req.role is not None:
        user["role"] = req.role
    _store.put_global(REGISTRY_TABLE, f"user:{user_id}", user)
    return _sanitize_user(user)


@router.delete("/users/{user_id}")
def delete_user(user_id: str):
    """Delete a user by ID."""
    user = get_user_by_id(user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    _store.delete_global(REGISTRY_TABLE, f"user:{user_id}")
    return {"status": "deleted"}


# ---------------------------------------------------------------------------
# Onboarding endpoints
# ---------------------------------------------------------------------------

@router.get("/onboarding/{tenant_id}")
def get_onboarding_status(tenant_id: str):
    """Get onboarding status for a tenant."""
    onboarding = get_onboarding(tenant_id)
    if onboarding is None:
        raise HTTPException(status_code=404, detail="Onboarding not found")
    return onboarding


@router.post("/onboarding/{tenant_id}/complete-step")
def complete_step(tenant_id: str, req: CompleteStepRequest):
    """Mark an onboarding step as complete."""
    onboarding = get_onboarding(tenant_id)
    if onboarding is None:
        raise HTTPException(status_code=404, detail="Onboarding not found")
    return mark_step_complete(tenant_id, req.step_id)
