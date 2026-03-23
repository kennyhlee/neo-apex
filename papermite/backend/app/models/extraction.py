from pydantic import BaseModel, Field
from typing import Any, Literal, Optional
import uuid


class RawExtraction(BaseModel):
    """What the AI returns — dicts so extra fields aren't dropped by Pydantic validation."""
    tenant: Optional[dict[str, Any]] = None
    programs: list[dict[str, Any]] = Field(default_factory=list)
    students: list[dict[str, Any]] = Field(default_factory=list)
    guardians: list[dict[str, Any]] = Field(default_factory=list)
    enrollments: list[dict[str, Any]] = Field(default_factory=list)
    registration_applications: list[dict[str, Any]] = Field(default_factory=list)
    emergency_contacts: list[dict[str, Any]] = Field(default_factory=list)
    medical_contacts: list[dict[str, Any]] = Field(default_factory=list)


FIELD_TYPES = ("str", "number", "bool", "date", "datetime", "email", "phone", "selection")


class FieldMapping(BaseModel):
    field_name: str
    value: Any
    source: Literal["base_model", "custom_field"]
    required: bool = True
    field_type: Literal["str", "number", "bool", "date", "datetime", "email", "phone", "selection"] = "str"
    options: Optional[list[str]] = None
    multiple: Optional[bool] = None


class EntityResult(BaseModel):
    entity_type: str
    entity: dict[str, Any]
    field_mappings: list[FieldMapping]


class ExtractionResult(BaseModel):
    extraction_id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    tenant_id: str
    filename: str
    entities: list[EntityResult]
    raw_text: str
    status: Literal["pending_review", "finalized"] = "pending_review"
