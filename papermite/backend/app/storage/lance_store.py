"""LanceDB storage for tenant model definitions.

Stores the finalized model definition (schema only — field definitions per entity type)
per tenant with version history. Each finalize creates a new version; latest by timestamp
is active, previous versions are archived. Max 50 versions per tenant.
"""
import json
from datetime import datetime, timezone

import lancedb
import pyarrow as pa

from app.config import settings
from app.models.extraction import ExtractionResult, EntityResult

# Schema for the tenant_models table
TABLE_NAME = "tenant_models"
TABLE_SCHEMA = pa.schema([
    pa.field("tenant_id", pa.string()),
    pa.field("version", pa.int64()),
    pa.field("status", pa.string()),  # "active" or "archived"
    pa.field("model_definition", pa.string()),  # JSON string
    pa.field("source_filename", pa.string()),
    pa.field("created_by", pa.string()),
    pa.field("created_at", pa.string()),
])

MAX_VERSIONS = 50


def _get_db():
    """Get or create the LanceDB database."""
    settings.lancedb_dir.mkdir(parents=True, exist_ok=True)
    return lancedb.connect(str(settings.lancedb_dir))


def _table_names(db) -> list[str]:
    """Get table names as plain strings (works across LanceDB versions)."""
    raw = db.table_names()
    if isinstance(raw, list):
        return raw
    # Newer LanceDB returns a response object with a .tables attribute
    return list(getattr(raw, "tables", []))


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


def _clear_stale_tables(db) -> None:
    """Drop any per-entity tables from the old storage format."""
    for table_name in _table_names(db):
        if table_name != TABLE_NAME:
            db.drop_table(table_name)


def _get_max_version(db, tenant_id: str) -> int:
    """Get the highest version number for a tenant, or 0 if none."""
    if TABLE_NAME not in _table_names(db):
        return 0
    table = db.open_table(TABLE_NAME)
    rows = (
        table.search()
        .where(f"tenant_id = '{tenant_id}'")
        .to_list()
    )
    if not rows:
        return 0
    return max(r["version"] for r in rows)


def _trim_versions(db, tenant_id: str) -> None:
    """Keep only the newest MAX_VERSIONS records per tenant. Drop oldest."""
    if TABLE_NAME not in _table_names(db):
        return
    table = db.open_table(TABLE_NAME)
    rows = (
        table.search()
        .where(f"tenant_id = '{tenant_id}'")
        .to_list()
    )
    if len(rows) <= MAX_VERSIONS:
        return
    # Sort by version descending, find versions to drop
    rows.sort(key=lambda r: r["version"], reverse=True)
    to_drop = rows[MAX_VERSIONS:]
    for row in to_drop:
        table.delete(f"tenant_id = '{tenant_id}' AND version = {row['version']}")


def get_active_model(tenant_id: str) -> dict | None:
    """Get the active model definition for a tenant, or None if not found."""
    db = _get_db()

    if TABLE_NAME not in _table_names(db):
        return None

    table = db.open_table(TABLE_NAME)
    results = (
        table.search()
        .where(f"tenant_id = '{tenant_id}' AND status = 'active'")
        .limit(1)
        .to_list()
    )

    if not results:
        return None

    row = results[0]
    return {
        "tenant_id": row["tenant_id"],
        "version": row["version"],
        "status": row["status"],
        "model_definition": json.loads(row["model_definition"]),
        "source_filename": row["source_filename"],
        "created_by": row["created_by"],
        "created_at": row["created_at"],
    }


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

    next_version = (_get_max_version(_get_db(), tenant_id) + 1) if existing else 1

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
    """Store a finalized model definition in LanceDB.

    - Compares against existing active model; skips write if unchanged
    - Archives any existing active record for this tenant
    - Inserts the new record as active with incremented version
    - Enforces max 50 versions per tenant
    - Clears stale per-entity tables from old format
    - Returns the stored model definition record with status
    """
    db = _get_db()

    # Clear stale per-entity tables from old storage format
    _clear_stale_tables(db)

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

    now = datetime.now(timezone.utc).isoformat()
    next_version = (_get_max_version(db, tenant_id) + 1) if existing else 1

    # Archive existing active records for this tenant
    if TABLE_NAME in _table_names(db):
        table = db.open_table(TABLE_NAME)
        active_rows = (
            table.search()
            .where(f"tenant_id = '{tenant_id}' AND status = 'active'")
            .to_list()
        )
        if active_rows:
            table.delete(f"tenant_id = '{tenant_id}' AND status = 'active'")
            for row in active_rows:
                row["status"] = "archived"
            table.add(active_rows)

    # Create the new active record
    record = {
        "tenant_id": tenant_id,
        "version": next_version,
        "status": "active",
        "model_definition": json.dumps(model_definition),
        "source_filename": extraction.filename,
        "created_by": created_by,
        "created_at": now,
    }

    if TABLE_NAME in _table_names(db):
        table = db.open_table(TABLE_NAME)
        table.add([record])
    else:
        db.create_table(TABLE_NAME, [record], schema=TABLE_SCHEMA)

    # Enforce max versions
    _trim_versions(db, tenant_id)

    return {
        "tenant_id": tenant_id,
        "version": next_version,
        "status": "finalized",
        "model_definition": model_definition,
        "source_filename": extraction.filename,
        "created_by": created_by,
        "created_at": now,
    }
