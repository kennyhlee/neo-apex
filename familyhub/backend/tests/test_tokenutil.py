# familyhub/backend/tests/test_tokenutil.py
"""Token PARSING only — familyhub never verifies signatures (enrollx does)."""
import base64

import pytest
from fastapi import HTTPException

from app.tokenutil import parse_token


def make_token(raw: str) -> str:
    return base64.urlsafe_b64encode(raw.encode()).decode().rstrip("=")


def test_parses_tenant_and_application():
    token = make_token("acme.RA260001.fakesignature")
    assert parse_token(token) == ("acme", "RA260001")


def test_extra_dot_segments_are_rejected_exactly_as_enrollx_rejects_them():
    """enrollx's parse_link_token uses an unbounded split with an exact-3
    unpack (tokens.py:81) and its comment explicitly forbids the bounded
    form. A 4-segment token can never be a token enrollx minted (the
    signature is hex), and familyhub must never be more lenient than the
    parser that signs."""
    with pytest.raises(HTTPException) as exc:
        parse_token(make_token("acme.RA260001.sig.with.dots"))
    assert exc.value.status_code == 400


def test_malformed_token_is_400():
    with pytest.raises(HTTPException) as exc:
        parse_token("!!!not-base64!!!")
    assert exc.value.status_code == 400


def test_token_without_three_parts_is_400():
    with pytest.raises(HTTPException):
        parse_token(make_token("no-dots-here"))
