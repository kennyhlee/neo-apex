// workflow-forms/src/blockConfig.ts
import type { FlowField } from './types';

/** `snake_case` field name -> "Title Case" display label. Used by `StepRenderer.tsx`. */
export function labelOf(name: string): string {
  return name.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * The academic year straddling `now`, rolling over each July: `${y}-${y+1}`
 * where `y` is `now`'s year when the month is July or later, else the
 * previous year. `getMonth()` is 0-indexed, so `>= 6` IS July.
 *
 * Lives here so both channels derive the identical default: the staff New
 * Application form prefills it, the parent start page shows it read-only,
 * and familyhub-backend restates the same rule in Python
 * (`_school_year_for_date`, `familyhub/backend/app/api/registration.py`) --
 * a staff-side host restating it must match exactly (enrollx's
 * `engine.default_school_year` did, pre-Task-12).
 */
export function defaultSchoolYear(now: Date = new Date()): string {
  const y = now.getMonth() >= 6 ? now.getFullYear() : now.getFullYear() - 1;
  return `${y}-${y + 1}`;
}

/** A tenant model definition, as both hosts already hold it. */
export interface ModelFieldSource {
  base_fields: FlowField[];
  custom_fields: FlowField[];
}
