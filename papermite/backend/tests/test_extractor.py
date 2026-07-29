"""Tests for extractor.py — discovery + targeted, text + vision."""
from unittest.mock import patch, MagicMock

from app.services.extractor import extract_fields, extract_fields_from_pdf


def test_extract_fields_returns_known_fields_only():
    model_definition = {
        "student": {
            "base_fields": [
                {"name": "first_name", "type": "str", "required": True},
                {"name": "last_name", "type": "str", "required": True},
            ],
            "custom_fields": [],
        }
    }

    mock_result = MagicMock()
    mock_result.output = {"first_name": "Jane", "last_name": "Doe", "hallucinated": "x"}

    with patch("app.services.extractor.Agent") as MockAgent:
        agent_instance = MagicMock()
        agent_instance.run_sync.return_value = mock_result
        MockAgent.return_value = agent_instance

        result = extract_fields(
            text="Jane Doe",
            entity_type="student",
            model_definition=model_definition,
            model_id="anthropic:claude-haiku-4-5-20251001",
        )

    assert result == {"first_name": "Jane", "last_name": "Doe"}


def test_extract_fields_unknown_entity_type_returns_empty():
    result = extract_fields(
        text="anything",
        entity_type="missing",
        model_definition={"student": {"base_fields": [], "custom_fields": []}},
        model_id="anthropic:claude-haiku-4-5-20251001",
    )
    assert result == {}


def test_extract_fields_filters_none_and_empty():
    model_definition = {
        "student": {
            "base_fields": [
                {"name": "first_name", "type": "str", "required": True},
                {"name": "last_name", "type": "str", "required": True},
            ],
            "custom_fields": [],
        }
    }

    mock_result = MagicMock()
    mock_result.output = {"first_name": "Jane", "last_name": None}

    with patch("app.services.extractor.Agent") as MockAgent:
        agent_instance = MagicMock()
        agent_instance.run_sync.return_value = mock_result
        MockAgent.return_value = agent_instance

        result = extract_fields(
            text="Jane",
            entity_type="student",
            model_definition=model_definition,
            model_id="anthropic:claude-haiku-4-5-20251001",
        )

    assert result == {"first_name": "Jane"}


def test_extract_fields_from_pdf_returns_filtered_dict(tmp_path):
    """Vision-based targeted extraction filters to known fields, drops empty."""
    model_definition = {
        "student": {
            "base_fields": [
                {"name": "first_name", "type": "str", "required": True},
                {"name": "last_name", "type": "str", "required": True},
            ],
            "custom_fields": [],
        }
    }

    pdf_file = tmp_path / "form.pdf"
    pdf_file.write_bytes(b"%PDF-1.4 fake")

    mock_result = MagicMock()
    mock_result.output = {
        "first_name": "Jane",
        "last_name": "Doe",
        "hallucinated": "ignored",
        "empty": "",
    }

    with patch("app.services.extractor.Agent") as MockAgent:
        agent_instance = MagicMock()
        agent_instance.run_sync.return_value = mock_result
        MockAgent.return_value = agent_instance

        result = extract_fields_from_pdf(
            file_path=pdf_file,
            entity_type="student",
            model_definition=model_definition,
            model_id="anthropic:claude-sonnet-4-6",
        )

    assert result == {"first_name": "Jane", "last_name": "Doe"}


def test_extract_fields_from_pdf_unknown_entity_returns_empty(tmp_path):
    pdf_file = tmp_path / "form.pdf"
    pdf_file.write_bytes(b"%PDF-1.4 fake")

    result = extract_fields_from_pdf(
        file_path=pdf_file,
        entity_type="missing",
        model_definition={"student": {"base_fields": [], "custom_fields": []}},
        model_id="anthropic:claude-sonnet-4-6",
    )

    assert result == {}


def test_filter_drops_angle_bracket_placeholders():
    from app.services.extractor import _filter_extracted_fields
    fields = [{"name": "a"}, {"name": "b"}, {"name": "c"}, {"name": "d"}]
    raw = {"a": "<UNKNOWN>", "b": False, "c": "real value", "d": 0}
    out = _filter_extracted_fields(raw, fields)
    assert "a" not in out           # bracketed placeholder dropped
    assert out["b"] is False        # real False preserved
    assert out["c"] == "real value"
    assert out["d"] == 0            # 0 preserved
