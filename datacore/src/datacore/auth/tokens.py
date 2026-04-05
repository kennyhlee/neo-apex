"""JWT token creation and validation."""
from datetime import datetime, timedelta, timezone

import jwt

from datacore.auth.config import AuthConfig


class TokenError(Exception):
    """Raised when a token is invalid or expired."""


def create_token(
    config: AuthConfig,
    user_id: str,
    email: str,
    tenant_id: str,
    role: str,
) -> str:
    payload = {
        "user_id": user_id,
        "email": email,
        "tenant_id": tenant_id,
        "role": role,
        "exp": datetime.now(timezone.utc) + timedelta(hours=config.jwt_expiry_hours),
    }
    return jwt.encode(payload, config.jwt_secret, algorithm="HS256")


def decode_token(config: AuthConfig, token: str) -> dict:
    try:
        return jwt.decode(token, config.jwt_secret, algorithms=["HS256"])
    except jwt.ExpiredSignatureError:
        raise TokenError("Token expired")
    except jwt.InvalidTokenError:
        raise TokenError("Invalid token")
