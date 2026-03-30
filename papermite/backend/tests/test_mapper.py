"""Tests for mapper with Family and Contact entity types."""
from app.models.extraction import RawExtraction
from app.services.mapper import map_extraction


def test_map_family():
    raw = RawExtraction(
        families=[{
            "family_name": "Smith Household",
            "primary_email": "smith@example.com",
            "primary_phone": "(555) 111-2222",
        }],
    )
    result = map_extraction(raw, "t1", "test.pdf", "raw text")
    family_entities = [e for e in result.entities if e.entity_type == "FAMILY"]
    assert len(family_entities) == 1
    fam = family_entities[0]
    assert any(m.field_name == "family_name" and m.source == "base_model" for m in fam.field_mappings)
    assert any(m.field_name == "primary_email" for m in fam.field_mappings)


def test_map_contact_guardian():
    raw = RawExtraction(
        contacts=[{
            "first_name": "Jane",
            "last_name": "Smith",
            "role": "guardian",
            "family_id": "F1",
            "student_id": "S1",
            "email": "jane@example.com",
            "relationship": "mother",
        }],
    )
    result = map_extraction(raw, "t1", "test.pdf", "raw text")
    contact_entities = [e for e in result.entities if e.entity_type == "CONTACT"]
    assert len(contact_entities) == 1
    c = contact_entities[0]
    assert any(m.field_name == "role" and m.value == "guardian" for m in c.field_mappings)
    assert any(m.field_name == "student_id" for m in c.field_mappings)


def test_map_contact_medical():
    raw = RawExtraction(
        contacts=[{
            "first_name": "Dr. Lee",
            "last_name": "Park",
            "role": "medical",
            "family_id": "F1",
            "student_id": "S1",
            "organization": "Springfield Pediatrics",
            "address": "456 Health Ave, Springfield",
        }],
    )
    result = map_extraction(raw, "t1", "test.pdf", "raw text")
    contact_entities = [e for e in result.entities if e.entity_type == "CONTACT"]
    assert len(contact_entities) == 1
    c = contact_entities[0]
    assert any(m.field_name == "organization" and m.value == "Springfield Pediatrics" for m in c.field_mappings)
    assert any(m.field_name == "address" and m.source == "base_model" for m in c.field_mappings)


def test_map_no_guardian_entity_type():
    """Ensure old GUARDIAN entity type is never produced."""
    raw = RawExtraction(
        contacts=[{
            "first_name": "Jane",
            "last_name": "Smith",
            "role": "guardian",
            "family_id": "F1",
            "student_id": "S1",
        }],
    )
    result = map_extraction(raw, "t1", "test.pdf", "raw text")
    entity_types = {e.entity_type for e in result.entities}
    assert "GUARDIAN" not in entity_types
    assert "EMERGENCY_CONTACT" not in entity_types
    assert "MEDICAL_CONTACT" not in entity_types


def test_map_contact_custom_fields():
    """Extra fields on contact go to custom_fields."""
    raw = RawExtraction(
        contacts=[{
            "first_name": "Jane",
            "last_name": "Smith",
            "role": "guardian",
            "family_id": "F1",
            "student_id": "S1",
            "preferred_language": "Spanish",
        }],
    )
    result = map_extraction(raw, "t1", "test.pdf", "raw text")
    c = [e for e in result.entities if e.entity_type == "CONTACT"][0]
    assert any(m.field_name == "preferred_language" and m.source == "custom_field" for m in c.field_mappings)
