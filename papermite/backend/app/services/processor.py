"""Document processing strategy dispatcher.

Picks between the local parse + extract pipeline and the merged Claude vision
pipeline based on settings.parser_backend. TXT and DOCX always go through the
local path — Claude vision is only worth invoking for PDFs.
"""
from pathlib import Path

from app.config import settings
from app.models.extraction import RawExtraction
from app.services.extractor import extract_entities, extract_entities_from_pdf
from app.services.parser import parse_document


# Placeholder text shown in the Review page's "Show Source" panel when the
# merged path was used. The merged path doesn't produce a markdown source as
# a side-product (would need a second LLM call). For users who need source
# view, set PAPERMITE_PARSER_BACKEND=local.
_MERGED_RAW_TEXT_PLACEHOLDER = (
    "[Document processed in merged mode — markdown source view is only "
    "available when PAPERMITE_PARSER_BACKEND=local]"
)


def process_document(file_path: Path, model_id: str) -> tuple[RawExtraction, str]:
    """Run the parse + extract pipeline. Returns (extraction, raw_text).

    Strategy:
    - Non-PDF files (TXT, DOCX) → always local path. Claude vision adds no value
      for plain-text and isn't reliable for DOCX.
    - PDF + parser_backend="local" → docling parses, LLM extracts (2 LLM-free
      parse + 1 LLM call total).
    - PDF + parser_backend="claude_merged" → vision LLM does both in one call.
      Returns a placeholder string for raw_text since the merged path doesn't
      emit markdown as a byproduct.
    """
    suffix = file_path.suffix.lower()

    if suffix != ".pdf" or settings.parser_backend == "local":
        text = parse_document(file_path)
        extraction = extract_entities(text, model_id)
        return extraction, text

    if settings.parser_backend == "claude_merged":
        extraction = extract_entities_from_pdf(file_path, model_id)
        return extraction, _MERGED_RAW_TEXT_PLACEHOLDER

    raise ValueError(
        f"Unknown parser_backend: {settings.parser_backend!r} "
        f"(expected 'local' or 'claude_merged')"
    )
