"""Auth endpoints and dependencies — JWT login, registration, role guards."""
import re
from datetime import datetime, timedelta, timezone

import jwt
from fastapi import APIRouter, Depends, Header, HTTPException
from pydantic import BaseModel

from app.config import settings
from app.storage.registry_store import RegistryStore
from app.storage import get_registry_store

router = APIRouter()

VALID_ROLES = {"admin", "staff", "teacher", "parent"}

# ─── JWT helpers ───────────────────────────────────────────────

def _create_token(user_id: str, email: str, tenant_id: str, role: str) -> str:
    payload = {
        "user_id": user_id,
        "email": email,
        "tenant_id": tenant_id,
        "role": role,
        "exp": datetime.now(timezone.utc) + timedelta(hours=settings.jwt_expiry_hours),
    }
    return jwt.encode(payload, settings.jwt_secret, algorithm="HS256")

def _decode_token(token: str) -> dict:
    try:
        return jwt.decode(token, settings.jwt_secret, algorithms=["HS256"])
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Token expired")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Invalid token")

# ─── FastAPI dependencies ──────────────────────────────────────

def get_current_user(authorization: str = Header(...), registry: RegistryStore = Depends(get_registry_store)):
    """Decode JWT and return user record."""
    if not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Invalid authorization header")
    token = authorization[7:]
    payload = _decode_token(token)
    user = registry.get_user_by_id(payload["user_id"])
    if not user:
        raise HTTPException(status_code=401, detail="User not found")
    return user

def require_role(*roles: str):
    """Factory for role-checking dependencies."""
    def dependency(user=Depends(get_current_user)):
        if user.role not in roles:
            raise HTTPException(status_code=403, detail=f"Requires one of: {', '.join(roles)}")
        return user
    return dependency

# ─── Request/Response models ──────────────────────────────────

class LoginRequest(BaseModel):
    email: str
    password: str

class RegisterRequest(BaseModel):
    name: str
    email: str
    password: str
    tenant_name: str

def _slugify(name: str) -> str:
    """Convert name to kebab-case tenant_id."""
    slug = re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")
    return slug or "tenant"

# ─── Routes ────────────────────────────────────────────────────

@router.post("/login")
def login(req: LoginRequest, registry: RegistryStore = Depends(get_registry_store)):
    user = registry.get_user_by_email(req.email)
    if not user or not registry.verify_password(req.password, user.password_hash):
        raise HTTPException(status_code=401, detail="Invalid credentials")
    token = _create_token(user.user_id, user.email, user.tenant_id, user.role)
    user_data = user.model_dump()
    del user_data["password_hash"]
    return {"token": token, "user": user_data}

@router.post("/register")
def register(req: RegisterRequest, registry: RegistryStore = Depends(get_registry_store)):
    if registry.get_user_by_email(req.email):
        raise HTTPException(status_code=409, detail="Email already registered")
    base_id = _slugify(req.tenant_name)
    tenant_id = base_id
    suffix = 2
    while registry.get_onboarding(tenant_id) is not None:
        tenant_id = f"{base_id}-{suffix}"
        suffix += 1
    user = registry.create_user(
        name=req.name, email=req.email, password=req.password,
        tenant_id=tenant_id, tenant_name=req.tenant_name, role="admin",
    )
    registry.create_onboarding(tenant_id)
    token = _create_token(user.user_id, user.email, user.tenant_id, user.role)
    user_data = user.model_dump()
    del user_data["password_hash"]
    return {"token": token, "user": user_data}

@router.get("/me")
def get_me(user=Depends(get_current_user)):
    user_data = user.model_dump()
    del user_data["password_hash"]
    return user_data
