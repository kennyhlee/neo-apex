"""Smoke test: store, retrieve, query, paginate, rollback."""

import tempfile
from pathlib import Path
from unittest.mock import MagicMock

from datacore import Store, QueryEngine


def test_full_workflow():
    with tempfile.TemporaryDirectory() as tmp:
        mock_embedder = MagicMock()
        mock_embedder.embed.return_value = [0.0] * 1024
        store = Store(
            data_dir=tmp,
            embedder=mock_embedder,
            max_model_versions=100,
            default_max_entity_versions=5,
            entity_version_limits={"student": 3},
        )
        engine = QueryEngine(store)

        # ── 0. Set up tenant ──
        store.put_entity(
            tenant_id="t1",
            entity_type="tenant",
            entity_id="t1",
            base_data={"tenant_id": "t1", "name": "Test School", "_abbrev": "TES"},
        )

        # ── 1. Store model definitions ──
        change_id = "ch001"
        store.put_model(
            tenant_id="t1",
            entity_type="student",
            model_definition={
                "base_fields": [
                    {"name": "first_name", "type": "str", "required": True},
                    {"name": "last_name", "type": "str", "required": True},
                    {"name": "grade", "type": "str", "required": False},
                ],
                "custom_fields": [],
            },
            change_id=change_id,
        )
        store.put_model(
            tenant_id="t1",
            entity_type="staff",
            model_definition={
                "base_fields": [
                    {"name": "name", "type": "str", "required": True},
                    {"name": "role", "type": "str", "required": True},
                ],
                "custom_fields": [],
            },
            change_id=change_id,
        )

        # Retrieve active model
        model = store.get_active_model("t1", "student")
        assert model is not None
        assert model["_version"] == 1
        assert model["model_definition"]["base_fields"][0]["name"] == "first_name"
        print("✓ Model store + retrieve works")

        # ── 2. Store entity records ──
        store.put_entity(
            tenant_id="t1",
            entity_type="student",
            entity_id="S001",
            base_data={"first_name": "Alice", "last_name": "Smith", "grade": "5"},
            custom_fields={"city": "Springfield", "bus_day": "tuesday"},
        )
        store.put_entity(
            tenant_id="t1",
            entity_type="student",
            entity_id="S002",
            base_data={"first_name": "Bob", "last_name": "Jones", "grade": "3"},
            custom_fields={"city": "Shelbyville", "bus_day": "monday"},
        )
        store.put_entity(
            tenant_id="t1",
            entity_type="student",
            entity_id="S003",
            base_data={"first_name": "Charlie", "last_name": "Brown", "grade": "5"},
            custom_fields={"city": "Springfield", "bus_day": "tuesday"},
        )

        # Retrieve active entity
        entity = store.get_active_entity("t1", "student", "S001")
        assert entity is not None
        assert entity["base_data"]["first_name"] == "Alice"
        assert entity["custom_fields"]["city"] == "Springfield"
        print("✓ Entity store + retrieve works")

        # ── 3. SQL query: filter on custom fields ──
        result = engine.query(
            tenant_id="t1",
            table_type="entities",
            sql="SELECT entity_id, first_name, city FROM data WHERE city = 'Springfield' AND _status = 'active'",
        )
        assert result["total"] == 2
        assert {r["entity_id"] for r in result["rows"]} == {"S001", "S003"}
        print("✓ Custom field query works")

        # ── 4. SQL query: aggregation ──
        result = engine.query(
            tenant_id="t1",
            table_type="entities",
            sql="SELECT bus_day, COUNT(*) AS count FROM data WHERE _status = 'active' AND entity_type != 'tenant' GROUP BY bus_day ORDER BY bus_day",
        )
        assert result["total"] == 2  # 2 groups
        bus_counts = {r["bus_day"]: r["count"] for r in result["rows"]}
        assert bus_counts["tuesday"] == 2
        assert bus_counts["monday"] == 1
        print("✓ Aggregation query works")

        # ── 5. SQL query: entity detail by ID ──
        result = engine.query(
            tenant_id="t1",
            table_type="entities",
            sql="SELECT * FROM data WHERE entity_id = 'S001' AND _status = 'active'",
        )
        assert result["total"] == 1
        assert result["rows"][0]["first_name"] == "Alice"
        print("✓ Entity detail query works")

        # ── 6. Pagination ──
        result = engine.query(
            tenant_id="t1",
            table_type="entities",
            sql="SELECT entity_id FROM data WHERE _status = 'active' AND entity_type != 'tenant' ORDER BY entity_id",
            limit=2,
            offset=0,
        )
        assert result["total"] == 3  # total is 3, but only 2 returned
        assert len(result["rows"]) == 2
        assert result["rows"][0]["entity_id"] == "S001"

        result_page2 = engine.query(
            tenant_id="t1",
            table_type="entities",
            sql="SELECT entity_id FROM data WHERE _status = 'active' AND entity_type != 'tenant' ORDER BY entity_id",
            limit=2,
            offset=2,
        )
        assert len(result_page2["rows"]) == 1
        assert result_page2["rows"][0]["entity_id"] == "S003"
        print("✓ Pagination works")

        # ── 7. Version history ──
        store.put_entity(
            tenant_id="t1",
            entity_type="student",
            entity_id="S001",
            base_data={"first_name": "Alice", "last_name": "Smith-Updated", "grade": "6"},
            custom_fields={"city": "Springfield", "bus_day": "wednesday"},
        )
        history = store.get_entity_history("t1", "student", "S001")
        assert len(history) == 2
        assert history[0]["_version"] == 2  # newest first
        assert history[0]["base_data"]["last_name"] == "Smith-Updated"
        print("✓ Version history works")

        # ── 8. Rollback by change_id ──
        change_id_2 = "ch002"
        store.put_model(
            tenant_id="t1",
            entity_type="student",
            model_definition={"base_fields": [{"name": "bad_field", "type": "str"}], "custom_fields": []},
            change_id=change_id_2,
        )
        store.put_model(
            tenant_id="t1",
            entity_type="staff",
            model_definition={"base_fields": [{"name": "bad_staff", "type": "str"}], "custom_fields": []},
            change_id=change_id_2,
        )

        # Both should be at version 2 now
        assert store.get_active_model("t1", "student")["_version"] == 2
        assert store.get_active_model("t1", "staff")["_version"] == 2

        # Rollback
        summary = store.rollback_by_change_id("t1", change_id_2)
        assert len(summary["models"]) == 2

        # Should be back to version 1
        student_model = store.get_active_model("t1", "student")
        assert student_model["_version"] == 1
        assert student_model["model_definition"]["base_fields"][0]["name"] == "first_name"
        print("✓ Rollback by change_id works")

        # ── 9. Version trimming (student max=3) ──
        for i in range(5):
            store.put_entity(
                tenant_id="t1",
                entity_type="student",
                entity_id="S001",
                base_data={"first_name": f"Alice-v{i}", "last_name": "Smith", "grade": "6"},
            )
        history = store.get_entity_history("t1", "student", "S001")
        assert len(history) <= 3  # student max is 3
        print("✓ Version trimming works")

        # ── 10. Key conflict validation ──
        import pytest
        with pytest.raises(ValueError, match="conflict with base data keys"):
            store.put_entity(
                tenant_id="t1",
                entity_type="student",
                entity_id="S999",
                base_data={"first_name": "Test", "city": "Nowhere"},
                custom_fields={"city": "Conflict!"},
            )
        print("✓ Key conflict validation works")

        print("\n🎉 All smoke tests passed!")


if __name__ == "__main__":
    test_full_workflow()
