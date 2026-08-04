"""Tenant entity lookup + base_data extraction (app/tenant_lookup.py).

Exercises get_tenant_entity against FakeDataCore (patches
app.registration.datacore, which tenant_lookup.py imports get_entity from —
NOT a raw dc_query call, so this also proves the sparse-field trap is
avoided: FakeDataCore.list_entities binder-errors on any `where` predicate
for a column no row has written yet, and this lookup filters on entity_id
(always present), never on stripe_account_id.
"""
import pytest

from tests.fakes import FakeDataCore, install_fake_datacore


@pytest.fixture
def fake_dc(monkeypatch):
    fdc = FakeDataCore()
    install_fake_datacore(monkeypatch, fdc)
    return fdc


def test_get_tenant_entity_found(fake_dc):
    from app.tenant_lookup import get_tenant_entity

    # Real DataCore's tenant rows use entity_id == tenant_id (confirmed
    # against Task 3/6's TENANT_ROW fixtures) rather than FakeDataCore's
    # auto-assigned uuid, so seed the row directly in that shape.
    fake_dc.rows.append({
        "entity_id": "acme", "entity_type": "tenant", "_tenant": "acme",
        "name": "Acme School",
    })

    row = get_tenant_entity("acme", None)
    assert row is not None
    assert row["entity_id"] == "acme"
    assert row["name"] == "Acme School"


def test_get_tenant_entity_missing_returns_none(fake_dc):
    from app.tenant_lookup import get_tenant_entity

    assert get_tenant_entity("nope", None) is None


def test_get_tenant_entity_before_any_stripe_account_id_exists(fake_dc):
    """The sparse-field trap: before ANY tenant in this tenant's table has
    written stripe_account_id, a SQL predicate filtering on that column
    would binder-error (FakeDataCore mirrors DataCore's real behavior here).
    get_tenant_entity must still succeed, because it never filters on
    stripe_account_id — only on entity_id."""
    from app.tenant_lookup import get_tenant_entity

    fake_dc.rows.append({
        "entity_id": "acme", "entity_type": "tenant", "_tenant": "acme",
        "name": "Acme School",
    })

    row = get_tenant_entity("acme", None)
    assert row is not None
    assert "stripe_account_id" not in row


def test_entity_base_data_strips_system_columns():
    from app.tenant_lookup import entity_base_data

    row = {
        "entity_id": "acme", "entity_type": "tenant", "_tenant": "acme",
        "_status": "active", "name": "Acme School", "stripe_account_id": "acct_123",
        "note": None,
    }
    base = entity_base_data(row)
    assert base == {"name": "Acme School", "stripe_account_id": "acct_123"}
