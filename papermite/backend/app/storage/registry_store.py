"""Registry store — read-only user lookup via DataCore global registry table."""
import bcrypt
from datacore import Store

from app.models.registry import UserRecord

REGISTRY_TABLE = "registry"


class RegistryStore:
    def __init__(self, store: Store):
        self._store = store

    @staticmethod
    def verify_password(password: str, password_hash: str) -> bool:
        try:
            return bcrypt.checkpw(password.encode(), password_hash.encode())
        except ValueError:
            return False

    def get_user_by_email(self, email: str) -> UserRecord | None:
        results = self._store.query_global(REGISTRY_TABLE)
        for row in results:
            if not row["record_key"].startswith("user:"):
                continue
            if row["data"].get("email", "").lower() == email.lower():
                return UserRecord(**row["data"])
        return None

    def get_user_by_id(self, user_id: str) -> UserRecord | None:
        result = self._store.get_global(REGISTRY_TABLE, f"user:{user_id}")
        if not result:
            return None
        return UserRecord(**result["data"])
