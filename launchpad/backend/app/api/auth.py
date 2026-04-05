"""Auth endpoints and dependencies — delegates to DataCore auth service."""
import httpx
from fastapi import APIRouter, Depends, Header, HTTPException
from pydantic import BaseModel

from app.config import settings

router = APIRouter()

VALID_ROLES = {"admin", "staff", "teacher", "parent"}


# ─── FastAPI dependencies ──────────────────────────────────────

def get_current_user(authorization: str = Header(...)):
    """Validate token by calling DataCore auth service."""
    if not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Invalid authorization header")
    resp = httpx.get(
        f"{settings.datacore_auth_url}/me",
        headers={"Authorization": authorization},
    )
    if resp.status_code != 200:
        raise HTTPException(status_code=401, detail="Invalid or expired token")
    return resp.json()


def require_role(*roles: str):
    """Factory for role-checking dependencies."""
    def dependency(user=Depends(get_current_user)):
        if user["role"] not in roles:
            raise HTTPException(status_code=403, detail=f"Requires one of: {', '.join(roles)}")
        return user
    return dependency


# ─── Request models ──────────────────────────────────────────

class LoginRequest(BaseModel):
    email: str
    password: str

class RegisterRequest(BaseModel):
    name: str
    email: str
    password: str
    tenant_name: str
    tenant_id: str

class CheckEmailRequest(BaseModel):
    email: str

class SuggestIdsRequest(BaseModel):
    email: str
    tenant_name: str


# ─── Routes (proxy to DataCore) ──────────────────────────────

@router.post("/login")
def login(req: LoginRequest):
    resp = httpx.post(
        f"{settings.datacore_auth_url}/login",
        json=req.model_dump(),
    )
    if resp.status_code != 200:
        raise HTTPException(status_code=resp.status_code, detail=resp.json().get("detail", "Login failed"))
    return resp.json()


@router.post("/register")
def register(req: RegisterRequest):
    resp = httpx.post(
        f"{settings.datacore_auth_url}/register",
        json=req.model_dump(),
    )
    if resp.status_code != 200:
        raise HTTPException(status_code=resp.status_code, detail=resp.json().get("detail", "Registration failed"))
    return resp.json()


@router.post("/register/check-email")
def check_email(req: CheckEmailRequest):
    resp = httpx.post(
        f"{settings.datacore_auth_url}/register/check-email",
        json=req.model_dump(),
    )
    if resp.status_code != 200:
        raise HTTPException(status_code=resp.status_code, detail=resp.json().get("detail", "Check failed"))
    return resp.json()


@router.post("/register/suggest-ids")
def suggest_ids(req: SuggestIdsRequest):
    resp = httpx.post(
        f"{settings.datacore_auth_url}/register/suggest-ids",
        json=req.model_dump(),
    )
    if resp.status_code != 200:
        raise HTTPException(status_code=resp.status_code, detail=resp.json().get("detail", "Suggest failed"))
    return resp.json()


@router.get("/me")
def get_me(user=Depends(get_current_user)):
    return user


@router.post("/exchange-code")
def exchange_code(authorization: str = Header(...)):
    """Get an exchange code for cross-service navigation."""
    resp = httpx.post(
        f"{settings.datacore_auth_url}/exchange-code",
        headers={"Authorization": authorization},
    )
    if resp.status_code != 200:
        raise HTTPException(status_code=resp.status_code, detail=resp.json().get("detail", "Exchange failed"))
    return resp.json()
