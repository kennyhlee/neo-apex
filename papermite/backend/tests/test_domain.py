"""Tests for Family and Contact domain entities."""
from app.models.domain import Family, Contact, ENTITY_CLASSES


def test_family_defaults():
    f = Family(family_id="F1", family_name="Smith Household")
    assert f.entity_type == "FAMILY"
    assert f.family_id == "F1"
    assert f.family_name == "Smith Household"
    assert f.primary_email is None
    assert f.primary_phone is None
    assert f.primary_address == ""
    assert f.mailing_address is None
    assert f.custom_fields == {}


def test_contact_guardian_role():
    c = Contact(
        contact_id="C1",
        family_id="F1",
        student_id="S1",
        first_name="Jane",
        last_name="Smith",
        role="guardian",
    )
    assert c.entity_type == "CONTACT"
    assert c.role == "guardian"
    assert c.student_id == "S1"
    assert c.family_id == "F1"
    assert c.clinic_name is None


def test_contact_medical_role():
    c = Contact(
        contact_id="C2",
        family_id="F1",
        student_id="S1",
        first_name="Dr. Lee",
        last_name="Park",
        role="medical_contact",
        clinic_name="Springfield Pediatrics",
    )
    assert c.role == "medical_contact"
    assert c.clinic_name == "Springfield Pediatrics"


def test_contact_emergency_role():
    c = Contact(
        contact_id="C3",
        family_id="F1",
        student_id="S1",
        first_name="Bob",
        last_name="Smith",
        role="emergency_contact",
        relationship="uncle",
    )
    assert c.role == "emergency_contact"
    assert c.relationship == "uncle"


def test_entity_classes_has_family_and_contact():
    assert "family" in ENTITY_CLASSES
    assert "contact" in ENTITY_CLASSES
    assert ENTITY_CLASSES["family"] is Family
    assert ENTITY_CLASSES["contact"] is Contact


def test_entity_classes_no_guardian():
    assert "guardian" not in ENTITY_CLASSES


from app.models.domain import Student, RegistrationApplication


def test_student_has_family_id():
    s = Student(student_id="S1", first_name="Alice", last_name="Smith", family_id="F1")
    assert s.family_id == "F1"


def test_student_no_guardian_ids():
    s = Student(student_id="S1", first_name="Alice", last_name="Smith")
    assert not hasattr(s, "guardian_ids") or "guardian_ids" not in s.model_fields


def test_registration_application_has_contacts():
    ra = RegistrationApplication(application_id="A1", school_year="2025-2026")
    assert hasattr(ra, "contacts")
    assert hasattr(ra, "family")
    assert ra.contacts == []
    assert ra.family is None


def test_registration_application_no_guardians():
    ra = RegistrationApplication(application_id="A1", school_year="2025-2026")
    assert "guardians" not in ra.model_fields
    assert "emergency_contacts" not in ra.model_fields
    assert "medical_contacts" not in ra.model_fields


def test_registration_application_no_program_fields():
    ra = RegistrationApplication(application_id="A1", school_year="2025-2026")
    assert "program_id" not in ra.model_fields
    assert "program_name" not in ra.model_fields
