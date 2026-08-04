# enrollx/backend/app/config.py
"""Configuration for enrollx backend service."""
from typing import List, Optional, Union

from pydantic import model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="ENROLLX_", case_sensitive=False)

    environment: str = "development"
    datacore_url: str = "http://localhost:5800"
    papermite_backend_url: str = "http://localhost:5710"
    cors_allowed_origins: Union[Optional[str], List[str]] = None
    port: int = 5910

    # Registration lifecycle (Plan 2)
    link_secret: str = "dev-link-secret-change-in-prod"
    internal_key: str = "dev-internal-key-change-in-prod"
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


settings = Settings()
