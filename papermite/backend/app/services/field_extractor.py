"""Targeted field extraction from documents using AI, guided by model definitions."""
from typing import Any

from pydantic_ai import Agent


def _build_field_prompt(entity_type: str, all_fields: list) -> str:
    """Build an extraction prompt from the model's field definitions.

    Args:
        entity_type: The entity type being extracted
        all_fields: Combined list of base_fields and custom_fields

    Returns:
        Extraction prompt string, or empty string if all_fields is empty
    """
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
    Only fields with non-empty, non-None values are included, and only if they
    exist in the model definition (filters out hallucinated field keys).
    Returns empty dict if entity_type is not in model_definition.
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

    # Build set of known field names for validation
    known_fields = {f["name"] for f in all_fields}

    # Filter: exclude None/empty values and hallucinated field keys not in model definition
    return {
        k: v
        for k, v in result.output.items()
        if v is not None and v != "" and k in known_fields
    }
