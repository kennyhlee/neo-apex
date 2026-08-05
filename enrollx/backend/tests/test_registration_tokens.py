"""Magic-link tokens: round-trip, revocation by token_version, tampering."""
import re

import pytest

from app.registration.tokens import (
    TokenError,
    magic_link_url,
    make_link_token,
    parse_link_token,
    verify_link_token,
)


def test_round_trip():
    tok = make_link_token("acme", "abc123def456", 1)
    assert verify_link_token(tok, 1) == ("acme", "abc123def456")


def test_token_is_urlsafe():
    tok = make_link_token("acme", "abc123def456", 1)
    assert re.fullmatch(r"[A-Za-z0-9_-]+", tok)


def test_bumped_token_version_revokes():
    tok = make_link_token("acme", "abc123def456", 1)
    with pytest.raises(TokenError):
        verify_link_token(tok, 2)


def test_tampered_signature_rejected():
    tok = make_link_token("acme", "abc123def456", 1)
    bad = tok[:-2] + ("AA" if not tok.endswith("AA") else "BB")
    with pytest.raises(TokenError):
        verify_link_token(bad, 1)


def test_garbage_token_rejected():
    with pytest.raises(TokenError):
        parse_link_token("!!!not-base64!!!")
    with pytest.raises(TokenError):
        verify_link_token("aGVsbG8", 1)  # decodes, but has no dot-separated parts


def test_parse_exposes_scope_without_verifying():
    tok = make_link_token("acme", "abc123def456", 7)
    tenant_id, application_id, sig = parse_link_token(tok)
    assert (tenant_id, application_id) == ("acme", "abc123def456")
    assert len(sig) == 64  # hex sha256


def test_magic_link_url_uses_familyhub_base():
    tok = make_link_token("acme", "abc123def456", 1)
    assert magic_link_url(tok) == f"http://localhost:5620/application/{tok}"


def test_different_tenant_rejected():
    """A token minted for one tenant must not verify for another tenant."""
    tok = make_link_token("acme", "abc123def456", 1)
    tenant_id, application_id, sig = parse_link_token(tok)
    forged_raw = f"othertenant.{application_id}.{sig}"
    import base64

    forged = base64.urlsafe_b64encode(forged_raw.encode()).decode().rstrip("=")
    with pytest.raises(TokenError):
        verify_link_token(forged, 1)


def test_different_application_rejected():
    """A token minted for one application must not verify for another application."""
    tok = make_link_token("acme", "abc123def456", 1)
    tenant_id, application_id, sig = parse_link_token(tok)
    forged_raw = f"{tenant_id}.otherapp999.{sig}"
    import base64

    forged = base64.urlsafe_b64encode(forged_raw.encode()).decode().rstrip("=")
    with pytest.raises(TokenError):
        verify_link_token(forged, 1)


def test_empty_token_rejected():
    with pytest.raises(TokenError):
        parse_link_token("")
    with pytest.raises(TokenError):
        verify_link_token("", 1)


def test_wrong_segment_count_rejected():
    import base64

    # Only two segments (missing signature).
    too_few = base64.urlsafe_b64encode(b"acme.abc123def456").decode().rstrip("=")
    with pytest.raises(TokenError):
        parse_link_token(too_few)

    # Four segments (extra dot).
    too_many = base64.urlsafe_b64encode(b"acme.abc.123.def456").decode().rstrip("=")
    with pytest.raises(TokenError):
        parse_link_token(too_many)


def test_dot_in_tenant_id_rejected_at_mint():
    """A dot in tenant_id would break the delimiter-free invariant that
    parse_link_token's unbounded split() + exact-3 unpack relies on."""
    with pytest.raises(TokenError):
        make_link_token("ac.me", "abc123def456", 1)


def test_dot_in_application_id_rejected_at_mint():
    with pytest.raises(TokenError):
        make_link_token("acme", "abc.123", 1)


def test_empty_tenant_id_rejected_at_mint():
    with pytest.raises(TokenError):
        make_link_token("", "abc123def456", 1)


def test_empty_application_id_rejected_at_mint():
    with pytest.raises(TokenError):
        make_link_token("acme", "", 1)


def test_non_int_token_version_rejected_at_mint():
    with pytest.raises(TokenError):
        make_link_token("acme", "abc123def456", None)
    with pytest.raises(TokenError):
        make_link_token("acme", "abc123def456", "not-a-number")


def test_non_int_token_version_rejected_at_verify():
    tok = make_link_token("acme", "abc123def456", 1)
    with pytest.raises(TokenError):
        verify_link_token(tok, None)
    with pytest.raises(TokenError):
        verify_link_token(tok, "not-a-number")


def test_empty_segment_rejected():
    import base64

    empty_tenant = base64.urlsafe_b64encode(b".abc123def456.somesig").decode().rstrip("=")
    with pytest.raises(TokenError):
        verify_link_token(empty_tenant, 1)

    empty_app = base64.urlsafe_b64encode(b"acme..somesig").decode().rstrip("=")
    with pytest.raises(TokenError):
        verify_link_token(empty_app, 1)

    empty_sig = base64.urlsafe_b64encode(b"acme.abc123def456.").decode().rstrip("=")
    with pytest.raises(TokenError):
        verify_link_token(empty_sig, 1)
