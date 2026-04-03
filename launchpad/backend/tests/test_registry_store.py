"""Tests for RegistryStore — user and onboarding CRUD."""

import pytest
from datacore import Store

from app.storage.registry_store import RegistryStore


@pytest.fixture()
def registry(tmp_path):
    store = Store(data_dir=tmp_path / "db")
    return RegistryStore(store)


# ── User CRUD ──────────────────────────────────────────────


def test_create_user(registry):
    user = registry.create_user(
        name="Alice",
        email="Alice@Example.com",
        password="secret123",
        tenant_id="t-001",
        tenant_name="Acme Academy",
        role="admin",
    )
    assert user.user_id.startswith("u-")
    assert user.email == "alice@example.com"  # lowercased
    assert user.password_hash != "secret123"  # hashed
    assert user.name == "Alice"
    assert user.tenant_id == "t-001"
    assert user.role == "admin"
    assert user.created_at  # non-empty


def test_get_user_by_email_found(registry):
    registry.create_user("Bob", "bob@test.com", "pw", "t-1", "T1", "staff")
    found = registry.get_user_by_email("bob@test.com")
    assert found is not None
    assert found.name == "Bob"


def test_get_user_by_email_not_found(registry):
    assert registry.get_user_by_email("nobody@test.com") is None


def test_get_user_by_email_case_insensitive(registry):
    registry.create_user("Cara", "Cara@Test.COM", "pw", "t-1", "T1", "teacher")
    found = registry.get_user_by_email("cara@test.com")
    assert found is not None
    assert found.name == "Cara"


def test_get_user_by_id(registry):
    user = registry.create_user("Dan", "dan@x.com", "pw", "t-1", "T1", "admin")
    found = registry.get_user_by_id(user.user_id)
    assert found is not None
    assert found.email == "dan@x.com"


def test_get_user_by_id_not_found(registry):
    assert registry.get_user_by_id("u-nonexistent") is None


def test_list_users_by_tenant(registry):
    registry.create_user("E1", "e1@x.com", "pw", "t-a", "TA", "admin")
    registry.create_user("E2", "e2@x.com", "pw", "t-a", "TA", "staff")
    registry.create_user("E3", "e3@x.com", "pw", "t-b", "TB", "admin")

    users_a = registry.list_users_by_tenant("t-a")
    users_b = registry.list_users_by_tenant("t-b")
    assert len(users_a) == 2
    assert len(users_b) == 1
    assert users_b[0].name == "E3"


def test_update_user(registry):
    user = registry.create_user("Fay", "fay@x.com", "pw", "t-1", "T1", "staff")
    updated = registry.update_user(user.user_id, role="admin")
    assert updated.role == "admin"
    assert updated.name == "Fay"  # unchanged


def test_update_user_not_found(registry):
    with pytest.raises(ValueError, match="not found"):
        registry.update_user("u-ghost", role="admin")


def test_delete_user(registry):
    user = registry.create_user("Gus", "gus@x.com", "pw", "t-1", "T1", "staff")
    assert registry.delete_user(user.user_id) is True
    assert registry.get_user_by_id(user.user_id) is None


def test_delete_user_not_found(registry):
    assert registry.delete_user("u-nonexistent") is False


# ── Password verification ──────────────────────────────────


def test_verify_password_correct(registry):
    user = registry.create_user("Hal", "hal@x.com", "mypass", "t-1", "T1", "admin")
    assert RegistryStore.verify_password("mypass", user.password_hash) is True


def test_verify_password_incorrect(registry):
    user = registry.create_user("Ivy", "ivy@x.com", "right", "t-1", "T1", "admin")
    assert RegistryStore.verify_password("wrong", user.password_hash) is False


# ── Admin count ────────────────────────────────────────────


def test_count_admins(registry):
    registry.create_user("A1", "a1@x.com", "pw", "t-1", "T1", "admin")
    registry.create_user("A2", "a2@x.com", "pw", "t-1", "T1", "admin")
    registry.create_user("A3", "a3@x.com", "pw", "t-1", "T1", "staff")
    assert registry.count_admins("t-1") == 2


# ── Onboarding ─────────────────────────────────────────────


def test_create_onboarding(registry):
    status = registry.create_onboarding("t-1")
    assert status.tenant_id == "t-1"
    assert len(status.steps) == 2
    assert status.is_complete is False
    assert all(s["completed"] is False for s in status.steps)


def test_get_onboarding(registry):
    registry.create_onboarding("t-1")
    status = registry.get_onboarding("t-1")
    assert status is not None
    assert status.tenant_id == "t-1"


def test_get_onboarding_not_found(registry):
    assert registry.get_onboarding("t-nonexistent") is None


def test_mark_step_complete_one(registry):
    registry.create_onboarding("t-1")
    status = registry.mark_step_complete("t-1", "model_setup")
    assert status.steps[0]["completed"] is True
    assert status.steps[1]["completed"] is False
    assert status.is_complete is False


def test_mark_step_complete_all(registry):
    registry.create_onboarding("t-1")
    registry.mark_step_complete("t-1", "model_setup")
    status = registry.mark_step_complete("t-1", "tenant_details")
    assert all(s["completed"] for s in status.steps)
    assert status.is_complete is True


def test_mark_step_complete_no_onboarding(registry):
    with pytest.raises(ValueError, match="No onboarding"):
        registry.mark_step_complete("t-ghost", "model_setup")
