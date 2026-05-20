"""Finalize endpoint — commit model definition via DataCore API."""
import httpx
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from app.api.auth import require_admin
from app.config import settings
from app.models.registry import UserRecord
from app.models.extraction import ExtractionResult, EntityResult
from app.models.domain import Tenant

# Base-data field names for the Tenant entity. Used to classify columns
# returned by DataCore's /api/query (which flattens base_data and
# custom_fields into a single top-level column set). System fields are
# excluded so they cannot accidentally route an unrelated key to the
# base bucket.
_TENANT_BASE_KEYS: frozenset[str] = frozenset(
    set(Tenant.model_fields.keys()) - {"tenant_id", "entity_type", "custom_fields"}
)

router = APIRouter()


class FinalizeRequest(BaseModel):
    extraction: ExtractionResult


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


def _is_empty(value) -> bool:
    """Return True iff `value` is None or a whitespace-only string.

    Falsy non-string values (0, False, [], {}) are NOT empty — they are
    legitimate user input. Strings like "0" or "False" (which can arise
    from DataCore's query flattening that stringifies everything) are
    also NOT empty.
    """
    if value is None:
        return True
    if isinstance(value, str) and value.strip() == "":
        return True
    return False


def _split_extracted_tenant(entity: EntityResult) -> tuple[dict, dict]:
    """Split an extracted TENANT entity's field_mappings into base and custom dicts.

    - Mappings with `source == "base_model"` go to the base dict.
    - Mappings with `source == "custom_field"` go to the custom dict.
    - Mappings whose value is empty (per `_is_empty`) are dropped from both.

    Returns:
        (extracted_base, extracted_custom)
    """
    extracted_base: dict = {}
    extracted_custom: dict = {}
    for mapping in entity.field_mappings:
        if _is_empty(mapping.value):
            continue
        if mapping.source == "base_model":
            extracted_base[mapping.field_name] = mapping.value
        elif mapping.source == "custom_field":
            extracted_custom[mapping.field_name] = mapping.value
    return extracted_base, extracted_custom


def _split_existing_tenant_row(cleaned: dict) -> tuple[dict, dict]:
    """Split a cleaned existing tenant row into base and custom dicts.

    "Cleaned" means: already stripped of internal columns (_status,
    _version, _created_at, _updated_at, _change_id, entity_type,
    entity_id, base_data, custom_fields, vector), any key starting
    with `_`, and any None value. The caller (_fetch_existing_tenant_row)
    is responsible for that cleaning step.

    Classification: keys in `_TENANT_BASE_KEYS` go to base; everything
    else goes to custom.
    """
    existing_base: dict = {}
    existing_custom: dict = {}
    for key, value in cleaned.items():
        if key in _TENANT_BASE_KEYS:
            existing_base[key] = value
        else:
            existing_custom[key] = value
    return existing_base, existing_custom


def _build_model_definition(entities: list[EntityResult]) -> dict:
    """Convert extraction entities into a model definition (schema only)."""
    from app.models.domain import ENTITY_CLASSES

    model_def: dict[str, dict] = {}

    for entity_result in entities:
        entity_type = entity_result.entity_type.lower()

        model_class = ENTITY_CLASSES.get(entity_type)
        schema_fields = set(model_class.model_fields.keys()) if model_class else set()

        base_fields: list[dict] = []
        custom_fields: list[dict] = []

        for mapping in entity_result.field_mappings:
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


@router.post("/tenants/{tenant_id}/finalize/commit")
async def finalize_commit(
    tenant_id: str,
    request: FinalizeRequest,
    user: UserRecord = Depends(require_admin),
):
    """Build model definition from extraction and store via DataCore API."""
    if user.tenant_id != tenant_id:
        raise HTTPException(status_code=403, detail="Tenant mismatch")

    extraction = request.extraction
    if extraction.tenant_id != tenant_id:
        raise HTTPException(status_code=400, detail="Extraction tenant_id mismatch")

    model_definition = _build_model_definition(extraction.entities)

    resp = httpx.put(
        f"{settings.datacore_api_url}/models/{tenant_id}",
        json={
            "model_definition": model_definition,
            "source_filename": extraction.filename,
            "created_by": user.name,
        },
        timeout=30.0,
    )
    if resp.status_code != 200:
        detail = "Finalization failed"
        try:
            detail = resp.json().get("detail", detail)
        except Exception:
            pass
        raise HTTPException(status_code=resp.status_code, detail=detail)

    result = resp.json()
    return {
        "status": result["status"],
        "tenant_id": tenant_id,
        "version": result["version"],
        "entity_count": len(extraction.entities),
        "model_definition": result["model_definition"],
        "source_filename": result["source_filename"],
        "created_by": result["created_by"],
        "created_at": result["created_at"],
    }
