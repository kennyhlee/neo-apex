// admindash/frontend/src/types/bulkAdd.ts
import type { ModelDefinition } from './models.ts';

export type BatchMode = 'documents' | 'csv';

export type RowStatus =
  | 'extracting'
  | 'extract_failed'
  | 'ready'
  | 'has_errors'
  | 'pending'
  | 'creating'
  | 'created'
  | 'failed';

export interface RowError {
  message: string;
  source: 'extract' | 'create' | 'dup_check' | 'validation';
}

export interface BulkRow {
  id: string;
  source: string;
  file?: File;
  values: Record<string, unknown>;
  status: RowStatus;
  error?: RowError;
  dupCheckSkipped?: boolean;
  duplicateMatches?: import('./models.ts').DuplicateMatch[];
  assignedStudentId?: string;
}

export type ColumnMapping = Record<number, string>;

export const SKIP_FIELD = '__skip__';

export interface BatchDraft {
  id: string;
  tenantId: string;
  batchId: string;
  mode: BatchMode;
  rows: BulkRow[];
  columnMapping?: ColumnMapping;
  createdAt: string;
  updatedAt: string;
}

export interface DraftModelSnapshot {
  baseFieldNames: string[];
  customFieldNames: string[];
}

export type Phase =
  | 'mode_select'
  | 'uploading'
  | 'mapping'
  | 'extracting'
  | 'review'
  | 'submitting'
  | 'post_submit';

export interface ResumeOption {
  draft: BatchDraft;
  rowCount: number;
  lastEditedISO: string;
}

export interface ExtractResult {
  file: File;
  rowId: string;
  fields?: Record<string, string>;
  error?: RowError;
}

export interface CsvParseResult {
  headers: string[];
  rows: Record<string, string>[];
}

export interface CsvParseError {
  kind: 'no_header' | 'no_rows' | 'too_many_rows' | 'parse_error' | 'wrong_extension';
  message: string;
}

export type CsvParseOutcome =
  | { ok: true; result: CsvParseResult }
  | { ok: false; error: CsvParseError };

export type DupCheckEligibility =
  | { eligible: true }
  | { eligible: false; missingFields: string[] };

export function newRowId(): string {
  return `row_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

export function newBatchId(): string {
  return `batch_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

export type { ModelDefinition };
