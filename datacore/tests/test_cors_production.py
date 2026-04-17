"""Tests for production fail-closed CORS on datacore."""
import pytest

from datacore.api import _load_cors_origins


def test_dev_mode_with_services_json_default(monkeypatch):
    """In dev mode (no ENVIRONMENT set), _load_cors_origins returns origins
    derived from services.json frontends (plus any CORS_ALLOWED_ORIGINS
    override)."""
    monkeypatch.delenv("ENVIRONMENT", raising=False)
    monkeypatch.delenv("CORS_ALLOWED_ORIGINS", raising=False)
    origins = _load_cors_origins()
    # At least one of the expected dev frontend origins should be in the list
    assert any("localhost:5600" in o for o in origins), (
        f"Expected localhost:5600 in dev CORS origins, got: {origins}"
    )


def test_dev_mode_with_env_override(monkeypatch):
    monkeypatch.delenv("ENVIRONMENT", raising=False)
    monkeypatch.setenv("CORS_ALLOWED_ORIGINS", "http://example.com")
    origins = _load_cors_origins()
    assert origins == ["http://example.com"]


def test_production_without_origins_raises(monkeypatch):
    monkeypatch.setenv("ENVIRONMENT", "production")
    monkeypatch.delenv("CORS_ALLOWED_ORIGINS", raising=False)
    with pytest.raises(RuntimeError, match="CORS_ALLOWED_ORIGINS"):
        _load_cors_origins()


def test_production_with_wildcard_raises(monkeypatch):
    monkeypatch.setenv("ENVIRONMENT", "production")
    monkeypatch.setenv("CORS_ALLOWED_ORIGINS", "*")
    with pytest.raises(RuntimeError, match="wildcard"):
        _load_cors_origins()


def test_production_with_explicit_origins_succeeds(monkeypatch):
    monkeypatch.setenv("ENVIRONMENT", "production")
    monkeypatch.setenv(
        "CORS_ALLOWED_ORIGINS",
        "https://launchpad.floatify.com,https://papermite.floatify.com",
    )
    origins = _load_cors_origins()
    assert origins == [
        "https://launchpad.floatify.com",
        "https://papermite.floatify.com",
    ]
