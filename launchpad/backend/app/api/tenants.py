"""Tenant profile and onboarding status endpoints."""
import json
from pathlib import Path
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from app.api.auth import get_current_user, require_role
from app.storage import get_registry_store
from app.storage.registry_store import RegistryStore
from app.storage.model_store import get_tenant_model

router = APIRouter()

@router.get("/tenants/{tenant_id}")
def get_tenant_profile(tenant_id: str, user=Depends(require_role("admin", "staff")), registry: RegistryStore = Depends(get_registry_store)):
    if user.tenant_id != tenant_id:
        raise HTTPException(status_code=403, detail="Tenant mismatch")
    from datacore import Store
    from app.config import settings
    store = Store(data_dir=settings.datacore_store_path)
    entity = store.get_active_entity(tenant_id, "tenant", tenant_id)
    if not entity:
        return {"tenant_id": tenant_id, "name": user.tenant_name}
    data = {**entity.get("base_data", {}), **entity.get("custom_fields", {})}
    data["tenant_id"] = tenant_id
    return data

@router.put("/tenants/{tenant_id}")
def update_tenant_profile(tenant_id: str, body: dict, user=Depends(require_role("admin")), registry: RegistryStore = Depends(get_registry_store)):
    if user.tenant_id != tenant_id:
        raise HTTPException(status_code=403, detail="Tenant mismatch")
    body.pop("name", None)
    body.pop("tenant_id", None)
    from datacore import Store
    from app.config import settings
    store = Store(data_dir=settings.datacore_store_path)
    existing = store.get_active_entity(tenant_id, "tenant", tenant_id)
    if existing:
        base_data = {**existing.get("base_data", {}), **body}
    else:
        base_data = {"tenant_id": tenant_id, **body}
    store.put_entity(tenant_id=tenant_id, entity_type="tenant", entity_id=tenant_id, base_data=base_data)
    return {**base_data, "tenant_id": tenant_id}

@router.get("/tenants/{tenant_id}/model")
def get_model(tenant_id: str, user=Depends(get_current_user)):
    if user.tenant_id != tenant_id:
        raise HTTPException(status_code=403, detail="Tenant mismatch")
    model = get_tenant_model(tenant_id)
    if not model:
        return None
    return model

BASE_MODEL_PATH = Path(__file__).parent.parent / "data" / "base_model.json"

@router.post("/tenants/{tenant_id}/model/use-default")
def use_default_model(tenant_id: str, user=Depends(require_role("admin")), registry: RegistryStore = Depends(get_registry_store)):
    if user.tenant_id != tenant_id:
        raise HTTPException(status_code=403, detail="Tenant mismatch")
    base_model = json.loads(BASE_MODEL_PATH.read_text())
    from datacore import Store
    from app.config import settings
    store = Store(data_dir=settings.datacore_store_path)
    for entity_type, model_def in base_model.items():
        store.put_model(tenant_id=tenant_id, entity_type=entity_type, model_definition=model_def)
    registry.mark_step_complete(tenant_id, "model_setup")
    return base_model

@router.get("/tenants/{tenant_id}/onboarding-status")
def get_onboarding_status(tenant_id: str, user=Depends(get_current_user), registry: RegistryStore = Depends(get_registry_store)):
    if user.tenant_id != tenant_id:
        raise HTTPException(status_code=403, detail="Tenant mismatch")
    status = registry.get_onboarding(tenant_id)
    if not status:
        raise HTTPException(status_code=404, detail="Onboarding not found")
    return status.model_dump()

class MarkStepRequest(BaseModel):
    step_id: str
    completed: bool = True

@router.post("/tenants/{tenant_id}/onboarding-status")
def update_onboarding_status(tenant_id: str, body: MarkStepRequest, user=Depends(require_role("admin")), registry: RegistryStore = Depends(get_registry_store)):
    if user.tenant_id != tenant_id:
        raise HTTPException(status_code=403, detail="Tenant mismatch")
    status = registry.mark_step_complete(tenant_id, body.step_id)
    return status.model_dump()
