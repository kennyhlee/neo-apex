// flow-runtime/src/sectionCompletion.ts
import type { FlowField, WorkflowDraft, WorkflowSectionDef } from './types';

export interface SectionProgress {
  /** How many REQUIRED fields the section has (per row, for repeats). */
  required: number;
  /** How many required answers are still missing (summed across rows). */
  remaining: number;
  done: boolean;
  /** True when the section has no required fields at all. */
  optional: boolean;
}

/**
 * `false` and `0` are ANSWERS. Only absent/blank values count as unanswered:
 * an unchecked required checkbox is a deliberate "no", which is also how the
 * backend's `as_bool` reads a flattened `"false"`.
 */
function isAnswered(value: unknown): boolean {
  if (value === undefined || value === null) return false;
  if (typeof value === 'string') return value.trim() !== '';
  if (Array.isArray(value)) return value.length > 0;
  return true;
}

/**
 * One section's progress, counting REQUIRED fields only.
 *
 * The single source of truth for both layouts' progress indicators (the
 * accordion pill and the rail dot), so the two can never disagree about
 * whether a section is finished.
 *
 * Draft keys follow the existing convention and are NOT re-invented here:
 * non-repeat values live flat at `"{section_id}.{field}"`, repeat rows live
 * at the bare `section_id` key as an array of per-field records
 * (`StepRenderer.tsx`'s SectionRenderer).
 */
export function sectionCompletion(
  section: WorkflowSectionDef,
  fields: FlowField[],
  draft: WorkflowDraft,
): SectionProgress {
  const required = fields.filter((f) => f.required);
  const base: SectionProgress = {
    required: required.length,
    remaining: 0,
    done: true,
    optional: required.length === 0,
  };
  if (required.length === 0) return base;

  if (!section.repeat) {
    const remaining = required.filter(
      (f) => !isAnswered(draft[`${section.section_id}.${f.name}`]),
    ).length;
    return { ...base, remaining, done: remaining === 0 };
  }

  const raw = draft[section.section_id];
  const rows: Record<string, unknown>[] = Array.isArray(raw)
    ? (raw as Record<string, unknown>[])
    : [];
  let remaining = 0;
  for (const row of rows) {
    remaining += required.filter((f) => !isAnswered(row[f.name])).length;
  }
  // Short of `min` rows, the missing rows are themselves outstanding work.
  const missingRows = Math.max(section.repeat.min - rows.length, 0);
  remaining += missingRows * required.length;
  return { ...base, remaining, done: remaining === 0 };
}
