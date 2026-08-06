// Field-picker exclusion + model-required-field enforcement rules.
//
// Mirrors `apexflow/backend/app/workflows/validate.py`'s `ENGINE_OWNED_FIELDS`
// import (from `workflows/schema.py`, interface map §2i) and its
// `_is_link_or_id_field` helper (`validate.py:81-89`: any field name ending
// in `_id` — a model's own primary id AND the link fields the engine stamps
// at commit, e.g. `family_id` on `student`) — both classes are "never
// section-writable in practice" per that function's own docstring, so a
// section field picker must never offer them as choices, not merely reject
// them at publish time.
//
// `ENGINE_OWNED_FIELDS` itself (`workflows/schema.py:32-48`) is
// `workflow_instance`-scoped (instance_id, state, subject_refs, ...) and in
// practice never appears on an entity model's own field list — it is
// filtered here anyway as defense in depth, matching
// `_engine_owned_field_errors` (`validate.py:630-637`), which checks the
// same set against section field picks server-side.
import type { EntityModelDef, EntityModelField, FieldPick } from '../types/designer.ts';

export const ENGINE_OWNED_FIELDS: readonly string[] = [
  'instance_id',
  'workflow_instance_id',
  'definition_id',
  'definition_version',
  'state',
  'subject_refs',
  'context',
  'channel_started',
  'applicant_email',
  'token_version',
  'draft_data',
  'opened_at',
  'closed_at',
];

/** `{model}_id`-shaped fields — a model's own primary id and injected link
 * fields alike (`validate.py`'s `_is_link_or_id_field`, verbatim rule). */
function isLinkOrIdField(name: string): boolean {
  return name.endsWith('_id');
}

export function isPickableField(field: EntityModelField): boolean {
  return !ENGINE_OWNED_FIELDS.includes(field.name) && !isLinkOrIdField(field.name);
}

/** Every base+custom field of `model` a section may legally pick from,
 * base fields first (declaration order preserved within each group). */
export function pickableFields(model: EntityModelDef | undefined): EntityModelField[] {
  if (!model) return [];
  return [...model.base_fields, ...model.custom_fields].filter(isPickableField);
}

/**
 * Reconcile a section's current field picks against its model: every
 * pickable field the model marks `required` is force-included and
 * force-`required: true` (the "model-required fields auto-included and
 * un-loosenable" DECISION — task-7-brief.md) regardless of what the caller
 * passed in. Everything else in `fields` is preserved as-is (including
 * picks the caller already made for model-optional fields).
 *
 * Order: existing picks keep their original position; newly-forced
 * model-required fields not already present are appended at the end.
 */
export function syncModelRequiredFields(
  fields: FieldPick[],
  model: EntityModelDef | undefined,
): FieldPick[] {
  const requiredNames = new Set(pickableFields(model).filter((f) => f.required).map((f) => f.name));
  const byName = new Map(fields.map((f) => [f.name, f]));
  for (const name of requiredNames) {
    byName.set(name, { name, required: true });
  }
  return Array.from(byName.values());
}

/** True iff two `FieldPick[]` describe the same set of {name, required}
 * pairs, order-insensitive — used to skip a no-op `onChange` after syncing. */
export function sameFieldPicks(a: FieldPick[], b: FieldPick[]): boolean {
  if (a.length !== b.length) return false;
  const sort = (list: FieldPick[]) =>
    [...list].sort((x, y) => x.name.localeCompare(y.name)).map((f) => `${f.name}:${f.required}`);
  const sa = sort(a);
  const sb = sort(b);
  return sa.every((v, i) => v === sb[i]);
}
