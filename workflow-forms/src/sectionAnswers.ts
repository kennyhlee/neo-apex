// workflow-forms/src/sectionAnswers.ts
//
// `WorkflowDraft` <-> `save_draft`'s `section_answers` converter. Hoisted
// here (Plan 3 Task 12) from familyhub-frontend's `api/facade.ts`, where
// Task 7 first built it — both channels need the identical mapping
// (`StepRenderer`'s flat, dotted-key `WorkflowDraft` is not the shape
// `engine.py::save_draft` expects, per the interface map's §4c derivation),
// and duplicating it per-channel risked the two silently drifting. Moved
// verbatim; familyhub's own copy now imports from here instead.
import type { WorkflowSectionDef, WorkflowStepDef } from './types';
import type { WorkflowDraft } from './StepRenderer';

function formSectionsOf(step: WorkflowStepDef): WorkflowSectionDef[] {
  const sections = step.config.sections;
  return Array.isArray(sections) ? (sections as WorkflowSectionDef[]) : [];
}

/**
 * Flatten a `WorkflowDraft` into `save_draft`'s `section_answers` shape.
 *
 * - Non-repeat section: one dict entry per declared field pick present in
 *   `draft` at its `"{section_id}.{field}"` key, collected into
 *   `{field_name: value}` and written to `section_answers[section_id]` --
 *   but ONLY if at least one field was actually present, so an untouched
 *   section is omitted rather than sent as `{}` (avoids clobbering
 *   already-saved answers for a section this particular draft snapshot
 *   never touched -- `save_draft` shallow-merges per section, but an empty
 *   dict is still a no-op either way; omitting keeps the wire payload
 *   honest about what changed).
 * - Repeat section: the WHOLE row array, copied straight across from the
 *   bare `section_id` key, only when it actually IS an array (matches
 *   `save_draft`'s REPLACE semantics for repeat sections -- a dict-shaped
 *   or missing value here would 400).
 *
 * Deliberately NEVER emits a `context.*` key or a `"{step_id}.ack"` key --
 * both are structurally impossible to produce since this only ever reads
 * keys shaped from a REAL section's `section_id`/field-pick names, never
 * pattern-matches `draft`'s own keys the way `buildConditionData` guards
 * against having to (`engine.py` would 400 either one as an undeclared
 * `section_id` regardless).
 */
export function draftToSectionAnswers(
  steps: WorkflowStepDef[],
  draft: WorkflowDraft,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const step of steps) {
    if (step.type !== 'form') continue;
    for (const section of formSectionsOf(step)) {
      if (!section.repeat) {
        const entry: Record<string, unknown> = {};
        for (const pick of section.fields) {
          const key = `${section.section_id}.${pick.name}`;
          if (Object.prototype.hasOwnProperty.call(draft, key)) {
            entry[pick.name] = draft[key];
          }
        }
        if (Object.keys(entry).length > 0) out[section.section_id] = entry;
      } else {
        const rows = draft[section.section_id];
        if (Array.isArray(rows)) out[section.section_id] = rows;
      }
    }
  }
  return out;
}

/**
 * The literal inverse of `draftToSectionAnswers` -- hydrate a fetched
 * instance's `draft_data` (already `JSON.parse`d into `section_answers`'s
 * nested shape) into a flat `WorkflowDraft` `StepRenderer` can consume.
 *
 * - Non-repeat section: spread `saved[section_id]`'s entries out to
 *   `"{section_id}.{field}"` keys.
 * - Repeat section: copy `saved[section_id]` straight across to the bare
 *   `section_id` key, unchanged.
 *
 * A `section_id` declared in `steps` but absent from `saved` (nothing
 * answered yet) simply contributes no keys -- not an error.
 */
export function sectionAnswersToDraft(
  steps: WorkflowStepDef[],
  saved: Record<string, unknown>,
): WorkflowDraft {
  const out: WorkflowDraft = {};
  for (const step of steps) {
    if (step.type !== 'form') continue;
    for (const section of formSectionsOf(step)) {
      const value = saved[section.section_id];
      if (value === undefined) continue;
      if (!section.repeat) {
        if (value && typeof value === 'object' && !Array.isArray(value)) {
          for (const [field, v] of Object.entries(value as Record<string, unknown>)) {
            out[`${section.section_id}.${field}`] = v;
          }
        }
      } else if (Array.isArray(value)) {
        out[section.section_id] = value;
      }
    }
  }
  return out;
}
