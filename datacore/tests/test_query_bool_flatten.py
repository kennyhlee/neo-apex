"""Boolean field values flatten to lowercase strings on read."""
from datacore import QueryEngine


def test_bool_custom_and_base_fields_flatten_lowercase(seeded_store):
    seeded_store.put_entity(
        tenant_id="t1", entity_type="student", entity_id="B1",
        base_data={"first_name": "Bool", "active": True},
        custom_fields={"needs_bus": False, "opted_in": True},
    )
    r = QueryEngine(seeded_store).query(
        tenant_id="t1", table_type="entities",
        sql="SELECT needs_bus, opted_in, active FROM data WHERE entity_id = 'B1'",
    )
    row = r["rows"][0]
    assert row["needs_bus"] == "false"   # custom bool False -> "false" (not "False")
    assert row["opted_in"] == "true"     # custom bool True  -> "true"
    assert row["active"] == "true"       # base bool True    -> "true"
