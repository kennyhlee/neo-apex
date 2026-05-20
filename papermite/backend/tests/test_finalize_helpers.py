"""Unit tests for pure helpers in app.api.finalize.

These cover the building blocks used to persist extracted tenant values
to DataCore on finalize (issue #69).
"""
from app.api.finalize import _is_empty


def test_is_empty_returns_true_for_none_and_blank_strings():
    assert _is_empty(None) is True
    assert _is_empty("") is True
    assert _is_empty("   ") is True
    assert _is_empty("\t\n") is True


def test_is_empty_returns_false_for_falsy_nonblank_values():
    # Falsy but meaningful — must NOT be treated as empty
    assert _is_empty(0) is False
    assert _is_empty(False) is False
    assert _is_empty([]) is False
    assert _is_empty({}) is False
    # Strings that LOOK falsy but are real content (e.g. from DataCore
    # query flattening which stringifies everything)
    assert _is_empty("0") is False
    assert _is_empty("False") is False
    assert _is_empty(" x ") is False


def test_split_extracted_tenant_routes_by_source_and_drops_empties():
    from app.api.finalize import _split_extracted_tenant
    from app.models.extraction import EntityResult, FieldMapping

    entity = EntityResult(
        entity_type="TENANT",
        entity={},  # contents irrelevant — splitter reads field_mappings
        field_mappings=[
            FieldMapping(field_name="name", value="Acme", source="base_model",
                         required=True, field_type="str"),
            FieldMapping(field_name="contact_phone", value=None, source="base_model",
                         required=False, field_type="phone"),
            FieldMapping(field_name="display_name", value="   ", source="base_model",
                         required=True, field_type="str"),
            FieldMapping(field_name="school_district_code", value="DC-100",
                         source="custom_field", required=False, field_type="str"),
            FieldMapping(field_name="legacy", value="", source="custom_field",
                         required=False, field_type="str"),
        ],
    )

    base, custom = _split_extracted_tenant(entity)

    assert base == {"name": "Acme"}
    assert custom == {"school_district_code": "DC-100"}


def test_split_existing_tenant_row_uses_tenant_model_fields_as_discriminator():
    from app.api.finalize import _split_existing_tenant_row

    cleaned = {
        "name": "Acme",
        "contact_email": "a@x.com",
        "school_district_code": "DC-100",
        "accreditation_id": "ACC-42",
    }
    base, custom = _split_existing_tenant_row(cleaned)

    # name and contact_email are real Tenant base fields
    assert base == {"name": "Acme", "contact_email": "a@x.com"}
    # the others are not in Tenant.model_fields
    assert custom == {
        "school_district_code": "DC-100",
        "accreditation_id": "ACC-42",
    }


def test_split_existing_tenant_row_excludes_system_fields_from_base_bucket():
    """tenant_id / entity_type / custom_fields are NOT base-classified even though
    they're declared on Tenant — they're system fields."""
    from app.api.finalize import _split_existing_tenant_row

    cleaned = {
        "tenant_id": "t1",
        "entity_type": "tenant",
        "custom_fields": "should-not-happen-but-be-safe",
        "name": "Acme",
    }
    base, custom = _split_existing_tenant_row(cleaned)

    assert base == {"name": "Acme"}
    # tenant_id / entity_type / custom_fields fall through to custom because
    # they're filtered out of the base-key set
    assert custom == {
        "tenant_id": "t1",
        "entity_type": "tenant",
        "custom_fields": "should-not-happen-but-be-safe",
    }
