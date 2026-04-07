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
    """Fetch the combined active model from DataCore unified query API."""
    resp = httpx.post(
        f"{settings.datacore_api_url}/query",
        json={
            "tenant_id": tenant_id,
            "table": "models",
            "sql": "SELECT * FROM data WHERE _status = 'active'",
        },
    )
    if resp.status_code != 200:
        raise HTTPException(status_code=502, detail="Failed to fetch model from DataCore")
    rows = resp.json().get("data", [])
    if not rows:
        return None

    # Reassemble combined model definition keyed by entity_type,
    # matching the shape the old GET /api/models/{tenant_id} returned
    model_definition = {}
    for row in rows:
        entity_type = row.get("entity_type")
        md = row.get("model_definition")
        if isinstance(md, str):
            md = json.loads(md)
        if entity_type and md:
            clean = {k: v for k, v in md.items() if not k.startswith("_")}
            model_definition[entity_type] = clean

    latest = max(rows, key=lambda r: r.get("_version", 0))
    latest_md = latest.get("model_definition")
    if isinstance(latest_md, str):
        latest_md = json.loads(latest_md)
    return {
        "tenant_id": tenant_id,
        "model_definition": model_definition,
        "version": max(r.get("_version", 0) for r in rows),
        "status": "active",
        "source_filename": latest_md.get("_source_filename", "") if latest_md else "",
        "created_by": latest_md.get("_created_by", "") if latest_md else "",
        "created_at": max(r.get("_created_at", "") for r in rows),
    }


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
