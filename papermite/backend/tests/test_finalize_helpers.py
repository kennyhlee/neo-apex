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


def test_merge_fields_fills_missing_keys():
    from app.api.finalize import _merge_fields
    assert _merge_fields({"a": "x"}, {"b": "y"}) == {"a": "x", "b": "y"}


def test_merge_fields_fills_none_and_empty_and_whitespace():
    from app.api.finalize import _merge_fields
    existing = {"a": None, "b": "", "c": "   "}
    extracted = {"a": "1", "b": "2", "c": "3"}
    assert _merge_fields(existing, extracted) == {"a": "1", "b": "2", "c": "3"}


def test_merge_fields_preserves_nonempty_string_over_extracted():
    from app.api.finalize import _merge_fields
    assert _merge_fields({"a": "kept"}, {"a": "overwritten"}) == {"a": "kept"}


def test_merge_fields_preserves_stringified_false_and_zero():
    """DataCore /api/query stringifies all values: False -> 'False', 0 -> '0',
    [] -> '[]'. Those are non-empty strings and MUST be preserved."""
    from app.api.finalize import _merge_fields
    existing = {"a": "False", "b": "0", "c": "[]"}
    extracted = {"a": True, "b": 1, "c": [1, 2]}
    assert _merge_fields(existing, extracted) == {"a": "False", "b": "0", "c": "[]"}


def test_merge_fields_preserves_existing_keys_not_in_extracted():
    from app.api.finalize import _merge_fields
    existing = {"a": "kept", "b": "also-kept"}
    extracted = {"c": "new"}
    assert _merge_fields(existing, extracted) == {
        "a": "kept",
        "b": "also-kept",
        "c": "new",
    }


def test_fetch_existing_tenant_row_returns_empty_dict_when_no_active_row():
    from unittest.mock import MagicMock, patch
    from app.api.finalize import _fetch_existing_tenant_row

    mock_resp = MagicMock()
    mock_resp.status_code = 200
    mock_resp.json.return_value = {"data": [], "total": 0}

    with patch("app.api.finalize.httpx.post", return_value=mock_resp) as mock_post:
        result = _fetch_existing_tenant_row("t1")

    assert result == {}
    assert mock_post.call_count == 1
    call_kwargs = mock_post.call_args.kwargs
    assert call_kwargs["json"] == {
        "tenant_id": "t1",
        "table": "tenants",
        "sql": "SELECT * FROM data WHERE entity_type = 'tenant' AND _status = 'active'",
    }


def test_fetch_existing_tenant_row_cleans_internal_and_underscore_columns():
    from unittest.mock import MagicMock, patch
    from app.api.finalize import _fetch_existing_tenant_row

    mock_resp = MagicMock()
    mock_resp.status_code = 200
    mock_resp.json.return_value = {
        "data": [
            {
                "_status": "active",
                "_version": 3,
                "_created_at": "2026-01-01",
                "_updated_at": "2026-01-02",
                "_change_id": "abc",
                "entity_type": "tenant",
                "entity_id": "t1",
                "base_data": "<encoded-toon>",
                "custom_fields": "<encoded-toon>",
                "vector": [0.1, 0.2],
                "_abbrev": "AC",  # underscore-prefixed → drop
                "name": "Acme",
                "contact_email": "a@x.com",
                "contact_phone": None,  # None → drop
                "school_district_code": "DC-100",
            }
        ],
        "total": 1,
    }

    with patch("app.api.finalize.httpx.post", return_value=mock_resp):
        result = _fetch_existing_tenant_row("t1")

    assert result == {
        "name": "Acme",
        "contact_email": "a@x.com",
        "school_district_code": "DC-100",
    }


def test_fetch_existing_tenant_row_raises_502_on_non_2xx():
    from unittest.mock import MagicMock, patch
    import pytest as _pytest
    from fastapi import HTTPException
    from app.api.finalize import _fetch_existing_tenant_row

    mock_resp = MagicMock()
    mock_resp.status_code = 500
    mock_resp.json.return_value = {"detail": "boom"}

    with patch("app.api.finalize.httpx.post", return_value=mock_resp):
        with _pytest.raises(HTTPException) as exc_info:
            _fetch_existing_tenant_row("t1")

    assert exc_info.value.status_code == 502
    assert exc_info.value.detail == "Failed to persist tenant from extraction"


def test_fetch_existing_tenant_row_raises_502_on_connection_error():
    from unittest.mock import patch
    import pytest as _pytest
    import httpx
    from fastapi import HTTPException
    from app.api.finalize import _fetch_existing_tenant_row

    with patch(
        "app.api.finalize.httpx.post",
        side_effect=httpx.ConnectError("unreachable"),
    ):
        with _pytest.raises(HTTPException) as exc_info:
            _fetch_existing_tenant_row("t1")

    assert exc_info.value.status_code == 502
    assert exc_info.value.detail == "Failed to persist tenant from extraction"
