"""AI extraction service using pydantic-ai."""
from app.models.domain import ENTITY_CLASSES
from app.models.extraction import RawExtraction
from pydantic_ai import Agent


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
