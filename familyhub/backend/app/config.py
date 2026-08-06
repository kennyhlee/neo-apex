# familyhub/backend/app/config.py
"""Configuration for familyhub backend service."""
from typing import List, Optional, Union

from pydantic import model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


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
    apexflow_internal_key: str = "dev-internal-key-change-in-prod"  # ADJUST(bindings): apexflow dev default

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
            if not self.apexflow_internal_key or self.apexflow_internal_key == "dev-internal-key-change-in-prod":
                raise ValueError(
                    "FAMILYHUB_APEXFLOW_INTERNAL_KEY must be set to a real secret in production"
                )
        elif not origins:
            origins = ["http://localhost:5620"]

        object.__setattr__(self, "cors_allowed_origins", origins)
        return self


settings = Settings()
