"""Model store — reads Tenant model definition from datacore (written by Papermite)."""
from datacore import Store

from app.config import settings

_store: Store | None = None

def _get_store() -> Store:
    global _store
    if _store is None:
        _store = Store(data_dir=settings.datacore_store_path)
    return _store

def get_tenant_model(tenant_id: str) -> dict | None:
    """Get the active Tenant entity model definition.
    Returns the model definition dict with base_fields and custom_fields,
    or None if no model has been defined for this tenant.
    """
    store = _get_store()
    model = store.get_active_model(tenant_id, "tenant")
    if not model:
        return None
    return model["model_definition"]
