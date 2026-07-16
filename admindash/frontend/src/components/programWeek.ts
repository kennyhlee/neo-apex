/**
 * Pure helpers for bucketing programs into the days of a week.
 *
 * A "program" is a tenant-defined entity row (`Record<string, unknown>`). The
 * model definition declares which fields are dates; the first date field is the
 * program's start and the second (if any) its end. Programs may also carry a
 * `days_of_week` field constraining which weekdays they recur on.
 *
 * These helpers are shared by the Program page's week calendar and the home
 * page's weekly program overview so the two stay in sync.
 */

import type { ModelDefinition, ModelFieldDefinition } from '../types/models.ts';

export type ProgramRow = Record<string, unknown>;

/** Returns all date/datetime fields from the model definition, in order. */
export function getDateFields(model: ModelDefinition): ModelFieldDefinition[] {
  const all = [...model.base_fields, ...model.custom_fields];
  return all.filter((f) => f.type === 'date' || f.type === 'datetime');
}

/** Returns the Monday (00:00 local) of the week containing the given date. */
export function getWeekStart(date: Date): Date {
  const d = new Date(date);
  const day = d.getDay(); // 0=Sun, 1=Mon, …
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

/** The seven days (Mon–Sun) of the week containing `date`. */
export function getWeekDays(date: Date): Date[] {
  const start = getWeekStart(date);
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(start);
    d.setDate(d.getDate() + i);
    return d;
  });
}

/** Parses a string value to a Date, or returns null. Never throws. */
export function parseDateValue(value: unknown): Date | null {
  if (!value || typeof value !== 'string') return null;
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (match) {
    return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  }
  const d = new Date(value);
  return isNaN(d.getTime()) ? null : d;
}

/** Returns true if two dates fall on the same calendar day. */
export function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

/** Day name lookup: JS getDay() (0=Sun) → day name strings. */
const JS_DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/**
 * Parse a days_of_week field value into a Set of JS day indices (0=Sun..6=Sat).
 * Handles JSON arrays like '["Monday","Tuesday"]', comma-separated, or single
 * values. Returns null if no valid days found (meaning: show on all days).
 */
export function parseDaysOfWeek(value: unknown): Set<number> | null {
  if (value == null || value === '') return null;
  let dayNames: string[] = [];
  const s = String(value).trim();
  if (s.startsWith('[')) {
    try { dayNames = JSON.parse(s); } catch { dayNames = [s]; }
  } else {
    dayNames = s.split(',').map((d) => d.trim());
  }
  const indices = new Set<number>();
  for (const name of dayNames) {
    const idx = JS_DAY_NAMES.findIndex((d) => d.toLowerCase() === name.toLowerCase());
    if (idx >= 0) indices.add(idx);
  }
  return indices.size > 0 ? indices : null;
}

/** Returns true if date falls within [start, end] (inclusive, day-level). */
export function isInRange(date: Date, start: Date, end: Date): boolean {
  const d = date.getTime();
  const s = new Date(start); s.setHours(0, 0, 0, 0);
  const e = new Date(end); e.setHours(23, 59, 59, 999);
  return d >= s.getTime() && d <= e.getTime();
}

/**
 * Returns the programs that appear on `day`, given the model's start date field
 * and optional end date field. A program with an end date spans every day in
 * [start, end]; without one it appears only on its start day. A `days_of_week`
 * constraint further restricts which weekdays a program shows on.
 *
 * Each result carries the program's original index (useful for stable tinting).
 */
export function getProgramsForDay(
  programs: ProgramRow[],
  day: Date,
  startField: ModelFieldDefinition,
  endField: ModelFieldDefinition | null,
): Array<{ program: ProgramRow; index: number }> {
  const result: Array<{ program: ProgramRow; index: number }> = [];
  for (let i = 0; i < programs.length; i++) {
    const program = programs[i];
    const startDate = parseDateValue(program[startField.name]);
    if (!startDate) continue;

    const allowedDays = parseDaysOfWeek(program.days_of_week);
    if (allowedDays && !allowedDays.has(day.getDay())) continue;

    if (endField) {
      const endDate = parseDateValue(program[endField.name]);
      if (endDate) {
        if (isInRange(day, startDate, endDate)) {
          result.push({ program, index: i });
        }
        continue;
      }
    }

    if (isSameDay(day, startDate)) {
      result.push({ program, index: i });
    }
  }
  return result;
}
