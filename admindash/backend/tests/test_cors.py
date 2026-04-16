"""Tests for production fail-closed CORS configuration."""
import pytest
from pydantic import ValidationError

from app.config import Settings


def test_dev_mode_allows_localhost_5600(monkeypatch):
    monkeypatch.delenv("ADMINDASH_ENVIRONMENT", raising=False)
    monkeypatch.delenv("ADMINDASH_CORS_ALLOWED_ORIGINS", raising=False)
    s = Settings()
    assert s.cors_allowed_origins == ["http://localhost:5600"]


def test_production_without_cors_origins_raises(monkeypatch):
    monkeypatch.setenv("ADMINDASH_ENVIRONMENT", "production")
    monkeypatch.delenv("ADMINDASH_CORS_ALLOWED_ORIGINS", raising=False)
    with pytest.raises(ValidationError, match="CORS_ALLOWED_ORIGINS"):
        Settings()


def test_production_with_wildcard_raises(monkeypatch):
    monkeypatch.setenv("ADMINDASH_ENVIRONMENT", "production")
    monkeypatch.setenv("ADMINDASH_CORS_ALLOWED_ORIGINS", "*")
    with pytest.raises(ValidationError, match="wildcard"):
        Settings()


def test_production_with_explicit_origin_succeeds(monkeypatch):
    monkeypatch.setenv("ADMINDASH_ENVIRONMENT", "production")
    monkeypatch.setenv(
        "ADMINDASH_CORS_ALLOWED_ORIGINS", "https://admin.floatify.com"
    )
    s = Settings()
    assert s.cors_allowed_origins == ["https://admin.floatify.com"]


def test_production_with_multiple_origins_comma_separated(monkeypatch):
    """Verify the workaround for pydantic-settings v2 List[str] JSON-decode quirk.

    A plain comma-separated string in the env var is correctly parsed into a
    list of stripped origins. This is the main code path of the model_validator
    workaround and is the reason the type is Union[Optional[str], List[str]].
    """
    monkeypatch.setenv("ADMINDASH_ENVIRONMENT", "production")
    monkeypatch.setenv(
        "ADMINDASH_CORS_ALLOWED_ORIGINS",
        "https://admin.floatify.com, https://other.floatify.com",
    )
    s = Settings()
    assert s.cors_allowed_origins == [
        "https://admin.floatify.com",
        "https://other.floatify.com",
    ]
