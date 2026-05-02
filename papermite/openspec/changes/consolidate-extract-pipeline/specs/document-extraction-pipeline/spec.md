## ADDED Requirements

### Requirement: Pipeline module exposes two extraction strategies
The papermite backend SHALL expose a single `extraction_pipeline` module with two named entrypoints — one for discovery extraction and one for targeted extraction — and SHALL NOT expose alternative parse+extract entrypoints elsewhere in the codebase.

#### Scenario: Discovery extraction entrypoint exists
- **WHEN** a caller imports `app.services.extraction_pipeline.extract_for_discovery`
- **THEN** the function signature is `(file_path: Path, model_id: str) -> RawExtraction` and it returns the extraction result directly with no auxiliary fields

#### Scenario: Targeted extraction entrypoint exists
- **WHEN** a caller imports `app.services.extraction_pipeline.extract_for_entity`
- **THEN** the function signature is `(file_path: Path, model_id: str, entity_type: str, model_definition: dict) -> dict[str, Any]` and it returns a flat field-name to value mapping filtered to fields present in `model_definition[entity_type]`

#### Scenario: No alternative parse+extract entrypoints
- **WHEN** the codebase is searched for direct callers of `parser.parse_document`, `field_extractor.extract_fields`, or `processor.process_document`
- **THEN** no matches exist outside `extraction_pipeline.py`'s own internal helpers

### Requirement: Both entrypoints honor the parser backend setting
Each pipeline entrypoint SHALL consult `settings.parser_backend` and dispatch to the corresponding parsing backend (docling-local or claude-vision-merged) for PDF inputs.

#### Scenario: Discovery extraction with parser_backend=local
- **WHEN** `extract_for_discovery` is called with a PDF and `settings.parser_backend == "local"`
- **THEN** docling parses the file to text and `extract_entities` is called with the resulting text

#### Scenario: Discovery extraction with parser_backend=claude_merged
- **WHEN** `extract_for_discovery` is called with a PDF and `settings.parser_backend == "claude_merged"`
- **THEN** the PDF bytes are sent directly to a vision-capable LLM via `extract_entities_from_pdf` and no docling pipeline runs

#### Scenario: Targeted extraction with parser_backend=local
- **WHEN** `extract_for_entity` is called with a PDF and `settings.parser_backend == "local"`
- **THEN** docling parses the file to text and `extract_fields` is called with the resulting text and the model definition

#### Scenario: Targeted extraction with parser_backend=claude_merged
- **WHEN** `extract_for_entity` is called with a PDF and `settings.parser_backend == "claude_merged"`
- **THEN** the PDF bytes are sent directly to a vision-capable LLM via `extract_fields_from_pdf` and no docling pipeline runs

#### Scenario: DOCX inputs always use the docling path
- **WHEN** any pipeline entrypoint is called with a `.docx` file
- **THEN** docling parses the file to text and the text-based extractor (`extract_entities` or `extract_fields`) is called regardless of `parser_backend`

#### Scenario: TXT inputs always use direct file read
- **WHEN** any pipeline entrypoint is called with a `.txt` file
- **THEN** the file content is read directly without invoking docling, and the text-based extractor is called regardless of `parser_backend`

#### Scenario: Unknown parser_backend value
- **WHEN** any pipeline entrypoint is called with a PDF and `settings.parser_backend` is neither `"local"` nor `"claude_merged"`
- **THEN** a `ValueError` is raised with a message naming the unrecognized value and the supported values

### Requirement: Pipeline does not manage file lifecycle
The pipeline SHALL NOT delete, move, or rename the input file. It SHALL read the file at the path provided and return; the caller retains ownership of the file's lifecycle.

#### Scenario: Pipeline preserves the input file
- **WHEN** any pipeline entrypoint is called with a file at `<path>`
- **THEN** after the call returns, the file at `<path>` still exists with unchanged contents

### Requirement: Targeted output filters to known fields only
`extract_for_entity` SHALL filter the extractor output to fields whose names appear in the union of `model_definition[entity_type].base_fields` and `model_definition[entity_type].custom_fields`, and SHALL exclude fields whose extracted value is `None` or an empty string.

#### Scenario: Hallucinated field rejected
- **WHEN** the extractor returns a field name that is not present in `model_definition[entity_type]`
- **THEN** that field is omitted from the returned dict

#### Scenario: Empty value rejected
- **WHEN** the extractor returns a field with value `None` or `""`
- **THEN** that field is omitted from the returned dict

#### Scenario: Missing entity_type returns empty
- **WHEN** `extract_for_entity` is called with an `entity_type` not present in `model_definition`
- **THEN** the function returns `{}` without invoking the extractor or the LLM
