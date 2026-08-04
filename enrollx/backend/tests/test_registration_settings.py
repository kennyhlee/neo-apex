"""New registration-related settings and their env overrides."""


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
    assert s.familyhub_url == "http://localhost:6000"


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
