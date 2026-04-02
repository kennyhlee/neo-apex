"""Unit tests for Store model definition CRUD and versioning."""

import pytest


MODEL_DEF_V1 = {
    "base_fields": [
        {"name": "first_name", "type": "str", "required": True},
        {"name": "last_name", "type": "str", "required": True},
    ],
    "custom_fields": [],
}

MODEL_DEF_V2 = {
    "base_fields": [
        {"name": "first_name", "type": "str", "required": True},
        {"name": "last_name", "type": "str", "required": True},
        {"name": "grade", "type": "str", "required": False},
    ],
    "custom_fields": [],
}


@pytest.fixture(autouse=True)
def setup_tenant(store):
    """Ensure tenant exists before each test."""
    store.put_entity(
        tenant_id="t1",
        entity_type="tenant",
        entity_id="t1",
        base_data={"tenant_id": "t1", "name": "Test School", "_abbrev": "TES"},
    )


def test_create_model_first_version(store):
    result = store.put_model(
        tenant_id="t1",
        entity_type="student",
        model_definition=MODEL_DEF_V1,
    )

    assert result["_version"] == 1
    assert result["_status"] == "active"
    assert result["_change_id"] is not None
    assert result["_created_at"] is not None
    assert result["_updated_at"] is not None
    assert result["entity_type"] == "student"
    assert result["model_definition"] == MODEL_DEF_V1


def test_create_model_auto_creates_table(store):
    before = store.get_active_model(tenant_id="t1", entity_type="student")
    assert before is None

    store.put_model(
        tenant_id="t1",
        entity_type="student",
        model_definition=MODEL_DEF_V1,
    )

    after = store.get_active_model(tenant_id="t1", entity_type="student")
    assert after is not None


def test_new_version_archives_previous(store):
    store.put_model(
        tenant_id="t1",
        entity_type="student",
        model_definition=MODEL_DEF_V1,
    )
    store.put_model(
        tenant_id="t1",
        entity_type="student",
        model_definition=MODEL_DEF_V2,
    )

    active = store.get_active_model(tenant_id="t1", entity_type="student")
    assert active["_version"] == 2
    assert active["_status"] == "active"
    assert active["model_definition"] == MODEL_DEF_V2

    history = store.get_model_history(tenant_id="t1", entity_type="student")
    statuses = {r["_version"]: r["_status"] for r in history}
    assert statuses[1] == "archived"
    assert statuses[2] == "active"


def test_retrieve_active_model_none_when_missing(store):
    result = store.get_active_model(
        tenant_id="nonexistent_tenant",
        entity_type="nonexistent_type",
    )
    assert result is None

    # Also test a tenant that exists (has a table) but no matching entity_type
    store.put_model(
        tenant_id="t1",
        entity_type="student",
        model_definition=MODEL_DEF_V1,
    )
    result2 = store.get_active_model(tenant_id="t1", entity_type="staff")
    assert result2 is None


def test_model_history_ordered_descending(store):
    for i in range(3):
        store.put_model(
            tenant_id="t1",
            entity_type="student",
            model_definition={**MODEL_DEF_V1, "iteration": i},
        )

    history = store.get_model_history(tenant_id="t1", entity_type="student")
    versions = [r["_version"] for r in history]
    assert versions == [3, 2, 1]


def test_model_history_empty_when_missing(store):
    result = store.get_model_history(
        tenant_id="nonexistent_tenant",
        entity_type="nonexistent_type",
    )
    assert result == []

    # Tenant exists but entity_type does not
    store.put_model(
        tenant_id="t1",
        entity_type="student",
        model_definition=MODEL_DEF_V1,
    )
    result2 = store.get_model_history(tenant_id="t1", entity_type="staff")
    assert result2 == []


def test_model_version_trimming(store):
    # store fixture has max_model_versions=5; put 8 versions
    for i in range(8):
        store.put_model(
            tenant_id="t1",
            entity_type="student",
            model_definition={**MODEL_DEF_V1, "iteration": i},
        )

    history = store.get_model_history(tenant_id="t1", entity_type="student")
    assert len(history) <= 5


def test_model_versioning_independent_per_entity_type(store):
    # student gets 3 versions
    for i in range(3):
        store.put_model(
            tenant_id="t1",
            entity_type="student",
            model_definition={**MODEL_DEF_V1, "iteration": i},
        )

    # staff gets 1 version
    store.put_model(
        tenant_id="t1",
        entity_type="staff",
        model_definition={
            "base_fields": [{"name": "name", "type": "str", "required": True}],
            "custom_fields": [],
        },
    )

    student_active = store.get_active_model(tenant_id="t1", entity_type="student")
    staff_active = store.get_active_model(tenant_id="t1", entity_type="staff")

    assert student_active["_version"] == 3
    assert staff_active["_version"] == 1


def test_model_change_id_correlation(store):
    shared_change_id = "shared-change-abc123"

    store.put_model(
        tenant_id="t1",
        entity_type="student",
        model_definition=MODEL_DEF_V1,
        change_id=shared_change_id,
    )
    store.put_model(
        tenant_id="t1",
        entity_type="staff",
        model_definition={
            "base_fields": [{"name": "name", "type": "str", "required": True}],
            "custom_fields": [],
        },
        change_id=shared_change_id,
    )

    student = store.get_active_model(tenant_id="t1", entity_type="student")
    staff = store.get_active_model(tenant_id="t1", entity_type="staff")

    assert student["_change_id"] == shared_change_id
    assert staff["_change_id"] == shared_change_id


def test_model_tenant_isolation(store):
    store.put_model(
        tenant_id="t1",
        entity_type="student",
        model_definition=MODEL_DEF_V1,
    )

    # t2 should not see t1's model
    result = store.get_active_model(tenant_id="t2", entity_type="student")
    assert result is None

    history = store.get_model_history(tenant_id="t2", entity_type="student")
    assert history == []
