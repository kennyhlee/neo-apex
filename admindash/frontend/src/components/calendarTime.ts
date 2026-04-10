/**
 * Pure helpers for parsing and formatting calendar time values.
 *
 * The Program model stores times in separate `start_time` / `end_time`
 * string fields (e.g. "09:00:00" from Python `datetime.time`, or values
 * like "9:30 AM" from AI extraction). These helpers read those strings
 * directly and format them as compact labels for the calendar chip.
 *
 * Date fields are intentionally not consulted — the chip's position in
 * the calendar already conveys which day it belongs to.
 */

interface ParsedTime {
  h: number;
  m: number;
}

/**
 * Parse a loose time string into { h, m }, or return null.
 *
 * Accepts:
 *  - `"HH:MM"` or `"HH:MM:SS"` or `"HH:MM:SS.ffffff"` (24-hour)
 *  - `"H:MM AM"` / `"H:MM PM"` / `"Ham"` / `"Hpm"` (12-hour)
 *
 * Never throws.
 */
function parseTimeString(value: unknown): ParsedTime | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string') return null;
  const s = value.trim();
  if (s === '') return null;

  const match = s.match(
    /^(\d{1,2})(?::(\d{2}))?(?::\d{2})?(?:\.\d+)?\s*([AaPp])\.?[Mm]?\.?$/,
  ) ?? s.match(/^(\d{1,2}):(\d{2})(?::\d{2})?(?:\.\d+)?$/);
  if (!match) return null;

  let h = Number(match[1]);
  const m = match[2] !== undefined ? Number(match[2]) : 0;
  const ap = match[3]?.toLowerCase();

  if (ap === 'p') {
    if (h < 12) h += 12;
  } else if (ap === 'a') {
    if (h === 12) h = 0;
  }

  if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
  if (h < 0 || h > 23 || m < 0 || m > 59) return null;
  return { h, m };
}

interface FormattedTime {
  text: string;
  meridiem: 'a' | 'p';
}

function formatSingleTime({ h, m }: ParsedTime): FormattedTime {
  const meridiem: 'a' | 'p' = h < 12 ? 'a' : 'p';
  let h12 = h % 12;
  if (h12 === 0) h12 = 12;
  const minutePart = m === 0 ? '' : `:${String(m).padStart(2, '0')}`;
  return { text: `${h12}${minutePart}`, meridiem };
}

/**
 * Format a pair of time-string values as a compact chip label.
 *
 * Examples:
 *  - start "09:00:00", end null         → "9a"
 *  - start "09:00:00", end "10:30:00"   → "9\u201310:30a"  (shared meridiem)
 *  - start "11:00:00", end "13:00:00"   → "11a\u20131p"    (crosses meridiem)
 *  - start unset                         → ""               (no time shown)
 *
 * Uses Unicode en-dash (U+2013) as the range separator.
 * Never throws.
 */
export function formatTimeRangeFromStrings(
  startValue: unknown,
  endValue: unknown,
): string {
  try {
    const start = parseTimeString(startValue);
    if (!start) return '';
    const startFmt = formatSingleTime(start);

    const end = parseTimeString(endValue);
    if (!end) {
      return `${startFmt.text}${startFmt.meridiem}`;
    }
    const endFmt = formatSingleTime(end);

    if (startFmt.meridiem === endFmt.meridiem) {
      return `${startFmt.text}\u2013${endFmt.text}${endFmt.meridiem}`;
    }
    return `${startFmt.text}${startFmt.meridiem}\u2013${endFmt.text}${endFmt.meridiem}`;
  } catch {
    return '';
  }
}
