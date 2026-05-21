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
    result = map_extraction(raw, "t1", "test.pdf")
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
    result = map_extraction(raw, "t1", "test.pdf")
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
    result = map_extraction(raw, "t1", "test.pdf")
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
    result = map_extraction(raw, "t1", "test.pdf")
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
    result = map_extraction(raw, "t1", "test.pdf")
    c = [e for e in result.entities if e.entity_type == "CONTACT"][0]
    assert any(m.field_name == "preferred_language" and m.source == "custom_field" for m in c.field_mappings)


def test_student_selection_fields_are_single_select():
    """Student grade_level, gender, status should be single-select (multiple=False)."""
    raw = RawExtraction(
        students=[{
            "first_name": "Alice",
            "last_name": "Smith",
            "grade_level": ["1st"],
            "gender": ["Female"],
            "status": ["Active"],
        }],
    )
    result = map_extraction(raw, "t1", "test.pdf")
    student = [e for e in result.entities if e.entity_type == "STUDENT"][0]

    for field_name in ("grade_level", "gender", "status"):
        mapping = next(m for m in student.field_mappings if m.field_name == field_name)
        assert mapping.multiple is False, f"{field_name} should be single-select"
        assert mapping.options is not None and len(mapping.options) > 0


def test_program_multi_select_fields():
    """Program days_of_week and grade_levels should be multi-select (multiple=True)."""
    raw = RawExtraction(
        programs=[{
            "name": "After School",
            "days_of_week": ["Monday", "Wednesday"],
            "grade_levels": ["1st", "2nd"],
        }],
    )
    result = map_extraction(raw, "t1", "test.pdf")
    program = [e for e in result.entities if e.entity_type == "PROGRAM"][0]

    for field_name in ("days_of_week", "grade_levels"):
        mapping = next(m for m in program.field_mappings if m.field_name == field_name)
        assert mapping.multiple is True, f"{field_name} should be multi-select"

    # Program status should still be single-select
    status_mapping = next(m for m in program.field_mappings if m.field_name == "status")
    assert status_mapping.multiple is False, "Program status should be single-select"


def test_consolidator_preserves_single_select_cardinality():
    """Consolidating duplicate entities should not force multiple=True on single-select fields."""
    raw = RawExtraction(
        students=[
            {
                "first_name": "Alice",
                "last_name": "Smith",
                "gender": ["Female"],
            },
            {
                "first_name": "Bob",
                "last_name": "Jones",
                "gender": ["Male"],
            },
        ],
    )
    result = map_extraction(raw, "t1", "test.pdf")
    student = [e for e in result.entities if e.entity_type == "STUDENT"][0]
    gender_mapping = next(m for m in student.field_mappings if m.field_name == "gender")
    # After consolidation, gender should still be single-select
    assert gender_mapping.multiple is False, "Consolidation should preserve single-select cardinality"
    # But options should be merged
    assert "Female" in gender_mapping.options
    assert "Male" in gender_mapping.options


def test_extraction_result_has_no_raw_text_field():
    """raw_text was removed in the extract-pipeline consolidation."""
    from app.models.extraction import ExtractionResult
    assert "raw_text" not in ExtractionResult.model_fields


def test_map_extraction_all_placeholders_when_raw_is_empty():
    """With nothing extracted, every entity type in ENTITY_CLASSES must appear."""
    from app.models.domain import ENTITY_CLASSES

    raw = RawExtraction()
    result = map_extraction(raw, "t1", "f.pdf")

    types = {e.entity_type for e in result.entities}
    expected = {k.upper() for k in ENTITY_CLASSES}
    assert types == expected
    assert len(result.entities) == len(ENTITY_CLASSES)


def test_map_extraction_only_tenant_extracted_yields_7_placeholders():
    """When AI extracts ONLY tenant, the other 7 entity types appear as placeholders."""
    from app.models.domain import ENTITY_CLASSES

    raw = RawExtraction(tenant={"name": "Acme School"})
    result = map_extraction(raw, "t1", "f.pdf")

    # 8 total: TENANT (extracted) + 7 placeholders
    assert len(result.entities) == len(ENTITY_CLASSES)

    # TENANT carries the extracted name
    tenant = next(e for e in result.entities if e.entity_type == "TENANT")
    name_mapping = next(m for m in tenant.field_mappings if m.field_name == "name")
    assert name_mapping.value == "Acme School"
    assert name_mapping.source == "base_model"

    # Every other entity type has only base_model mappings with value=None
    # (placeholders have no extracted values)
    for e in result.entities:
        if e.entity_type == "TENANT":
            continue
        for m in e.field_mappings:
            assert m.source == "base_model", (
                f"{e.entity_type}.{m.field_name} unexpectedly has source={m.source}"
            )
            # Non-selection placeholder values are None.
            # Selection fields (List[str] with defaults) carry the default list as value.
            if m.field_type != "selection":
                assert m.value is None, (
                    f"{e.entity_type}.{m.field_name} expected None, got {m.value!r}"
                )


def test_map_extraction_multiple_students_consolidate_others_are_placeholders():
    """Three extracted students consolidate to one STUDENT EntityResult;
    7 other entity types appear as placeholders."""
    from app.models.domain import ENTITY_CLASSES

    raw = RawExtraction(students=[
        {"first_name": "A"},
        {"first_name": "B"},
        {"first_name": "C"},
    ])
    result = map_extraction(raw, "t1", "f.pdf")

    # Total = 8 (one per ENTITY_CLASSES key)
    assert len(result.entities) == len(ENTITY_CLASSES)

    # Exactly one STUDENT after consolidation
    students = [e for e in result.entities if e.entity_type == "STUDENT"]
    assert len(students) == 1

    # first_name mapping exists with one of the three input values
    # (consolidator keeps the first encountered)
    student = students[0]
    first_name_mappings = [m for m in student.field_mappings if m.field_name == "first_name"]
    assert len(first_name_mappings) == 1
    assert first_name_mappings[0].value in {"A", "B", "C"}

    # The other 7 types are present and have no consolidated extracted data
    # (they were never extracted — the backstop added them)
    non_student_types = {k.upper() for k in ENTITY_CLASSES if k != "student"}
    actual_non_student_types = {e.entity_type for e in result.entities if e.entity_type != "STUDENT"}
    assert actual_non_student_types == non_student_types


def test_placeholder_student_has_full_base_field_coverage():
    """Placeholder STUDENT entity contains all base fields from the Student Pydantic class."""
    from app.models.domain import Student

    raw = RawExtraction()
    result = map_extraction(raw, "t1", "f.pdf")

    student = next(e for e in result.entities if e.entity_type == "STUDENT")

    # Every base field declared on Student (excluding system fields) appears in
    # field_mappings exactly once. System fields are tenant_id, entity_type, custom_fields.
    SYSTEM = {"tenant_id", "entity_type", "custom_fields"}
    expected_fields = set(Student.model_fields.keys()) - SYSTEM
    mapping_names = {m.field_name for m in student.field_mappings}
    assert mapping_names == expected_fields

    # All mappings are sourced from base_model (no custom fields in a placeholder)
    for m in student.field_mappings:
        assert m.source == "base_model"

    # Selection-type Student fields carry non-empty options lists from the
    # Pydantic class defaults
    selection_field_names = {"grade_level", "gender", "status"}
    for name in selection_field_names:
        m = next(m for m in student.field_mappings if m.field_name == name)
        assert m.field_type == "selection", f"{name} expected selection type, got {m.field_type}"
        assert m.options, f"{name} expected non-empty options list, got {m.options}"
