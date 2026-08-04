// flow-runtime/src/money.ts
/** Format integer cents as a currency string ("$1,234.50"). */
export function formatCents(cents: number | undefined | null): string {
  if (typeof cents !== 'number' || Number.isNaN(cents)) return '—';
  return new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD' }).format(cents / 100);
}
