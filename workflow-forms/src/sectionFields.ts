// workflow-forms/src/sectionFields.ts
import type { FlowField, WorkflowSectionDef } from './types';
import type { ModelFieldSource } from './blockConfig';

/**
 * Resolve one workflow section's field picks against the entity model it
 * draws from, producing renderable `FlowField`s.
 *
 * `WorkflowSectionDef.fields` (`FieldPick[]`) carries only `name` and a
 * per-step `required` override (`workflows/schema.py`'s `FieldPick`,
 * `:176-178`, verbatim in `templates/enrollment.py`'s section builders,
 * e.g. `family_section`'s `primary_address` is required at the step even
 * though nothing in the model itself forces that) — type, options, default,
 * etc. live on the model's own field definition (`base_model.json`-shaped
 * `base_fields`/`custom_fields`, mirrored here as `ModelFieldSource`). This
 * function is the join: for each pick, find the matching model field by
 * name and stamp the PICK's `required` onto it — the step's own
 * requiredness is authoritative for what the renderer marks required,
 * exactly as `templates/enrollment.py`'s section dicts already assume.
 *
 * A pick naming a field absent from the model is skipped rather than
 * synthesized: the task-3 brief's own framing is that a step's field picks
 * already exclude engine-owned/id/link fields, so a miss here means a stale
 * pick against a model that has since dropped the field, not something
 * safe to guess a type for.
 */
export function sectionFields(
  section: WorkflowSectionDef,
  model: ModelFieldSource | undefined,
): FlowField[] {
  if (!model) return [];
  const byName = new Map<string, FlowField>();
  for (const f of model.base_fields) byName.set(f.name, f);
  for (const f of model.custom_fields) byName.set(f.name, f);

  const out: FlowField[] = [];
  for (const pick of section.fields) {
    const base = byName.get(pick.name);
    if (!base) continue;
    out.push({ ...base, required: pick.required });
  }
  return out;
}
