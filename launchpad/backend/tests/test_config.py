"""Tests for LaunchPad Settings."""
from app.config import Settings


def test_apexflow_backend_url_defaults_from_services_json(monkeypatch):
    monkeypatch.delenv("LAUNCHPAD_APEXFLOW_BACKEND_URL", raising=False)
    assert Settings().apexflow_backend_url == "http://localhost:5910"


def test_apexflow_backend_url_env_override(monkeypatch):
    monkeypatch.setenv("LAUNCHPAD_APEXFLOW_BACKEND_URL", "http://x:1")
    assert Settings().apexflow_backend_url == "http://x:1"
