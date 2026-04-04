"""Auth endpoints and dependencies — JWT-based login with test user config."""
from datetime import datetime, timedelta, timezone

import jwt
from fastapi import APIRouter, Depends, Header, HTTPException
from pydantic import BaseModel

from app.config import TestUser, settings

router = APIRouter()

# ─── JWT helpers ───────────────────────────────────────────────

def _create_token(user: TestUser) -> str:
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

def get_current_user(authorization: str = Header(...)) -> TestUser:
    """Decode JWT from Authorization header. Tries papermite secret first, then launchpad secret."""
    if not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Invalid authorization header")
    token = authorization[7:]

    # Try papermite's own secret first
    try:
        payload = _decode_token(token, settings.jwt_secret)
        user = settings.find_user_by_email(payload["email"])
        if not user:
            raise HTTPException(status_code=401, detail="User not found")
        return user
    except jwt.InvalidTokenError:
        pass

    # Try launchpad secret
    try:
        payload = _decode_token(token, settings.launchpad_jwt_secret)
        return TestUser(
            user_id=payload["user_id"],
            name=payload.get("name", payload["email"].split("@")[0]),
            email=payload["email"],
            password="",  # Not used for JWT-authenticated users
            tenant_id=payload["tenant_id"],
            tenant_name=payload.get("tenant_name", ""),
            role=payload["role"],
        )
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Invalid token")


def require_admin(user: TestUser = Depends(get_current_user)) -> TestUser:
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
def login(req: LoginRequest):
    """Authenticate with email + password, return JWT."""
    user = settings.find_user_by_email(req.email)
    if not user or user.password != req.password:
        raise HTTPException(status_code=401, detail="Invalid email or password")
    token = _create_token(user)
    # Exclude password from response
    user_data = user.model_dump()
    del user_data["password"]
    return {"token": token, "user": user_data}


@router.get("/me")
def get_me(user: TestUser = Depends(get_current_user)):
    """Return the authenticated user's profile."""
    user_data = user.model_dump()
    del user_data["password"]
    return user_data
