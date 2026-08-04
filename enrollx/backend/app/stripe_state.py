"""Signed OAuth `state` for Stripe Connect onboarding.

The state ties the Stripe redirect back to the tenant that initiated it and
expires, so the unauthenticated callback cannot be forged or replayed later.
Format: base64url("{tenant_id}.{issued_epoch}.{hex hmac-sha256}").
Signed with the same server secret as magic links (ENROLLX_LINK_SECRET) —
see app/registration/tokens.py, which this module deliberately mirrors:
constant-time signature comparison, fail-closed parsing on every malformed
shape, and no exception (or logged secret/signature) ever reaching a caller.

Divergence from tokens.py, by design (this task's brief, not an oversight):
- verify_state returns tenant_id | None instead of raising a TokenError —
  the OAuth callback has no scope-versioning story to report back to
  Stripe, so a plain None is all the caller needs.
- The state carries an `issued` timestamp and expires after
  STATE_TTL_SECONDS. Magic links deliberately have no expiry (revocation is
  bumping token_version instead) — that is a different tradeoff for a
  different channel and is NOT replicated here; this state is single-use,
  short-lived, and started interactively by a staff member, so a fixed TTL
  is the right shape and nothing about tokens.py's no-expiry design
  transfers to it.
- tokens.py's unbounded split()+exact-3-unpack is load-bearing there
  because BOTH tenant_id and application_id are attacker-adjacent dynamic
  fields, so a bounded split could let a dot shift the boundary between
  them. Here there is exactly one dynamic identity field (tenant_id);
  `issued` is decimal digits and `sig` is lowercase hex, neither of which
  can ever contain a literal '.'. rsplit(".", 2) therefore unambiguously
  peels the two fixed-shape trailing fields off the right regardless of
  any dots inside tenant_id itself — there is no second field for a dot to
  be confused with, so this bounded split does not reopen the class of bug
  tokens.py's comment warns about.

Freshness has TWO bounds, both measured against the verifying process's
own clock:
- STATE_TTL_SECONDS bounds how OLD `issued` may be — this is the replay
  window this module exists to close.
- STATE_CLOCK_SKEW_SECONDS bounds how far into the FUTURE `issued` may be.
  Without this, `time.time() - issued` for a future-dated `issued` is
  negative and therefore always <= STATE_TTL_SECONDS, so a state minted by
  a clock running ahead of the verifier's would never expire — the age
  check alone is not a bound on future-dated timestamps, only on past
  ones. enrollx runs multi-instance on Fly, so the instance that calls
  make_state and the instance that later calls verify_state are not
  guaranteed to share a clock; ordinary NTP drift between them is
  infrastructure behavior, not an attack. 60 seconds is generous slack for
  that drift (production hosts are typically NTP-synced to within a few
  seconds) while staying negligible next to the 15-minute TTL, so it does
  not meaningfully widen the callback replay window this mechanism bounds.
"""
import base64
import hashlib
import hmac
import time

from app.config import settings

STATE_TTL_SECONDS = 15 * 60
# Allowance for the verifying instance's clock to lag behind the minting
# instance's — see the module docstring's "Freshness has TWO bounds" note.
STATE_CLOCK_SKEW_SECONDS = 60


def _sign(tenant_id: str, issued: int) -> str:
    msg = f"{tenant_id}.{issued}".encode()
    return hmac.new(settings.link_secret.encode(), msg, hashlib.sha256).hexdigest()


def make_state(tenant_id: str) -> str:
    issued = int(time.time())
    raw = f"{tenant_id}.{issued}.{_sign(tenant_id, issued)}"
    return base64.urlsafe_b64encode(raw.encode()).decode().rstrip("=")


def verify_state(state: str) -> str | None:
    """Return the tenant_id if `state` is authentic and fresh, else None.

    Fails closed on every malformed shape — bad base64, wrong segment
    count, empty segments, a non-numeric issued time, a bad/tampered
    signature, a too-old `issued`, or a too-far-future `issued` beyond
    STATE_CLOCK_SKEW_SECONDS of clock slack — by falling through to the
    `except` below or an explicit `return None`. Never raises to the
    caller, and never includes the secret or a computed/expected signature
    in anything (there is nothing to log or raise here in the first
    place).

    CALLER OBLIGATION: `None` means authentication failed, full stop. The
    caller MUST treat it as a hard rejection of the callback — never fall
    through to a default tenant, an "anonymous" tenant, or any Stripe call
    keyed on the (absent) return value. `None` is the only falsy value this
    function can return (a real tenant_id is always a non-empty string, see
    _validate_id upstream), so `if not tenant_id:` is a safe and correct
    guard — but the point is to check it, not that a truthiness shortcut
    happens to be available. Skipping this check is exactly the cross-tenant
    Stripe-account-attachment attack this module exists to prevent.
    """
    try:
        padded = state + "=" * (-len(state) % 4)
        raw = base64.urlsafe_b64decode(padded.encode()).decode()
        tenant_id, issued_s, sig = raw.rsplit(".", 2)
        if not tenant_id or not issued_s or not sig:
            raise ValueError("empty segment")
        issued = int(issued_s)
    except Exception:
        return None
    if not hmac.compare_digest(sig, _sign(tenant_id, issued)):
        return None
    now = time.time()
    if now - issued > STATE_TTL_SECONDS:
        return None
    if issued - now > STATE_CLOCK_SKEW_SECONDS:
        return None
    return tenant_id
