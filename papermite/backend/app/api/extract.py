"""Document field extraction endpoint for cross-project add-student-entry flow."""
import shutil
from pathlib import Path

from fastapi import APIRouter, HTTPException, UploadFile, File

from app.config import settings
from app.services.parser import parse_document
from app.services.field_extractor import extract_fields
from app.storage.lance_store import get_active_model

router = APIRouter()

ALLOWED_EXTENSIONS = {".pdf", ".png", ".jpg", ".jpeg"}


@router.post("/extract/{tenant_id}/{entity_type}")
def extract_document_fields(
    tenant_id: str,
    entity_type: str,
    file: UploadFile = File(...),
):
    """Extract field values from an uploaded document, guided by the entity model.

    Returns {"fields": {"field_name": "value", ...}} with only successfully
    extracted fields. Partial extraction is success (HTTP 200), not failure.
    """

    # Validate file format
    suffix = Path(file.filename or "").suffix.lower()
    if suffix not in ALLOWED_EXTENSIONS:
        raise HTTPException(
            status_code=422,
            detail=f"Unsupported file format: {suffix}. Allowed: {', '.join(sorted(ALLOWED_EXTENSIONS))}",
        )

    # Fetch model definition from datacore
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

    # Save uploaded file temporarily
    upload_dir = settings.upload_dir / tenant_id / "extract"
    upload_dir.mkdir(parents=True, exist_ok=True)
    file_path = upload_dir / Path(file.filename or "unknown").name
    try:
        with file_path.open("wb") as f:
            shutil.copyfileobj(file.file, f)

        # Parse document → extract fields
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
        # Clean up temp file
        if file_path.exists():
            file_path.unlink()
