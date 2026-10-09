"""Tests for the base-fields-win / custom-fields-preserved merge rule."""
from app.model_merge import merge_model_definition


def test_merge_model_definition_base_fields_always_win():
    base_fields = [{"name": "student_id", "type": "str", "required": True}]
    existing = [{"name": "student_id", "type": "str", "required": False}]  # stale/different shape
    merged = merge_model_definition(base_fields, existing)
    assert merged["base_fields"] == base_fields
    assert merged["custom_fields"] == []  # dropped -- collides with a base field name


def test_merge_model_definition_keeps_non_colliding_custom_fields():
    base_fields = [{"name": "student_id", "type": "str", "required": True}]
    existing = [
        {"name": "student_id", "type": "str", "required": True},
        {"name": "school_id", "type": "str", "required": False},  # papermite-extracted, kept
    ]
    merged = merge_model_definition(base_fields, existing)
    assert merged["custom_fields"] == [{"name": "school_id", "type": "str", "required": False}]


def test_merge_model_definition_dedupes_first_write_wins():
    base_fields = []
    existing = [
        {"name": "notes", "type": "str", "required": False, "source": "first"},
        {"name": "notes", "type": "str", "required": False, "source": "second"},
    ]
    merged = merge_model_definition(base_fields, existing)
    assert len(merged["custom_fields"]) == 1
    assert merged["custom_fields"][0]["source"] == "first"


def test_merge_model_definition_skips_fields_with_no_name():
    base_fields = []
    existing = [{"type": "str", "required": False}]  # malformed, no "name" key
    merged = merge_model_definition(base_fields, existing)
    assert merged["custom_fields"] == []


def test_merge_model_definition_demotes_required_carried_field_without_default():
    # A field that was engine-required in a PRIOR model generation (e.g. the
    # retired registration_application's `config_version`/`channel_started`,
    # replaced by workflow_instance fields of the same name in Task 2) but is
    # no longer part of the CURRENT base_fields: no template section can ever
    # satisfy it (nothing seeds it), so carrying `required: True` forward
    # makes validate_definition's unconditional-coverage check fail forever
    # -- reproduces the live reseed run's actual 409 on tenant "acme"
    # (registration_application required 'channel_started'/'config_version'
    # not covered by any section). Demote to optional on carry-forward.
    base_fields = [{"name": "student_id", "type": "str", "required": True}]
    existing = [
        {"name": "student_id", "type": "str", "required": True},  # base -- dropped, not demoted
        {"name": "config_version", "type": "number", "required": True},
    ]
    merged = merge_model_definition(base_fields, existing)
    assert merged["custom_fields"] == [
        {"name": "config_version", "type": "number", "required": False}
    ]


def test_merge_model_definition_keeps_required_true_when_field_has_default():
    # A field with a `default` self-satisfies validate_definition's coverage
    # check regardless of `required` (app/workflows/validate.py's
    # `_coverage_errors`: `exempt = ... or "default" in fdef`), so it is not
    # the case this demotion needs to guard -- left untouched.
    base_fields: list[dict] = []
    existing = [
        {"name": "status", "type": "selection", "required": True, "default": "draft"},
    ]
    merged = merge_model_definition(base_fields, existing)
    assert merged["custom_fields"] == existing


def test_merge_model_definition_pure_no_mutation():
    base_fields = [{"name": "a", "type": "str", "required": True}]
    existing = [{"name": "b", "type": "str", "required": False}]
    base_fields_copy = [dict(f) for f in base_fields]
    existing_copy = [dict(f) for f in existing]
    merge_model_definition(base_fields, existing)
    assert base_fields == base_fields_copy
    assert existing == existing_copy
