"""Tests for apexflow backend production config validators."""
import pytest

from app.config import DEV_INTERNAL_KEY, DEV_LINK_SECRET, Settings

VALID = dict(
    environment="production",
    cors_allowed_origins="https://apexflow.example.com",
    link_secret="l" * 32,
    internal_key="k" * 32,
)


def test_production_boot_ok_with_real_secrets(monkeypatch):
    monkeypatch.delenv("TRUST_ALL_IPS", raising=False)
    Settings(**VALID)


def test_production_refuses_dev_default_link_secret(monkeypatch):
    monkeypatch.delenv("TRUST_ALL_IPS", raising=False)
    with pytest.raises(Exception, match="APEXFLOW_LINK_SECRET"):
        Settings(**{**VALID, "link_secret": DEV_LINK_SECRET})


def test_production_refuses_short_internal_key(monkeypatch):
    monkeypatch.delenv("TRUST_ALL_IPS", raising=False)
    with pytest.raises(Exception, match="32"):
        Settings(**{**VALID, "internal_key": "short"})


def test_production_refuses_trust_all_ips(monkeypatch):
    monkeypatch.delenv("TRUST_ALL_IPS", raising=False)
    monkeypatch.setenv("TRUST_ALL_IPS", "1")
    with pytest.raises(Exception, match="TRUST_ALL_IPS"):
        Settings(**VALID)


def test_development_allows_dev_defaults(monkeypatch):
    monkeypatch.setenv("TRUST_ALL_IPS", "1")
    Settings(environment="development")
