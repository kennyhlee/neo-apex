"""Tests for JWT token creation and validation."""
import time

from datacore.auth.config import AuthConfig
from datacore.auth.tokens import create_token, decode_token, TokenError


def _config():
    return AuthConfig(jwt_secret="test-secret", jwt_expiry_hours=1)


def test_create_and_decode():
    cfg = _config()
    token = create_token(
        cfg,
        user_id="u-001",
        email="jane@acme.edu",
        tenant_id="acme",
        role="admin",
    )
    payload = decode_token(cfg, token)
    assert payload["user_id"] == "u-001"
    assert payload["email"] == "jane@acme.edu"
    assert payload["tenant_id"] == "acme"
    assert payload["role"] == "admin"
    assert "exp" in payload


def test_invalid_token_raises():
    cfg = _config()
    try:
        decode_token(cfg, "not-a-token")
        assert False, "Should have raised"
    except TokenError as e:
        assert "Invalid token" in str(e)


def test_wrong_secret_raises():
    cfg = _config()
    token = create_token(cfg, user_id="u-001", email="a@b.com", tenant_id="t", role="admin")
    other_cfg = AuthConfig(jwt_secret="other-secret")
    try:
        decode_token(other_cfg, token)
        assert False, "Should have raised"
    except TokenError as e:
        assert "Invalid token" in str(e)


def test_expired_token_raises():
    cfg = AuthConfig(jwt_secret="test-secret", jwt_expiry_hours=-1)
    token = create_token(cfg, user_id="u-001", email="a@b.com", tenant_id="t", role="admin")
    try:
        decode_token(cfg, token)
        assert False, "Should have raised"
    except TokenError as e:
        assert "expired" in str(e).lower()
