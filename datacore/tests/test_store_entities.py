"""Unit tests for Store entity CRUD, versioning, and validation."""

import pytest
from datacore import Store


# ── 1. First entity gets version=1, status="active", dicts returned ──────────

def test_create_entity_first_version(store):
    result = store.put_entity(
        tenant_id="t1",
        entity_type="student",
        entity_id="S001",
        base_data={"first_name": "Alice", "last_name": "Smith"},
        custom_fields={"city": "Springfield"},
    )
    assert result["_version"] == 1
    assert result["_status"] == "active"
    assert isinstance(result["base_data"], dict)
    assert isinstance(result["_custom_fields"], dict)
    assert result["base_data"]["first_name"] == "Alice"
    assert result["_custom_fields"]["city"] == "Springfield"


# ── 2. Second put archives v1, makes v2 active ───────────────────────────────

def test_entity_new_version_archives_previous(store):
    store.put_entity(
        tenant_id="t1",
        entity_type="student",
        entity_id="S001",
        base_data={"first_name": "Alice", "last_name": "Smith"},
    )
    store.put_entity(
        tenant_id="t1",
        entity_type="student",
        entity_id="S001",
        base_data={"first_name": "Alice", "last_name": "Smith-Updated"},
    )

    active = store.get_active_entity("t1", "student", "S001")
    assert active is not None
    assert active["_version"] == 2
    assert active["_status"] == "active"

    history = store.get_entity_history("t1", "student", "S001")
    versions = [r["_version"] for r in history]
    assert 2 in versions
    assert 1 in versions

    archived_v1 = [r for r in history if r["_version"] == 1]
    assert len(archived_v1) == 1
    assert archived_v1[0]["_status"] == "archived"


# ── 3. get_active_entity returns None for missing entity ─────────────────────

def test_retrieve_active_entity_none_when_missing(store):
    result = store.get_active_entity("t1", "student", "NONEXISTENT")
    assert result is None

    # Also test with a tenant that has no table at all
    result2 = store.get_active_entity("t99", "student", "S001")
    assert result2 is None


# ── 4. History ordered descending by version ──────────────────────────────────

def test_entity_history_ordered_descending(store):
    for i in range(3):
        store.put_entity(
            tenant_id="t1",
            entity_type="student",
            entity_id="S001",
            base_data={"first_name": f"Alice-v{i+1}", "last_name": "Smith"},
        )

    history = store.get_entity_history("t1", "student", "S001")
    versions = [r["_version"] for r in history]
    assert versions == sorted(versions, reverse=True)
    assert versions[0] == 3
    assert versions[-1] == 1


# ── 5. History returns [] for missing entity ──────────────────────────────────

def test_entity_history_empty_when_missing(store):
    result = store.get_entity_history("t1", "student", "NONEXISTENT")
    assert result == []

    # Also test with a tenant that has no table at all
    result2 = store.get_entity_history("t99", "student", "S001")
    assert result2 == []


# ── 6. Version trimming for student (max=3) ───────────────────────────────────

def test_entity_version_trimming_per_entity_type(store):
    # store fixture has entity_version_limits={"student": 3}
    for i in range(6):
        store.put_entity(
            tenant_id="t1",
            entity_type="student",
            entity_id="S001",
            base_data={"first_name": f"Alice-v{i+1}", "last_name": "Smith"},
        )

    history = store.get_entity_history("t1", "student", "S001")
    assert len(history) <= 3


# ── 7. Version trimming for staff (max=2) ─────────────────────────────────────

def test_entity_version_trimming_different_limits(store):
    # store fixture has entity_version_limits={"staff": 2}
    for i in range(5):
        store.put_entity(
            tenant_id="t1",
            entity_type="staff",
            entity_id="STAFF001",
            base_data={"name": f"Bob-v{i+1}", "role": "teacher"},
        )

    history = store.get_entity_history("t1", "staff", "STAFF001")
    assert len(history) <= 2


# ── 8. Default version limit (no entity_version_limits) applies 5 ─────────────

def test_entity_version_trimming_default_limit(tmp_dir):
    # Create a Store with no entity_version_limits — default is 5
    s = Store(data_dir=tmp_dir)
    for i in range(8):
        s.put_entity(
            tenant_id="t1",
            entity_type="course",
            entity_id="C001",
            base_data={"name": f"Course-v{i+1}"},
        )

    history = s.get_entity_history("t1", "course", "C001")
    assert len(history) <= 5


# ── 9. Versioning is independent per entity_id ───────────────────────────────

def test_entity_versioning_independent_per_entity_id(store):
    # Put S001 twice, S002 once
    store.put_entity(
        tenant_id="t1",
        entity_type="student",
        entity_id="S001",
        base_data={"first_name": "Alice", "last_name": "Smith"},
    )
    store.put_entity(
        tenant_id="t1",
        entity_type="student",
        entity_id="S001",
        base_data={"first_name": "Alice", "last_name": "Smith-Updated"},
    )
    store.put_entity(
        tenant_id="t1",
        entity_type="student",
        entity_id="S002",
        base_data={"first_name": "Bob", "last_name": "Jones"},
    )

    active_s001 = store.get_active_entity("t1", "student", "S001")
    active_s002 = store.get_active_entity("t1", "student", "S002")

    assert active_s001["_version"] == 2
    assert active_s002["_version"] == 1

    history_s001 = store.get_entity_history("t1", "student", "S001")
    history_s002 = store.get_entity_history("t1", "student", "S002")

    assert len(history_s001) == 2
    assert len(history_s002) == 1


# ── 10. Custom fields are TOON-encoded (no braces in raw storage) ─────────────

def test_entity_custom_fields_stored_as_toon(store):
    store.put_entity(
        tenant_id="t1",
        entity_type="student",
        entity_id="S001",
        base_data={"first_name": "Alice", "last_name": "Smith"},
        custom_fields={"city": "Springfield", "bus_day": "tuesday"},
    )

    # Read raw from LanceDB
    table = store._db.open_table(store._entities_table_name("t1"))
    rows = table.search().where("entity_id = 'S001'").to_list()
    assert len(rows) == 1

    raw_custom = rows[0]["_custom_fields"]
    # Should NOT be JSON (no braces)
    assert "{" not in raw_custom
    # Should be TOON format: "key: value"
    assert "city: Springfield" in raw_custom


# ── 11. Custom fields can be empty dict ───────────────────────────────────────

def test_entity_custom_fields_empty_dict_ok(store):
    result = store.put_entity(
        tenant_id="t1",
        entity_type="student",
        entity_id="S001",
        base_data={"first_name": "Alice", "last_name": "Smith"},
        custom_fields=None,
    )
    assert result["_custom_fields"] == {}

    active = store.get_active_entity("t1", "student", "S001")
    assert active is not None
    assert active["_custom_fields"] == {}


# ── 12. Key conflict between base_data and custom_fields raises ValueError ─────

def test_entity_key_conflict_raises_error(store):
    with pytest.raises(ValueError, match="conflict with base data keys"):
        store.put_entity(
            tenant_id="t1",
            entity_type="student",
            entity_id="S999",
            base_data={"first_name": "Test", "city": "Nowhere"},
            custom_fields={"city": "Conflict!"},
        )


# ── 13. Multiple conflicting keys also raise ValueError ───────────────────────

def test_entity_key_conflict_multiple_keys(store):
    with pytest.raises(ValueError, match="conflict with base data keys"):
        store.put_entity(
            tenant_id="t1",
            entity_type="student",
            entity_id="S999",
            base_data={"first_name": "Test", "city": "Nowhere", "bus_day": "monday"},
            custom_fields={"city": "Conflict!", "bus_day": "tuesday"},
        )


# ── 14. Tenant isolation: t1 entity invisible to t2 ──────────────────────────

def test_entity_tenant_isolation(store):
    store.put_entity(
        tenant_id="t1",
        entity_type="student",
        entity_id="S001",
        base_data={"first_name": "Alice", "last_name": "Smith"},
    )

    # t2 should not see t1's entity
    result = store.get_active_entity("t2", "student", "S001")
    assert result is None

    history = store.get_entity_history("t2", "student", "S001")
    assert history == []


# ── 15. Delete a specific version ────────────────────────────────────────────

def test_delete_version(store):
    store.put_entity(
        tenant_id="t1",
        entity_type="student",
        entity_id="S001",
        base_data={"first_name": "Alice", "last_name": "Smith"},
    )
    store.put_entity(
        tenant_id="t1",
        entity_type="student",
        entity_id="S001",
        base_data={"first_name": "Alice", "last_name": "Smith-Updated"},
    )

    # Delete version 1
    deleted = store.delete_version(
        tenant_id="t1",
        table_type="entities",
        version=1,
        entity_type="student",
        entity_id="S001",
    )
    assert deleted is True

    history = store.get_entity_history("t1", "student", "S001")
    assert len(history) == 1
    assert history[0]["_version"] == 2


# ── 16. Deleting nonexistent version returns False ────────────────────────────

def test_delete_version_nonexistent_returns_false(store):
    result = store.delete_version(
        tenant_id="t1",
        table_type="entities",
        version=999,
        entity_type="student",
        entity_id="S001",
    )
    assert result is False


# ── 17. delete_version with invalid table_type raises ValueError ──────────────

def test_delete_version_invalid_table_type(store):
    with pytest.raises(ValueError, match="table_type must be"):
        store.delete_version(
            tenant_id="t1",
            table_type="invalid_type",
            version=1,
            entity_type="student",
            entity_id="S001",
        )
