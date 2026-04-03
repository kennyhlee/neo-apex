"""Launchpad configuration — settings, JWT config, datacore path."""
import os
from pathlib import Path
from pydantic_settings import BaseSettings

class Settings(BaseSettings):
    jwt_secret: str = "neoapex-dev-secret-change-in-prod"
    jwt_expiry_hours: int = 24
    datacore_store_path: Path = Path(os.environ.get(
        "NEOAPEX_LANCEDB_DIR",
        str(Path(__file__).resolve().parent.parent.parent.parent
            / "datacore" / "data" / "lancedb"),
    ))
    papermite_url: str = "http://localhost:5173"
    port: int = 8001
    model_config = {"env_prefix": "LAUNCHPAD_"}

settings = Settings()
