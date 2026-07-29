/**
 * Coerce a possibly-stringified value (e.g. "false"/"True"/"0"/"<unknown>" from
 * DataCore's query flattening) into a real boolean. Only explicit truthy tokens
 * are true; everything else — including "" / "false" / "no" / "0" / null — is
 * false, matching a bool field's default.
 */
export function toBool(value: unknown): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  if (typeof value === 'string') {
    const s = value.trim().toLowerCase();
    return s === 'true' || s === 'yes' || s === '1';
  }
  return false;
}
