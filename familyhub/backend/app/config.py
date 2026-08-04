# familyhub/backend/app/config.py
"""Configuration for familyhub backend service."""
from typing import List, Optional, Union

from pydantic import model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="FAMILYHUB_", case_sensitive=False)

    environment: str = "development"
    datacore_url: str = "http://localhost:5800"
    enrollx_url: str = "http://localhost:5910"
    cors_allowed_origins: Union[Optional[str], List[str]] = None
    port: int = 6010

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
            origins = ["http://localhost:6000"]

        object.__setattr__(self, "cors_allowed_origins", origins)
        return self


settings = Settings()
