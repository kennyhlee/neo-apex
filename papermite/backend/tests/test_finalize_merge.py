"""Finalize must MERGE an extracted model into the tenant's existing one, not
replace it (spec §4 rule 1).

Base fields are SEEDED by LaunchPad from base_model.json and are load-bearing
for running code — the registration engine writes `status`, `config_version`,
`token_version` and the rest onto every application. A replace turned
acme-afterschool's registration_application model into the extraction's shape
and dropped them; that must be impossible.
"""
from app.api.finalize import _merge_model_definition

SEEDED = {
    "registration_application": {
        "base_fields": [
            {"name": "application_id", "type": "str", "required": True},
            {"name": "school_year", "type": "str", "required": True},
            {"name": "status", "type": "selection", "required": True},
        ],
        "custom_fields": [],
    },
    "student": {
        "base_fields": [{"name": "student_id", "type": "str", "required": True},
                        {"name": "first_name", "type": "str", "required": True}],
        "custom_fields": [],
    },
}

EXTRACTED = {
    "registration_application": {
        "base_fields": [
            {"name": "application_id", "type": "str", "required": True},
            {"name": "school_year", "type": "str", "required": True},
            {"name": "school_id", "type": "str", "required": False},
        ],
        "custom_fields": [
            {"name": "agreement_signed_by", "type": "str", "required": True},
            {"name": "initials", "type": "str", "required": False},
        ],
    },
}


def test_existing_base_fields_are_never_removed():
    merged = _merge_model_definition(SEEDED, EXTRACTED)
    names = [f["name"] for f in merged["registration_application"]["base_fields"]]
    assert names == ["application_id", "school_year", "status"]


def test_extracted_fields_matching_a_base_field_are_dropped():
    merged = _merge_model_definition(SEEDED, EXTRACTED)
    custom = [f["name"] for f in merged["registration_application"]["custom_fields"]]
    assert "application_id" not in custom and "school_year" not in custom


def test_remaining_extracted_fields_are_appended_as_custom():
    merged = _merge_model_definition(SEEDED, EXTRACTED)
    custom = [f["name"] for f in merged["registration_application"]["custom_fields"]]
    assert custom == ["school_id", "agreement_signed_by", "initials"]


def test_merge_is_idempotent_on_recommit():
    once = _merge_model_definition(SEEDED, EXTRACTED)
    twice = _merge_model_definition(once, EXTRACTED)
    assert twice == once


def test_entity_types_absent_from_the_extraction_are_preserved():
    """A single-entity extraction must never delete the rest of the model."""
    merged = _merge_model_definition(SEEDED, EXTRACTED)
    assert "student" in merged
    assert [f["name"] for f in merged["student"]["base_fields"]] == [
        "student_id", "first_name"]


def test_a_wholly_new_entity_type_is_taken_verbatim():
    incoming = {"lead": {"base_fields": [{"name": "lead_id", "type": "str",
                                          "required": True}],
                         "custom_fields": []}}
    merged = _merge_model_definition(SEEDED, incoming)
    assert merged["lead"]["base_fields"] == incoming["lead"]["base_fields"]


def test_merge_on_an_empty_tenant_is_the_extraction_itself():
    assert _merge_model_definition({}, EXTRACTED) == EXTRACTED


def test_merge_does_not_mutate_either_input():
    before_seeded = repr(SEEDED)
    before_extracted = repr(EXTRACTED)
    _merge_model_definition(SEEDED, EXTRACTED)
    assert repr(SEEDED) == before_seeded
    assert repr(EXTRACTED) == before_extracted
