"""Upload endpoint — accepts documents and runs the extraction pipeline."""
import shutil
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form

from app.api.auth import require_admin
from app.config import TestUser, settings
from app.models.extraction import ExtractionResult
from app.services.parser import parse_document
from app.services.extractor import extract_entities
from app.services.mapper import map_extraction

router = APIRouter()

ALLOWED_EXTENSIONS = {".pdf", ".docx", ".txt"}


@router.post("/tenants/{tenant_id}/upload", response_model=ExtractionResult)
def upload_document(
    tenant_id: str,
    file: UploadFile = File(...),
    model_id: str = Form(default=settings.default_model),
    user: TestUser = Depends(require_admin),
):
    """Upload a document, extract entities, and return the mapped result."""
    if user.tenant_id != tenant_id:
        raise HTTPException(status_code=403, detail="Tenant mismatch")

    # Validate file type
    suffix = Path(file.filename or "").suffix.lower()
    if suffix not in ALLOWED_EXTENSIONS:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported file type: {suffix}. Allowed: {ALLOWED_EXTENSIONS}",
        )

    # Save uploaded file
    upload_dir = settings.upload_dir / tenant_id
    upload_dir.mkdir(parents=True, exist_ok=True)
    file_path = upload_dir / file.filename
    with file_path.open("wb") as f:
        shutil.copyfileobj(file.file, f)

    try:
        # Pipeline: parse → extract → map
        text = parse_document(file_path)
        raw_extraction = extract_entities(text, model_id)
        result = map_extraction(raw_extraction, tenant_id, file.filename, text)
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
