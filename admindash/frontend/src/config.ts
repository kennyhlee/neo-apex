import services from '../../../services.json';

function svcUrl(key: string): string {
  const svc = services.services[key as keyof typeof services.services];
  return `http://${svc.host}:${svc.port}`;
}

export const ADMINDASH_API_URL =
  import.meta.env.VITE_ADMINDASH_API_URL || svcUrl("admindash-backend");

function envInt(name: string, fallback: number): number {
  const raw = (import.meta.env as Record<string, string | undefined>)[name];
  if (raw == null || raw === '') return fallback;
  const n = parseInt(String(raw), 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/** Hard cap on number of files in a documents-mode batch. */
export const BULK_ADD_DOCUMENT_CAP = envInt('VITE_BULK_ADD_DOCUMENT_CAP', 50);

/** Hard cap on number of data rows in a CSV-mode batch (header excluded). */
export const BULK_ADD_CSV_ROW_CAP = envInt('VITE_BULK_ADD_CSV_ROW_CAP', 500);

/** Concurrency for all bulk-add fan-outs (extract, dup-check, create). */
export const BULK_ADD_CONCURRENCY = envInt('VITE_BULK_ADD_CONCURRENCY', 5);
