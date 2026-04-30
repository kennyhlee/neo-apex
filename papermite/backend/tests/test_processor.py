"""Tests for the document processor strategy dispatcher."""
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest

from app.models.extraction import RawExtraction
from app.services.processor import process_document


def _fake_extraction() -> RawExtraction:
    return RawExtraction(
        students=[{"first_name": "Jane", "last_name": "Doe"}],
    )


def test_txt_always_uses_local_path_regardless_of_backend(tmp_path, monkeypatch):
    """TXT files skip Claude vision entirely — pure read + text-LLM extract."""
    # Even with the merged backend selected, TXT should use the local pipeline
    monkeypatch.setattr("app.services.processor.settings.parser_backend", "claude_merged")

    txt_file = tmp_path / "test.txt"
    txt_file.write_text("Student: Jane Doe")

    fake_extraction = _fake_extraction()

    with patch("app.services.processor.parse_document") as mock_parse, \
         patch("app.services.processor.extract_entities") as mock_extract, \
         patch("app.services.processor.extract_entities_from_pdf") as mock_pdf:
        mock_parse.return_value = "Student: Jane Doe"
        mock_extract.return_value = fake_extraction

        extraction, text = process_document(txt_file, "anthropic:claude-haiku-4-5-20251001")

    assert extraction == fake_extraction
    assert text == "Student: Jane Doe"
    mock_pdf.assert_not_called()  # never reach the merged branch for TXT


def test_pdf_local_backend_uses_two_step_pipeline(tmp_path, monkeypatch):
    """PDF + parser_backend=local → parse_document then extract_entities."""
    monkeypatch.setattr("app.services.processor.settings.parser_backend", "local")

    pdf_file = tmp_path / "test.pdf"
    pdf_file.write_bytes(b"%PDF-1.4 fake")

    fake_extraction = _fake_extraction()

    with patch("app.services.processor.parse_document") as mock_parse, \
         patch("app.services.processor.extract_entities") as mock_extract, \
         patch("app.services.processor.extract_entities_from_pdf") as mock_pdf:
        mock_parse.return_value = "# Page 1\nJane Doe"
        mock_extract.return_value = fake_extraction

        extraction, text = process_document(pdf_file, "anthropic:claude-haiku-4-5-20251001")

    assert extraction == fake_extraction
    assert text == "# Page 1\nJane Doe"
    mock_parse.assert_called_once_with(pdf_file)
    mock_extract.assert_called_once_with("# Page 1\nJane Doe", "anthropic:claude-haiku-4-5-20251001")
    mock_pdf.assert_not_called()


def test_pdf_merged_backend_uses_single_vision_call(tmp_path, monkeypatch):
    """PDF + parser_backend=claude_merged → one extract_entities_from_pdf call."""
    monkeypatch.setattr("app.services.processor.settings.parser_backend", "claude_merged")

    pdf_file = tmp_path / "test.pdf"
    pdf_file.write_bytes(b"%PDF-1.4 fake")

    fake_extraction = _fake_extraction()

    with patch("app.services.processor.parse_document") as mock_parse, \
         patch("app.services.processor.extract_entities") as mock_extract, \
         patch("app.services.processor.extract_entities_from_pdf") as mock_pdf:
        mock_pdf.return_value = fake_extraction

        extraction, text = process_document(pdf_file, "anthropic:claude-sonnet-4-6")

    assert extraction == fake_extraction
    assert "merged mode" in text  # placeholder text since merged path has no markdown source
    mock_pdf.assert_called_once_with(pdf_file, "anthropic:claude-sonnet-4-6")
    mock_parse.assert_not_called()
    mock_extract.assert_not_called()


def test_docx_always_uses_local_path(tmp_path, monkeypatch):
    """DOCX always uses local — Claude doesn't natively parse DOCX."""
    monkeypatch.setattr("app.services.processor.settings.parser_backend", "claude_merged")

    docx_file = tmp_path / "test.docx"
    docx_file.write_bytes(b"PK fake")

    fake_extraction = _fake_extraction()

    with patch("app.services.processor.parse_document") as mock_parse, \
         patch("app.services.processor.extract_entities") as mock_extract, \
         patch("app.services.processor.extract_entities_from_pdf") as mock_pdf:
        mock_parse.return_value = "extracted text"
        mock_extract.return_value = fake_extraction

        extraction, text = process_document(docx_file, "anthropic:claude-haiku-4-5-20251001")

    assert extraction == fake_extraction
    assert text == "extracted text"
    mock_pdf.assert_not_called()


def test_unknown_backend_raises(tmp_path, monkeypatch):
    """An unrecognized parser_backend value fails loud, not silent."""
    monkeypatch.setattr("app.services.processor.settings.parser_backend", "bogus_value")

    pdf_file = tmp_path / "test.pdf"
    pdf_file.write_bytes(b"%PDF-1.4 fake")

    with pytest.raises(ValueError, match="Unknown parser_backend"):
        process_document(pdf_file, "anthropic:claude-sonnet-4-6")
