"""AI extraction service using pydantic-ai."""
from pathlib import Path

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

    Single-call alternative to parse_document + extract_entities. Sends the PDF
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
