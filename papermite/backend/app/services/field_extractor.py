"""Targeted field extraction from documents using AI, guided by model definitions."""
from typing import Any

from pydantic_ai import Agent


def _build_field_prompt(entity_type: str, model_definition: dict) -> str:
    """Build an extraction prompt from the model's field definitions."""
    entity_def = model_definition.get(entity_type)
    if not entity_def:
        return ""

    all_fields = entity_def.get("base_fields", []) + entity_def.get("custom_fields", [])
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
        f"Only include fields where you find a value in the document.\n"
        f"Do NOT invent data.\n\n"
        f"Fields:\n" + "\n".join(field_lines)
    )


def extract_fields(
    text: str,
    entity_type: str,
    model_definition: dict,
    model_id: str,
) -> dict[str, Any]:
    """Extract field values from document text, guided by entity model definition.

    Returns a dict mapping field names to extracted values.
    Only fields with non-empty, non-None values are included.
    Returns empty dict if entity_type is not in model_definition.
    """
    prompt = _build_field_prompt(entity_type, model_definition)
    if not prompt:
        return {}

    agent = Agent(model_id, output_type=dict[str, Any], system_prompt=prompt)
    result = agent.run_sync(f"Extract fields from this document:\n\n{text}")

    # Filter out None and empty-string values
    return {k: v for k, v in result.output.items() if v is not None and v != ""}
