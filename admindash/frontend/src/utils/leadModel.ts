import type { ModelDefinition } from '../types/models.ts';
import { DEFAULT_LEAD_STAGES } from '../types/models.ts';

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
