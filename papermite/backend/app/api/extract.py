"""Document field extraction endpoint for cross-project add-student-entry flow."""
import json
import shutil
from pathlib import Path

import httpx
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File

from app.api.auth import require_admin
from app.config import settings
from app.models.registry import UserRecord
from app.services.parser import parse_document
from app.services.field_extractor import extract_fields

router = APIRouter()

ALLOWED_EXTENSIONS = {".pdf", ".png", ".jpg", ".jpeg"}


def get_active_model(tenant_id: str) -> dict | None:
    """Fetch the combined active model from DataCore unified query API."""
    resp = httpx.post(
        f"{settings.datacore_api_url}/api/query",
        json={
            "tenant_id": tenant_id,
            "table": "models",
            "sql": "SELECT * FROM data WHERE _status = 'active'",
        },
    )
    if resp.status_code != 200:
        raise HTTPException(status_code=502, detail="Failed to fetch model from DataCore")
    rows = resp.json().get("data", [])
    if not rows:
        return None
    record = rows[0]
    md = record.get("model_definition")
    if isinstance(md, str):
        record["model_definition"] = json.loads(md)
    return record


@router.post("/extract/{tenant_id}/{entity_type}")
def extract_document_fields(
    tenant_id: str,
    entity_type: str,
    file: UploadFile = File(...),
    user: UserRecord = Depends(require_admin),
):
    """Extract field values from an uploaded document, guided by the entity model."""
    if user.tenant_id != tenant_id:
        raise HTTPException(status_code=403, detail="Tenant mismatch")

    suffix = Path(file.filename or "").suffix.lower()
    if suffix not in ALLOWED_EXTENSIONS:
        raise HTTPException(
            status_code=422,
            detail=f"Unsupported file format: {suffix}. Allowed: {', '.join(sorted(ALLOWED_EXTENSIONS))}",
        )

    model = get_active_model(tenant_id)
    if model is None:
        raise HTTPException(
            status_code=404,
            detail="No active model definition found. Configure a model first via Papermite.",
        )

    model_definition = model["model_definition"]
    if entity_type not in model_definition:
        raise HTTPException(
            status_code=404,
            detail=f"Entity type '{entity_type}' not found in model definition. "
                   f"Available: {', '.join(sorted(model_definition.keys()))}",
        )

    upload_dir = settings.upload_dir / tenant_id / "extract"
    upload_dir.mkdir(parents=True, exist_ok=True)
    file_path = upload_dir / Path(file.filename or "unknown").name
    try:
        with file_path.open("wb") as f:
            shutil.copyfileobj(file.file, f)

        text = parse_document(file_path)
        fields = extract_fields(
            text=text,
            entity_type=entity_type,
            model_definition=model_definition,
            model_id=settings.default_model,
        )

        return {"fields": fields}

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Extraction failed: {e}")
    finally:
        if file_path.exists():
            file_path.unlink()
