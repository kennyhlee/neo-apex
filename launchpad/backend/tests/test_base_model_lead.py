"""Tests for lead entity in base_model.json."""
import json
import pathlib

BASE_MODEL_PATH = pathlib.Path(__file__).parent.parent / "app" / "data" / "base_model.json"


def load_model():
    with open(BASE_MODEL_PATH) as f:
        return json.load(f)


def test_lead_entity_exists():
    model = load_model()
    assert "lead" in model, "lead entity must exist in base_model.json"


def test_lead_has_base_fields_and_custom_fields():
    model = load_model()
    lead = model["lead"]
    assert "base_fields" in lead
    assert "custom_fields" in lead
    assert lead["custom_fields"] == []


def test_lead_required_fields_present():
    model = load_model()
    fields = {f["name"]: f for f in model["lead"]["base_fields"]}
    assert "lead_id" in fields
    assert fields["lead_id"]["required"] is True
    assert "guardian_name" in fields
    assert fields["guardian_name"]["required"] is True


def test_lead_stage_selection_options():
    model = load_model()
    fields = {f["name"]: f for f in model["lead"]["base_fields"]}
    assert "stage" in fields
    stage = fields["stage"]
    assert stage["type"] == "selection"
    assert stage["required"] is False
    assert stage["options"] == ["New", "Contacted", "Tour Scheduled", "Toured", "Enrolled", "Lost"]
    assert stage["multiple"] is False


def test_lead_source_selection_options():
    model = load_model()
    fields = {f["name"]: f for f in model["lead"]["base_fields"]}
    assert "source" in fields
    source = fields["source"]
    assert source["type"] == "selection"
    assert source["options"] == ["web_form", "manual", "email_import"]
    assert source["multiple"] is False


def test_lead_field_order():
    model = load_model()
    names = [f["name"] for f in model["lead"]["base_fields"]]
    assert names == [
        "lead_id",
        "guardian_name",
        "email",
        "phone",
        "student_first_name",
        "student_last_name",
        "grade_of_interest",
        "message",
        "source",
        "stage",
        "converted_family_id",
    ]
