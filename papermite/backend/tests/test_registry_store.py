"""Tests for RegistryStore and UserRecord in papermite."""


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
