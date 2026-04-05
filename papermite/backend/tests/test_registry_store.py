"""Tests for RegistryStore and UserRecord in papermite."""

from unittest.mock import MagicMock


def test_user_record_import():
    from app.models.registry import UserRecord
    user = UserRecord(
        user_id="u-abc123",
        name="Jane Admin",
        email="jane@acme.edu",
        password_hash="$2b$12$fakehash",
        tenant_id="acme",
        tenant_name="Acme School",
        role="admin",
        created_at="2026-01-01T00:00:00+00:00",
    )
    assert user.user_id == "u-abc123"
    assert user.email == "jane@acme.edu"
    assert user.role == "admin"


def _make_store(rows=None, get_result=None):
    """Build a mock datacore.Store for RegistryStore tests."""
    store = MagicMock()
    store.query_global.return_value = rows or []
    store.get_global.return_value = get_result
    return store


def test_verify_password_correct():
    import bcrypt
    from app.storage.registry_store import RegistryStore

    hashed = bcrypt.hashpw(b"secret", bcrypt.gensalt(rounds=4)).decode()
    assert RegistryStore.verify_password("secret", hashed) is True


def test_verify_password_wrong():
    import bcrypt
    from app.storage.registry_store import RegistryStore

    hashed = bcrypt.hashpw(b"secret", bcrypt.gensalt(rounds=4)).decode()
    assert RegistryStore.verify_password("wrong", hashed) is False


def test_get_user_by_email_found():
    from app.storage.registry_store import RegistryStore

    rows = [
        {
            "record_key": "user:u-abc123",
            "data": {
                "user_id": "u-abc123",
                "name": "Jane Admin",
                "email": "jane@acme.edu",
                "password_hash": "$2b$04$fakehash",
                "tenant_id": "acme",
                "tenant_name": "Acme School",
                "role": "admin",
                "created_at": "2026-01-01T00:00:00+00:00",
            },
        }
    ]
    store = _make_store(rows=rows)
    registry = RegistryStore(store)

    user = registry.get_user_by_email("jane@acme.edu")
    assert user is not None
    assert user.user_id == "u-abc123"
    assert user.email == "jane@acme.edu"


def test_get_user_by_email_not_found():
    from app.storage.registry_store import RegistryStore

    store = _make_store(rows=[])
    registry = RegistryStore(store)

    user = registry.get_user_by_email("nobody@acme.edu")
    assert user is None


def test_get_user_by_email_case_insensitive():
    from app.storage.registry_store import RegistryStore

    rows = [
        {
            "record_key": "user:u-abc123",
            "data": {
                "user_id": "u-abc123",
                "name": "Jane",
                "email": "jane@acme.edu",
                "password_hash": "$2b$04$x",
                "tenant_id": "acme",
                "tenant_name": "Acme",
                "role": "admin",
                "created_at": "2026-01-01T00:00:00+00:00",
            },
        }
    ]
    store = _make_store(rows=rows)
    registry = RegistryStore(store)

    user = registry.get_user_by_email("JANE@ACME.EDU")
    assert user is not None
    assert user.user_id == "u-abc123"


def test_get_user_by_id_found():
    from app.storage.registry_store import RegistryStore

    get_result = {
        "record_key": "user:u-abc123",
        "data": {
            "user_id": "u-abc123",
            "name": "Jane",
            "email": "jane@acme.edu",
            "password_hash": "$2b$04$x",
            "tenant_id": "acme",
            "tenant_name": "Acme",
            "role": "admin",
            "created_at": "2026-01-01T00:00:00+00:00",
        },
    }
    store = _make_store(get_result=get_result)
    registry = RegistryStore(store)

    user = registry.get_user_by_id("u-abc123")
    assert user is not None
    assert user.user_id == "u-abc123"


def test_get_user_by_id_not_found():
    from app.storage.registry_store import RegistryStore

    store = _make_store(get_result=None)
    registry = RegistryStore(store)

    user = registry.get_user_by_id("u-missing")
    assert user is None


def test_get_user_by_email_skips_non_user_keys():
    """Onboarding records (key: onboarding:...) must not be returned as users."""
    from app.storage.registry_store import RegistryStore

    rows = [
        {"record_key": "onboarding:acme", "data": {"tenant_id": "acme"}},
    ]
    store = _make_store(rows=rows)
    registry = RegistryStore(store)

    user = registry.get_user_by_email("acme@acme.edu")
    assert user is None
