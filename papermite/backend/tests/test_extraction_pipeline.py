"""Tests for the extraction_pipeline module."""
from unittest.mock import patch

import pytest

from app.models.extraction import RawExtraction


def _fake_raw_extraction() -> RawExtraction:
    return RawExtraction(students=[{"first_name": "Jane", "last_name": "Doe"}])


# ─── Discovery entrypoint ─────────────────────────────────────────


def test_extract_for_discovery_returns_raw_extraction(tmp_path, monkeypatch):
    """Discovery returns RawExtraction directly — no tuple, no placeholder."""
    from app.services.extraction_pipeline import extract_for_discovery

    monkeypatch.setattr("app.services.extraction_pipeline.settings.parser_backend", "local")
    pdf_file = tmp_path / "f.pdf"
    pdf_file.write_bytes(b"%PDF-1.4 fake")

    with patch("app.services.extraction_pipeline._docling_parse") as mock_parse, \
         patch("app.services.extraction_pipeline.extract_entities") as mock_extract, \
         patch("app.services.extraction_pipeline.extract_entities_from_pdf") as mock_pdf:
        mock_parse.return_value = "parsed text"
        mock_extract.return_value = _fake_raw_extraction()

        result = extract_for_discovery(pdf_file, "anthropic:claude-haiku-4-5-20251001")

    assert isinstance(result, RawExtraction)
    assert result.students[0]["first_name"] == "Jane"
    mock_pdf.assert_not_called()


def test_extract_for_discovery_pdf_local_uses_docling(tmp_path, monkeypatch):
    from app.services.extraction_pipeline import extract_for_discovery

    monkeypatch.setattr("app.services.extraction_pipeline.settings.parser_backend", "local")
    pdf_file = tmp_path / "f.pdf"
    pdf_file.write_bytes(b"%PDF-1.4 fake")

    with patch("app.services.extraction_pipeline._docling_parse") as mock_parse, \
         patch("app.services.extraction_pipeline.extract_entities") as mock_extract, \
         patch("app.services.extraction_pipeline.extract_entities_from_pdf") as mock_pdf:
        mock_parse.return_value = "parsed text"
        mock_extract.return_value = _fake_raw_extraction()

        extract_for_discovery(pdf_file, "anthropic:claude-haiku-4-5-20251001")

    mock_parse.assert_called_once_with(pdf_file)
    mock_extract.assert_called_once_with("parsed text", "anthropic:claude-haiku-4-5-20251001")
    mock_pdf.assert_not_called()


def test_extract_for_discovery_pdf_merged_uses_vision(tmp_path, monkeypatch):
    from app.services.extraction_pipeline import extract_for_discovery

    monkeypatch.setattr("app.services.extraction_pipeline.settings.parser_backend", "claude_merged")
    pdf_file = tmp_path / "f.pdf"
    pdf_file.write_bytes(b"%PDF-1.4 fake")

    with patch("app.services.extraction_pipeline._docling_parse") as mock_parse, \
         patch("app.services.extraction_pipeline.extract_entities") as mock_extract, \
         patch("app.services.extraction_pipeline.extract_entities_from_pdf") as mock_pdf:
        mock_pdf.return_value = _fake_raw_extraction()

        extract_for_discovery(pdf_file, "anthropic:claude-sonnet-4-6")

    mock_pdf.assert_called_once_with(pdf_file, "anthropic:claude-sonnet-4-6")
    mock_parse.assert_not_called()
    mock_extract.assert_not_called()


def test_extract_for_discovery_docx_always_uses_docling(tmp_path, monkeypatch):
    """DOCX falls back to docling regardless of parser_backend."""
    from app.services.extraction_pipeline import extract_for_discovery

    monkeypatch.setattr("app.services.extraction_pipeline.settings.parser_backend", "claude_merged")
    docx_file = tmp_path / "f.docx"
    docx_file.write_bytes(b"PK fake")

    with patch("app.services.extraction_pipeline._docling_parse") as mock_parse, \
         patch("app.services.extraction_pipeline.extract_entities") as mock_extract, \
         patch("app.services.extraction_pipeline.extract_entities_from_pdf") as mock_pdf:
        mock_parse.return_value = "from docx"
        mock_extract.return_value = _fake_raw_extraction()

        extract_for_discovery(docx_file, "anthropic:claude-haiku-4-5-20251001")

    mock_parse.assert_called_once_with(docx_file)
    mock_pdf.assert_not_called()


def test_extract_for_discovery_txt_uses_direct_read(tmp_path, monkeypatch):
    """TXT skips docling; reads file directly."""
    from app.services.extraction_pipeline import extract_for_discovery

    monkeypatch.setattr("app.services.extraction_pipeline.settings.parser_backend", "claude_merged")
    txt_file = tmp_path / "f.txt"
    txt_file.write_text("Student: Jane Doe")

    with patch("app.services.extraction_pipeline._docling_parse") as mock_parse, \
         patch("app.services.extraction_pipeline.extract_entities") as mock_extract, \
         patch("app.services.extraction_pipeline.extract_entities_from_pdf") as mock_pdf:
        mock_extract.return_value = _fake_raw_extraction()

        extract_for_discovery(txt_file, "anthropic:claude-haiku-4-5-20251001")

    mock_parse.assert_not_called()  # docling not invoked for TXT
    mock_extract.assert_called_once_with("Student: Jane Doe", "anthropic:claude-haiku-4-5-20251001")
    mock_pdf.assert_not_called()


# ─── Targeted entrypoint ──────────────────────────────────────────


def test_extract_for_entity_pdf_local_uses_text_extractor(tmp_path, monkeypatch):
    from app.services.extraction_pipeline import extract_for_entity

    monkeypatch.setattr("app.services.extraction_pipeline.settings.parser_backend", "local")
    pdf_file = tmp_path / "f.pdf"
    pdf_file.write_bytes(b"%PDF-1.4 fake")

    model_def = {"student": {"base_fields": [{"name": "first_name", "type": "str"}], "custom_fields": []}}

    with patch("app.services.extraction_pipeline._docling_parse") as mock_parse, \
         patch("app.services.extraction_pipeline.extract_fields") as mock_text, \
         patch("app.services.extraction_pipeline.extract_fields_from_pdf") as mock_vision:
        mock_parse.return_value = "parsed text"
        mock_text.return_value = {"first_name": "Jane"}

        result = extract_for_entity(pdf_file, "anthropic:claude-haiku-4-5-20251001", "student", model_def)

    assert result == {"first_name": "Jane"}
    mock_parse.assert_called_once_with(pdf_file)
    mock_text.assert_called_once_with(
        "parsed text", "student", model_def, "anthropic:claude-haiku-4-5-20251001"
    )
    mock_vision.assert_not_called()


def test_extract_for_entity_pdf_merged_uses_vision_extractor(tmp_path, monkeypatch):
    from app.services.extraction_pipeline import extract_for_entity

    monkeypatch.setattr("app.services.extraction_pipeline.settings.parser_backend", "claude_merged")
    pdf_file = tmp_path / "f.pdf"
    pdf_file.write_bytes(b"%PDF-1.4 fake")

    model_def = {"student": {"base_fields": [{"name": "first_name", "type": "str"}], "custom_fields": []}}

    with patch("app.services.extraction_pipeline._docling_parse") as mock_parse, \
         patch("app.services.extraction_pipeline.extract_fields") as mock_text, \
         patch("app.services.extraction_pipeline.extract_fields_from_pdf") as mock_vision:
        mock_vision.return_value = {"first_name": "Jane"}

        result = extract_for_entity(pdf_file, "anthropic:claude-sonnet-4-6", "student", model_def)

    assert result == {"first_name": "Jane"}
    # NOTE: extract_fields_from_pdf signature is (file_path, entity_type, model_definition, model_id)
    mock_vision.assert_called_once_with(
        pdf_file, "student", model_def, "anthropic:claude-sonnet-4-6"
    )
    mock_parse.assert_not_called()
    mock_text.assert_not_called()


def test_extract_for_entity_docx_always_uses_text_extractor(tmp_path, monkeypatch):
    from app.services.extraction_pipeline import extract_for_entity

    monkeypatch.setattr("app.services.extraction_pipeline.settings.parser_backend", "claude_merged")
    docx_file = tmp_path / "f.docx"
    docx_file.write_bytes(b"PK fake")

    model_def = {"student": {"base_fields": [{"name": "first_name", "type": "str"}], "custom_fields": []}}

    with patch("app.services.extraction_pipeline._docling_parse") as mock_parse, \
         patch("app.services.extraction_pipeline.extract_fields") as mock_text, \
         patch("app.services.extraction_pipeline.extract_fields_from_pdf") as mock_vision:
        mock_parse.return_value = "from docx"
        mock_text.return_value = {"first_name": "Jane"}

        extract_for_entity(docx_file, "anthropic:claude-haiku-4-5-20251001", "student", model_def)

    mock_parse.assert_called_once_with(docx_file)
    mock_text.assert_called_once()
    mock_vision.assert_not_called()


def test_extract_for_entity_txt_uses_direct_read(tmp_path, monkeypatch):
    from app.services.extraction_pipeline import extract_for_entity

    monkeypatch.setattr("app.services.extraction_pipeline.settings.parser_backend", "claude_merged")
    txt_file = tmp_path / "f.txt"
    txt_file.write_text("Student: Jane")

    model_def = {"student": {"base_fields": [{"name": "first_name", "type": "str"}], "custom_fields": []}}

    with patch("app.services.extraction_pipeline._docling_parse") as mock_parse, \
         patch("app.services.extraction_pipeline.extract_fields") as mock_text, \
         patch("app.services.extraction_pipeline.extract_fields_from_pdf") as mock_vision:
        mock_text.return_value = {"first_name": "Jane"}

        extract_for_entity(txt_file, "anthropic:claude-haiku-4-5-20251001", "student", model_def)

    mock_parse.assert_not_called()
    mock_text.assert_called_once_with(
        "Student: Jane", "student", model_def, "anthropic:claude-haiku-4-5-20251001"
    )
    mock_vision.assert_not_called()


# ─── Error handling ───────────────────────────────────────────────


def test_pdf_with_unknown_parser_backend_raises_value_error(tmp_path, monkeypatch):
    from app.services.extraction_pipeline import extract_for_discovery

    monkeypatch.setattr("app.services.extraction_pipeline.settings.parser_backend", "bogus_value")
    pdf_file = tmp_path / "f.pdf"
    pdf_file.write_bytes(b"%PDF-1.4 fake")

    with pytest.raises(ValueError, match="parser_backend"):
        extract_for_discovery(pdf_file, "anthropic:claude-sonnet-4-6")


# ─── File lifecycle ───────────────────────────────────────────────


def test_pipeline_does_not_delete_input_file(tmp_path, monkeypatch):
    """Pipeline is pure: caller owns file lifecycle."""
    from app.services.extraction_pipeline import extract_for_discovery

    monkeypatch.setattr("app.services.extraction_pipeline.settings.parser_backend", "local")
    pdf_file = tmp_path / "f.pdf"
    pdf_file.write_bytes(b"%PDF-1.4 fake")

    with patch("app.services.extraction_pipeline._docling_parse") as mock_parse, \
         patch("app.services.extraction_pipeline.extract_entities") as mock_extract:
        mock_parse.return_value = "parsed"
        mock_extract.return_value = _fake_raw_extraction()

        extract_for_discovery(pdf_file, "anthropic:claude-haiku-4-5-20251001")

    assert pdf_file.exists()
    assert pdf_file.read_bytes() == b"%PDF-1.4 fake"
