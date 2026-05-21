"""Integration: mapper.map_extraction → finalize._build_model_definition.

Verifies that the backstop in map_extraction propagates through to the
model definition dict that gets written to DataCore — every entity type
in ENTITY_CLASSES appears with non-empty base_fields, even when the
source document had nothing to extract.
"""
from app.api.finalize import _build_model_definition
from app.models.domain import ENTITY_CLASSES
from app.models.extraction import RawExtraction
from app.services.mapper import map_extraction


def test_build_model_definition_includes_all_entity_types_for_empty_extraction():
    raw = RawExtraction()
    result = map_extraction(raw, "t1", "f.pdf")

    model_def = _build_model_definition(result.entities)

    # Every ENTITY_CLASSES key appears in the model definition
    expected_keys = set(ENTITY_CLASSES.keys())
    actual_keys = set(model_def.keys())
    assert actual_keys == expected_keys

    # Every entry has non-empty base_fields (each Pydantic class declares at
    # least one base field beyond the system fields)
    for entity_type, definition in model_def.items():
        assert "base_fields" in definition, f"{entity_type} missing base_fields"
        assert isinstance(definition["base_fields"], list)
        assert len(definition["base_fields"]) > 0, (
            f"{entity_type} has empty base_fields"
        )
        # custom_fields is always present (placeholders carry zero custom fields)
        assert "custom_fields" in definition
        assert definition["custom_fields"] == []
