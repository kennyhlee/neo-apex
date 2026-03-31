"""API route handlers."""

from fastapi import FastAPI

from datacore.store import Store


def register_routes(app: FastAPI, store: Store) -> None:
    """Register API routes."""
    pass
