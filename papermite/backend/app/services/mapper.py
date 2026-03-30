"""Maps raw AI extraction output to base model fields vs custom_fields."""
import uuid
from typing import Any

from app.models.domain import (
    ENTITY_CLASSES,
    BaseEntity,
)
from app.models.extraction import (
    EntityResult,
    ExtractionResult,
    FieldMapping,
    RawExtraction,
)


def _infer_field_type(field_name: str, value: Any) -> str:
    """Best-effort field type inference from name patterns and value."""
    n = field_name.lower()

    # Boolean patterns
    if n.startswith(("is_", "has_", "requires_", "allow_")) or n.startswith("can_"):
        return "bool"
    if isinstance(value, bool):
        return "bool"

    # Email
    if "email" in n:
        return "email"

    # Phone
    if "phone" in n or n == "mobile" or n == "fax":
        return "phone"

    # Date/datetime
    if n in ("dob", "date_of_birth", "birthday", "birthdate"):
        return "date"
    if n.endswith("_date") or n.startswith("date_"):
        return "date"
    if n in ("start_date", "end_date", "enrollment_date", "registration_date", "expiry_date"):
        return "date"
    if n.endswith("_at") or n in ("created_at", "updated_at", "submitted_at", "deleted_at"):
        return "datetime"

    # Number patterns
    if n in ("age", "capacity", "count", "size", "quantity", "max_capacity"):
        return "number"
    if n.endswith(("_count", "_size", "_amount", "_fee", "_cost", "_price", "_total")):
        return "number"
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        return "number"

    # Selection patterns (list/dict values)
    if isinstance(value, (list, dict)):
        return "selection"

    return "str"


def _extract_options(value: Any) -> tuple[list[str], bool]:
    """Extract selection options from a value.

    - list of strings → options with multiple=True
    - list of dicts → stringify each as an option, multiple=True
    - dict → use keys as options, multiple=False
    - single string with commas/semicolons → split into options, multiple=True
    """
    if isinstance(value, list):
        options = []
        for item in value:
            s = str(item).strip() if not isinstance(item, dict) else str(item)
            if s and s not in options:
                options.append(s)
        return options, True
    if isinstance(value, dict):
        return [str(k) for k in value.keys()], False
    # Check for comma/semicolon-separated string
    if isinstance(value, str) and ("," in value or ";" in value):
        sep = ";" if ";" in value else ","
        parts = [p.strip() for p in value.split(sep) if p.strip()]
        if len(parts) > 1:
            return parts, True
    return [], False


# System fields that are derived from context, not part of the data model.
# Includes nested entity fields on RegistrationApplication — these are
# extracted as separate entity types and shouldn't appear as editable fields.
SYSTEM_FIELDS = {"tenant_id", "entity_type", "custom_fields", "student", "family", "contacts", "address", "addresses"}


def _map_entity(raw: dict[str, Any], model_class: type) -> tuple[dict[str, Any], list[FieldMapping]]:
    """Split a raw dict into base model fields and custom_fields with provenance tracking.

    System fields (tenant_id, entity_type) are excluded from field_mappings
    since they are derived from the authenticated user and entity context.
    """
    schema_fields = set(model_class.model_fields.keys())
    base_data: dict[str, Any] = {}
    custom_data: dict[str, Any] = {}
    mappings: list[FieldMapping] = []

    for key, value in raw.items():
        # Skip system fields — these are not part of the data model
        if key in SYSTEM_FIELDS:
            if key in schema_fields:
                base_data[key] = value
            continue

        field_type = _infer_field_type(key, value)
        options = None
        multiple = None
        if field_type == "selection":
            options, multiple = _extract_options(value)

        if key in schema_fields:
            base_data[key] = value
            mappings.append(FieldMapping(
                field_name=key, value=value, source="base_model",
                required=True, field_type=field_type,
                options=options, multiple=multiple,
            ))
        else:
            custom_data[key] = value
            mappings.append(FieldMapping(
                field_name=key, value=value, source="custom_field",
                required=False, field_type=field_type,
                options=options, multiple=multiple,
            ))

    base_data["custom_fields"] = custom_data
    return base_data, mappings


def _map_entity_list(
    raw_list: list[dict[str, Any]],
    entity_type: str,
    model_class: type,
    tenant_id: str,
) -> list[EntityResult]:
    """Map a list of raw dicts for a given entity type."""
    results = []
    for raw in raw_list:
        data, mappings = _map_entity(raw, model_class)
        if issubclass(model_class, BaseEntity):
            data.setdefault("tenant_id", tenant_id)
            # Generate placeholder ID if needed
            id_field = f"{entity_type}_id"
            if id_field in model_class.model_fields and not data.get(id_field):
                data[id_field] = str(uuid.uuid4())[:8]
        results.append(EntityResult(
            entity_type=entity_type.upper(),
            entity=data,
            field_mappings=mappings,
        ))
    return results


def _consolidate_entities(entities: list[EntityResult]) -> list[EntityResult]:
    """Merge multiple entities of the same type into one, combining unique fields."""
    by_type: dict[str, EntityResult] = {}

    for entity in entities:
        et = entity.entity_type
        if et not in by_type:
            by_type[et] = EntityResult(
                entity_type=et,
                entity=dict(entity.entity),
                field_mappings=list(entity.field_mappings),
            )
        else:
            merged = by_type[et]
            existing_fields = {m.field_name: i for i, m in enumerate(merged.field_mappings)}
            for mapping in entity.field_mappings:
                if mapping.field_name not in existing_fields:
                    existing_fields[mapping.field_name] = len(merged.field_mappings)
                    merged.field_mappings.append(mapping)
                    merged.entity[mapping.field_name] = mapping.value
                elif mapping.field_type == "selection" and mapping.options:
                    # Merge options from duplicate entities
                    idx = existing_fields[mapping.field_name]
                    existing_mapping = merged.field_mappings[idx]
                    existing_opts = set(existing_mapping.options or [])
                    new_opts = list(existing_mapping.options or [])
                    for opt in mapping.options:
                        if opt not in existing_opts:
                            new_opts.append(opt)
                            existing_opts.add(opt)
                    merged.field_mappings[idx] = existing_mapping.model_copy(
                        update={"options": new_opts, "multiple": True}
                    )

    return list(by_type.values())


def map_extraction(raw: RawExtraction, tenant_id: str, filename: str, raw_text: str) -> ExtractionResult:
    """Map a RawExtraction into an ExtractionResult with field provenance."""
    entities: list[EntityResult] = []

    # Map tenant
    if raw.tenant:
        data, mappings = _map_entity(raw.tenant, ENTITY_CLASSES["tenant"])
        data.setdefault("tenant_id", tenant_id)
        entities.append(EntityResult(entity_type="TENANT", entity=data, field_mappings=mappings))

    # Map entity lists
    entity_list_map = {
        "program": raw.programs,
        "student": raw.students,
        "family": raw.families,
        "contact": raw.contacts,
        "enrollment": raw.enrollments,
        "registration_application": raw.registration_applications,
    }
    for entity_type, raw_list in entity_list_map.items():
        if raw_list:
            entities.extend(_map_entity_list(
                raw_list, entity_type, ENTITY_CLASSES[entity_type], tenant_id,
            ))

    # Consolidate multiple entities of the same type into one
    entities = _consolidate_entities(entities)

    return ExtractionResult(
        tenant_id=tenant_id,
        filename=filename,
        entities=entities,
        raw_text=raw_text,
    )
