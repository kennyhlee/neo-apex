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


def _merge_fields(existing: dict, extracted: dict) -> dict:
    """Return a new dict that fills empty fields in `existing` with values from `extracted`.

    For each (k, v) in `extracted`: if `_is_empty(existing.get(k))`, set
    the merged value to v; otherwise keep existing's value. Keys present
    in `existing` but absent from `extracted` are preserved unchanged.

    Pure function — no I/O. Does not mutate either input.
    """
    merged = dict(existing)
    for key, extracted_value in extracted.items():
        if _is_empty(merged.get(key)):
            merged[key] = extracted_value
    return merged


# Columns returned by DataCore's /api/query that are storage internals
# rather than tenant data. Stripped before classification.
_TENANT_ROW_INTERNAL_COLUMNS: frozenset[str] = frozenset({
    "_status", "_version", "_created_at", "_updated_at", "_change_id",
    "entity_type", "entity_id", "base_data", "custom_fields", "vector",
})


def _fetch_existing_tenant_row(tenant_id: str) -> dict:
    """Read the active tenant row from DataCore and return its cleaned columns.

    Uses POST /api/query (the same pattern Launchpad's
    `update_tenant_profile` uses) because DataCore exposes no
    GET-by-id endpoint for tenants.

    Returns {} when no active row exists.

    Cleaning: drops internal storage columns, any key starting with `_`
    (e.g. `_abbrev` — DataCore re-derives it on PUT), and any None value.

    Raises HTTPException(502) on any non-2xx response or transport
    failure.
    """
    try:
        resp = httpx.post(
            f"{settings.datacore_api_url}/query",
            json={
                "tenant_id": tenant_id,
                "table": "tenants",
                "sql": "SELECT * FROM data WHERE entity_type = 'tenant' AND _status = 'active'",
            },
            timeout=30.0,
        )
    except httpx.HTTPError:
        raise HTTPException(
            status_code=502,
            detail="Failed to persist tenant from extraction",
        )

    if resp.status_code != 200:
        raise HTTPException(
            status_code=502,
            detail="Failed to persist tenant from extraction",
        )

    rows = resp.json().get("data", [])
    if not rows:
        return {}

    raw = rows[0]
    cleaned: dict = {}
    for key, value in raw.items():
        if key in _TENANT_ROW_INTERNAL_COLUMNS:
            continue
        if key.startswith("_"):
            continue
        if value is None:
            continue
        cleaned[key] = value
    return cleaned


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
            if mapping.default is not None:
                field_def["default"] = mapping.default

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

    # --- Persist extracted tenant values to DataCore (issue #69) ---
    tenant_entity = next(
        (e for e in extraction.entities if e.entity_type == "TENANT"),
        None,
    )
    if tenant_entity is not None:
        extracted_base, extracted_custom = _split_extracted_tenant(tenant_entity)
        # The tenant schema is pre-determined and takes no custom fields
        # (issue #76): fold any extra extracted fields into the `note` field so
        # the information is preserved rather than stored as custom columns.
        if extracted_custom:
            extra = "; ".join(f"{k}: {v}" for k, v in extracted_custom.items())
            base_note = str(extracted_base.get("note", "")).strip()
            extracted_base["note"] = f"{base_note}\n{extra}".strip() if base_note else extra
        if extracted_base:
            cleaned = _fetch_existing_tenant_row(tenant_id)
            existing_base, existing_custom = _split_existing_tenant_row(cleaned)
            merged_base = _merge_fields(existing_base, extracted_base)
            # Do not introduce new custom fields for the tenant; preserve any
            # that already exist on the row unchanged.
            try:
                tenant_resp = httpx.put(
                    f"{settings.datacore_api_url}/tenants/{tenant_id}",
                    json={"base_data": merged_base, "custom_fields": existing_custom},
                    timeout=30.0,
                )
            except httpx.HTTPError:
                raise HTTPException(
                    status_code=502,
                    detail="Failed to persist tenant from extraction",
                )
            if tenant_resp.status_code not in (200, 201):
                raise HTTPException(
                    status_code=502,
                    detail="Failed to persist tenant from extraction",
                )
    # --- end tenant persistence ---

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
