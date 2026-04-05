"""Storage layer — dependency injection for FastAPI routes."""
from datacore import Store

from app.config import settings
from app.storage.registry_store import RegistryStore

_store: Store | None = None
_registry: RegistryStore | None = None


def _get_store() -> Store:
    global _store
    if _store is None:
        _store = Store(data_dir=settings.lancedb_dir)
    return _store


def get_registry_store() -> RegistryStore:
    global _registry
    if _registry is None:
        _registry = RegistryStore(_get_store())
    return _registry
