"""Auth endpoints and dependencies — JWT-based login with registry user lookup."""
from datetime import datetime, timedelta, timezone

import jwt
from fastapi import APIRouter, Depends, Header, HTTPException
from pydantic import BaseModel

from app.config import settings
from app.models.registry import UserRecord
from app.storage import get_registry_store
from app.storage.registry_store import RegistryStore

router = APIRouter()

# ─── JWT helpers ───────────────────────────────────────────────

def _create_token(user: UserRecord) -> str:
    payload = {
        "user_id": user.user_id,
        "email": user.email,
        "tenant_id": user.tenant_id,
        "role": user.role,
        "exp": datetime.now(timezone.utc) + timedelta(hours=settings.jwt_expiry_hours),
    }
    return jwt.encode(payload, settings.jwt_secret, algorithm="HS256")


def _decode_token(token: str, secret: str) -> dict:
    try:
        return jwt.decode(token, secret, algorithms=["HS256"])
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Token expired")
    except jwt.InvalidTokenError as e:
        raise e  # Let caller handle fallback


# ─── FastAPI dependencies ──────────────────────────────────────

def get_current_user(
    authorization: str = Header(...),
    registry: RegistryStore = Depends(get_registry_store),
) -> UserRecord:
    """Decode JWT from Authorization header. Tries papermite secret first, then launchpad secret."""
    if not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Invalid authorization header")
    token = authorization[7:]

    # Try papermite's own secret first
    try:
        payload = _decode_token(token, settings.jwt_secret)
        user = registry.get_user_by_email(payload["email"])
        if not user:
            raise HTTPException(status_code=401, detail="User not found")
        return user
    except jwt.InvalidTokenError:
        pass

    # Try launchpad secret
    try:
        payload = _decode_token(token, settings.launchpad_jwt_secret)
        return UserRecord(
            user_id=payload["user_id"],
            name=payload.get("name", payload["email"].split("@")[0]),
            email=payload["email"],
            password_hash="",
            tenant_id=payload["tenant_id"],
            tenant_name=payload.get("tenant_name", ""),
            role=payload["role"],
            created_at="",
        )
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Invalid token")


def require_admin(user: UserRecord = Depends(get_current_user)) -> UserRecord:
    """Verify the current user has admin role."""
    if user.role != "admin":
        raise HTTPException(status_code=403, detail="Requires admin role")
    return user


# ─── Routes ────────────────────────────────────────────────────

class LoginRequest(BaseModel):
    email: str
    password: str


class LoginResponse(BaseModel):
    token: str
    user: dict


@router.post("/login")
def login(req: LoginRequest, registry: RegistryStore = Depends(get_registry_store)):
    """Authenticate with email + password, return JWT."""
    user = registry.get_user_by_email(req.email)
    if not user or not RegistryStore.verify_password(req.password, user.password_hash):
        raise HTTPException(status_code=401, detail="Invalid credentials")
    token = _create_token(user)
    # Exclude password_hash from response
    user_data = user.model_dump()
    del user_data["password_hash"]
    return {"token": token, "user": user_data}


@router.get("/me")
def get_me(user: UserRecord = Depends(get_current_user)):
    """Return the authenticated user's profile."""
    user_data = user.model_dump()
    del user_data["password_hash"]
    return user_data
