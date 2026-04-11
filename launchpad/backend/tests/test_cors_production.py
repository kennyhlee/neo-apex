"""Tests for production fail-closed CORS on launchpad backend."""
import pytest

from app.config import _cors_origins


def test_dev_mode_with_services_json_default(monkeypatch):
    monkeypatch.delenv("ENVIRONMENT", raising=False)
    monkeypatch.delenv("CORS_ALLOWED_ORIGINS", raising=False)
    origins = _cors_origins()
    assert any("localhost:5500" in o for o in origins), (
        f"Expected localhost:5500 in dev CORS origins, got: {origins}"
    )


def test_dev_mode_with_env_override(monkeypatch):
    monkeypatch.delenv("ENVIRONMENT", raising=False)
    monkeypatch.setenv("CORS_ALLOWED_ORIGINS", "http://example.com")
    origins = _cors_origins()
    assert origins == ["http://example.com"]


def test_production_without_origins_raises(monkeypatch):
    monkeypatch.setenv("ENVIRONMENT", "production")
    monkeypatch.delenv("CORS_ALLOWED_ORIGINS", raising=False)
    with pytest.raises(RuntimeError, match="CORS_ALLOWED_ORIGINS"):
        _cors_origins()


def test_production_with_wildcard_raises(monkeypatch):
    monkeypatch.setenv("ENVIRONMENT", "production")
    monkeypatch.setenv("CORS_ALLOWED_ORIGINS", "*")
    with pytest.raises(RuntimeError, match="wildcard"):
        _cors_origins()


def test_production_with_explicit_origin_succeeds(monkeypatch):
    monkeypatch.setenv("ENVIRONMENT", "production")
    monkeypatch.setenv("CORS_ALLOWED_ORIGINS", "https://launchpad.floatify.com")
    origins = _cors_origins()
    assert origins == ["https://launchpad.floatify.com"]
