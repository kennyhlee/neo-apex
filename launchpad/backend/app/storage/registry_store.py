"""Registry store — user and onboarding CRUD via datacore global tables."""

import copy
import uuid
from datetime import datetime, timezone

import bcrypt
from datacore import Store

from app.models.registry import OnboardingStatus, UserRecord

REGISTRY_TABLE = "registry"
ONBOARDING_STEPS = [
    {"id": "model_setup", "label": "Set Up Model", "completed": False},
    {"id": "tenant_details", "label": "Tenant Details", "completed": False},
]


class RegistryStore:
    def __init__(self, store: Store):
        self._store = store

    @staticmethod
    def hash_password(password: str) -> str:
        return bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()

    @staticmethod
    def verify_password(password: str, password_hash: str) -> bool:
        return bcrypt.checkpw(password.encode(), password_hash.encode())

    def create_user(
        self,
        name: str,
        email: str,
        password: str,
        tenant_id: str,
        tenant_name: str,
        role: str,
    ) -> UserRecord:
        user_id = f"u-{uuid.uuid4().hex[:8]}"
        now = datetime.now(timezone.utc).isoformat()
        record = UserRecord(
            user_id=user_id,
            name=name,
            email=email.lower(),
            password_hash=self.hash_password(password),
            tenant_id=tenant_id,
            tenant_name=tenant_name,
            role=role,
            created_at=now,
        )
        self._store.put_global(REGISTRY_TABLE, f"user:{user_id}", record.model_dump())
        return record

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

    def list_users_by_tenant(self, tenant_id: str) -> list[UserRecord]:
        results = self._store.query_global(
            REGISTRY_TABLE, filters={"tenant_id": tenant_id}
        )
        return [
            UserRecord(**row["data"])
            for row in results
            if row["record_key"].startswith("user:")
        ]

    def update_user(self, user_id: str, **fields) -> UserRecord:
        result = self._store.get_global(REGISTRY_TABLE, f"user:{user_id}")
        if not result:
            raise ValueError(f"User {user_id} not found")
        data = result["data"]
        data.update(fields)
        record = UserRecord(**data)
        self._store.put_global(REGISTRY_TABLE, f"user:{user_id}", record.model_dump())
        return record

    def delete_user(self, user_id: str) -> bool:
        return self._store.delete_global(REGISTRY_TABLE, f"user:{user_id}")

    def get_users_by_email_domain(self, domain: str) -> list[UserRecord]:
        """Return all users whose email matches the given domain."""
        results = self._store.query_global(REGISTRY_TABLE)
        users = []
        for row in results:
            if not row["record_key"].startswith("user:"):
                continue
            email = row["data"].get("email", "")
            if email.split("@")[-1].lower() == domain.lower():
                users.append(UserRecord(**row["data"]))
        return users

    def count_admins(self, tenant_id: str) -> int:
        users = self.list_users_by_tenant(tenant_id)
        return sum(1 for u in users if u.role == "admin")

    def create_onboarding(self, tenant_id: str) -> OnboardingStatus:
        status = OnboardingStatus(
            tenant_id=tenant_id,
            steps=copy.deepcopy(ONBOARDING_STEPS),
            is_complete=False,
        )
        self._store.put_global(
            REGISTRY_TABLE, f"onboarding:{tenant_id}", status.model_dump()
        )
        return status

    def get_onboarding(self, tenant_id: str) -> OnboardingStatus | None:
        result = self._store.get_global(REGISTRY_TABLE, f"onboarding:{tenant_id}")
        if not result:
            return None
        return OnboardingStatus(**result["data"])

    def mark_step_complete(
        self, tenant_id: str, step_id: str
    ) -> OnboardingStatus:
        status = self.get_onboarding(tenant_id)
        if not status:
            raise ValueError(f"No onboarding for tenant {tenant_id}")
        for step in status.steps:
            if step["id"] == step_id:
                step["completed"] = True
        status.is_complete = all(s["completed"] for s in status.steps)
        self._store.put_global(
            REGISTRY_TABLE, f"onboarding:{tenant_id}", status.model_dump()
        )
        return status
