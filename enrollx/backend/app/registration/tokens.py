"""Magic-link tokens (roadmap contract, exact):

    signature = HMAC-SHA256(ENROLLX_LINK_SECRET, "{tenant}.{app_entity_id}.{token_version}")
    token     = urlsafe_b64("{tenant}.{app_entity_id}.{hex_signature}")  # padding stripped

No expiry field by design — revocation is bumping token_version on the
application entity. make_link_token / verify_link_token are BINDING names.

Security notes:
- Signature comparison uses hmac.compare_digest (constant-time) to avoid a
  timing oracle against the signature.
- Every malformed-input path (bad base64, wrong segment count, empty
  segments, decode errors) fails closed by raising TokenError — never an
  unhandled exception.
- Error messages never include the secret or a valid signature.
"""
import base64
import hashlib
import hmac

from app.config import settings


class TokenError(Exception):
    """Raised when a magic-link token is malformed, forged, or revoked."""


def _sign(tenant_id: str, application_id: str, token_version: int) -> str:
    msg = f"{tenant_id}.{application_id}.{int(token_version)}".encode()
    return hmac.new(settings.link_secret.encode(), msg, hashlib.sha256).hexdigest()


def make_link_token(tenant_id: str, application_id: str, token_version: int) -> str:
    raw = f"{tenant_id}.{application_id}.{_sign(tenant_id, application_id, token_version)}"
    return base64.urlsafe_b64encode(raw.encode()).decode().rstrip("=")


def parse_link_token(token: str) -> tuple[str, str, str]:
    try:
        if not token:
            raise ValueError("empty token")
        padded = token + "=" * (-len(token) % 4)
        raw = base64.urlsafe_b64decode(padded.encode()).decode()
        tenant_id, application_id, sig = raw.split(".")
        if not tenant_id or not application_id or not sig:
            raise ValueError("empty segment")
    except Exception as exc:
        raise TokenError("Malformed token") from exc
    return tenant_id, application_id, sig


def verify_link_token(token: str, token_version: int) -> tuple[str, str]:
    tenant_id, application_id, sig = parse_link_token(token)
    expected = _sign(tenant_id, application_id, token_version)
    if not hmac.compare_digest(sig, expected):
        raise TokenError("Invalid or revoked token")
    return tenant_id, application_id


def magic_link_url(token: str) -> str:
    return f"{settings.familyhub_url}/application/{token}"
