# enrollx/backend/app/config.py
"""Configuration for enrollx backend service."""
from typing import List, Optional, Union

from pydantic import model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

DEV_LINK_SECRET = "dev-link-secret-change-in-prod"
DEV_INTERNAL_KEY = "dev-internal-key-change-in-prod"

# Below this length an HMAC secret is guessable/brute-forceable enough that it
# should never reach production. 32 chars is the floor, not a recommendation.
MIN_SECRET_LENGTH = 32

# Stripe (Plan 3) localhost dev defaults. Referenced by BOTH the field
# default below and validate_production_secrets, same as DEV_LINK_SECRET /
# DEV_INTERNAL_KEY above — one constant per value so the two can't drift.
DEV_STRIPE_REDIRECT_URL = "http://localhost:5910/api/stripe/connect/callback"
DEV_FAMILYHUB_PUBLIC_URL = "http://localhost:5620"
DEV_FRONTEND_PUBLIC_URL = "http://localhost:5900"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="ENROLLX_", case_sensitive=False)

    environment: str = "development"
    datacore_url: str = "http://localhost:5800"
    papermite_backend_url: str = "http://localhost:5710"
    cors_allowed_origins: Union[Optional[str], List[str]] = None
    port: int = 5910

    # Registration lifecycle (Plan 2)
    # These defaults are DEV-ONLY and are refused at startup in production by
    # validate_production_secrets below. The link secret is the only thing
    # protecting the parent channel: token_version starts at 1 for every
    # application, so anyone who knows the secret can compute
    # HMAC(secret, "{tenant}.{app_entity_id}.1") and mint a valid magic link
    # for any application in any tenant. These literals are in the repo.
    link_secret: str = DEV_LINK_SECRET
    internal_key: str = DEV_INTERNAL_KEY
    resend_api_key: str = ""
    email_from: str = "NeoApex Registration <registration@floatify.com>"
    familyhub_url: str = "http://localhost:5620"

    # ── Stripe Connect / payments (Plan 3) ─────────────────────────────
    stripe_client_id: str = ""       # ENROLLX_STRIPE_CLIENT_ID (ca_...)
    stripe_secret_key: str = ""      # ENROLLX_STRIPE_SECRET_KEY (sk_...)
    stripe_webhook_secret: str = ""  # ENROLLX_STRIPE_WEBHOOK_SECRET (whsec_...)
    stripe_redirect_url: str = DEV_STRIPE_REDIRECT_URL
    # Same public familyhub Worker as `familyhub_url` above (Plan 2's magic
    # links) — there's no internal-vs-public split, just two names for one
    # address. If ENROLLX_FAMILYHUB_PUBLIC_URL isn't set explicitly, it
    # falls back to ENROLLX_FAMILYHUB_URL in resolve_familyhub_public_url_
    # fallback below. Do NOT remove that fallback as unused/redundant.
    familyhub_public_url: str = DEV_FAMILYHUB_PUBLIC_URL
    frontend_public_url: str = DEV_FRONTEND_PUBLIC_URL
    balance_due_days: int = 30

    @model_validator(mode="after")
    def resolve_familyhub_public_url_fallback(self):
        """`familyhub_public_url` (Plan 3: checkout/reminder links) and
        `familyhub_url` (Plan 2: magic links) address the same public
        familyhub Worker and share the same localhost dev default — there
        is no internal-vs-public split to justify two independently
        configured addresses. Without this fallback, an operator who sets
        ENROLLX_FAMILYHUB_URL for magic links has no reason to suspect a
        second, differently-named variable governs payment links: magic
        links work, payment links silently point at localhost, and the
        production URL guard below won't catch it until
        stripe_secret_key is also set.

        Rule: if ENROLLX_FAMILYHUB_PUBLIC_URL was explicitly set, use it
        verbatim (someone who genuinely needs the two to differ keeps that
        ability). Otherwise, if ENROLLX_FAMILYHUB_URL was explicitly set,
        familyhub_public_url takes that value. Otherwise, keep the
        localhost default.

        Must run before validate_production_secrets, which reads the
        resolved familyhub_public_url — model_validator(mode="after")
        methods run in class-definition order, so this is declared first.
        """
        if (
            "familyhub_public_url" not in self.model_fields_set
            and "familyhub_url" in self.model_fields_set
        ):
            object.__setattr__(self, "familyhub_public_url", self.familyhub_url)
        return self

    @model_validator(mode="after")
    def parse_and_validate_cors(self):
        raw = self.cors_allowed_origins
        if isinstance(raw, str):
            origins = [o.strip() for o in raw.split(",") if o.strip()]
        elif raw is None:
            origins = []
        else:
            origins = list(raw)

        if self.environment == "production":
            if not origins:
                raise ValueError(
                    "ENROLLX_CORS_ALLOWED_ORIGINS is required in production and must not be empty"
                )
            if "*" in origins:
                raise ValueError(
                    "wildcard '*' in ENROLLX_CORS_ALLOWED_ORIGINS is not permitted in production"
                )
        elif not origins:
            origins = ["http://localhost:5900"]

        object.__setattr__(self, "cors_allowed_origins", origins)
        return self

    @model_validator(mode="after")
    def validate_production_secrets(self):
        """Refuse to start in production with a dev-default, weak, or missing
        security-critical setting.

        Same shape as parse_and_validate_cors above: a security-critical
        setting left unsafe is a startup failure, not a warning. Dev and test
        are unaffected — the defaults stay usable there.

        `link_secret` gates the entire parent channel (see the note on the
        field); `internal_key` is the only auth on the /internal routes that
        familyhub calls.

        Stripe (Plan 3) additions, decided per-field. Stripe payments are an
        *optional* per-tenant feature — a school that takes no online
        payments must still be able to boot enrollx in production — so the
        bar for a hard startup failure is narrower than for link_secret /
        internal_key, which are load-bearing for every tenant:

        - `stripe_client_id` / `stripe_secret_key` are NOT guarded. Empty is
          a legitimate production state meaning "this deployment has no
          Stripe integration." Payments routes must fail cleanly at call
          time (a later task's concern), not block the whole service from
          starting.
        - `stripe_webhook_secret` IS guarded, but only *conditionally*: it
          is required exactly when `stripe_secret_key` is non-empty. A
          tenant with no Stripe integration has no webhook endpoint to
          protect, so nothing to require. A tenant WITH Stripe configured
          but no webhook secret would accept unsigned webhook payloads if
          any handler treats "no secret configured" as "skip
          verification" — that's a spoofing risk (forged
          payment-succeeded events), so it must fail fast at startup
          instead. Its default is `""`, not a placeholder literal like
          DEV_LINK_SECRET, so the message says it's *required* rather than
          "still set to its development default" — there's no dev value
          being left behind, just a missing one.
        - `stripe_redirect_url`, `familyhub_public_url`,
          `frontend_public_url` ARE guarded against surviving as their
          localhost dev default in production, mirroring
          parse_and_validate_cors's philosophy — but, like
          `stripe_webhook_secret`, only *conditionally*, when
          `stripe_secret_key` is set. All three are read exclusively by
          payments code: `stripe_redirect_url` is the Connect OAuth
          callback; `frontend_public_url` builds the settings/payments and
          application links in Connect-callback redirects and payment
          links; `familyhub_public_url` builds the family-facing
          application/payment links used in checkout redirects and
          balance-due reminders (see task-3, task-5, task-7 briefs). None
          of that code runs for a tenant with no Stripe integration, so a
          deployment with `stripe_secret_key` unset has no live exposure
          from these staying at their localhost defaults — forcing them
          to change anyway would make Stripe a hard requirement to boot in
          production, which is exactly the over-broad guard this policy
          rejects. Once `stripe_secret_key` is set, though, that code path
          is live, so a stale localhost value silently ships broken
          redirects and broken email links to real users — fail fast
          instead. There's no meaningful "weak but non-default" state for
          a URL, so only the dev-default-equality check applies.
        - `balance_due_days` is NOT guarded. It is a business-policy
          default (invoice due window), not a secret or an
          environment-specific endpoint; 30 is a reasonable value in every
          environment and there is no unsafe state for it to be left in.
        """
        if self.environment != "production":
            return self
        for name, value, dev_default in (
            ("ENROLLX_LINK_SECRET", self.link_secret, DEV_LINK_SECRET),
            ("ENROLLX_INTERNAL_KEY", self.internal_key, DEV_INTERNAL_KEY),
        ):
            if value == dev_default:
                raise ValueError(
                    f"{name} is still set to its development default in production; "
                    "set it to a strong random value"
                )
            if len(value) < MIN_SECRET_LENGTH:
                raise ValueError(
                    f"{name} must be at least {MIN_SECRET_LENGTH} characters in "
                    f"production (got {len(value)})"
                )

        # Stripe is optional per-tenant: the checks below only apply once
        # this deployment actually has a Stripe secret key configured —
        # everything they guard (webhook verification, OAuth callback,
        # payment links) is dead code until then.
        if self.stripe_secret_key:
            if not self.stripe_webhook_secret:
                raise ValueError(
                    "ENROLLX_STRIPE_WEBHOOK_SECRET is required in production when "
                    "ENROLLX_STRIPE_SECRET_KEY is set; without it, incoming Stripe "
                    "webhooks cannot be signature-verified"
                )

            for name, value, dev_default in (
                ("ENROLLX_STRIPE_REDIRECT_URL", self.stripe_redirect_url, DEV_STRIPE_REDIRECT_URL),
                ("ENROLLX_FAMILYHUB_PUBLIC_URL", self.familyhub_public_url, DEV_FAMILYHUB_PUBLIC_URL),
                ("ENROLLX_FRONTEND_PUBLIC_URL", self.frontend_public_url, DEV_FRONTEND_PUBLIC_URL),
            ):
                if value == dev_default:
                    raise ValueError(
                        f"{name} is still set to its localhost development default in "
                        "production while ENROLLX_STRIPE_SECRET_KEY is set; set it to "
                        "the deployed public URL"
                    )
        return self


settings = Settings()
