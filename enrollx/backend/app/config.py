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
    familyhub_url: str = "http://localhost:6000"

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
        """Refuse to start in production with a dev-default or weak secret.

        Same shape as parse_and_validate_cors above: a security-critical
        setting left unsafe is a startup failure, not a warning. Dev and test
        are unaffected — the defaults stay usable there.

        `link_secret` gates the entire parent channel (see the note on the
        field); `internal_key` is the only auth on the /internal routes that
        familyhub calls.
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
        return self


settings = Settings()
