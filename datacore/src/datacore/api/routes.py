"""API route handlers."""

from fastapi import FastAPI, HTTPException

from datacore.store import Store


def register_routes(app: FastAPI, store: Store) -> None:
    """Register API routes."""

    @app.get("/api/models/{tenant_id}/{entity_type}")
    def get_model(tenant_id: str, entity_type: str):
        result = store.get_active_model(tenant_id, entity_type)
        if result is None:
            raise HTTPException(status_code=404, detail="Model not found")
        return result
