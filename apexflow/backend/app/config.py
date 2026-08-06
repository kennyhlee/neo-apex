# apexflow/backend/app/config.py
"""Configuration for apexflow backend service.

Ported from enrollx/backend/app/config.py — see docs/superpowers/plans/
2026-08-05-apexflow-plan1-interface-map.md §1-§2. Stripe/payments and
registration-lifecycle-only settings (stripe_*, familyhub_url,
familyhub_public_url, frontend_public_url, balance_due_days,
papermite_backend_url) were dropped per task-1-brief.md Step 1 ("delete
registration-specific and payment code from the copies"): this is a generic
workflow-engine scaffold, apexflow-backend has no Papermite or familyhub
dependency yet, and none of those fields are read by any module this task
ports (app/auth.py, app/workflows/{datacore,tokens,emails}.py).
"""
from typing import List, Optional, Union

from pydantic import model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

DEV_LINK_SECRET = "dev-link-secret-change-in-prod"
DEV_INTERNAL_KEY = "dev-internal-key-change-in-prod"

# Below this length an HMAC secret is guessable/brute-forceable enough that it
# should never reach production. 32 chars is the floor, not a recommendation.
MIN_SECRET_LENGTH = 32


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="APEXFLOW_", case_sensitive=False)

    environment: str = "development"

    # ADJUST(bindings): task-1-brief.md's Interfaces section names this field
    # `datacore_base_url`. That name does not exist anywhere in enrollx's
    # source — the interface map (§1) transcribes the real field verbatim as
    # `datacore_url` (`app.registration.datacore._request` reads
    # `settings.datacore_url`; enrollx/backend/app/config.py:27 declares it).
    # Ported under the real name per the map, which overrides the brief here
    # the same way Task 0 resolved `require_tenant_match` -> `require_staff_tenant`.
    datacore_url: str = "http://localhost:5800"

    cors_allowed_origins: Union[Optional[str], List[str]] = None
    port: int = 5910

    # Magic-link facade (ported from enrollx's registration lifecycle,
    # generalized to apexflow's workflow-instance vocabulary — see
    # app/workflows/tokens.py). `link_secret` is the only thing protecting
    # the token-scoped facade: token_version starts at 1 for every workflow
    # instance, so anyone who knows the secret can mint a valid link for any
    # instance in any tenant. These dev literals are in the repo by design;
    # validate_production_secrets below refuses them in production.
    link_secret: str = DEV_LINK_SECRET
    internal_key: str = DEV_INTERNAL_KEY

    # Base URL of familyhub-frontend (the family/token-scoped channel this
    # task's magic-link "link" field points at) -- task-10-brief.md:
    # "link" = familyhub base URL pattern from env APEXFLOW_FAMILYHUB_BASE_URL
    # (default http://localhost:6000) + "/w/{tenant_id}/{definition_id}?token={token}".
    # Matches CLAUDE.md's FamilyHub frontend port (6000).
    familyhub_base_url: str = "http://localhost:6000"

    # Outbound email (app/workflows/emails.py's generic Resend client only —
    # the registration-specific send_application_email/v1 templates were not
    # ported, see that module's docstring).
    resend_api_key: str = ""
    email_from: str = "NeoApex Workflows <workflows@floatify.com>"

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
                    "APEXFLOW_CORS_ALLOWED_ORIGINS is required in production and must not be empty"
                )
            if "*" in origins:
                raise ValueError(
                    "wildcard '*' in APEXFLOW_CORS_ALLOWED_ORIGINS is not permitted in production"
                )
        elif not origins:
            origins = ["http://localhost:5900"]

        object.__setattr__(self, "cors_allowed_origins", origins)
        return self

    @model_validator(mode="after")
    def validate_production_secrets(self):
        """Refuse to start in production with a dev-default or weak
        security-critical setting. Mirrors enrollx/backend/app/config.py's
        validator of the same name (Stripe-conditional checks dropped along
        with the Stripe fields themselves — see module docstring).

        `link_secret` gates the entire token-scoped facade; `internal_key`
        is the only auth on the internal/facade routes a later task adds.
        """
        if self.environment != "production":
            return self
        for name, value, dev_default in (
            ("APEXFLOW_LINK_SECRET", self.link_secret, DEV_LINK_SECRET),
            ("APEXFLOW_INTERNAL_KEY", self.internal_key, DEV_INTERNAL_KEY),
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
        return self


settings = Settings()
