from pydantic import BaseModel, Field, EmailStr
from typing import Optional, List, Dict, Any
import datetime as _dt


class BaseEntity(BaseModel):
    tenant_id: str = ""
    entity_type: str = Field(...)
    custom_fields: Dict[str, Any] = Field(default_factory=dict)


class Address(BaseModel):
    type: Optional[str] = None
    line1: Optional[str] = None
    line2: Optional[str] = None
    city: Optional[str] = None
    state: Optional[str] = None
    postalCode: Optional[str] = None
    country: Optional[str] = None


class Family(BaseEntity):
    entity_type: str = "FAMILY"
    family_id: str = ""
    family_name: str = ""
    address: Optional[Address] = None
    primary_email: Optional[EmailStr] = None
    primary_phone: Optional[str] = None


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
    role: str = ""
    clinic_name: Optional[str] = None


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
    gender: Optional[str] = None
    family_id: str = ""
    addresses: List[Address] = Field(default_factory=list)


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
    name: Optional[str] = None
    display_name: Optional[str] = None
    contact_email: Optional[EmailStr] = None
    contact_phone: Optional[str] = None
    address: Optional[Address] = None


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
