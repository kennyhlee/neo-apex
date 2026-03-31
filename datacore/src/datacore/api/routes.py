"""API route handlers."""

import uuid

from fastapi import FastAPI, HTTPException
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from datacore.store import Store


class CreateEntityRequest(BaseModel):
    base_data: dict
    custom_fields: dict | None = None


def register_routes(app: FastAPI, store: Store) -> None:
    """Register API routes."""

    @app.get("/api/models/{tenant_id}/{entity_type}")
    def get_model(tenant_id: str, entity_type: str):
        result = store.get_active_model(tenant_id, entity_type)
        if result is None:
            raise HTTPException(status_code=404, detail="Model not found")
        return result

    @app.post("/api/entities/{tenant_id}/{entity_type}")
    def create_entity(
        tenant_id: str, entity_type: str, body: CreateEntityRequest
    ):
        entity_id = uuid.uuid4().hex[:12]
        result = store.put_entity(
            tenant_id=tenant_id,
            entity_type=entity_type,
            entity_id=entity_id,
            base_data=body.base_data,
            custom_fields=body.custom_fields,
        )
        return JSONResponse(status_code=201, content=result)
