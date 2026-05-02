// admindash/frontend/src/utils/csvParse.ts
import Papa from 'papaparse';
import type { CsvParseOutcome, CsvParseError } from '../types/bulkAdd.ts';
import { BULK_ADD_CSV_ROW_CAP } from '../config.ts';

export interface ParseCsvOptions {
  rowCap?: number;
}

export async function parseCsvForBulk(file: File, opts: ParseCsvOptions = {}): Promise<CsvParseOutcome> {
  const cap = opts.rowCap ?? BULK_ADD_CSV_ROW_CAP;

  const ext = file.name.split('.').pop()?.toLowerCase();
  if (ext !== 'csv') {
    return { ok: false, error: { kind: 'wrong_extension', message: `Expected .csv, got .${ext ?? '(none)'}` } };
  }

  const text = await file.text();
  if (text.trim() === '') {
    return { ok: false, error: { kind: 'no_rows', message: 'CSV file is empty' } };
  }

  const parsed = Papa.parse<Record<string, string>>(text, {
    header: true,
    skipEmptyLines: true,
  });

  if (parsed.errors.length > 0) {
    const first = parsed.errors[0];
    const err: CsvParseError = {
      kind: 'parse_error',
      message: `Row ${first.row != null ? first.row + 2 : '?'}: ${first.message}`,
    };
    return { ok: false, error: err };
  }

  const headers = parsed.meta.fields ?? [];
  if (headers.length === 0 || headers.every((h) => h.trim() === '')) {
    return { ok: false, error: { kind: 'no_header', message: 'CSV must include a header row' } };
  }

  const rows = parsed.data;
  if (rows.length === 0) {
    return { ok: false, error: { kind: 'no_rows', message: 'CSV has no data rows' } };
  }
  if (rows.length > cap) {
    return {
      ok: false,
      error: {
        kind: 'too_many_rows',
        message: `CSV has ${rows.length} data rows; the active cap is ${cap}. Split into smaller batches.`,
      },
    };
  }

  return { ok: true, result: { headers, rows } };
}
