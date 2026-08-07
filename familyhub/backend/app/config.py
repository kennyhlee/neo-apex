# familyhub/backend/app/config.py
"""Configuration for familyhub backend service."""
import os
from typing import List, Optional, Union

from pydantic import model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

# Dev default for apexflow_internal_key below. Must match apexflow's own
# DEV_INTERNAL_KEY (apexflow/backend/app/config.py) since the two secrets
# must be equal to each other in every environment.
DEV_INTERNAL_KEY = "dev-internal-key-change-in-prod"

# Below this length the shared internal-key secret is guessable/
# brute-forceable enough that it should never reach production. 32 chars is
# the floor, not a recommendation. Mirrors apexflow/backend/app/config.py.
MIN_SECRET_LENGTH = 32


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="FAMILYHUB_", case_sensitive=False)

    environment: str = "development"
    datacore_url: str = "http://localhost:5800"

    # Task 10: registration/config/actions/documents/request-link all
    # retarget from enrollx to apexflow-backend's token-scoped internal API
    # (docs/superpowers/plans/2026-08-05-apexflow-plan1-interface-map.md §7,
    # task-10-brief.md's familyhub retarget). Must equal apexflow's
    # APEXFLOW_INTERNAL_KEY. Dev default below must match apexflow's dev
    # default (apexflow/backend/app/config.py DEV_INTERNAL_KEY).
    apexflow_url: str = "http://localhost:5910"
    apexflow_internal_key: str = DEV_INTERNAL_KEY  # ADJUST(bindings): apexflow dev default

    cors_allowed_origins: Union[Optional[str], List[str]] = None
    port: int = 5630

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
                    "FAMILYHUB_CORS_ALLOWED_ORIGINS is required in production and must not be empty"
                )
            if "*" in origins:
                raise ValueError(
                    "wildcard '*' in FAMILYHUB_CORS_ALLOWED_ORIGINS is not permitted in production"
                )
        elif not origins:
            origins = ["http://localhost:5620"]

        object.__setattr__(self, "cors_allowed_origins", origins)
        return self

    @model_validator(mode="after")
    def validate_production_secrets(self) -> "Settings":
        """Refuse to start in production with a dev-default or weak
        security-critical setting. Mirrors apexflow/backend/app/config.py's
        validator of the same name.

        `apexflow_internal_key` is the only auth on familyhub's calls into
        apexflow-backend's token-scoped internal API (task-10-brief.md).
        """
        if self.environment != "production":
            return self
        if os.environ.get("TRUST_ALL_IPS") == "1":
            raise ValueError(
                "TRUST_ALL_IPS=1 must never be set in production: it disables "
                "the Cloudflare IP allowlist AND collapses rate-limit keying."
            )
        key = self.apexflow_internal_key
        if not key or key == DEV_INTERNAL_KEY:
            raise ValueError(
                "FAMILYHUB_APEXFLOW_INTERNAL_KEY must be set to a real secret in production"
            )
        if len(key) < MIN_SECRET_LENGTH:
            raise ValueError(
                f"FAMILYHUB_APEXFLOW_INTERNAL_KEY must be at least {MIN_SECRET_LENGTH} chars"
            )
        return self


settings = Settings()
