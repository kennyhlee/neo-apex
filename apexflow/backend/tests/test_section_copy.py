"""Section `title`/`description` — defaults, caps, and link-scheme validation."""
import pytest

from app.workflows.schema import SectionDef, StepDef
from app.workflows.validate import _SectionEntry, _section_copy_errors


def _section(**over) -> SectionDef:
    data = {
        "section_id": "student_section",
        "entity_model": "student",
        "fields": [{"name": "first_name", "required": True}],
        "mode": "create",
    }
    data.update(over)
    return SectionDef.model_validate(data)


def _step() -> StepDef:
    return StepDef(
        step_id="application_form", type="form", title="Application",
        required=True, blocking=True, available_in=["draft"], config={},
    )


def _entries(section: SectionDef) -> list:
    return [_SectionEntry(step=_step(), section=section)]


def test_title_and_description_default_to_empty():
    """Additive and backward compatible: a stored definition that predates
    these fields must still parse."""
    s = _section()
    assert s.title == ""
    assert s.description == ""


def test_title_and_description_round_trip():
    s = _section(title="Student Information", description="About your **child**.")
    assert s.title == "Student Information"
    assert s.description == "About your **child**."


def test_empty_copy_produces_no_errors():
    assert _section_copy_errors(_entries(_section())) == []


def test_title_over_80_chars_rejected():
    errors = _section_copy_errors(_entries(_section(title="x" * 81)))
    assert any("student_section" in e and "title" in e for e in errors)


def test_description_over_600_chars_rejected():
    errors = _section_copy_errors(_entries(_section(description="x" * 601)))
    assert any("student_section" in e and "description" in e for e in errors)


@pytest.mark.parametrize("url", [
    "https://school.example.com/handbook.pdf",
    "http://school.example.com",
    "mailto:office@school.example.com",
])
def test_allowed_link_schemes_accepted(url):
    d = f"Read the [handbook]({url}) first."
    assert _section_copy_errors(_entries(_section(description=d))) == []


@pytest.mark.parametrize("url", [
    "javascript:alert(1)",
    "data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=",
    "vbscript:msgbox(1)",
    "ftp://files.example.com/x",
])
def test_disallowed_link_schemes_rejected(url):
    d = f"Read the [handbook]({url}) first."
    errors = _section_copy_errors(_entries(_section(description=d)))
    assert any("student_section" in e for e in errors), errors


def test_link_scheme_check_is_case_insensitive():
    d = "Click [here](JaVaScRiPt:alert(1))."
    assert _section_copy_errors(_entries(_section(description=d))) != []


def test_plain_text_description_without_links_is_fine():
    d = "Tell us about the child you're enrolling."
    assert _section_copy_errors(_entries(_section(description=d))) == []
