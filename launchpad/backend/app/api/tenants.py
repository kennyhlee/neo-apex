"""Tenant profile and onboarding status endpoints."""
import json
from pathlib import Path

import httpx
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from app.api.auth import get_current_user, require_role
from app.config import settings

router = APIRouter()


def _datacore_url(path: str) -> str:
    return f"{settings.datacore_api_url}{path}"


def _registry_url(path: str) -> str:
    return f"{settings.datacore_api_url}/registry{path}"


@router.get("/tenants/{tenant_id}")
def get_tenant_profile(tenant_id: str, user=Depends(require_role("admin", "staff"))):
    if user["tenant_id"] != tenant_id:
        raise HTTPException(status_code=403, detail="Tenant mismatch")
    resp = httpx.post(
        _datacore_url("/query"),
        json={
            "tenant_id": tenant_id,
            "table": "tenants",
            "sql": "SELECT * FROM data WHERE entity_type = 'tenant' AND _status = 'active'",
        },
    )
    if resp.status_code != 200:
        raise HTTPException(status_code=502, detail="Failed to fetch tenant")
    rows = resp.json().get("data", [])
    if not rows:
        return {"tenant_id": tenant_id, "name": user["tenant_name"]}
    return {**rows[0], "tenant_id": tenant_id}


@router.put("/tenants/{tenant_id}")
def update_tenant_profile(tenant_id: str, body: dict, user=Depends(require_role("admin"))):
    if user["tenant_id"] != tenant_id:
        raise HTTPException(status_code=403, detail="Tenant mismatch")
    body.pop("name", None)
    body.pop("tenant_id", None)

    existing_resp = httpx.post(
        _datacore_url("/query"),
        json={
            "tenant_id": tenant_id,
            "table": "tenants",
            "sql": "SELECT * FROM data WHERE entity_type = 'tenant' AND _status = 'active'",
        },
    )
    result = existing_resp.json()
    if existing_resp.status_code == 200 and result.get("data"):
        existing = result["data"][0]
        internal_keys = {"_status", "_version", "_created_at", "_updated_at", "_change_id", "entity_type", "entity_id"}
        base_data = {k: v for k, v in existing.items() if k not in internal_keys}
        base_data.update(body)
    else:
        base_data = {"tenant_id": tenant_id, **body}

    resp = httpx.put(
        _datacore_url(f"/tenants/{tenant_id}"),
        json={"base_data": base_data},
    )
    if resp.status_code not in (200, 201):
        raise HTTPException(status_code=502, detail="Failed to update tenant")
    return {**base_data, "tenant_id": tenant_id}


@router.get("/tenants/{tenant_id}/model")
def get_model(tenant_id: str, user=Depends(get_current_user)):
    if user["tenant_id"] != tenant_id:
        raise HTTPException(status_code=403, detail="Tenant mismatch")
    resp = httpx.post(
        _datacore_url("/query"),
        json={
            "tenant_id": tenant_id,
            "table": "models",
            "sql": "SELECT * FROM data WHERE entity_type = 'tenant' AND _status = 'active'",
        },
    )
    if resp.status_code != 200:
        raise HTTPException(status_code=502, detail="Failed to fetch model")
    rows = resp.json().get("data", [])
    if not rows:
        return None
    md = rows[0].get("model_definition")
    return json.loads(md) if isinstance(md, str) else md


@router.get("/tenants/{tenant_id}/model/info")
def get_model_info(tenant_id: str, user=Depends(get_current_user)):
    if user["tenant_id"] != tenant_id:
        raise HTTPException(status_code=403, detail="Tenant mismatch")
    resp = httpx.post(
        _datacore_url("/query"),
        json={
            "tenant_id": tenant_id,
            "table": "models",
            "sql": "SELECT * FROM data WHERE entity_type = 'tenant' AND _status = 'active'",
        },
    )
    if resp.status_code != 200:
        raise HTTPException(status_code=502, detail="Failed to fetch model")
    rows = resp.json().get("data", [])
    if not rows:
        return None
    model = rows[0]
    return {
        "model_definition": json.loads(model["model_definition"]) if isinstance(model.get("model_definition"), str) else model.get("model_definition"),
        "version": model.get("_version"),
        "change_id": model.get("_change_id"),
        "created_at": model.get("_created_at"),
        "updated_at": model.get("_updated_at"),
    }


BASE_MODEL_PATH = Path(__file__).parent.parent / "data" / "base_model.json"


@router.post("/tenants/{tenant_id}/model/use-default")
def use_default_model(tenant_id: str, user=Depends(require_role("admin"))):
    if user["tenant_id"] != tenant_id:
        raise HTTPException(status_code=403, detail="Tenant mismatch")
    base_model = json.loads(BASE_MODEL_PATH.read_text())

    resp = httpx.put(
        _datacore_url(f"/models/{tenant_id}"),
        json={
            "model_definition": base_model,
            "source_filename": "base_model.json",
            "created_by": user["name"],
        },
        timeout=30.0,
    )
    if resp.status_code != 200:
        raise HTTPException(status_code=502, detail="Failed to store model")

    httpx.post(
        _registry_url(f"/onboarding/{tenant_id}/complete-step"),
        json={"step_id": "model_setup"},
    )

    return base_model


@router.get("/tenants/{tenant_id}/onboarding-status")
def get_onboarding_status(tenant_id: str, user=Depends(get_current_user)):
    if user["tenant_id"] != tenant_id:
        raise HTTPException(status_code=403, detail="Tenant mismatch")
    resp = httpx.get(_registry_url(f"/onboarding/{tenant_id}"))
    if resp.status_code == 404:
        raise HTTPException(status_code=404, detail="Onboarding not found")
    if resp.status_code != 200:
        raise HTTPException(status_code=502, detail="Failed to fetch onboarding")
    return resp.json()


class MarkStepRequest(BaseModel):
    step_id: str
    completed: bool = True


@router.post("/tenants/{tenant_id}/onboarding-status")
def update_onboarding_status(tenant_id: str, body: MarkStepRequest, user=Depends(require_role("admin"))):
    if user["tenant_id"] != tenant_id:
        raise HTTPException(status_code=403, detail="Tenant mismatch")
    resp = httpx.post(
        _registry_url(f"/onboarding/{tenant_id}/complete-step"),
        json={"step_id": body.step_id},
    )
    if resp.status_code == 404:
        raise HTTPException(status_code=404, detail="Onboarding not found")
    if resp.status_code != 200:
        raise HTTPException(status_code=502, detail="Failed to update onboarding")
    return resp.json()
