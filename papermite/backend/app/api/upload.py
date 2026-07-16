"""Upload endpoint — accepts documents and runs the extraction pipeline."""
import shutil
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form, Response

from app.api.auth import require_admin
from app.config import settings
from app.models.registry import UserRecord
from app.models.extraction import ExtractionResult
from app.services.mapper import map_extraction, merge_raw_extractions
from app.services.extraction_pipeline import extract_for_discovery

router = APIRouter()

ALLOWED_EXTENSIONS = {".pdf", ".docx", ".txt"}


@router.post("/tenants/{tenant_id}/upload", response_model=ExtractionResult)
def upload_document(
    tenant_id: str,
    response: Response,
    files: list[UploadFile] = File(...),
    model_id: str = Form(default=settings.default_model),
    user: UserRecord = Depends(require_admin),
):
    """Upload one or more documents, extract entities from each, and return the
    merged mapped result. Multiple files are extracted independently and their
    entities merged into a single field union per entity type."""
    if user.tenant_id != tenant_id:
        raise HTTPException(status_code=403, detail="Tenant mismatch")

    if not files:
        raise HTTPException(status_code=400, detail="No files provided")

    # Validate all file types up front
    for f in files:
        suffix = Path(f.filename or "").suffix.lower()
        if suffix not in ALLOWED_EXTENSIONS:
            raise HTTPException(
                status_code=400,
                detail=f"Unsupported file type: {suffix}. Allowed: {ALLOWED_EXTENSIONS}",
            )

    upload_dir = settings.upload_dir / tenant_id
    upload_dir.mkdir(parents=True, exist_ok=True)

    try:
        raw_extractions = []
        filenames = []
        for f in files:
            file_path = upload_dir / f.filename
            with file_path.open("wb") as out:
                shutil.copyfileobj(f.file, out)
            raw_extractions.append(extract_for_discovery(file_path, model_id))
            filenames.append(f.filename)

        merged_raw = merge_raw_extractions(raw_extractions)
        combined_name = filenames[0] if len(filenames) == 1 else ", ".join(filenames)
        result = map_extraction(merged_raw, tenant_id, combined_name)
        response.headers["X-Papermite-Parser-Backend"] = settings.parser_backend
        return result
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
