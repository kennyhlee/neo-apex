/** Render an ISO timestamp for tables/timelines; em dash when absent. */
export function fmtDateTime(value: unknown): string {
  if (value == null || value === '') return '—';
  const d = new Date(String(value));
  return Number.isNaN(d.getTime()) ? String(value) : d.toLocaleString();
}

export function toBoolish(value: unknown): boolean {
  return value === true || value === 'true' || value === 'True' || value === 1;
}
