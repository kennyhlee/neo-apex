"""New registration-related settings and their env overrides."""
import pytest
from pydantic import ValidationError


def _clean(monkeypatch):
    for var in (
        "ENROLLX_LINK_SECRET",
        "ENROLLX_INTERNAL_KEY",
        "ENROLLX_RESEND_API_KEY",
        "ENROLLX_EMAIL_FROM",
        "ENROLLX_FAMILYHUB_URL",
    ):
        monkeypatch.delenv(var, raising=False)


def test_registration_settings_defaults(monkeypatch):
    _clean(monkeypatch)
    from app.config import Settings

    s = Settings()
    assert s.link_secret == "dev-link-secret-change-in-prod"
    assert s.internal_key == "dev-internal-key-change-in-prod"
    assert s.resend_api_key == ""
    assert s.email_from == "NeoApex Registration <registration@floatify.com>"
    assert s.familyhub_url == "http://localhost:8080"


def test_registration_settings_env_overrides(monkeypatch):
    _clean(monkeypatch)
    monkeypatch.setenv("ENROLLX_LINK_SECRET", "s3cret")
    monkeypatch.setenv("ENROLLX_INTERNAL_KEY", "internal-k")
    monkeypatch.setenv("ENROLLX_RESEND_API_KEY", "re_123")
    monkeypatch.setenv("ENROLLX_EMAIL_FROM", "School <hi@school.org>")
    monkeypatch.setenv("ENROLLX_FAMILYHUB_URL", "https://familyhub.floatify.com")
    from app.config import Settings

    s = Settings()
    assert s.link_secret == "s3cret"
    assert s.internal_key == "internal-k"
    assert s.resend_api_key == "re_123"
    assert s.email_from == "School <hi@school.org>"
    assert s.familyhub_url == "https://familyhub.floatify.com"


# ── C2: production guard on the parent-channel secrets ────────────────────

STRONG = "x" * 32


def _prod(monkeypatch, **env):
    _clean(monkeypatch)
    monkeypatch.setenv("ENROLLX_ENVIRONMENT", "production")
    monkeypatch.setenv("ENROLLX_CORS_ALLOWED_ORIGINS", "https://familyhub.floatify.com")
    for k, v in env.items():
        monkeypatch.setenv(k, v)


def test_production_rejects_default_link_secret(monkeypatch):
    _prod(monkeypatch, ENROLLX_INTERNAL_KEY=STRONG)
    from app.config import Settings

    with pytest.raises(ValidationError) as exc:
        Settings()
    assert "ENROLLX_LINK_SECRET" in str(exc.value)
    assert "development default" in str(exc.value)


def test_production_rejects_default_internal_key(monkeypatch):
    _prod(monkeypatch, ENROLLX_LINK_SECRET=STRONG)
    from app.config import Settings

    with pytest.raises(ValidationError) as exc:
        Settings()
    assert "ENROLLX_INTERNAL_KEY" in str(exc.value)


def test_production_rejects_short_secret(monkeypatch):
    _prod(monkeypatch, ENROLLX_LINK_SECRET="x" * 31, ENROLLX_INTERNAL_KEY=STRONG)
    from app.config import Settings

    with pytest.raises(ValidationError) as exc:
        Settings()
    assert "at least 32 characters" in str(exc.value)


def test_production_accepts_strong_secrets(monkeypatch):
    _prod(monkeypatch, ENROLLX_LINK_SECRET="a" * 40, ENROLLX_INTERNAL_KEY="b" * 40)
    from app.config import Settings

    s = Settings()
    assert s.link_secret == "a" * 40
    assert s.internal_key == "b" * 40


def test_dev_and_test_still_start_with_defaults(monkeypatch):
    """The guard must not disturb dev/test — the whole suite relies on the
    dev defaults (tests/test_internal_api.py posts the dev internal key)."""
    _clean(monkeypatch)
    monkeypatch.delenv("ENROLLX_ENVIRONMENT", raising=False)
    from app.config import Settings

    assert Settings().link_secret == "dev-link-secret-change-in-prod"
    monkeypatch.setenv("ENROLLX_ENVIRONMENT", "development")
    assert Settings().internal_key == "dev-internal-key-change-in-prod"
