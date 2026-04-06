"""FastAPI REST API layer for datacore."""

import json
import os
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from datacore.store import Store
from datacore.api.routes import register_routes
from datacore.api.auth_routes import register_auth_routes


def _load_cors_origins() -> list[str]:
    """Build CORS allowed origins from services.json or env var override."""
    env_origins = os.environ.get("CORS_ALLOWED_ORIGINS")
    if env_origins:
        return [o.strip() for o in env_origins.split(",") if o.strip()]

    config_path = Path(__file__).resolve().parent.parent.parent.parent.parent / "services.json"
    if not config_path.exists():
        return []

    with open(config_path) as f:
        config = json.load(f)

    frontend_keys = [k for k in config["services"] if k.endswith("-frontend")]
    origins = []
    for key in frontend_keys:
        svc = config["services"][key]
        port = svc["port"]
        origins.append(f"http://localhost:{port}")
        origins.append(f"http://127.0.0.1:{port}")
    return origins


def create_app(store: Store) -> FastAPI:
    """Create and configure the FastAPI application."""
    app = FastAPI(title="datacore")

    app.add_middleware(
        CORSMiddleware,
        allow_origins=_load_cors_origins(),
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    register_routes(app, store)
    register_auth_routes(app, store)

    return app
