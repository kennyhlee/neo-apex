"""Schema and model endpoints."""
import json

import httpx
from fastapi import APIRouter, Depends, HTTPException

from app.api.auth import require_admin
from app.config import settings
from app.models.registry import UserRecord
from app.models.domain import ENTITY_CLASSES

router = APIRouter()


def _get_active_model(tenant_id: str) -> dict | None:
    """Fetch the combined active model from DataCore models API."""
    resp = httpx.get(f"{settings.datacore_api_url}/models/{tenant_id}")
    if resp.status_code == 404:
        return None
    if resp.status_code != 200:
        raise HTTPException(status_code=502, detail="Failed to fetch model from DataCore")
    return resp.json()


@router.get("/schema")
def get_schema(user: UserRecord = Depends(require_admin)):
    """Return base model schemas so frontend knows which fields are base vs custom."""
    schemas = {}
    for name, cls in ENTITY_CLASSES.items():
        fields = {}
        for field_name, field_info in cls.model_fields.items():
            if field_name == "custom_fields":
                continue
            fields[field_name] = {
                "type": str(field_info.annotation),
                "required": field_info.is_required(),
                "default": repr(field_info.default) if field_info.default is not None else None,
            }
        schemas[name] = fields
    return schemas


@router.get("/config/models")
def get_available_models(user: UserRecord = Depends(require_admin)):
    """Return available LLM model options."""
    return {
        "default": settings.default_model,
        "models": settings.available_models,
    }


@router.get("/tenants/{tenant_id}/model")
def get_tenant_model(tenant_id: str, user: UserRecord = Depends(require_admin)):
    """Return the active model definition for the tenant, if it exists."""
    if user.tenant_id != tenant_id:
        raise HTTPException(status_code=403, detail="Tenant mismatch")

    model = _get_active_model(tenant_id)
    if model is None:
        return None
    return model
