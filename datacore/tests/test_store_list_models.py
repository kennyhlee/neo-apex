"""Tests for Store.list_models() method."""


MODEL_DEF_STUDENT = {
    "base_fields": [
        {"name": "first_name", "type": "str", "required": True},
        {"name": "last_name", "type": "str", "required": True},
    ],
    "custom_fields": [],
}

MODEL_DEF_STAFF = {
    "base_fields": [
        {"name": "name", "type": "str", "required": True},
        {"name": "role", "type": "str", "required": True},
    ],
    "custom_fields": [],
}


def test_list_models_empty_tenant(store):
    """Returns empty list when tenant has no models table."""
    result = store.list_models(tenant_id="nonexistent")
    assert result == []


def test_list_models_all_records(store):
    """Returns all records (active + archived) when status is None."""
    store.put_model("t1", "student", MODEL_DEF_STUDENT)
    store.put_model("t1", "student", {**MODEL_DEF_STUDENT, "iteration": 2})

    result = store.list_models("t1")
    assert len(result) == 2
    statuses = {r["_version"]: r["_status"] for r in result}
    assert statuses[1] == "archived"
    assert statuses[2] == "active"


def test_list_models_active_only(store):
    """Returns only active records when status='active'."""
    store.put_model("t1", "student", MODEL_DEF_STUDENT)
    store.put_model("t1", "student", {**MODEL_DEF_STUDENT, "iteration": 2})
    store.put_model("t1", "staff", MODEL_DEF_STAFF)

    result = store.list_models("t1", status="active")
    assert len(result) == 2
    assert all(r["_status"] == "active" for r in result)
    entity_types = {r["entity_type"] for r in result}
    assert entity_types == {"student", "staff"}


def test_list_models_archived_only(store):
    """Returns only archived records when status='archived'."""
    store.put_model("t1", "student", MODEL_DEF_STUDENT)
    store.put_model("t1", "student", {**MODEL_DEF_STUDENT, "iteration": 2})

    result = store.list_models("t1", status="archived")
    assert len(result) == 1
    assert result[0]["_status"] == "archived"
    assert result[0]["_version"] == 1


def test_list_models_deserializes_model_definition(store):
    """model_definition is returned as a dict, not a JSON string."""
    store.put_model("t1", "student", MODEL_DEF_STUDENT)

    result = store.list_models("t1")
    assert len(result) == 1
    assert isinstance(result[0]["model_definition"], dict)
    assert result[0]["model_definition"] == MODEL_DEF_STUDENT


def test_list_models_multiple_entity_types(seeded_store):
    """Returns records across all entity types for the tenant."""
    result = seeded_store.list_models("t1", status="active")
    entity_types = {r["entity_type"] for r in result}
    assert "student" in entity_types
    assert "staff" in entity_types


def test_list_models_tenant_isolation(store):
    """Tenant t2 cannot see tenant t1's models."""
    store.put_model("t1", "student", MODEL_DEF_STUDENT)

    result = store.list_models("t2")
    assert result == []
