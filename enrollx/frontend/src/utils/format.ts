/** Render an ISO timestamp for tables/timelines; em dash when absent. */
export function fmtDateTime(value: unknown): string {
  if (value == null || value === '') return '—';
  const d = new Date(String(value));
  return Number.isNaN(d.getTime()) ? String(value) : d.toLocaleString();
}

export function toBoolish(value: unknown): boolean {
  return value === true || value === 'true' || value === 'True' || value === 1;
}

/**
 * Translate a key built from RUNTIME data, falling back to a readable value
 * instead of the key itself.
 *
 * `useTranslation`'s `t` returns the raw key when a translation is missing
 * (`useTranslation.ts:25`). That is fine for literal keys — a missing one is a
 * bug to fix — but wrong whenever the key is assembled from a DataCore value
 * (a payment status, an activity type, a tenant-defined program status), since
 * the key set can never cover every value a tenant might write. Without this,
 * such a value renders as the literal string "paymentStatus.chargeback".
 */
export function translateOr(
  t: (key: string) => string, key: string, fallback: string,
): string {
  const out = t(key);
  return out === key ? fallback : out;
}
