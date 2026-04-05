"""Storage layer — dependency injection for FastAPI routes."""
from datacore import Store

from app.config import settings

_store: Store | None = None


def _get_store() -> Store:
    global _store
    if _store is None:
        _store = Store(data_dir=settings.lancedb_dir)
    return _store
