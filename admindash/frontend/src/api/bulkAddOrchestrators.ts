// admindash/frontend/src/api/bulkAddOrchestrators.ts
import { ADMINDASH_API_URL, BULK_ADD_CONCURRENCY } from '../config.ts';
import type {
  CreateEntityResponse,
  DuplicateCheckRequest,
  DuplicateCheckResponse,
  ExtractResponse,
} from '../types/models.ts';
import type {
  BulkRow,
  DupCheckEligibility,
  ExtractResult,
  RowError,
} from '../types/bulkAdd.ts';
import { runBounded } from '../utils/boundedParallel.ts';
import { parseDetailError } from '../utils/parseDetail.ts';

const TOKEN_KEY = 'neoapex_token';
function authHeaders(): Record<string, string> {
  const t = localStorage.getItem(TOKEN_KEY);
  return t ? { Authorization: `Bearer ${t}` } : {};
}

/** Hard-coded fields the duplicate-check API requires. */
export const DUP_CHECK_FIELDS = ['first_name', 'last_name', 'dob', 'primary_address'] as const;

export function dupCheckEligibility(row: BulkRow): DupCheckEligibility {
  const missing: string[] = [];
  for (const f of DUP_CHECK_FIELDS) {
    const v = row.values[f];
    if (v == null || String(v).trim() === '') missing.push(f);
  }
  return missing.length === 0
    ? { eligible: true }
    : { eligible: false, missingFields: missing };
}

async function extractOne(tenantId: string, file: File): Promise<Record<string, string>> {
  const fd = new FormData();
  fd.append('file', file);
  const resp = await fetch(`${ADMINDASH_API_URL}/api/extract/${tenantId}/student`, {
    method: 'POST',
    headers: authHeaders(),
    body: fd,
  });
  if (!resp.ok) throw new Error(await parseDetailError(resp));
  const data = (await resp.json()) as ExtractResponse;
  return data.fields;
}

export interface ExtractBatchOptions {
  tenantId: string;
  files: { rowId: string; file: File }[];
  onRowResult?: (rowId: string, result: ExtractResult) => void;
  signal?: AbortSignal;
}

export async function extractStudentBatch(opts: ExtractBatchOptions): Promise<ExtractResult[]> {
  const items = opts.files;
  const results = await runBounded<{ rowId: string; file: File }, ExtractResult>(
    items,
    async (item) => {
      try {
        const fields = await extractOne(opts.tenantId, item.file);
        const out: ExtractResult = { file: item.file, rowId: item.rowId, fields };
        opts.onRowResult?.(item.rowId, out);
        return out;
      } catch (e) {
        const err: RowError = {
          source: 'extract',
          message: e instanceof Error ? e.message : String(e),
        };
        const out: ExtractResult = { file: item.file, rowId: item.rowId, error: err };
        opts.onRowResult?.(item.rowId, out);
        return out;
      }
    },
    { concurrency: BULK_ADD_CONCURRENCY, signal: opts.signal },
  );
  return results.filter((r): r is ExtractResult => !(r instanceof Error));
}

async function dupCheckOne(tenantId: string, body: DuplicateCheckRequest): Promise<DuplicateCheckResponse> {
  const resp = await fetch(`${ADMINDASH_API_URL}/api/entities/${tenantId}/student/duplicate-check`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify(body),
  });
  if (!resp.ok) throw new Error(await parseDetailError(resp));
  return resp.json();
}

export type DupCheckOutcome =
  | { rowId: string; kind: 'eligible_match'; matches: DuplicateCheckResponse['matches'] }
  | { rowId: string; kind: 'eligible_clean' }
  | { rowId: string; kind: 'skipped'; missingFields: string[] }
  | { rowId: string; kind: 'failed'; error: string };

export interface BulkDupCheckOptions {
  tenantId: string;
  rows: BulkRow[];
  signal?: AbortSignal;
}

export async function bulkCheckDuplicates(opts: BulkDupCheckOptions): Promise<DupCheckOutcome[]> {
  const eligible: BulkRow[] = [];
  const skipped: DupCheckOutcome[] = [];

  for (const row of opts.rows) {
    const e = dupCheckEligibility(row);
    if (e.eligible) {
      eligible.push(row);
    } else {
      skipped.push({ rowId: row.id, kind: 'skipped', missingFields: e.missingFields ?? [] });
    }
  }

  const results = await runBounded<BulkRow, DupCheckOutcome>(
    eligible,
    async (row): Promise<DupCheckOutcome> => {
      try {
        const body: DuplicateCheckRequest = {
          first_name: String(row.values.first_name ?? ''),
          last_name: String(row.values.last_name ?? ''),
          dob: String(row.values.dob ?? ''),
          primary_address: String(row.values.primary_address ?? ''),
        };
        const resp = await dupCheckOne(opts.tenantId, body);
        return resp.matches.length > 0
          ? { rowId: row.id, kind: 'eligible_match', matches: resp.matches }
          : { rowId: row.id, kind: 'eligible_clean' };
      } catch (e) {
        return {
          rowId: row.id,
          kind: 'failed',
          error: e instanceof Error ? e.message : String(e),
        };
      }
    },
    { concurrency: BULK_ADD_CONCURRENCY, signal: opts.signal },
  );

  return [
    ...skipped,
    ...results.filter((r): r is DupCheckOutcome => !(r instanceof Error)),
  ];
}

async function createOne(
  tenantId: string,
  baseData: Record<string, unknown>,
  customFields: Record<string, unknown>,
): Promise<CreateEntityResponse> {
  const resp = await fetch(`${ADMINDASH_API_URL}/api/entities/${tenantId}/student`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ base_data: baseData, custom_fields: customFields }),
  });
  if (!resp.ok) throw new Error(await parseDetailError(resp));
  return resp.json();
}

export interface CreatePayload {
  rowId: string;
  baseData: Record<string, unknown>;
  customFields: Record<string, unknown>;
}

export type CreateOutcome =
  | { rowId: string; kind: 'created'; assignedStudentId: string }
  | { rowId: string; kind: 'failed'; error: string };

export interface BulkCreateOptions {
  tenantId: string;
  payloads: CreatePayload[];
  onRowResult?: (rowId: string, outcome: CreateOutcome) => void;
}

export async function bulkCreateStudents(opts: BulkCreateOptions): Promise<CreateOutcome[]> {
  const results = await runBounded<CreatePayload, CreateOutcome>(
    opts.payloads,
    async (p): Promise<CreateOutcome> => {
      try {
        const resp = await createOne(opts.tenantId, p.baseData, p.customFields);
        const studentIdValue = resp.base_data['student_id'];
        const studentId =
          typeof studentIdValue === 'string' ? studentIdValue : resp.entity_id;
        const out: CreateOutcome = { rowId: p.rowId, kind: 'created', assignedStudentId: studentId };
        opts.onRowResult?.(p.rowId, out);
        return out;
      } catch (e) {
        const out: CreateOutcome = {
          rowId: p.rowId,
          kind: 'failed',
          error: e instanceof Error ? e.message : String(e),
        };
        opts.onRowResult?.(p.rowId, out);
        return out;
      }
    },
    { concurrency: BULK_ADD_CONCURRENCY },
  );
  return results.filter((r): r is CreateOutcome => !(r instanceof Error));
}
