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


# ── tenant_write_payload: the write-side split ────────────────────────────

FLAT_TENANT_ROW = {
    "entity_id": "acme",
    "entity_type": "tenant",
    "base_data": "name: Acme School\n_abbrev: ACS",
    "custom_fields": "",
    "vector": [0.0, 0.0],
    "_version": "4",
    "_status": "active",
    "_change_id": "chg_1",
    "_created_at": "2026-01-01T00:00:00+00:00",
    "_updated_at": "2026-02-01T00:00:00+00:00",
    "name": "Acme School",
    "_abbrev": "ACS",
    "note": None,
}


def test_tenant_write_payload_keeps_abbrev_and_drops_meta():
    from app.tenant_lookup import tenant_write_payload

    base, custom = tenant_write_payload(FLAT_TENANT_ROW)
    assert base == {"name": "Acme School", "_abbrev": "ACS"}
    assert custom == {}


def test_tenant_write_payload_splits_custom_fields_out_of_base_data():
    from app.tenant_lookup import tenant_write_payload

    row = {
        **FLAT_TENANT_ROW,
        "custom_fields": 'district: North\n"seat count": 30\ntags[2]: a,b\nmeta:\n  x: 1',
        "district": "North",
        "seat count": "30",
        "tags": '["a", "b"]',
        "meta": '{"x": 1}',
    }
    base, custom = tenant_write_payload(row)
    assert custom == {
        "district": "North", "seat count": "30", "tags": '["a", "b"]', "meta": '{"x": 1}',
    }
    # DataCore's put_entity raises ValueError when base_data and
    # custom_fields share a key, so the split must be exclusive.
    assert set(base) & set(custom) == set()
    assert base["_abbrev"] == "ACS"


def test_tenant_write_payload_ignores_unrecognized_toon_keys():
    """Conservative by design: a key the TOON scanner cannot match back to an
    actual column is left where it was rather than dropped."""
    from app.tenant_lookup import tenant_write_payload

    row = {**FLAT_TENANT_ROW, "custom_fields": "ghost: 1"}
    base, custom = tenant_write_payload(row)
    assert custom == {}
    assert base == {"name": "Acme School", "_abbrev": "ACS"}


def test_update_tenant_entity_sends_changes_and_custom_fields(monkeypatch):
    from app import tenant_lookup

    seen = {}
    monkeypatch.setattr(
        tenant_lookup, "dc_update",
        lambda t, et, eid, base, tok, custom_fields=None: seen.update(
            tenant=t, entity_type=et, entity_id=eid, base=base,
            custom=custom_fields, token=tok,
        ) or {"entity_id": eid},
    )
    row = {**FLAT_TENANT_ROW, "custom_fields": "district: North", "district": "North"}
    tenant_lookup.update_tenant_entity("acme", row, {"stripe_account_id": "acct_1"}, "tok")

    assert seen["tenant"] == "acme"
    assert seen["entity_type"] == "tenant"
    assert seen["entity_id"] == "acme"
    assert seen["token"] == "tok"
    assert seen["base"] == {
        "name": "Acme School", "_abbrev": "ACS", "stripe_account_id": "acct_1",
    }
    assert seen["custom"] == {"district": "North"}


def test_update_tenant_entity_change_wins_over_a_colliding_custom_field(monkeypatch):
    """A change key that also exists as a custom field must end up in
    base_data only — sending it in both trips DataCore's overlap check."""
    from app import tenant_lookup

    seen = {}
    monkeypatch.setattr(
        tenant_lookup, "dc_update",
        lambda t, et, eid, base, tok, custom_fields=None: seen.update(
            base=base, custom=custom_fields) or {"entity_id": eid},
    )
    row = {
        **FLAT_TENANT_ROW,
        "custom_fields": "stripe_account_id: acct_old",
        "stripe_account_id": "acct_old",
    }
    tenant_lookup.update_tenant_entity("acme", row, {"stripe_account_id": "acct_new"})

    assert seen["base"]["stripe_account_id"] == "acct_new"
    assert seen["custom"] == {}
