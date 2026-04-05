"""Auth dependencies — delegates token validation to DataCore auth service."""
import httpx
from fastapi import APIRouter, Depends, Header, HTTPException
from pydantic import BaseModel

from app.config import settings
from app.models.registry import UserRecord

router = APIRouter()


# ─── FastAPI dependencies ──────────────────────────────────────

def get_current_user(authorization: str = Header(...)) -> UserRecord:
    """Validate token by calling DataCore auth service."""
    if not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Invalid authorization header")
    resp = httpx.get(
        f"{settings.datacore_auth_url}/me",
        headers={"Authorization": authorization},
    )
    if resp.status_code != 200:
        raise HTTPException(status_code=401, detail="Invalid or expired token")
    data = resp.json()
    return UserRecord(
        user_id=data["user_id"],
        name=data["name"],
        email=data["email"],
        password_hash="",
        tenant_id=data["tenant_id"],
        tenant_name=data["tenant_name"],
        role=data["role"],
        created_at=data.get("created_at", ""),
    )


def require_admin(user: UserRecord = Depends(get_current_user)) -> UserRecord:
    """Verify the current user has admin role."""
    if user.role != "admin":
        raise HTTPException(status_code=403, detail="Requires admin role")
    return user


# ─── Routes ────────────────────────────────────────────────────

class LoginRequest(BaseModel):
    email: str
    password: str


@router.post("/login")
def login(req: LoginRequest):
    """Proxy login to DataCore auth service."""
    resp = httpx.post(
        f"{settings.datacore_auth_url}/login",
        json=req.model_dump(),
    )
    if resp.status_code != 200:
        raise HTTPException(status_code=resp.status_code, detail=resp.json().get("detail", "Login failed"))
    return resp.json()


@router.post("/redeem-code")
def redeem_code(code: str):
    """Redeem an exchange code from LaunchPad for a token."""
    resp = httpx.post(
        f"{settings.datacore_auth_url}/redeem-code",
        json={"code": code},
    )
    if resp.status_code != 200:
        raise HTTPException(status_code=resp.status_code, detail=resp.json().get("detail", "Invalid code"))
    return resp.json()


@router.get("/me")
def get_me(user: UserRecord = Depends(get_current_user)):
    """Return the authenticated user's profile."""
    user_data = user.model_dump()
    del user_data["password_hash"]
    return user_data
