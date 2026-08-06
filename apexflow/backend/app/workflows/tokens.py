# apexflow/backend/app/workflows/tokens.py
"""Magic-link tokens (roadmap contract, exact):

    signature = HMAC-SHA256(APEXFLOW_LINK_SECRET, "{tenant}.{app_entity_id}.{token_version}")
    token     = urlsafe_b64("{tenant}.{app_entity_id}.{hex_signature}")  # padding stripped

No expiry field by design — revocation is bumping token_version on the
workflow-instance entity. `make_link_token` / `verify_link_token` are BINDING
names, ported verbatim from enrollx/backend/app/registration/tokens.py — see
interface map §3.

ADJUST(bindings): task-1-brief.md's Interfaces section presumes this module
exposes `sign_link_token(tenant_id, instance_entity_id, token_version) -> str`
and `verify_link_token(token) -> (tenant_id, instance_entity_id) | raise`.
Neither that name nor that `verify_link_token` arity exists anywhere in
enrollx's source. The interface map (§3) transcribes the real names/signatures
verbatim: `make_link_token(tenant_id, application_id, token_version) -> str`
and `verify_link_token(token, token_version) -> tuple[str, str]` — the caller
supplies the expected token_version to check the signature against; there is
no version-less overload, since the whole point of a version bump is
revocation (an old token must stop verifying once the version moves).
Ported under the real names/signatures per the map, which overrides the
brief. `application_id` here is the DataCore entity_id of the workflow
instance (interface map Gotcha A: this is the opaque DataCore-assigned id,
never the human-readable business id), kept as-is rather than renamed to
`instance_entity_id` since the map cites it verbatim and a rename is exactly
the kind of "authored from memory" drift this map exists to prevent.

`magic_link_url` (enrollx tokens.py:97, `f"{settings.familyhub_url}/application/{token}"`)
was NOT ported: it is registration/familyhub-specific (task-1-brief.md Step 1:
"delete registration-specific ... code from the copies"), and apexflow's
Settings (app/config.py) has no `familyhub_url` field. A later task can add a
generic link-builder once apexflow has its own family-facing/link-consuming
channel.

Security notes:
- Signature comparison uses hmac.compare_digest (constant-time) to avoid a
  timing oracle against the signature.
- Every malformed-input path (bad base64, wrong segment count, empty
  segments, decode errors, non-int-castable token_version) fails closed by
  raising TokenError — never an unhandled exception.
- Error messages never include the secret or a valid signature.
- tenant_id and application_id must never contain '.'. This is enforced at
  mint time in make_link_token; see the comment on the split(".") in
  parse_link_token for why it is load-bearing for scope isolation.
"""
import base64
import hashlib
import hmac

from app.config import settings


class TokenError(Exception):
    """Raised when a magic-link token is malformed, forged, or revoked."""


def _sign(tenant_id: str, application_id: str, token_version: int) -> str:
    try:
        version = int(token_version)
    except (TypeError, ValueError) as exc:
        raise TokenError("token_version must be int-castable") from exc
    msg = f"{tenant_id}.{application_id}.{version}".encode()
    return hmac.new(settings.link_secret.encode(), msg, hashlib.sha256).hexdigest()


def _validate_scope(tenant_id: str, application_id: str) -> None:
    """Reject scope values that would break the delimiter-free invariant.

    parse_link_token's unbounded split(".") + exact-3 unpack only makes
    scope confusion impossible because tenant_id/application_id are
    guaranteed dot-free — enforcing that here, at mint time, is cheaper
    and louder than discovering a mis-minted token can never verify.
    """
    if not tenant_id or not application_id:
        raise TokenError("tenant_id and application_id must be non-empty")
    if "." in tenant_id or "." in application_id:
        raise TokenError("tenant_id and application_id must not contain '.'")


def make_link_token(tenant_id: str, application_id: str, token_version: int) -> str:
    _validate_scope(tenant_id, application_id)
    raw = f"{tenant_id}.{application_id}.{_sign(tenant_id, application_id, token_version)}"
    return base64.urlsafe_b64encode(raw.encode()).decode().rstrip("=")


def parse_link_token(token: str) -> tuple[str, str, str]:
    """Decode a token into (tenant_id, application_id, hex_signature).

    Does NOT check the signature — the return value is unauthenticated and
    must never be treated as proof of scope. Use verify_link_token to get
    an authenticated (tenant_id, application_id) pair.
    """
    try:
        if not token:
            raise ValueError("empty token")
        padded = token + "=" * (-len(token) % 4)
        raw = base64.urlsafe_b64decode(padded.encode()).decode()
        # Unbounded split (no maxsplit) + exact-3 unpack is load-bearing for
        # scope isolation: it guarantees a token decodes to a (tenant,
        # application, signature) triple in exactly one way, so no dot
        # placement can make two distinct (tenant_id, application_id) pairs
        # decode-and-sign identically. make_link_token enforces the dot-free
        # precondition this depends on. Do NOT change this to a bounded
        # split (maxsplit=2 / rsplit(..., 2)) "to be lenient about dots" —
        # that would let extra dots get absorbed into a field instead of
        # rejected, reopening that confusion class.
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
