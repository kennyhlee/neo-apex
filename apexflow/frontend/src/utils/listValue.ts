/**
 * Ported from admindash/frontend/src/utils/listValue.ts (interface map §1f,
 * StatusBadge's dependency). Normalises selection-field values that can
 * arrive as JSON arrays, Python-repr arrays, bare values, or plain strings.
 */

function stripQuotes(s: string): string {
  const t = s.trim();
  if (t.length >= 2 && ((t[0] === '"' && t.endsWith('"')) || (t[0] === "'" && t.endsWith("'")))) {
    return t.slice(1, -1);
  }
  return t;
}

/** Split a bracketed list body on commas that are not inside quotes. */
function splitParts(body: string): string[] {
  const parts: string[] = [];
  let current = '';
  let quote: string | null = null;

  for (const ch of body) {
    if (quote) {
      if (ch === quote) quote = null;
      else current += ch;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if (ch === ',') {
      parts.push(current);
      current = '';
      continue;
    }
    current += ch;
  }
  parts.push(current);

  return parts.map((p) => p.trim()).filter((p) => p.length > 0);
}

/** Normalise any of the shapes above into a list of plain values. */
export function toValues(raw: unknown): string[] {
  if (raw == null) return [];
  if (Array.isArray(raw)) {
    return raw.map((v) => stripQuotes(String(v))).filter((v) => v.length > 0);
  }

  const s = String(raw).trim();
  if (!s) return [];

  if (s.startsWith('[') && s.endsWith(']')) {
    try {
      const parsed: unknown = JSON.parse(s);
      if (Array.isArray(parsed)) {
        return parsed.map((v) => String(v)).filter((v) => v.length > 0);
      }
    } catch {
      /* not JSON — fall through to the tolerant parser */
    }
    return splitParts(s.slice(1, -1));
  }

  return [stripQuotes(s)];
}

/**
 * Display label for a selection value. Returns `fallback` when there is
 * nothing to show, so callers do not have to special-case empties.
 */
export function toLabel(raw: unknown, fallback = '—'): string {
  const values = toValues(raw);
  return values.length > 0 ? values.join(', ') : fallback;
}

/** Stable lookup key for tone maps: "On Leave" -> "on_leave". */
export function toToneKey(raw: unknown): string {
  return toLabel(raw, '').toLowerCase().trim().replace(/\s+/g, '_');
}
