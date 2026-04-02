from enum import Enum

from pydantic import BaseModel, Field, EmailStr
from typing import Optional, List, Dict, Any
import datetime as _dt


class BaseEntity(BaseModel):
    tenant_id: str = ""
    entity_type: str = Field(...)
    custom_fields: Dict[str, Any] = Field(default_factory=dict)


class Family(BaseEntity):
    entity_type: str = "FAMILY"
    family_id: str = ""
    family_name: str = ""
    primary_address: str = ""
    mailing_address: Optional[str] = None
    primary_email: Optional[EmailStr] = None
    primary_phone: Optional[str] = None


class ContactRole(str, Enum):
    GUARDIAN = "guardian"
    EMERGENCY = "emergency"
    MEDICAL = "medical"
    AUTHORIZED_PICKUP = "authorized_pickup"
    OTHER = "other"


class Contact(BaseEntity):
    entity_type: str = "CONTACT"
    contact_id: str = ""
    family_id: str = ""
    student_id: str = ""
    first_name: str = ""
    last_name: str = ""
    email: Optional[EmailStr] = None
    phone: Optional[str] = None
    relationship: Optional[str] = None
    role: ContactRole = ContactRole.OTHER
    organization: Optional[str] = None
    address: Optional[str] = None


class Student(BaseEntity):
    entity_type: str = "STUDENT"
    student_id: str = ""
    first_name: str = ""
    last_name: str = ""
    middle_name: Optional[str] = None
    preferred_name: Optional[str] = None
    dob: Optional[_dt.date] = None
    grade_level: Optional[str] = None
    email: Optional[EmailStr] = None
    gender: List[str] = Field(
        default_factory=lambda: [
            "Male",
            "Female",
            "Non-binary",
            "Prefer not to say",
        ]
    )
    status: List[str] = Field(
        default_factory=lambda: [
            "Active",
            "Inactive",
            "Enrolled",
            "Waitlisted",
            "Graduated",
            "Withdrawn",
            "Transferred",
            "Suspended",
        ]
    )
    family_id: str = ""
    primary_address: str = ""
    mailing_address: Optional[str] = None


class Program(BaseEntity):
    entity_type: str = "PROGRAM"
    program_id: str = ""
    name: str = ""
    school_year: str = ""


class Enrollment(BaseEntity):
    entity_type: str = "ENROLLMENT"
    student_id: str = ""
    program_id: str = ""
    class_id: Optional[str] = None
    status: Optional[str] = None
    start_date: Optional[_dt.date] = None
    end_date: Optional[_dt.date] = None


class Attendance(BaseEntity):
    entity_type: str = "ATTENDANCE"
    student_id: str = ""
    date: _dt.date = _dt.date.today()
    program_id: str = ""
    class_id: Optional[str] = None
    status: str = ""


class RegistrationApplication(BaseEntity):
    entity_type: str = "REGAPP"
    application_id: str = ""
    school_year: str = ""
    school_id: Optional[str] = None
    student: Optional[Student] = None
    family: Optional[Family] = None
    contacts: List[Contact] = Field(default_factory=list)


class Tenant(BaseEntity):
    entity_type: str = "TENANT"
    name: str = ""
    display_name: str = ""
    contact_email: str = ""
    contact_phone: str = ""
    primary_address: str = ""
    mailing_address: str = ""
    license_number: Optional[str] = None
    capacity: Optional[int] = None
    accreditation: Optional[str] = None
    insurance_provider: Optional[str] = None


# All entity classes that can be extracted from documents
ENTITY_CLASSES: Dict[str, type[BaseEntity]] = {
    "tenant": Tenant,
    "program": Program,
    "student": Student,
    "family": Family,
    "contact": Contact,
    "enrollment": Enrollment,
    "attendance": Attendance,
    "registration_application": RegistrationApplication,
}
