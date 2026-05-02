"""Shared parse+extract pipeline.

Owns the dispatch decision between docling-local parsing and Claude-vision-
merged parsing for PDFs, with text-based fallback paths for DOCX/TXT. Exposes
two named entrypoints — `extract_for_discovery` (multi-entity, used by
/api/upload's model-building flow) and `extract_for_entity` (single-entity,
used by /api/extract's add-student-with-document flow).

The pipeline is pure: it reads the file at the supplied path and returns; it
does not delete, move, or rename the file. Lifecycle is the caller's concern.

Dispatch table for PDFs:
    parser_backend=local         → _docling_parse → extract_entities / extract_fields
    parser_backend=claude_merged → extract_entities_from_pdf / extract_fields_from_pdf

Non-PDFs (.docx, .txt) always use the text path; Claude vision does not
natively accept DOCX, and TXT is read directly without docling.
"""
from pathlib import Path
from typing import Any

from docling.document_converter import DocumentConverter

from app.config import settings
from app.models.extraction import RawExtraction
from app.services.extractor import (
    extract_entities,
    extract_entities_from_pdf,
    extract_fields,
    extract_fields_from_pdf,
)


def _docling_parse(file_path: Path) -> str:
    """Parse a document with docling and return its markdown text."""
    suffix = file_path.suffix.lower()
    if suffix == ".txt":
        return file_path.read_text(encoding="utf-8")
    converter = DocumentConverter()
    result = converter.convert(str(file_path))
    return result.document.export_to_markdown()


def _read_text_or_parse(file_path: Path) -> str:
    """Get text from a file using the cheapest method that works.

    .txt → direct read (no docling load).
    Other → docling DocumentConverter.
    """
    suffix = file_path.suffix.lower()
    if suffix == ".txt":
        return file_path.read_text(encoding="utf-8")
    return _docling_parse(file_path)


def _is_vision_path(file_path: Path) -> bool:
    """Return True if this file should use the merged-vision path.

    Only applies to PDFs when parser_backend=claude_merged. DOCX and TXT
    always use the local text path regardless of backend.
    """
    if file_path.suffix.lower() != ".pdf":
        return False
    return settings.parser_backend == "claude_merged"


def _validate_pdf_backend() -> None:
    """Raise if parser_backend is set to an unrecognized value (PDF path only)."""
    if settings.parser_backend not in ("local", "claude_merged"):
        raise ValueError(
            f"Unknown parser_backend: {settings.parser_backend!r} "
            f"(expected 'local' or 'claude_merged')"
        )


def extract_for_discovery(file_path: Path, model_id: str) -> RawExtraction:
    """Run multi-entity discovery extraction. Used by model-building."""
    if file_path.suffix.lower() == ".pdf":
        _validate_pdf_backend()
        if _is_vision_path(file_path):
            return extract_entities_from_pdf(file_path, model_id)
    text = _read_text_or_parse(file_path)
    return extract_entities(text, model_id)


def extract_for_entity(
    file_path: Path,
    model_id: str,
    entity_type: str,
    model_definition: dict[str, Any],
) -> dict[str, Any]:
    """Run targeted, model-driven extraction for a single entity type.

    Returns a flat dict of {field_name: value} filtered to fields present in
    `model_definition[entity_type]`. Returns `{}` if `entity_type` is not in
    the model definition (without invoking any LLM).
    """
    if file_path.suffix.lower() == ".pdf":
        _validate_pdf_backend()
        if _is_vision_path(file_path):
            # NOTE: signature is (file_path, entity_type, model_definition, model_id)
            return extract_fields_from_pdf(file_path, entity_type, model_definition, model_id)
    text = _read_text_or_parse(file_path)
    return extract_fields(text, entity_type, model_definition, model_id)
