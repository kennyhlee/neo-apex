"""Auth API routes — login, token validation, exchange codes."""
from fastapi import APIRouter, HTTPException, Header
from pydantic import BaseModel

from datacore.auth.config import AuthConfig
from datacore.auth.exchange import ExchangeStore
from datacore.auth.passwords import verify_password
from datacore.auth.tokens import TokenError, create_token, decode_token
from datacore.store import Store

router = APIRouter(prefix="/auth", tags=["auth"])

_store: Store | None = None
_config: AuthConfig | None = None
_exchange: ExchangeStore | None = None

REGISTRY_TABLE = "registry"


class LoginRequest(BaseModel):
    email: str
    password: str


class RedeemRequest(BaseModel):
    code: str


def register_auth_routes(app, store: Store, config: AuthConfig | None = None) -> None:
    global _store, _config, _exchange
    _store = store
    _config = config or AuthConfig()
    _exchange = ExchangeStore(ttl_seconds=30)
    app.include_router(router)


def _get_user_by_email(email: str) -> dict | None:
    results = _store.query_global(REGISTRY_TABLE)
    for row in results:
        if not row["record_key"].startswith("user:"):
            continue
        if row["data"].get("email", "").lower() == email.lower():
            return row["data"]
    return None


def _get_user_by_id(user_id: str) -> dict | None:
    result = _store.get_global(REGISTRY_TABLE, f"user:{user_id}")
    if not result:
        return None
    return result["data"]


def _sanitize_user(user_data: dict) -> dict:
    return {k: v for k, v in user_data.items() if k != "password_hash"}


def _extract_bearer_token(authorization: str) -> str:
    if not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Invalid authorization header")
    return authorization[7:]


@router.post("/login")
def login(req: LoginRequest):
    user = _get_user_by_email(req.email)
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
    user = _get_user_by_id(payload["user_id"])
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
