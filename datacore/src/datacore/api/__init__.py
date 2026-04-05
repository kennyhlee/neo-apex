"""FastAPI REST API layer for datacore."""

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from datacore.store import Store
from datacore.api.routes import register_routes
from datacore.api.auth_routes import register_auth_routes


def create_app(store: Store) -> FastAPI:
    """Create and configure the FastAPI application."""
    app = FastAPI(title="datacore")

    app.add_middleware(
        CORSMiddleware,
        allow_origins=[
            "http://localhost:5173",
            "http://localhost:5174",
        ],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    register_routes(app, store)
    register_auth_routes(app, store)

    return app
