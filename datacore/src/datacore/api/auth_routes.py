"""Auth API routes — login, token validation, exchange codes."""
import re

from fastapi import APIRouter, HTTPException, Header
from pydantic import BaseModel

from datacore.auth.config import AuthConfig
from datacore.auth.exchange import ExchangeStore
from datacore.auth.passwords import verify_password
from datacore.auth.tokens import TokenError, create_token, decode_token
from datacore.store import Store

router = APIRouter(prefix="/auth", tags=["auth"])

_config: AuthConfig | None = None
_exchange: ExchangeStore | None = None
_registry = None  # set in register_auth_routes via deferred import


class LoginRequest(BaseModel):
    email: str
    password: str


class RedeemRequest(BaseModel):
    code: str


def register_auth_routes(app, store: Store, config: AuthConfig | None = None) -> None:
    global _config, _exchange, _registry
    _config = config or AuthConfig()
    _exchange = ExchangeStore(ttl_seconds=30)
    from datacore.api import registry_routes
    _registry = registry_routes
    app.include_router(router)


def _sanitize_user(user_data: dict) -> dict:
    return {k: v for k, v in user_data.items() if k != "password_hash"}


def _extract_bearer_token(authorization: str) -> str:
    if not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Invalid authorization header")
    return authorization[7:]


@router.post("/login")
def login(req: LoginRequest):
    user = _registry.get_user_by_email(req.email)
    if not user or not verify_password(req.password, user["password_hash"]):
        raise HTTPException(status_code=401, detail="Invalid credentials")
    token = create_token(
        _config,
        user_id=user["user_id"],
        email=user["email"],
        tenant_id=user["tenant_id"],
        role=user["role"],
    )
    return {"token": token, "user": _sanitize_user(user)}


@router.get("/me")
def get_me(authorization: str = Header(None)):
    if not authorization:
        raise HTTPException(status_code=401, detail="Missing authorization header")
    token = _extract_bearer_token(authorization)
    try:
        payload = decode_token(_config, token)
    except TokenError as e:
        raise HTTPException(status_code=401, detail=str(e))
    user = _registry.get_user_by_id(payload["user_id"])
    if not user:
        raise HTTPException(status_code=401, detail="User not found")
    return _sanitize_user(user)


@router.post("/exchange-code")
def exchange_code(authorization: str = Header(None)):
    if not authorization:
        raise HTTPException(status_code=401, detail="Missing authorization header")
    token = _extract_bearer_token(authorization)
    try:
        decode_token(_config, token)
    except TokenError as e:
        raise HTTPException(status_code=401, detail=str(e))
    code = _exchange.create(token)
    return {"code": code}


@router.post("/redeem-code")
def redeem_code(req: RedeemRequest):
    token = _exchange.redeem(req.code)
    if token is None:
        raise HTTPException(status_code=401, detail="Invalid or expired code")
    return {"token": token}


# ---------------------------------------------------------------------------
# Registration endpoints
# ---------------------------------------------------------------------------

TENANT_ID_PATTERN = re.compile(r"^[a-z][a-z0-9-]{2,39}$")
COMMON_EMAIL_PROVIDERS = frozenset({
    "gmail.com", "yahoo.com", "hotmail.com", "outlook.com",
    "icloud.com", "protonmail.com", "aol.com", "mail.com", "zoho.com",
    "live.com", "msn.com", "ymail.com",
})


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


def _mask_email(email: str) -> str:
    local, domain = email.split("@")
    return f"{local[0]}***@{domain}"


def _generate_slug_candidates(email: str, tenant_name: str) -> list[str]:
    domain = email.split("@")[-1].lower()
    is_common = domain in COMMON_EMAIL_PROVIDERS
    words = re.sub(r"[^a-z0-9]+", " ", tenant_name.lower()).split()
    candidates = []

    if not is_common:
        stem = domain.split(".")[0]
        if stem and TENANT_ID_PATTERN.match(stem):
            candidates.append(stem)

    if len(words) >= 2:
        slug = f"{words[0]}-{words[1]}"
        if TENANT_ID_PATTERN.match(slug):
            candidates.append(slug)

    if len(words) >= 2:
        initials = "-".join([words[0], "".join(w[0] for w in words[1:])])
        if TENANT_ID_PATTERN.match(initials):
            candidates.append(initials)

    if len(words) >= 2:
        rev = f"{words[1]}-{words[0]}"
        if TENANT_ID_PATTERN.match(rev):
            candidates.append(rev)

    full = "-".join(words)
    if TENANT_ID_PATTERN.match(full) and full not in candidates:
        candidates.append(full)

    seen = set()
    unique = []
    for c in candidates:
        if c not in seen:
            seen.add(c)
            unique.append(c)
    return unique


@router.post("/register")
def register(req: RegisterRequest):
    if not TENANT_ID_PATTERN.match(req.tenant_id):
        raise HTTPException(
            status_code=422,
            detail="Invalid tenant ID format. Must be 3-40 lowercase alphanumeric characters and hyphens, starting with a letter.",
        )
    if _registry.get_onboarding(req.tenant_id) is not None:
        raise HTTPException(status_code=409, detail="Tenant ID already taken")
    if _registry.get_user_by_email(req.email):
        raise HTTPException(status_code=409, detail="Email already registered")

    user_data = _registry.create_user_record(
        name=req.name,
        email=req.email,
        password=req.password,
        tenant_id=req.tenant_id,
        tenant_name=req.tenant_name,
        role="admin",
    )
    _registry.create_onboarding(req.tenant_id)

    token = create_token(
        _config,
        user_id=user_data["user_id"],
        email=user_data["email"],
        tenant_id=user_data["tenant_id"],
        role=user_data["role"],
    )
    return {"token": token, "user": _sanitize_user(user_data)}


@router.post("/register/check-email")
def check_email(req: CheckEmailRequest):
    domain = req.email.split("@")[-1].lower()
    if domain in COMMON_EMAIL_PROVIDERS:
        return {"status": "new_tenant", "admin_email_hint": None}
    users = _registry.get_users_by_email_domain(domain)
    admins = [u for u in users if u.get("role") == "admin"]
    if admins:
        return {
            "status": "org_exists",
            "admin_email_hint": _mask_email(admins[0]["email"]),
        }
    return {"status": "new_tenant", "admin_email_hint": None}


@router.post("/register/suggest-ids")
def suggest_ids(req: SuggestIdsRequest):
    candidates = _generate_slug_candidates(req.email, req.tenant_name)
    available = [c for c in candidates if _registry.get_onboarding(c) is None]
    return {"suggestions": available}
