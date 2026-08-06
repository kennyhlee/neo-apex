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
//
// Task review fix #1 (critical): a CONDITIONAL section (its owning step has
// a `show_if`) may not pick a model-required field unless the model also
// declares a `default` for it — `validate.py`'s `_coverage_errors`
// conditional branch (`:733-748`) checks `fdef.get("required")` (the
// MODEL's own flag, not the per-step `FieldPick.required` override) and
// only exempts it via `_is_exempt_field`'s `"default" in fdef` /
// `_is_link_or_id_field` checks — NOT via the committing-transition
// `set_entity_field` exemption also present there, which needs full machine
// analysis this section-level picker doesn't have. Mirroring only the
// default-based exemption is therefore intentionally the STRICTER
// subset of what the backend would ultimately accept — it can reject a
// pick a sufficiently-configured machine would actually allow, but it can
// never let through a pick the backend would reject. `pickableFields`'s
// `conditional` flag threads this rule through: an unconditional
// section keeps today's unrestricted "every non-engine-owned/id/link field"
// menu.
//
// Live-repro fix (browser-gate defect #1): the UNCONDITIONAL auto-include/
// lock path (`syncModelRequiredFields`, and `SectionPanel.tsx`'s `locked`)
// used to force-include+lock every model-`required` field with no
// exemption at all — including a required field that also declares a
// `default`, which `validate.py`'s `_is_exempt_field` (same function the
// conditional path already mirrors) exempts from the unconditional
// coverage rule too (`validate.py:718-731` calls the identical `exempt =
// _is_link_or_id_field(...) or "default" in fdef` check the conditional
// branch at `:742` uses via `_is_exempt_field`). A stale model-required
// field that later gained a default (e.g. `registration_application.status`)
// was therefore being silently force-added to every unconditional section's
// picks and shown to parents. `isModelRequiredNoDefault`, below, is now the
// single predicate both paths share for "auto-included+locked (uncondi-
// tional) / forbidden (conditional)" — a required-with-default field is
// exempt on both paths, ordinary-optional on both paths.
import type {
  EntityModelDef,
  EntityModelField,
  EntityModelsMap,
  FieldPick,
  WorkflowSectionDef,
} from '../types/designer.ts';

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

/** `"default" in fdef` equivalent — `validate.py`'s `_is_exempt_field`
 * treats any field with a declared default as exempt from the
 * required-field coverage rules, unconditional or conditional alike. */
function hasModelDefault(field: EntityModelField): boolean {
  return field.default !== undefined;
}

export function isPickableField(field: EntityModelField): boolean {
  return !ENGINE_OWNED_FIELDS.includes(field.name) && !isLinkOrIdField(field.name);
}

/**
 * A model-required field with NO declared default — `validate.py`'s
 * `_is_exempt_field` (`"default" in fdef`) exempts a required-with-default
 * field from coverage rules regardless of section shape, so this is the
 * single coverage-critical field class on both paths:
 *  - CONDITIONAL section: forbidden outright (`isForbiddenWhenConditional`,
 *    below — the conditional coverage rule, `validate.py:733-748`).
 *  - UNCONDITIONAL section: auto-included + locked (`syncModelRequiredFields`
 *    / `SectionPanel.tsx`'s `locked` — the unconditional coverage rule,
 *    `validate.py:718-731`).
 * A required-with-default field is, on EITHER path, a fully ordinary
 * optional-to-include field the author may pick manually as optional or
 * required — it is never auto-included/locked and never forbidden.
 */
export function isModelRequiredNoDefault(field: EntityModelField): boolean {
  return field.required && !hasModelDefault(field);
}

/** Alias of `isModelRequiredNoDefault` kept for call-site clarity at the
 * conditional-section forbidden-field check. */
export function isForbiddenWhenConditional(field: EntityModelField): boolean {
  return isModelRequiredNoDefault(field);
}

/**
 * Every base+custom field of `model` a section may legally pick from, base
 * fields first (declaration order preserved within each group).
 *
 * `conditional` (default `false`) is whether the OWNING STEP has a
 * `show_if` set — pass `true` from a section whose step is conditional to
 * additionally drop model-required/no-default fields per the module doc
 * comment's rule.
 */
export function pickableFields(
  model: EntityModelDef | undefined,
  conditional = false,
): EntityModelField[] {
  if (!model) return [];
  return [...model.base_fields, ...model.custom_fields].filter(
    (f) => isPickableField(f) && !(conditional && isForbiddenWhenConditional(f)),
  );
}

/**
 * Reconcile a section's current field picks against its model for an
 * UNCONDITIONAL section: every pickable field the model marks `required`
 * AND that has no declared default (`isModelRequiredNoDefault` — mirrors
 * `validate.py`'s `_is_exempt_field` "default" in fdef" exemption, which
 * applies to the unconditional coverage rule exactly as it does to the
 * conditional one) is force-included and force-`required: true` (the
 * "model-required fields auto-included and un-loosenable" DECISION —
 * task-7-brief.md) regardless of what the caller passed in. A
 * required-WITH-default field is left untouched here — same as any other
 * model-optional field, the author may include it manually as optional or
 * required, or leave it out. Everything else in `fields` is preserved
 * as-is (including picks the caller already made for model-optional
 * fields).
 *
 * NOT used for conditional sections — those never auto-include/lock
 * anything (a model-required-no-default field is forbidden outright, per
 * `isForbiddenWhenConditional`, and a required-with-default field is
 * treated as a fully ordinary optional field, per the task review fix).
 * Conditional sections use `dropForbiddenConditionalFields` instead, which
 * only ever REMOVES picks, never forces one in.
 *
 * Order: existing picks keep their original position; newly-forced
 * model-required-no-default fields not already present are appended at the
 * end.
 */
export function syncModelRequiredFields(
  fields: FieldPick[],
  model: EntityModelDef | undefined,
): FieldPick[] {
  const requiredNames = new Set(
    pickableFields(model).filter(isModelRequiredNoDefault).map((f) => f.name),
  );
  const byName = new Map(fields.map((f) => [f.name, f]));
  for (const name of requiredNames) {
    byName.set(name, { name, required: true });
  }
  return Array.from(byName.values());
}

/**
 * Strip any field pick that `pickableFields(model, true)` would no longer
 * offer — the picks a section must drop the moment its owning step becomes
 * conditional (or whenever the resolved model changes underneath an
 * already-conditional section). Pure/no side effects: callers decide what
 * to do with the dropped names (e.g. `StepEditor.tsx`'s show_if transition
 * handler surfaces them in a toast).
 */
export function dropForbiddenConditionalFields(
  fields: FieldPick[],
  model: EntityModelDef | undefined,
): { fields: FieldPick[]; dropped: FieldPick[] } {
  const allowed = new Set(pickableFields(model, true).map((f) => f.name));
  const kept: FieldPick[] = [];
  const dropped: FieldPick[] = [];
  for (const pick of fields) {
    (allowed.has(pick.name) ? kept : dropped).push(pick);
  }
  return { fields: kept, dropped };
}

/**
 * Same as `dropForbiddenConditionalFields`, applied across every section of
 * a (form-step-owned) section list at once — used both when a step's
 * `show_if` transitions from unset to set, and defensively whenever the
 * resolved model changes underneath an already-conditional section.
 */
export function dropForbiddenConditionalFieldsAcross(
  sections: WorkflowSectionDef[],
  models: EntityModelsMap,
): { sections: WorkflowSectionDef[]; dropped: string[] } {
  const dropped: string[] = [];
  const nextSections = sections.map((section) => {
    const model = models[section.entity_model];
    const { fields, dropped: sectionDropped } = dropForbiddenConditionalFields(section.fields, model);
    if (sectionDropped.length === 0) return section;
    dropped.push(...sectionDropped.map((f) => `${section.section_id}.${f.name}`));
    return { ...section, fields };
  });
  return { sections: nextSections, dropped };
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
