"""AI extraction service using pydantic-ai."""
from pathlib import Path
from typing import Any

from app.models.domain import ENTITY_CLASSES
from app.models.extraction import RawExtraction
from pydantic_ai import Agent, BinaryContent


def _schema_context() -> str:
    """Generate schema descriptions from domain model classes for the AI prompt."""
    lines = []
    for name, cls in ENTITY_CLASSES.items():
        fields = {
            k: str(v.annotation)
            for k, v in cls.model_fields.items()
            if k != "custom_fields"
        }
        lines.append(f"{name}: {fields}")
    return "\n".join(lines)


SYSTEM_PROMPT = f"""You are a document analysis assistant for afterschool programs.
Extract structured data from the provided document into the entity types below.

Known entity schemas (field_name: type):
{_schema_context()}

Instructions:
- Extract ALL entities you can find in the document.
- Use the exact field names from the schemas when possible.
- For any attributes mentioned in the document that do NOT match a known schema field,
  include them anyway using descriptive snake_case keys. These will become custom fields.
- Do NOT invent data that is not in the document.
- Leave ID fields (tenant_id, student_id, etc.) as empty strings — they will be generated.
- Return the result as a structured object matching the RawExtraction schema.
"""


def extract_entities(text: str, model_id: str) -> RawExtraction:
    """Extract all entity types from document text using an AI agent."""
    agent = Agent(model_id, output_type=RawExtraction, system_prompt=SYSTEM_PROMPT)
    result = agent.run_sync(f"Extract entities from this document:\n\n{text}")
    return result.output


def extract_entities_from_pdf(file_path: Path, model_id: str) -> RawExtraction:
    """Extract entities directly from a PDF using a vision-capable LLM.

    Single-call alternative to docling parse + extract_entities. Sends the PDF
    bytes directly to the model so visual layout (tables, form-field labels) is
    preserved end-to-end. Used when settings.parser_backend == "claude_merged".

    The caller is responsible for ensuring `model_id` is a vision-capable model
    (Anthropic Claude or OpenAI GPT-4o family). Ollama and text-only models
    will fail at the model layer with a clear error.
    """
    agent = Agent(model_id, output_type=RawExtraction, system_prompt=SYSTEM_PROMPT)
    result = agent.run_sync(
        [
            "Extract entities from this document:",
            BinaryContent(data=file_path.read_bytes(), media_type="application/pdf"),
        ]
    )
    return result.output


# ─── Targeted field extraction (text-based) ───────────────────────


def _build_field_prompt(entity_type: str, all_fields: list[dict[str, Any]]) -> str:
    """Build an extraction prompt from the model's field definitions."""
    if not all_fields:
        return ""

    field_lines = []
    for f in all_fields:
        line = f"- {f['name']} ({f['type']})"
        if f.get("required"):
            line += " [required]"
        if f.get("options"):
            line += f" options: {f['options']}"
        field_lines.append(line)

    return (
        f"Extract the following {entity_type} fields from the document.\n"
        f"Return a JSON object with field names as keys and extracted values.\n"
        f"Only include fields where you find a clear value in the document.\n"
        f"OMIT any field whose value is not found — do NOT use placeholders "
        f"like '<unknown>', 'N/A', 'unknown', or empty strings.\n"
        f"Do NOT invent data.\n\n"
        f"Fields:\n" + "\n".join(field_lines)
    )


def _filter_extracted_fields(
    raw: dict[str, Any], all_fields: list[dict[str, Any]]
) -> dict[str, Any]:
    """Drop hallucinated keys, None values, and empty strings.

    A "known field" is any element of `all_fields` whose `"name"` matches a
    key in `raw`. `all_fields` is a list of field-definition dicts as stored
    in the model definition (each has at least a `"name"`).

    Note: falsy-but-meaningful values like 0 and False are preserved — only
    None and "" are filtered. Filter semantics inherited from the legacy
    field_extractor module (now consolidated here).
    """
    known_fields = {f["name"] for f in all_fields}
    return {
        k: v
        for k, v in raw.items()
        if v is not None and v != "" and k in known_fields
    }


def extract_fields(
    text: str,
    entity_type: str,
    model_definition: dict[str, Any],
    model_id: str,
) -> dict[str, Any]:
    """Extract field values from document text, guided by entity model definition.

    Returns a dict mapping field names to extracted values. Only fields with
    non-empty values are included, and only if they exist in the model
    definition (filters out hallucinated field keys). Returns empty dict if
    entity_type is not in model_definition.
    """
    entity_def = model_definition.get(entity_type)
    if not entity_def:
        return {}

    all_fields = entity_def.get("base_fields", []) + entity_def.get("custom_fields", [])
    prompt = _build_field_prompt(entity_type, all_fields)
    if not prompt:
        return {}

    agent = Agent(model_id, output_type=dict[str, Any], system_prompt=prompt)
    result = agent.run_sync(f"Extract fields from this document:\n\n{text}")
    return _filter_extracted_fields(result.output, all_fields)


def extract_fields_from_pdf(
    file_path: Path,
    entity_type: str,
    model_definition: dict[str, Any],
    model_id: str,
) -> dict[str, Any]:
    """Vision-based targeted field extraction.

    Sends the PDF bytes directly to a vision-capable LLM with a model-definition-
    driven prompt. Output schema and filtering match `extract_fields`.

    The caller is responsible for ensuring `model_id` is a vision-capable model
    (Anthropic Claude or OpenAI GPT-4o family). Ollama and text-only models
    will fail at the model layer with a clear error.
    """
    entity_def = model_definition.get(entity_type)
    if not entity_def:
        return {}

    all_fields = entity_def.get("base_fields", []) + entity_def.get("custom_fields", [])
    prompt = _build_field_prompt(entity_type, all_fields)
    if not prompt:
        return {}

    agent = Agent(model_id, output_type=dict[str, Any], system_prompt=prompt)
    result = agent.run_sync(
        [
            "Extract fields from this document:",
            BinaryContent(data=file_path.read_bytes(), media_type="application/pdf"),
        ]
    )
    return _filter_extracted_fields(result.output, all_fields)
