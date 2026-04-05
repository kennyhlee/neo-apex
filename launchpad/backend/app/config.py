"""Launchpad configuration — settings and datacore path."""
import os
from pathlib import Path
from pydantic_settings import BaseSettings

class Settings(BaseSettings):
    datacore_auth_url: str = "http://localhost:8081/auth"
    datacore_store_path: Path = Path(os.environ.get(
        "NEOAPEX_LANCEDB_DIR",
        str(Path(__file__).resolve().parent.parent.parent.parent
            / "datacore" / "data" / "lancedb"),
    ))
    papermite_url: str = "http://localhost:5173"
    port: int = 8001
    model_config = {"env_prefix": "LAUNCHPAD_"}

settings = Settings()
