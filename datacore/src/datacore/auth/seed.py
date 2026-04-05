"""Seed test user into the DataCore registry for development."""
from datacore.auth.passwords import hash_password
from datacore.store import Store

REGISTRY_TABLE = "registry"


def seed_test_user(store: Store) -> None:
    """Create the default test user if not already present."""
    existing = store.get_global(REGISTRY_TABLE, "user:u-001")
    if existing is not None:
        return

    store.put_global(REGISTRY_TABLE, "user:u-001", {
        "user_id": "u-001",
        "name": "Jane Admin",
        "email": "jane@acme.edu",
        "password_hash": hash_password("admin123"),
        "tenant_id": "acme",
        "tenant_name": "Acme Afterschool",
        "role": "admin",
        "created_at": "2026-01-01T00:00:00+00:00",
    })
