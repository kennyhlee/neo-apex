"""Upload endpoint — accepts documents and runs the extraction pipeline."""
import shutil
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form, Response

from app.api.auth import require_admin
from app.config import settings
from app.models.registry import UserRecord
from app.models.extraction import ExtractionResult
from app.services.mapper import map_extraction
from app.services.extraction_pipeline import extract_for_discovery

router = APIRouter()

ALLOWED_EXTENSIONS = {".pdf", ".docx", ".txt"}


@router.post("/tenants/{tenant_id}/upload", response_model=ExtractionResult)
def upload_document(
    tenant_id: str,
    response: Response,
    file: UploadFile = File(...),
    model_id: str = Form(default=settings.default_model),
    user: UserRecord = Depends(require_admin),
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
        # Run discovery extraction → map to ExtractionResult
        raw_extraction = extract_for_discovery(file_path, model_id)
        result = map_extraction(raw_extraction, tenant_id, file.filename)
        response.headers["X-Papermite-Parser-Backend"] = settings.parser_backend
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
