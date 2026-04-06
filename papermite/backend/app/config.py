import json
import os
from pathlib import Path
from pydantic_settings import BaseSettings


def _load_services() -> dict:
    config_path = Path(__file__).resolve().parent.parent.parent.parent / "services.json"
    if config_path.exists():
        with open(config_path) as f:
            return json.load(f)["services"]
    return {}


_services = _load_services()


def _svc_url(key: str) -> str:
    svc = _services.get(key, {})
    host = svc.get("host", "localhost")
    port = svc.get("port", 6210)
    return f"http://{host}:{port}"


def _cors_origins() -> list[str]:
    env_origins = os.environ.get("CORS_ALLOWED_ORIGINS")
    if env_origins:
        return [o.strip() for o in env_origins.split(",") if o.strip()]
    origins = []
    for k in _services:
        if k.endswith("-frontend"):
            port = _services[k].get("port", 0)
            origins.append(f"http://localhost:{port}")
            origins.append(f"http://127.0.0.1:{port}")
    return origins


class Settings(BaseSettings):
    datacore_auth_url: str = _svc_url("datacore") + "/auth"
    datacore_api_url: str = _svc_url("datacore") + "/api"
    default_model: str = "anthropic:claude-haiku-4-5-20251001"
    available_models: list[str] = [
        "anthropic:claude-haiku-4-5-20251001",
        "anthropic:claude-sonnet-4-6",
        "openai:gpt-4.1",
        "openai:gpt-5",
        "ollama:llama3.2",
    ]
    upload_dir: Path = Path(__file__).parent.parent / "uploads"
    port: int = _services.get("papermite-backend", {}).get("port", 6210)
    cors_origins: list[str] = _cors_origins()

    model_config = {"env_prefix": "PAPERMITE_"}


settings = Settings()
