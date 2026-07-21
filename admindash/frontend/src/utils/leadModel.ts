import type { ModelDefinition } from '../types/models.ts';
import { DEFAULT_LEAD_STAGES } from '../types/models.ts';

/**
 * Humanize a field name into a readable label.
 * e.g. "guardian_name" → "Guardian Name"
 */
export function formatFieldLabel(name: string): string {
  return name.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * Return the list of lead stages for a given ModelDefinition.
 * Looks for a field named "stage" (in base_fields then custom_fields) with
 * a non-empty options array. Falls back to DEFAULT_LEAD_STAGES if not found.
 */
export function leadStages(model: ModelDefinition | undefined | null): string[] {
  if (model) {
    const allFields = [...(model.base_fields ?? []), ...(model.custom_fields ?? [])];
    const stageField = allFields.find(
      (f) => f.name === 'stage' && Array.isArray(f.options) && f.options.length > 0,
    );
    if (stageField?.options) {
      return stageField.options;
    }
  }
  return [...DEFAULT_LEAD_STAGES];
}

/**
 * Build a ModelDefinition suitable for capture/edit forms by excluding
 * reserved internal fields (stage/source/converted_family_id/lead_id) from
 * both base_fields and custom_fields.
 *
 * When `model` is null, both field lists come back empty — callers should
 * detect that and fall back to their fixed hardcoded inputs.
 */
export function formModel(
  model: ModelDefinition | null,
  exclude: string[] = ['stage', 'source', 'converted_family_id', 'lead_id'],
): ModelDefinition {
  const keep = (f: { name: string }) => !exclude.includes(f.name);
  return {
    base_fields: (model?.base_fields ?? []).filter(keep),
    custom_fields: (model?.custom_fields ?? []).filter(keep),
  };
}
