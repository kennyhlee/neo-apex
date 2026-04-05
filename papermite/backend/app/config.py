import os
from pathlib import Path
from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    datacore_auth_url: str = "http://localhost:8081/auth"
    default_model: str = "anthropic:claude-haiku-4-5-20251001"
    available_models: list[str] = [
        "anthropic:claude-haiku-4-5-20251001",
        "anthropic:claude-sonnet-4-6",
        "openai:gpt-4.1",
        "openai:gpt-5",
        "ollama:llama3.2",
    ]
    upload_dir: Path = Path(__file__).parent.parent / "uploads"
    lancedb_dir: Path = Path(os.environ.get(
        "NEOAPEX_LANCEDB_DIR",
        str(Path(__file__).resolve().parent.parent.parent.parent / "datacore" / "data" / "lancedb"),
    ))

    model_config = {"env_prefix": "PAPERMITE_"}


settings = Settings()
