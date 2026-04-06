"""Launchpad configuration — settings and datacore path."""
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
    port = svc.get("port", 6010)
    return f"http://{host}:{port}"


def _cors_origins() -> list[str]:
    env_origins = os.environ.get("CORS_ALLOWED_ORIGINS")
    if env_origins:
        return [o.strip() for o in env_origins.split(",") if o.strip()]
    return [_svc_url(k) for k in _services if k.endswith("-frontend")]


class Settings(BaseSettings):
    datacore_auth_url: str = _svc_url("datacore") + "/auth"
    datacore_store_path: Path = Path(os.environ.get(
        "NEOAPEX_LANCEDB_DIR",
        str(Path(__file__).resolve().parent.parent.parent.parent
            / "datacore" / "data" / "lancedb"),
    ))
    papermite_frontend_url: str = _svc_url("papermite-frontend")
    port: int = _services.get("launchpad-backend", {}).get("port", 6010)
    cors_origins: list[str] = _cors_origins()
    model_config = {"env_prefix": "LAUNCHPAD_"}

settings = Settings()
