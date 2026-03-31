"""Tests for field_extractor service."""
from unittest.mock import patch, MagicMock
from app.services.field_extractor import extract_fields


def test_extract_fields_maps_to_model_fields():
    """Extracted values are mapped to model field names."""
    model_definition = {
        "student": {
            "base_fields": [
                {"name": "first_name", "type": "str", "required": True},
                {"name": "last_name", "type": "str", "required": True},
                {"name": "dob", "type": "date", "required": False},
                {"name": "email", "type": "email", "required": False},
            ],
            "custom_fields": [
                {"name": "allergies", "type": "str", "required": False},
            ],
        }
    }

    # Mock the AI agent to return known values
    mock_result = MagicMock()
    mock_result.output = {
        "first_name": "Jane",
        "last_name": "Doe",
        "dob": "2015-03-15",
    }

    with patch("app.services.field_extractor.Agent") as MockAgent:
        agent_instance = MagicMock()
        agent_instance.run_sync.return_value = mock_result
        MockAgent.return_value = agent_instance

        result = extract_fields(
            text="Student: Jane Doe, born March 15 2015",
            entity_type="student",
            model_definition=model_definition,
            model_id="anthropic:claude-haiku-4-5-20251001",
        )

    assert result == {
        "first_name": "Jane",
        "last_name": "Doe",
        "dob": "2015-03-15",
    }


def test_extract_fields_partial_extraction():
    """Partial extraction returns only the fields that were found."""
    model_definition = {
        "student": {
            "base_fields": [
                {"name": "first_name", "type": "str", "required": True},
                {"name": "last_name", "type": "str", "required": True},
                {"name": "dob", "type": "date", "required": False},
            ],
            "custom_fields": [],
        }
    }

    mock_result = MagicMock()
    mock_result.output = {
        "first_name": "Jane",
    }

    with patch("app.services.field_extractor.Agent") as MockAgent:
        agent_instance = MagicMock()
        agent_instance.run_sync.return_value = mock_result
        MockAgent.return_value = agent_instance

        result = extract_fields(
            text="Applicant: Jane",
            entity_type="student",
            model_definition=model_definition,
            model_id="anthropic:claude-haiku-4-5-20251001",
        )

    assert result == {"first_name": "Jane"}


def test_extract_fields_filters_none_and_empty():
    """None and empty-string values are excluded from the result."""
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
    mock_result.output = {
        "first_name": "Jane",
        "last_name": None,
    }

    with patch("app.services.field_extractor.Agent") as MockAgent:
        agent_instance = MagicMock()
        agent_instance.run_sync.return_value = mock_result
        MockAgent.return_value = agent_instance

        result = extract_fields(
            text="Applicant: Jane",
            entity_type="student",
            model_definition=model_definition,
            model_id="anthropic:claude-haiku-4-5-20251001",
        )

    assert result == {"first_name": "Jane"}


def test_extract_fields_unknown_entity_type():
    """When entity_type is not in model_definition, returns empty dict."""
    model_definition = {
        "student": {
            "base_fields": [{"name": "first_name", "type": "str", "required": True}],
            "custom_fields": [],
        }
    }

    result = extract_fields(
        text="Some doc text",
        entity_type="unknown_type",
        model_definition=model_definition,
        model_id="anthropic:claude-haiku-4-5-20251001",
    )

    assert result == {}
