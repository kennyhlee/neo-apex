"""Finalize endpoint — commit model definition via DataCore API."""
import httpx
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from app.api.auth import require_admin
from app.config import settings
from app.models.registry import UserRecord
from app.models.extraction import ExtractionResult, EntityResult

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
