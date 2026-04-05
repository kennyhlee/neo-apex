"""Finalize endpoints — preview and commit model definition to LanceDB."""
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from app.api.auth import require_admin
from app.models.registry import UserRecord
from app.models.extraction import ExtractionResult
from app.storage.lance_store import preview_finalize, commit_finalize

router = APIRouter()


class FinalizeRequest(BaseModel):
    extraction: ExtractionResult


@router.post("/tenants/{tenant_id}/finalize/preview")
async def finalize_preview(
    tenant_id: str,
    request: FinalizeRequest,
    user: UserRecord = Depends(require_admin),
):
    """Preview the finalization without storing anything."""
    if user.tenant_id != tenant_id:
        raise HTTPException(status_code=403, detail="Tenant mismatch")

    extraction = request.extraction
    if extraction.tenant_id != tenant_id:
        raise HTTPException(status_code=400, detail="Extraction tenant_id mismatch")

    try:
        result = preview_finalize(tenant_id, extraction)
        return {
            "status": result["status"],
            "tenant_id": tenant_id,
            "version": result["version"],
            "entity_count": len(extraction.entities),
            "model_definition": result["model_definition"],
            "source_filename": result["source_filename"],
            "created_by": result.get("created_by"),
            "created_at": result.get("created_at"),
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/tenants/{tenant_id}/finalize/commit")
async def finalize_commit(
    tenant_id: str,
    request: FinalizeRequest,
    user: UserRecord = Depends(require_admin),
):
    """Commit the finalized model definition to LanceDB."""
    if user.tenant_id != tenant_id:
        raise HTTPException(status_code=403, detail="Tenant mismatch")

    extraction = request.extraction
    if extraction.tenant_id != tenant_id:
        raise HTTPException(status_code=400, detail="Extraction tenant_id mismatch")

    try:
        result = commit_finalize(tenant_id, extraction, created_by=user.name)
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
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
