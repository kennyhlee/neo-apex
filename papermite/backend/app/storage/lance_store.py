"""LanceDB storage for tenant model definitions — delegated to datacore.

Stores the finalized model definition (schema only — field definitions per entity type)
per tenant with version history. Each entity type is stored as a separate datacore model
record with a shared change_id for grouped rollback. Max 50 versions per entity type.
"""
import uuid
from datetime import datetime, timezone

from datacore import Store

from app.config import settings
from app.models.extraction import ExtractionResult, EntityResult

MAX_VERSIONS = 50

_store: Store | None = None


def _get_store() -> Store:
    """Get or create the datacore Store singleton."""
    global _store
    if _store is None:
        _store = Store(
            data_dir=settings.lancedb_dir,
            max_model_versions=MAX_VERSIONS,
        )
    return _store


def _build_model_definition(entities: list[EntityResult]) -> dict:
    """Convert extraction entities into a model definition (schema only).

    For each entity type, collects all field names classified as base_model
    or custom_field from the field_mappings, producing field definitions
    (name, type, required) without sample values.
    """
    from app.models.domain import ENTITY_CLASSES

    model_def: dict[str, dict] = {}

    for entity_result in entities:
        entity_type = entity_result.entity_type.lower()

        # Look up the domain model class for type info
        model_class = ENTITY_CLASSES.get(entity_type)
        schema_fields = set(model_class.model_fields.keys()) if model_class else set()

        base_fields: list[dict] = []
        custom_fields: list[dict] = []

        for mapping in entity_result.field_mappings:
            # Use explicit field_type from mapping if set, otherwise infer
            field_type = mapping.field_type if mapping.field_type != "str" else _infer_type(mapping.value)
            field_def: dict = {
                "name": mapping.field_name,
                "type": field_type,
                "required": mapping.required,
            }
            if field_type == "selection":
                field_def["options"] = mapping.options or []
                field_def["multiple"] = mapping.multiple or False

            if mapping.source == "base_model":
                base_fields.append(field_def)
            else:
                custom_fields.append(field_def)

        # If this entity type already exists (e.g. multiple students), merge fields
        if entity_type in model_def:
            existing_base_names = {f["name"] for f in model_def[entity_type]["base_fields"]}
            existing_custom_names = {f["name"] for f in model_def[entity_type]["custom_fields"]}
            for f in base_fields:
                if f["name"] not in existing_base_names:
                    model_def[entity_type]["base_fields"].append(f)
            for f in custom_fields:
                if f["name"] not in existing_custom_names:
                    model_def[entity_type]["custom_fields"].append(f)
        else:
            model_def[entity_type] = {
                "base_fields": base_fields,
                "custom_fields": custom_fields,
            }

    return model_def


def _infer_type(value) -> str:
    """Infer a simple type string from a Python value."""
    if value is None:
        return "str"
    if isinstance(value, bool):
        return "bool"
    if isinstance(value, (int, float)):
        return "number"
    if isinstance(value, (list, dict)):
        return "selection"
    return "str"


def _normalize_model_def(model_def: dict) -> dict:
    """Normalize a model definition for comparison (sort keys and field lists)."""
    normalized = {}
    for entity_type in sorted(model_def.keys()):
        entity = model_def[entity_type]
        normalized[entity_type] = {
            "base_fields": sorted(entity.get("base_fields", []), key=lambda f: f["name"]),
            "custom_fields": sorted(entity.get("custom_fields", []), key=lambda f: f["name"]),
        }
    return normalized


def get_active_model(tenant_id: str) -> dict | None:
    """Get the active model definition for a tenant, or None if not found.

    Retrieves all active model records across entity types from datacore
    and reassembles them into a single model_definition dict.
    """
    store = _get_store()
    rows = store.list_models(tenant_id, status="active")
    if not rows:
        return None

    # Reassemble per-entity-type records into combined model_definition
    model_definition = {}
    for row in rows:
        entity_type = row["entity_type"]
        defn = row["model_definition"]
        # Strip underscore-prefixed metadata keys
        clean_defn = {k: v for k, v in defn.items() if not k.startswith("_")}
        model_definition[entity_type] = clean_defn

    # Extract metadata from highest-versioned record (most recently written)
    latest_row = max(rows, key=lambda r: r["_version"])
    first_defn = latest_row["model_definition"]

    return {
        "tenant_id": tenant_id,
        "version": max(row["_version"] for row in rows),
        "status": "active",
        "model_definition": model_definition,
        "source_filename": first_defn.get("_source_filename", ""),
        "created_by": first_defn.get("_created_by", ""),
        "created_at": max(row["_created_at"] for row in rows),
    }


def preview_finalize(
    tenant_id: str,
    extraction: ExtractionResult,
) -> dict:
    """Build the model definition and compare with active — without storing.

    Returns a preview with status "unchanged" or "pending_confirmation".
    """
    model_definition = _build_model_definition(extraction.entities)

    existing = get_active_model(tenant_id)
    if existing:
        existing_normalized = _normalize_model_def(existing["model_definition"])
        new_normalized = _normalize_model_def(model_definition)
        if existing_normalized == new_normalized:
            return {
                "status": "unchanged",
                "version": existing["version"],
                "model_definition": existing["model_definition"],
                "source_filename": existing["source_filename"],
                "created_by": existing["created_by"],
                "created_at": existing["created_at"],
            }

    # Calculate next version from max across ALL records (active + archived)
    # to avoid version collisions after rollback
    store = _get_store()
    all_rows = store.list_models(tenant_id)
    max_version = max((r["_version"] for r in all_rows), default=0)
    next_version = max_version + 1 if max_version > 0 else 1

    return {
        "status": "pending_confirmation",
        "version": next_version,
        "model_definition": model_definition,
        "source_filename": extraction.filename,
    }


def commit_finalize(
    tenant_id: str,
    extraction: ExtractionResult,
    created_by: str,
) -> dict:
    """Store a finalized model definition via datacore.

    - Compares against existing active model; skips write if unchanged
    - Stores each entity type as a separate datacore model record
    - All entity types share a change_id for grouped rollback
    - Returns the stored model definition record with status
    """
    store = _get_store()

    model_definition = _build_model_definition(extraction.entities)

    # Check if model is unchanged from the active version
    existing = get_active_model(tenant_id)
    if existing:
        existing_normalized = _normalize_model_def(existing["model_definition"])
        new_normalized = _normalize_model_def(model_definition)
        if existing_normalized == new_normalized:
            return {
                "tenant_id": tenant_id,
                "version": existing["version"],
                "status": "unchanged",
                "model_definition": existing["model_definition"],
                "source_filename": existing["source_filename"],
                "created_by": existing["created_by"],
                "created_at": existing["created_at"],
            }

    # Store each entity type with a shared change_id
    change_id = uuid.uuid4().hex[:12]
    now = datetime.now(timezone.utc).isoformat()
    max_version = 0

    for entity_type, definition in model_definition.items():
        model_def_with_meta = {
            **definition,
            "_source_filename": extraction.filename,
            "_created_by": created_by,
        }
        result = store.put_model(
            tenant_id=tenant_id,
            entity_type=entity_type,
            model_definition=model_def_with_meta,
            change_id=change_id,
        )
        max_version = max(max_version, result["_version"])

    return {
        "tenant_id": tenant_id,
        "version": max_version,
        "status": "finalized",
        "model_definition": model_definition,
        "source_filename": extraction.filename,
        "created_by": created_by,
        "created_at": now,
    }
