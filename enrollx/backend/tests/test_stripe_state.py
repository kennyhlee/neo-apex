"""Signed Connect OAuth state: roundtrip, tamper, expiry, malformed input.

The state is the ONLY thing binding Stripe's unauthenticated OAuth callback
to the tenant that started the Connect flow — see stripe_state.py's module
docstring. Every test in this file that expects `None` is exercising a way
an attacker (or a bit-flip) might try to make a bad state look valid; each
must fail closed rather than raise or return a usable tenant_id.
"""
import base64
import time

import pytest

from app.config import settings


@pytest.fixture(autouse=True)
def link_secret(monkeypatch):
    monkeypatch.setattr(settings, "link_secret", "test-link-secret", raising=False)


def _encode(raw: str) -> str:
    return base64.urlsafe_b64encode(raw.encode()).decode().rstrip("=")


def test_state_roundtrip():
    from app.stripe_state import make_state, verify_state

    state = make_state("acme")
    assert verify_state(state) == "acme"


def test_state_rejects_tampered_tenant():
    from app.stripe_state import make_state, verify_state

    state = make_state("acme")
    padded = state + "=" * (-len(state) % 4)
    raw = base64.urlsafe_b64decode(padded.encode()).decode()
    tampered_raw = raw.replace("acme", "globex", 1)
    tampered = base64.urlsafe_b64encode(tampered_raw.encode()).decode().rstrip("=")
    assert verify_state(tampered) is None


def test_state_rejects_garbage():
    from app.stripe_state import verify_state

    assert verify_state("not-a-state") is None
    assert verify_state("") is None


def test_state_expires():
    from app.stripe_state import STATE_TTL_SECONDS, _sign, verify_state

    issued = int(time.time()) - STATE_TTL_SECONDS - 1
    raw = f"acme.{issued}.{_sign('acme', issued)}"
    stale = base64.urlsafe_b64encode(raw.encode()).decode().rstrip("=")
    assert verify_state(stale) is None


# ── Malformed-input matrix (parent-task requirement: each case its own test) ──


def test_state_rejects_bad_base64_encoding():
    from app.stripe_state import verify_state

    # '@' and '!' are outside the urlsafe-base64 alphabet, so decoding itself
    # fails (binascii.Error) before any parsing of the payload happens.
    assert verify_state("@@@@not-valid-base64!!!!") is None


def test_state_rejects_too_few_segments():
    from app.stripe_state import verify_state

    # Zero dots: nothing to unpack into (tenant_id, issued, sig).
    assert verify_state(_encode("justtenantnodots")) is None
    # One dot: only two fields present, still short of the required three.
    assert verify_state(_encode("acme.123")) is None


def test_state_rejects_empty_tenant_segment():
    from app.stripe_state import _sign, verify_state

    issued = int(time.time())
    raw = f".{issued}.{_sign('', issued)}"
    assert verify_state(_encode(raw)) is None


def test_state_rejects_empty_issued_segment():
    from app.stripe_state import verify_state

    raw = "acme..deadbeef"
    assert verify_state(_encode(raw)) is None


def test_state_rejects_empty_signature_segment():
    from app.stripe_state import verify_state

    issued = int(time.time())
    raw = f"acme.{issued}."
    assert verify_state(_encode(raw)) is None


def test_state_rejects_non_numeric_issued():
    from app.stripe_state import verify_state

    raw = "acme.not-a-number.deadbeefdeadbeefdeadbeefdeadbeef"
    assert verify_state(_encode(raw)) is None


def test_state_rejects_wrong_signature():
    from app.stripe_state import verify_state

    issued = int(time.time())
    raw = f"acme.{issued}." + "0" * 64  # well-formed shape, wrong signature
    assert verify_state(_encode(raw)) is None


def test_state_signed_for_tenant_a_does_not_verify_as_tenant_b():
    from app.stripe_state import make_state, verify_state

    state_a = make_state("acme")
    state_b = make_state("globex")

    assert verify_state(state_a) == "acme"
    assert verify_state(state_b) == "globex"
    assert verify_state(state_a) != "globex"

    # Graft tenant A's signature/issued-time onto tenant B's name — the
    # signature was computed over "acme", so it must not authenticate
    # "globex" even though the wire format is well-formed.
    padded = state_a + "=" * (-len(state_a) % 4)
    raw_a = base64.urlsafe_b64decode(padded.encode()).decode()
    _, issued_s, sig = raw_a.rsplit(".", 2)
    forged = _encode(f"globex.{issued_s}.{sig}")
    assert verify_state(forged) is None
