"""Payment settings defaults."""
import pytest
from pydantic import ValidationError

from app.config import Settings


def test_payment_settings_defaults(monkeypatch):
    for var in (
        "ENROLLX_STRIPE_CLIENT_ID",
        "ENROLLX_STRIPE_SECRET_KEY",
        "ENROLLX_STRIPE_WEBHOOK_SECRET",
        "ENROLLX_STRIPE_REDIRECT_URL",
        "ENROLLX_FAMILYHUB_PUBLIC_URL",
        "ENROLLX_FRONTEND_PUBLIC_URL",
        "ENROLLX_BALANCE_DUE_DAYS",
        "ENROLLX_FAMILYHUB_URL",  # would otherwise feed the public_url fallback
    ):
        monkeypatch.delenv(var, raising=False)
    s = Settings()
    assert s.stripe_client_id == ""
    assert s.stripe_secret_key == ""
    assert s.stripe_webhook_secret == ""
    assert s.stripe_redirect_url == "http://localhost:5910/api/stripe/connect/callback"
    assert s.familyhub_public_url == "http://localhost:8080"
    assert s.frontend_public_url == "http://localhost:5900"
    assert s.balance_due_days == 30


def test_payment_settings_env_override(monkeypatch):
    monkeypatch.setenv("ENROLLX_STRIPE_CLIENT_ID", "ca_live_x")
    monkeypatch.setenv("ENROLLX_FAMILYHUB_PUBLIC_URL", "https://familyhub.floatify.com")
    monkeypatch.setenv("ENROLLX_BALANCE_DUE_DAYS", "14")
    s = Settings()
    assert s.stripe_client_id == "ca_live_x"
    assert s.familyhub_public_url == "https://familyhub.floatify.com"
    assert s.balance_due_days == 14


def test_stripe_importable():
    import stripe  # noqa: F401  — dependency added by this plan


# ── familyhub_public_url falls back to familyhub_url (Important 1) ────────
# familyhub_public_url and familyhub_url address the same public familyhub
# Worker with the same localhost default; an operator who only sets
# ENROLLX_FAMILYHUB_URL (for Plan 2 magic links) must not silently ship
# payment links pointed at localhost.

def _clean_familyhub_vars(monkeypatch):
    for var in ("ENROLLX_FAMILYHUB_URL", "ENROLLX_FAMILYHUB_PUBLIC_URL"):
        monkeypatch.delenv(var, raising=False)


def test_familyhub_public_url_falls_back_to_familyhub_url_when_unset(monkeypatch):
    _clean_familyhub_vars(monkeypatch)
    monkeypatch.setenv("ENROLLX_FAMILYHUB_URL", "https://familyhub.floatify.com")
    s = Settings()
    assert s.familyhub_public_url == "https://familyhub.floatify.com"
    assert s.familyhub_url == "https://familyhub.floatify.com"


def test_familyhub_public_url_fallback_satisfies_production_guard(monkeypatch):
    """The fallback must resolve before validate_production_secrets reads
    familyhub_public_url, so a deployment that only set
    ENROLLX_FAMILYHUB_URL still boots with Stripe configured."""
    _clean_familyhub_vars(monkeypatch)
    monkeypatch.setenv("ENROLLX_ENVIRONMENT", "production")
    monkeypatch.setenv("ENROLLX_CORS_ALLOWED_ORIGINS", "https://familyhub.floatify.com")
    monkeypatch.setenv("ENROLLX_LINK_SECRET", "x" * 32)
    monkeypatch.setenv("ENROLLX_INTERNAL_KEY", "y" * 32)
    monkeypatch.setenv("ENROLLX_STRIPE_SECRET_KEY", "sk_live_" + "x" * 40)
    monkeypatch.setenv("ENROLLX_STRIPE_WEBHOOK_SECRET", "whsec_" + "x" * 40)
    monkeypatch.setenv(
        "ENROLLX_STRIPE_REDIRECT_URL", "https://api.enrollx.floatify.com/api/stripe/connect/callback"
    )
    monkeypatch.setenv("ENROLLX_FRONTEND_PUBLIC_URL", "https://enrollx.floatify.com")
    monkeypatch.setenv("ENROLLX_FAMILYHUB_URL", "https://familyhub.floatify.com")
    s = Settings()
    assert s.familyhub_public_url == "https://familyhub.floatify.com"


def test_familyhub_public_url_independent_when_both_set(monkeypatch):
    """Someone who genuinely needs the two to differ keeps that ability."""
    _clean_familyhub_vars(monkeypatch)
    monkeypatch.setenv("ENROLLX_FAMILYHUB_URL", "https://links.floatify.com")
    monkeypatch.setenv("ENROLLX_FAMILYHUB_PUBLIC_URL", "https://pay.floatify.com")
    s = Settings()
    assert s.familyhub_url == "https://links.floatify.com"
    assert s.familyhub_public_url == "https://pay.floatify.com"


def test_familyhub_public_url_default_when_neither_set(monkeypatch):
    _clean_familyhub_vars(monkeypatch)
    s = Settings()
    assert s.familyhub_url == "http://localhost:8080"
    assert s.familyhub_public_url == "http://localhost:8080"


# ── C3: production guard on the Stripe secrets + public URLs ──────────────

STRONG = "x" * 32

ALL_PAYMENT_VARS = (
    "ENROLLX_STRIPE_CLIENT_ID",
    "ENROLLX_STRIPE_SECRET_KEY",
    "ENROLLX_STRIPE_WEBHOOK_SECRET",
    "ENROLLX_STRIPE_REDIRECT_URL",
    "ENROLLX_FAMILYHUB_PUBLIC_URL",
    "ENROLLX_FRONTEND_PUBLIC_URL",
    "ENROLLX_BALANCE_DUE_DAYS",
)


def _prod(monkeypatch, **env):
    """Baseline production env that satisfies every OTHER guard, so each
    test below isolates exactly one field's guard behavior."""
    for var in ALL_PAYMENT_VARS + ("ENROLLX_LINK_SECRET", "ENROLLX_INTERNAL_KEY"):
        monkeypatch.delenv(var, raising=False)
    monkeypatch.setenv("ENROLLX_ENVIRONMENT", "production")
    monkeypatch.setenv("ENROLLX_CORS_ALLOWED_ORIGINS", "https://familyhub.floatify.com")
    monkeypatch.setenv("ENROLLX_LINK_SECRET", STRONG)
    monkeypatch.setenv("ENROLLX_INTERNAL_KEY", STRONG)
    monkeypatch.setenv("ENROLLX_STRIPE_SECRET_KEY", "sk_live_" + "x" * 40)
    monkeypatch.setenv("ENROLLX_STRIPE_WEBHOOK_SECRET", "whsec_" + "x" * 40)
    monkeypatch.setenv("ENROLLX_STRIPE_REDIRECT_URL", "https://api.enrollx.floatify.com/api/stripe/connect/callback")
    monkeypatch.setenv("ENROLLX_FAMILYHUB_PUBLIC_URL", "https://familyhub.floatify.com")
    monkeypatch.setenv("ENROLLX_FRONTEND_PUBLIC_URL", "https://enrollx.floatify.com")
    for k, v in env.items():
        monkeypatch.setenv(k, v)


# stripe_client_id / stripe_secret_key — intentionally NOT guarded ─────
# Stripe is an optional per-tenant feature: a deployment with no Stripe
# integration at all must still boot in production.

def test_production_allows_empty_stripe_secret_key(monkeypatch):
    """No Stripe integration configured at all — a legitimate production
    state, not a startup failure."""
    _prod(monkeypatch)
    monkeypatch.delenv("ENROLLX_STRIPE_SECRET_KEY", raising=False)
    monkeypatch.delenv("ENROLLX_STRIPE_WEBHOOK_SECRET", raising=False)
    s = Settings()
    assert s.stripe_secret_key == ""


def test_production_accepts_strong_stripe_secret_key(monkeypatch):
    _prod(monkeypatch)
    s = Settings()
    assert s.stripe_secret_key.startswith("sk_live_")


# stripe_webhook_secret — guarded CONDITIONALLY on stripe_secret_key ───

def test_production_allows_empty_webhook_secret_when_stripe_not_configured(monkeypatch):
    """No secret key at all -> no webhook endpoint to protect -> nothing to
    require."""
    _prod(monkeypatch)
    monkeypatch.delenv("ENROLLX_STRIPE_SECRET_KEY", raising=False)
    monkeypatch.delenv("ENROLLX_STRIPE_WEBHOOK_SECRET", raising=False)
    s = Settings()
    assert s.stripe_webhook_secret == ""


def test_production_rejects_empty_webhook_secret_when_stripe_configured(monkeypatch):
    """Secret key IS set but webhook secret is missing -> incoming webhooks
    would have nothing to verify signatures against -> fail fast."""
    _prod(monkeypatch)
    monkeypatch.delenv("ENROLLX_STRIPE_WEBHOOK_SECRET", raising=False)
    with pytest.raises(ValidationError) as exc:
        Settings()
    assert "ENROLLX_STRIPE_WEBHOOK_SECRET" in str(exc.value)
    assert "development default" not in str(exc.value)


def test_production_accepts_strong_stripe_webhook_secret(monkeypatch):
    _prod(monkeypatch)
    s = Settings()
    assert s.stripe_webhook_secret.startswith("whsec_")


# stripe_redirect_url — guarded CONDITIONALLY on stripe_secret_key ─────

def test_production_rejects_localhost_stripe_redirect_url_when_stripe_configured(monkeypatch):
    _prod(
        monkeypatch,
        ENROLLX_STRIPE_REDIRECT_URL="http://localhost:5910/api/stripe/connect/callback",
    )
    with pytest.raises(ValidationError) as exc:
        Settings()
    assert "ENROLLX_STRIPE_REDIRECT_URL" in str(exc.value)


def test_production_accepts_real_stripe_redirect_url(monkeypatch):
    _prod(monkeypatch)
    s = Settings()
    assert s.stripe_redirect_url == "https://api.enrollx.floatify.com/api/stripe/connect/callback"


def test_production_allows_localhost_stripe_redirect_url_when_stripe_not_configured(monkeypatch):
    """No stripe_secret_key -> the Connect callback route is unreachable ->
    a stale localhost redirect URL has no live exposure."""
    _prod(monkeypatch)
    monkeypatch.delenv("ENROLLX_STRIPE_SECRET_KEY", raising=False)
    monkeypatch.delenv("ENROLLX_STRIPE_WEBHOOK_SECRET", raising=False)
    monkeypatch.setenv(
        "ENROLLX_STRIPE_REDIRECT_URL", "http://localhost:5910/api/stripe/connect/callback"
    )
    s = Settings()
    assert s.stripe_redirect_url == "http://localhost:5910/api/stripe/connect/callback"


# familyhub_public_url — guarded CONDITIONALLY on stripe_secret_key ────

def test_production_rejects_localhost_familyhub_public_url_when_stripe_configured(monkeypatch):
    _prod(monkeypatch, ENROLLX_FAMILYHUB_PUBLIC_URL="http://localhost:8080")
    with pytest.raises(ValidationError) as exc:
        Settings()
    assert "ENROLLX_FAMILYHUB_PUBLIC_URL" in str(exc.value)


def test_production_accepts_real_familyhub_public_url(monkeypatch):
    _prod(monkeypatch)
    s = Settings()
    assert s.familyhub_public_url == "https://familyhub.floatify.com"


def test_production_allows_localhost_familyhub_public_url_when_stripe_not_configured(monkeypatch):
    _prod(monkeypatch)
    monkeypatch.delenv("ENROLLX_STRIPE_SECRET_KEY", raising=False)
    monkeypatch.delenv("ENROLLX_STRIPE_WEBHOOK_SECRET", raising=False)
    monkeypatch.setenv("ENROLLX_FAMILYHUB_PUBLIC_URL", "http://localhost:8080")
    s = Settings()
    assert s.familyhub_public_url == "http://localhost:8080"


# frontend_public_url — guarded CONDITIONALLY on stripe_secret_key ─────

def test_production_rejects_localhost_frontend_public_url_when_stripe_configured(monkeypatch):
    _prod(monkeypatch, ENROLLX_FRONTEND_PUBLIC_URL="http://localhost:5900")
    with pytest.raises(ValidationError) as exc:
        Settings()
    assert "ENROLLX_FRONTEND_PUBLIC_URL" in str(exc.value)


def test_production_accepts_real_frontend_public_url(monkeypatch):
    _prod(monkeypatch)
    s = Settings()
    assert s.frontend_public_url == "https://enrollx.floatify.com"


def test_production_allows_localhost_frontend_public_url_when_stripe_not_configured(monkeypatch):
    _prod(monkeypatch)
    monkeypatch.delenv("ENROLLX_STRIPE_SECRET_KEY", raising=False)
    monkeypatch.delenv("ENROLLX_STRIPE_WEBHOOK_SECRET", raising=False)
    monkeypatch.setenv("ENROLLX_FRONTEND_PUBLIC_URL", "http://localhost:5900")
    s = Settings()
    assert s.frontend_public_url == "http://localhost:5900"


# stripe_client_id — intentionally NOT guarded ─────────────────────────

def test_production_allows_empty_stripe_client_id(monkeypatch):
    _prod(monkeypatch)
    monkeypatch.delenv("ENROLLX_STRIPE_CLIENT_ID", raising=False)
    s = Settings()
    assert s.stripe_client_id == ""


def test_production_accepts_set_stripe_client_id(monkeypatch):
    _prod(monkeypatch, ENROLLX_STRIPE_CLIENT_ID="ca_live_x")
    s = Settings()
    assert s.stripe_client_id == "ca_live_x"


# balance_due_days — intentionally NOT guarded ─────────────────────────

def test_production_allows_default_balance_due_days(monkeypatch):
    _prod(monkeypatch)
    monkeypatch.delenv("ENROLLX_BALANCE_DUE_DAYS", raising=False)
    s = Settings()
    assert s.balance_due_days == 30
