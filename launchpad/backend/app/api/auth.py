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

COMMON_EMAIL_PROVIDERS = frozenset({
    "gmail.com", "yahoo.com", "hotmail.com", "outlook.com",
    "icloud.com", "protonmail.com", "aol.com", "mail.com", "zoho.com",
    "live.com", "msn.com", "ymail.com",
})

TENANT_ID_PATTERN = re.compile(r"^[a-z][a-z0-9-]{2,39}$")

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
    tenant_id: str

class CheckEmailRequest(BaseModel):
    email: str

class CheckEmailResponse(BaseModel):
    status: str  # "new_tenant" or "org_exists"
    admin_email_hint: str | None = None

class SuggestIdsRequest(BaseModel):
    email: str
    tenant_name: str

class SuggestIdsResponse(BaseModel):
    suggestions: list[str]

# ─── Helpers ──────────────────────────────────────────────────

def _mask_email(email: str) -> str:
    """Mask email for privacy: jane@acme.edu -> j***@acme.edu"""
    local, domain = email.split("@")
    return f"{local[0]}***@{domain}"

def _generate_slug_candidates(email: str, tenant_name: str) -> list[str]:
    """Generate up to 5 deterministic tenant ID candidates."""
    domain = email.split("@")[-1].lower()
    is_common = domain in COMMON_EMAIL_PROVIDERS
    words = re.sub(r"[^a-z0-9]+", " ", tenant_name.lower()).split()
    candidates = []

    # 1. Domain stem (skip for common providers)
    if not is_common:
        stem = domain.split(".")[0]
        if stem and TENANT_ID_PATTERN.match(stem):
            candidates.append(stem)

    # 2. First two words
    if len(words) >= 2:
        slug = f"{words[0]}-{words[1]}"
        if TENANT_ID_PATTERN.match(slug):
            candidates.append(slug)

    # 3. Initials
    if len(words) >= 2:
        initials = "-".join([words[0], "".join(w[0] for w in words[1:])])
        if TENANT_ID_PATTERN.match(initials):
            candidates.append(initials)

    # 4. Reversed key words (first two reversed)
    if len(words) >= 2:
        rev = f"{words[1]}-{words[0]}"
        if TENANT_ID_PATTERN.match(rev):
            candidates.append(rev)

    # 5. Full slug
    full = "-".join(words)
    if TENANT_ID_PATTERN.match(full) and full not in candidates:
        candidates.append(full)

    # Deduplicate while preserving order
    seen = set()
    unique = []
    for c in candidates:
        if c not in seen:
            seen.add(c)
            unique.append(c)
    return unique

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

@router.post("/register/check-email")
def check_email(req: CheckEmailRequest, registry: RegistryStore = Depends(get_registry_store)):
    domain = req.email.split("@")[-1].lower()
    if domain in COMMON_EMAIL_PROVIDERS:
        return CheckEmailResponse(status="new_tenant")
    users = registry.get_users_by_email_domain(domain)
    admins = [u for u in users if u.role == "admin"]
    if admins:
        return CheckEmailResponse(
            status="org_exists",
            admin_email_hint=_mask_email(admins[0].email),
        )
    return CheckEmailResponse(status="new_tenant")

@router.post("/register/suggest-ids")
def suggest_ids(req: SuggestIdsRequest, registry: RegistryStore = Depends(get_registry_store)):
    candidates = _generate_slug_candidates(req.email, req.tenant_name)
    available = [c for c in candidates if registry.get_onboarding(c) is None]
    return SuggestIdsResponse(suggestions=available)

@router.post("/register")
def register(req: RegisterRequest, registry: RegistryStore = Depends(get_registry_store)):
    if not TENANT_ID_PATTERN.match(req.tenant_id):
        raise HTTPException(status_code=422, detail="Invalid tenant ID format. Must be 3-40 lowercase alphanumeric characters and hyphens, starting with a letter.")
    if registry.get_onboarding(req.tenant_id) is not None:
        raise HTTPException(status_code=409, detail="Tenant ID already taken")
    if registry.get_user_by_email(req.email):
        raise HTTPException(status_code=409, detail="Email already registered")
    user = registry.create_user(
        name=req.name, email=req.email, password=req.password,
        tenant_id=req.tenant_id, tenant_name=req.tenant_name, role="admin",
    )
    registry.create_onboarding(req.tenant_id)
    token = _create_token(user.user_id, user.email, user.tenant_id, user.role)
    user_data = user.model_dump()
    del user_data["password_hash"]
    return {"token": token, "user": user_data}

@router.get("/me")
def get_me(user=Depends(get_current_user)):
    user_data = user.model_dump()
    del user_data["password_hash"]
    return user_data
