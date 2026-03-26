"""Unit tests for store.rollback_by_change_id."""


def test_rollback_models_by_change_id(store):
    """Put 2 models with cid1, put 2 with cid2, rollback cid2, both back to v1."""
    cid1 = "change-1"
    cid2 = "change-2"

    # v1 for both entity types
    store.put_model(
        tenant_id="t1",
        entity_type="student",
        model_definition={"base_fields": [{"name": "first_name", "type": "str"}], "custom_fields": []},
        change_id=cid1,
    )
    store.put_model(
        tenant_id="t1",
        entity_type="staff",
        model_definition={"base_fields": [{"name": "name", "type": "str"}], "custom_fields": []},
        change_id=cid1,
    )

    # v2 for both entity types
    store.put_model(
        tenant_id="t1",
        entity_type="student",
        model_definition={"base_fields": [{"name": "bad_field", "type": "str"}], "custom_fields": []},
        change_id=cid2,
    )
    store.put_model(
        tenant_id="t1",
        entity_type="staff",
        model_definition={"base_fields": [{"name": "bad_staff", "type": "str"}], "custom_fields": []},
        change_id=cid2,
    )

    assert store.get_active_model("t1", "student")["_version"] == 2
    assert store.get_active_model("t1", "staff")["_version"] == 2

    summary = store.rollback_by_change_id("t1", cid2)

    assert len(summary["models"]) == 2
    rolled_back_types = {m["entity_type"] for m in summary["models"]}
    assert "student" in rolled_back_types
    assert "staff" in rolled_back_types

    student_model = store.get_active_model("t1", "student")
    assert student_model["_version"] == 1
    assert student_model["model_definition"]["base_fields"][0]["name"] == "first_name"

    staff_model = store.get_active_model("t1", "staff")
    assert staff_model["_version"] == 1
    assert staff_model["model_definition"]["base_fields"][0]["name"] == "name"


def test_rollback_entities_by_change_id(store):
    """Put entity v1, put v2 with cid, rollback cid, entity back to v1."""
    cid = "entity-change"

    store.put_entity(
        tenant_id="t1",
        entity_type="student",
        entity_id="S001",
        base_data={"first_name": "Alice", "last_name": "Smith"},
    )

    assert store.get_active_entity("t1", "student", "S001")["_version"] == 1

    store.put_entity(
        tenant_id="t1",
        entity_type="student",
        entity_id="S001",
        base_data={"first_name": "Alice-Updated", "last_name": "Smith-Updated"},
        change_id=cid,
    )

    assert store.get_active_entity("t1", "student", "S001")["_version"] == 2

    summary = store.rollback_by_change_id("t1", cid)

    assert len(summary["entities"]) == 1
    assert summary["entities"][0]["entity_type"] == "student"
    assert summary["entities"][0]["rolled_back_version"] == 2

    entity = store.get_active_entity("t1", "student", "S001")
    assert entity["_version"] == 1
    assert entity["base_data"]["first_name"] == "Alice"
    assert entity["base_data"]["last_name"] == "Smith"


def test_rollback_across_models_and_entities(store):
    """Put model+entity v1 (no cid), put both v2 with same cid, rollback, both back to v1."""
    cid = "combined-change"

    # v1 - no change_id
    store.put_model(
        tenant_id="t1",
        entity_type="student",
        model_definition={"base_fields": [{"name": "first_name", "type": "str"}], "custom_fields": []},
    )
    store.put_entity(
        tenant_id="t1",
        entity_type="student",
        entity_id="S001",
        base_data={"first_name": "Alice"},
    )

    assert store.get_active_model("t1", "student")["_version"] == 1
    assert store.get_active_entity("t1", "student", "S001")["_version"] == 1

    # v2 - with cid
    store.put_model(
        tenant_id="t1",
        entity_type="student",
        model_definition={"base_fields": [{"name": "bad_field", "type": "str"}], "custom_fields": []},
        change_id=cid,
    )
    store.put_entity(
        tenant_id="t1",
        entity_type="student",
        entity_id="S001",
        base_data={"first_name": "Alice-Bad"},
        change_id=cid,
    )

    assert store.get_active_model("t1", "student")["_version"] == 2
    assert store.get_active_entity("t1", "student", "S001")["_version"] == 2

    summary = store.rollback_by_change_id("t1", cid)

    assert len(summary["models"]) == 1
    assert len(summary["entities"]) == 1

    model = store.get_active_model("t1", "student")
    assert model["_version"] == 1
    assert model["model_definition"]["base_fields"][0]["name"] == "first_name"

    entity = store.get_active_entity("t1", "student", "S001")
    assert entity["_version"] == 1
    assert entity["base_data"]["first_name"] == "Alice"


def test_rollback_nonexistent_change_id(store):
    """Rollback of a non-existent change_id returns empty lists."""
    summary = store.rollback_by_change_id("t1", "doesnt-exist")

    assert summary == {"models": [], "entities": []}


def test_rollback_tenant_isolation(store):
    """Rollback on t1 does not affect t2."""
    cid = "t1-change"

    # t1: v1, then v2 with cid
    store.put_model(
        tenant_id="t1",
        entity_type="student",
        model_definition={"base_fields": [{"name": "first_name", "type": "str"}], "custom_fields": []},
    )
    store.put_model(
        tenant_id="t1",
        entity_type="student",
        model_definition={"base_fields": [{"name": "bad_field", "type": "str"}], "custom_fields": []},
        change_id=cid,
    )

    # t2: v1 only
    store.put_model(
        tenant_id="t2",
        entity_type="student",
        model_definition={"base_fields": [{"name": "t2_field", "type": "str"}], "custom_fields": []},
    )

    assert store.get_active_model("t1", "student")["_version"] == 2
    assert store.get_active_model("t2", "student")["_version"] == 1

    summary = store.rollback_by_change_id("t1", cid)

    assert len(summary["models"]) == 1

    # t1 rolled back to v1
    t1_model = store.get_active_model("t1", "student")
    assert t1_model["_version"] == 1
    assert t1_model["model_definition"]["base_fields"][0]["name"] == "first_name"

    # t2 unaffected
    t2_model = store.get_active_model("t2", "student")
    assert t2_model["_version"] == 1
    assert t2_model["model_definition"]["base_fields"][0]["name"] == "t2_field"
