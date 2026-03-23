"""Document parsing service using Docling."""
from pathlib import Path

from docling.document_converter import DocumentConverter


def parse_document(file_path: Path) -> str:
    """Parse a document (PDF, DOCX, TXT, etc.) and return its text content."""
    suffix = file_path.suffix.lower()

    if suffix == ".txt":
        return file_path.read_text(encoding="utf-8")

    converter = DocumentConverter()
    result = converter.convert(str(file_path))
    return result.document.export_to_markdown()
