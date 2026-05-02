# Bulk Student Upload — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a dedicated bulk-add page to AdminDash that lets school admins ingest up to 50 application documents or 500 CSV rows in a single sitting — extracting via Papermite, reviewing in a table, and best-effort creating with retry-on-failure.

**Architecture:** Pure additive frontend feature in `admindash/frontend`. New route `/students/bulk-add` with a phase state machine (`mode_select | uploading | mapping | extracting | review | submitting | post_submit`). Composes existing API endpoints (`/api/extract/...`, `/api/entities/.../duplicate-check`, `/api/entities/...`, `/api/config/models`) via bounded-parallel fan-out (5 concurrent default). Side-drawer review reuses the existing `DynamicForm` component. Hybrid IndexedDB persistence kicks in once review phase begins. No backend changes.

**Tech stack:** React 19 + TypeScript 5.9 + Vite 8, react-router-dom v7, native Fetch API, custom CSS variables (no CSS-in-JS). New deps: `papaparse` (CSV parsing) and `idb` (IndexedDB wrapper, matching Papermite's version).

**Source of truth:** OpenSpec change at `admindash/openspec/changes/bulk-student-upload/`. Read `proposal.md`, `design.md`, `specs/bulk-student-intake/spec.md`, `tasks.md` first if you have context budget. The plan below maps to the tasks.md sections 1–13 with full code, commands, and commit boundaries.

**Testing reality:** AdminDash frontend has **no test framework configured** (per `admindash/CLAUDE.md`). Verification gates per task are: `npm run lint` (ESLint), `npm run build` (which runs `tsc -b` + Vite bundle), and manual smoke tests at the end of each phase. Treat "tests pass" in TDD-style steps as "type check + build + lint pass." A test framework is out of scope here.

**Working directory for all bash commands:** `/Users/kennylee/Development/NeoApex/admindash/frontend` unless explicitly stated otherwise.

---

## File Structure

### New files

| Path | Responsibility |
|------|----------------|
| `src/types/bulkAdd.ts` | Batch state types: `BulkRow`, `RowStatus`, `BatchMode`, `BatchDraft`, `ColumnMapping`, `RowError`. |
| `src/utils/boundedParallel.ts` | `runBounded<T,R>(items, fn, opts)` Promise-queue helper. |
| `src/utils/parseDetail.ts` | `parseDetailError(resp)` reads FastAPI `{detail: "..."}` body → string error. |
| `src/utils/validateField.ts` | Extracted copy of `DynamicForm`'s field validator, shared between gate + form. |
| `src/utils/csvParse.ts` | `parseCsvForBulk(file, opts)` wrapping `papaparse` with header + cap validation. |
| `src/utils/csvMapping.ts` | `autoMatchColumns(headers, modelDef)`, `applyMapping(rows, mapping, modelDef)`. |
| `src/db/bulkAddDrafts.ts` | IndexedDB CRUD for batch drafts. |
| `src/api/bulkAddOrchestrators.ts` | `extractStudentBatch`, `bulkCheckDuplicates`, `bulkCreateStudents` using `runBounded`. |
| `src/pages/BulkAddStudentsPage.tsx` + `.css` | Top-level page component with phase state machine. |
| `src/components/BulkModeSelector.tsx` + `.css` | Empty-state mode picker (Documents / CSV). |
| `src/components/BulkDocumentDropzone.tsx` + `.css` | Multi-file dropzone for documents mode. |
| `src/components/BulkCsvDropzone.tsx` + `.css` | Single-file CSV dropzone. |
| `src/components/CsvMappingStep.tsx` + `.css` | CSV column → model field mapping UI. |
| `src/components/BulkReviewTable.tsx` + `.css` | Read-only summary table. |
| `src/components/BulkRowDrawer.tsx` + `.css` | Side drawer with `DynamicForm`, prev/next, dirty-discard prompt. |
| `src/components/PreSubmitGate.tsx` + `.css` | Modal gate with Ready / Missing / Duplicates / Skipped sections. |
| `src/components/PostSubmitSummary.tsx` + `.css` | Header card with success/failure counts + actions. |
| `src/components/CreatedStudentsDisclosure.tsx` + `.css` | Collapsed list of created students with IDs. |
| `src/components/ResumeBatchPrompt.tsx` + `.css` | Modal prompted on page mount when drafts exist. |
| `src/components/ExtractionProgressBar.tsx` + `.css` | Header chip during extraction phase. |

### Modified files

| Path | What changes |
|------|--------------|
| `package.json` | Add `papaparse`, `@types/papaparse`, `idb` deps. |
| `src/config.ts` | Export `BULK_ADD_DOCUMENT_CAP`, `BULK_ADD_CSV_ROW_CAP`, `BULK_ADD_CONCURRENCY`. |
| `src/App.tsx` | Register `/students/bulk-add` route inside the authenticated route group. |
| `src/pages/StudentsPage.tsx` | Add secondary "Bulk add" button. |
| `src/i18n/translations.ts` | Add `bulkAdd.*` flat translation keys for `en-US` + `zh-CN`. |

### Read-only references (no edits)

- `src/components/DynamicForm.tsx` — reused from inside `BulkRowDrawer` with `key={row.id}`.
- `src/components/AddStudentModal.tsx` — pattern reference (e.g., line 89 strips `student_id`).
- `src/contexts/ModelContext.tsx` — `useModel()` for fetching the active model.
- `papermite/frontend/src/db/indexedDb.ts` — pattern reference for `idb` usage.

---

## Phase / Commit Map

Each phase produces one commit unless noted. Commits use `feat(admindash):` / `chore(admindash):` / `refactor(admindash):` prefix matching repo convention.

| Phase | Tasks | Commit |
|-------|-------|--------|
| 1. Foundation | 1.1–1.5 | `chore(admindash): scaffold bulk-add deps, types, utils, config` |
| 2. API helpers | 2.1–2.5 | `feat(admindash): add bulk-add orchestrators and CSV utilities` |
| 3. Page scaffold + routing | 3.1–3.4 | `feat(admindash): scaffold bulk-add page and route` |
| 4. Mode selection + uploaders | 4.1–4.3 | `feat(admindash): bulk-add mode selector and dropzones` |
| 5. CSV mapping step | 5.1–5.3 | `feat(admindash): bulk-add CSV column mapping` |
| 6. Documents extraction | 6.1–6.3 | `feat(admindash): bulk-add extraction phase with retry` |
| 7. Review table + drawer | 7.1–7.4 | `feat(admindash): bulk-add review table and side drawer` |
| 8. IndexedDB persistence | 8.1–8.5 | `feat(admindash): bulk-add IndexedDB persistence and resume` |
| 9. Pre-submit gate + submit | 9.1–9.6 | `feat(admindash): bulk-add pre-submit gate and create fan-out` |
| 10. Post-submit + retry | 10.1–10.6 | `feat(admindash): bulk-add post-submit and retry-failed loop` |
| 11. Cancel / discard | 11.1–11.2 | `feat(admindash): bulk-add cancel and discard semantics` |
| 12. i18n | 12.1–12.2 | `feat(admindash): bulk-add translations en-US + zh-CN` |
| 13. Verification | 13.1–13.13 | (no commit — verification only) |

---

## Phase 1 — Foundation

### Task 1.1: Add dependencies

**Files:**
- Modify: `admindash/frontend/package.json`

- [ ] **Step 1: Install runtime + type deps**

```bash
cd /Users/kennylee/Development/NeoApex/admindash/frontend
npm install papaparse@^5.4.1 idb@^8.0.3
npm install --save-dev @types/papaparse@^5.3.14
```

- [ ] **Step 2: Verify package.json contains all three new entries**

Run: `grep -E '"papaparse"|"@types/papaparse"|"idb"' package.json`

Expected output (versions may differ slightly):
```
    "idb": "^8.0.3",
    "papaparse": "^5.4.1",
    "@types/papaparse": "^5.3.14",
```

(No commit yet — bundles with the rest of Phase 1.)

---

### Task 1.2: Define batch-state types

**Files:**
- Create: `admindash/frontend/src/types/bulkAdd.ts`

- [ ] **Step 1: Write the file**

```ts
// admindash/frontend/src/types/bulkAdd.ts
import type { ModelDefinition } from './models.ts';

export type BatchMode = 'documents' | 'csv';

export type RowStatus =
  | 'extracting'         // documents mode, extract in flight
  | 'extract_failed'     // documents mode, extract errored
  | 'ready'              // values populated, no errors
  | 'has_errors'         // values populated, validation errors present
  | 'pending'            // queued for create fan-out
  | 'creating'           // create call in flight
  | 'created'            // create succeeded
  | 'failed';            // create failed

export interface RowError {
  /** Human-readable error message (parsed from FastAPI detail when possible). */
  message: string;
  /** Source of the error: 'extract' | 'create' | 'dup_check' | 'validation'. */
  source: 'extract' | 'create' | 'dup_check' | 'validation';
}

export interface BulkRow {
  /** Stable client-side identifier — used as React `key` and IndexedDB row identity. */
  id: string;
  /** Display source: filename for documents mode, "CSV row N" for CSV mode. */
  source: string;
  /** Documents mode only: kept in memory for `Retry extract`. Not persisted. */
  file?: File;
  /** Field values (base + custom flattened, mirrors DynamicForm's value shape). */
  values: Record<string, unknown>;
  status: RowStatus;
  /** Last error attached to this row, if any. */
  error?: RowError;
  /** Set on documents-mode rows when the dup-check eligibility fields are missing. */
  dupCheckSkipped?: boolean;
  /** Set on rows whose dup-check returned matches; populated in the gate. */
  duplicateMatches?: import('./models.ts').DuplicateMatch[];
  /** Backend-assigned student ID after successful create. */
  assignedStudentId?: string;
}

/** Mapping of CSV column index → model field name (or '__skip__'). */
export type ColumnMapping = Record<number, string>;

export const SKIP_FIELD = '__skip__';

export interface BatchDraft {
  /** `${tenantId}:${batchId}` — IndexedDB keyPath. */
  id: string;
  tenantId: string;
  batchId: string;
  mode: BatchMode;
  rows: BulkRow[];
  columnMapping?: ColumnMapping;
  /** ISO timestamp. */
  createdAt: string;
  updatedAt: string;
}

/** Snapshot of the model used at draft time, for stale-model detection on resume. */
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

/** Result shape returned from the extraction orchestrator (one entry per file). */
export interface ExtractResult {
  file: File;
  rowId: string;
  fields?: Record<string, string>;
  error?: RowError;
}

/** Result of CSV parse before mapping. */
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

/** Eligibility verdict for one row going into dup-check. */
export interface DupCheckEligibility {
  eligible: boolean;
  /** Reason if not eligible: list of missing fields. */
  missingFields?: string[];
}

/** Convenience constructor used by extraction + mapping. */
export function newRowId(): string {
  // Random + timestamp; collision-safe enough for in-page state.
  return `row_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

export function newBatchId(): string {
  return `batch_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

/** Re-export ModelDefinition so consumers don't have to import it from types/models. */
export type { ModelDefinition };
```

- [ ] **Step 2: Verify the file type-checks**

Run from `admindash/`: `cd /Users/kennylee/Development/NeoApex/admindash && cd frontend && npx tsc -b --noEmit`
Expected: PASS with no errors.

(No commit yet — bundles with the rest of Phase 1.)

---

### Task 1.3: Concurrency utility

**Files:**
- Create: `admindash/frontend/src/utils/boundedParallel.ts`

- [ ] **Step 1: Write the file**

```ts
// admindash/frontend/src/utils/boundedParallel.ts

export interface RunBoundedOptions<T, R> {
  /** Maximum number of in-flight calls. Must be >= 1. */
  concurrency: number;
  /** Optional callback fired when each item resolves (success or failure). */
  onProgress?: (item: T, result: R | Error, index: number) => void;
  /** Optional abort signal — items not yet started are skipped. In-flight items are NOT cancelled. */
  signal?: AbortSignal;
}

/**
 * Run `fn` over `items` with at most `concurrency` calls in flight.
 * Returns results in the same order as the input.
 *
 * On individual failures, the rejection is captured per-item and the
 * overall promise still resolves — the caller decides how to handle errors
 * via inspecting the result array. We use this for best-effort fan-outs
 * (extract, dup-check, create) where partial success is the design.
 *
 * Aborted items resolve to a synthetic Error('aborted'); they are NOT skipped
 * silently because the caller needs to know which slots were skipped.
 */
export async function runBounded<T, R>(
  items: T[],
  fn: (item: T, index: number) => Promise<R>,
  opts: RunBoundedOptions<T, R>,
): Promise<(R | Error)[]> {
  const concurrency = Math.max(1, Math.floor(opts.concurrency));
  const results: (R | Error)[] = new Array(items.length);
  let nextIndex = 0;

  async function worker() {
    while (true) {
      const i = nextIndex++;
      if (i >= items.length) return;
      if (opts.signal?.aborted) {
        const err = new Error('aborted');
        results[i] = err;
        opts.onProgress?.(items[i], err, i);
        continue;
      }
      try {
        const r = await fn(items[i], i);
        results[i] = r;
        opts.onProgress?.(items[i], r, i);
      } catch (e) {
        const err = e instanceof Error ? e : new Error(String(e));
        results[i] = err;
        opts.onProgress?.(items[i], err, i);
      }
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, items.length) }, () => worker());
  await Promise.all(workers);
  return results;
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc -b --noEmit`
Expected: PASS.

(No commit yet.)

---

### Task 1.4: IndexedDB module for batch drafts

**Files:**
- Create: `admindash/frontend/src/db/bulkAddDrafts.ts`
- Read-only reference: `papermite/frontend/src/db/indexedDb.ts`

- [ ] **Step 1: Write the file**

```ts
// admindash/frontend/src/db/bulkAddDrafts.ts
import { openDB, type IDBPDatabase } from 'idb';
import type { BatchDraft } from '../types/bulkAdd.ts';

const DB_NAME = 'admindash';
const STORE = 'bulk_add_drafts';
const DB_VERSION = 1;

interface AdmindashDb {
  bulk_add_drafts: {
    key: string;
    value: BatchDraft;
    indexes: { tenantId: string };
  };
}

let dbPromise: Promise<IDBPDatabase<AdmindashDb>> | null = null;

function getDb(): Promise<IDBPDatabase<AdmindashDb>> {
  if (!dbPromise) {
    dbPromise = openDB<AdmindashDb>(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains(STORE)) {
          const store = db.createObjectStore(STORE, { keyPath: 'id' });
          store.createIndex('tenantId', 'tenantId', { unique: false });
        }
      },
    });
  }
  return dbPromise;
}

export async function saveDraft(draft: BatchDraft): Promise<void> {
  const db = await getDb();
  await db.put(STORE, draft);
}

export async function loadDraft(id: string): Promise<BatchDraft | undefined> {
  const db = await getDb();
  return db.get(STORE, id);
}

/** Returns drafts for the tenant sorted by `updatedAt` descending (most recent first). */
export async function findActiveDraftsForTenant(tenantId: string): Promise<BatchDraft[]> {
  const db = await getDb();
  const all = await db.getAllFromIndex(STORE, 'tenantId', tenantId);
  return all.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function deleteDraft(id: string): Promise<void> {
  const db = await getDb();
  await db.delete(STORE, id);
}

export async function deleteDraftsForTenant(tenantId: string, exceptId?: string): Promise<void> {
  const db = await getDb();
  const all = await db.getAllFromIndex(STORE, 'tenantId', tenantId);
  await Promise.all(
    all
      .filter((d) => d.id !== exceptId)
      .map((d) => db.delete(STORE, d.id)),
  );
}

export function buildDraftId(tenantId: string, batchId: string): string {
  return `${tenantId}:${batchId}`;
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc -b --noEmit`
Expected: PASS. (`idb` types resolved via the package's bundled `.d.ts`.)

(No commit yet.)

---

### Task 1.5: Config constants for caps and concurrency

**Files:**
- Modify: `admindash/frontend/src/config.ts`

- [ ] **Step 1: Read current file**

Current contents of `src/config.ts`:
```ts
import services from '../../../services.json';

function svcUrl(key: string): string {
  const svc = services.services[key as keyof typeof services.services];
  return `http://${svc.host}:${svc.port}`;
}

export const ADMINDASH_API_URL =
  import.meta.env.VITE_ADMINDASH_API_URL || svcUrl("admindash-backend");
```

- [ ] **Step 2: Append the bulk-add constants**

Add to the end of `src/config.ts`:

```ts
function envInt(name: string, fallback: number): number {
  const raw = import.meta.env[name as keyof ImportMetaEnv];
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
```

- [ ] **Step 3: Type-check**

Run: `npx tsc -b --noEmit`
Expected: PASS. (`import.meta.env[...]` indexed access requires `vite/client` types — already configured by Vite default.)

If there's a type error about `import.meta.env`, change the lookup to: `(import.meta.env as Record<string, string | undefined>)[name]`.

- [ ] **Step 4: Commit Phase 1**

```bash
cd /Users/kennylee/Development/NeoApex
git add admindash/frontend/package.json admindash/frontend/package-lock.json \
  admindash/frontend/src/types/bulkAdd.ts \
  admindash/frontend/src/utils/boundedParallel.ts \
  admindash/frontend/src/db/bulkAddDrafts.ts \
  admindash/frontend/src/config.ts
git commit -m "$(cat <<'EOF'
chore(admindash): scaffold bulk-add deps, types, utils, config

Adds papaparse, @types/papaparse, and idb deps. Introduces batch-state
types (BulkRow, BatchDraft, RowStatus, ...), the bounded-parallel
fan-out helper, the IndexedDB module for batch drafts, and the three
build-time configurable constants (BULK_ADD_DOCUMENT_CAP,
BULK_ADD_CSV_ROW_CAP, BULK_ADD_CONCURRENCY).

Refs admindash/openspec/changes/bulk-student-upload/.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Phase 2 — API helpers (orchestrators, CSV, mapping)

### Task 2.1: Detail-parsing error wrapper

**Files:**
- Create: `admindash/frontend/src/utils/parseDetail.ts`

- [ ] **Step 1: Write the file**

```ts
// admindash/frontend/src/utils/parseDetail.ts

/**
 * Parse FastAPI's `{detail: "..."}` body from a Response, falling back
 * to `HTTP <status>` when the body is missing/unparseable. Always returns
 * a non-empty string.
 *
 * Use this whenever the bulk orchestrators surface a row-level failure —
 * the existing api/client.ts helpers throw bare HTTP-status errors which
 * are not actionable in the review table's Issues column.
 */
export async function parseDetailError(resp: Response): Promise<string> {
  try {
    const text = await resp.text();
    if (!text) return `HTTP ${resp.status}`;
    try {
      const parsed = JSON.parse(text) as unknown;
      if (
        parsed &&
        typeof parsed === 'object' &&
        'detail' in parsed &&
        typeof (parsed as { detail: unknown }).detail === 'string'
      ) {
        const detail = (parsed as { detail: string }).detail.trim();
        if (detail) return detail;
      }
    } catch {
      /* not JSON — fall through */
    }
    // Plain text body — surface a trimmed snippet up to 200 chars.
    const snippet = text.trim().slice(0, 200);
    return snippet || `HTTP ${resp.status}`;
  } catch {
    return `HTTP ${resp.status}`;
  }
}

/** Thin wrapper used inside orchestrators: throws Error(parsedDetail) on non-OK. */
export async function fetchOrThrow(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const resp = await fetch(input, init);
  if (!resp.ok) {
    const detail = await parseDetailError(resp);
    throw new Error(detail);
  }
  return resp;
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc -b --noEmit`
Expected: PASS.

---

### Task 2.2: Bulk orchestrators (extract / dup-check / create)

**Files:**
- Create: `admindash/frontend/src/api/bulkAddOrchestrators.ts`
- Read-only reference: `admindash/frontend/src/api/client.ts:72-150`

- [ ] **Step 1: Write the file**

```ts
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
  // runBounded returns (R | Error)[] — but our fn always returns R.
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
```

- [ ] **Step 2: Type-check**

Run: `npx tsc -b --noEmit`
Expected: PASS.

---

### Task 2.3: CSV parse helper

**Files:**
- Create: `admindash/frontend/src/utils/csvParse.ts`

- [ ] **Step 1: Write the file**

```ts
// admindash/frontend/src/utils/csvParse.ts
import Papa from 'papaparse';
import type { CsvParseOutcome, CsvParseError } from '../types/bulkAdd.ts';
import { BULK_ADD_CSV_ROW_CAP } from '../config.ts';

export interface ParseCsvOptions {
  /** Override the active row cap (used by tests / forced rejections). */
  rowCap?: number;
}

/**
 * Parse a CSV file with header validation and a hard row cap.
 *
 * Rules (mirror spec.md "CSV-mode batch caps and structural validation"):
 *   - file must end in .csv
 *   - first row must be a header row (we treat any row 0 as headers)
 *   - row count <= rowCap (data rows, excluding header)
 *   - at least 1 data row
 *
 * Returns a typed outcome — never throws.
 */
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
```

- [ ] **Step 2: Type-check**

Run: `npx tsc -b --noEmit`
Expected: PASS.

---

### Task 2.4: CSV column mapping helper

**Files:**
- Create: `admindash/frontend/src/utils/csvMapping.ts`

- [ ] **Step 1: Write the file**

```ts
// admindash/frontend/src/utils/csvMapping.ts
import type { ModelDefinition, ModelFieldDefinition } from '../types/models.ts';
import type { ColumnMapping } from '../types/bulkAdd.ts';
import { SKIP_FIELD } from '../types/bulkAdd.ts';

function normalize(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

/** Auto-match CSV headers (in order) against base + custom field names. */
export function autoMatchColumns(headers: string[], modelDef: ModelDefinition): ColumnMapping {
  const allFields: ModelFieldDefinition[] = [
    ...modelDef.base_fields,
    ...modelDef.custom_fields,
  ];
  const fieldByNorm = new Map<string, string>();
  for (const f of allFields) fieldByNorm.set(normalize(f.name), f.name);

  const mapping: ColumnMapping = {};
  for (let i = 0; i < headers.length; i++) {
    const norm = normalize(headers[i]);
    const matched = fieldByNorm.get(norm);
    mapping[i] = matched ?? SKIP_FIELD;
  }
  return mapping;
}

/** Names of required base fields not yet mapped to any column. */
export function unmappedRequiredFields(mapping: ColumnMapping, modelDef: ModelDefinition): string[] {
  const mappedNames = new Set(Object.values(mapping).filter((n) => n !== SKIP_FIELD));
  return modelDef.base_fields
    .filter((f) => f.required && !mappedNames.has(f.name))
    .map((f) => f.name);
}

/**
 * Apply a column mapping to parsed CSV rows.
 *
 * - Cells mapped to selection+multiple fields are split on ';' and trimmed.
 * - Cells mapped to other fields are passed through as the raw string.
 * - Skipped columns are dropped.
 */
export function applyMapping(
  rows: Record<string, string>[],
  headers: string[],
  mapping: ColumnMapping,
  modelDef: ModelDefinition,
): Record<string, unknown>[] {
  const fieldDefByName = new Map<string, ModelFieldDefinition>();
  for (const f of [...modelDef.base_fields, ...modelDef.custom_fields]) {
    fieldDefByName.set(f.name, f);
  }

  return rows.map((row) => {
    const out: Record<string, unknown> = {};
    for (let i = 0; i < headers.length; i++) {
      const target = mapping[i];
      if (target == null || target === SKIP_FIELD) continue;
      const raw = row[headers[i]] ?? '';
      const def = fieldDefByName.get(target);
      if (def?.type === 'selection' && def.multiple) {
        out[target] = raw
          .split(';')
          .map((t) => t.trim())
          .filter((t) => t !== '');
      } else {
        out[target] = raw;
      }
    }
    return out;
  });
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc -b --noEmit`
Expected: PASS.

---

### Task 2.5: Extract `validateField` for shared use

**Files:**
- Create: `admindash/frontend/src/utils/validateField.ts`
- Read-only reference: `admindash/frontend/src/components/DynamicForm.tsx:17-47`

The gate needs to validate rows against required-field rules using the same logic the form uses. Rather than duplicating, copy the function into a shared util and update DynamicForm to import it later (Phase 9).

- [ ] **Step 1: Write the shared util**

```ts
// admindash/frontend/src/utils/validateField.ts
import type { ModelFieldDefinition } from '../types/models.ts';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_RE = /^[+]?[\d\s\-().]{7,}$/;

/**
 * Validate a single field against its definition. Mirrors the logic that
 * `DynamicForm` enforces (see DynamicForm.tsx:20). Returns null when valid,
 * a short error message otherwise.
 */
export function validateField(field: ModelFieldDefinition, value: unknown): string | null {
  const strValue = value != null ? String(value) : '';
  const isEmpty = strValue.trim() === '';

  if (field.type === 'bool') return null;
  if (field.type === 'selection' && field.multiple) {
    const arr = Array.isArray(value) ? value : [];
    if (field.required && arr.length === 0) return 'Required';
    return null;
  }

  if (field.required && isEmpty) return 'Required';
  if (isEmpty) return null;

  switch (field.type) {
    case 'number':
      if (isNaN(Number(strValue))) return 'Must be a number';
      break;
    case 'email':
      if (!EMAIL_RE.test(strValue)) return 'Invalid email';
      break;
    case 'phone':
      if (!PHONE_RE.test(strValue)) return 'Invalid phone number';
      break;
  }
  return null;
}

/**
 * Run validateField across every base + custom field in a model and a
 * row's values. Returns a map of fieldName -> error message (only entries
 * with errors are present).
 */
export function validateRowAgainstModel(
  values: Record<string, unknown>,
  modelDef: { base_fields: ModelFieldDefinition[]; custom_fields: ModelFieldDefinition[] },
): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const field of [...modelDef.base_fields, ...modelDef.custom_fields]) {
    const e = validateField(field, values[field.name]);
    if (e) errors[field.name] = e;
  }
  return errors;
}
```

- [ ] **Step 2: Refactor `DynamicForm` to import the shared util**

Open `admindash/frontend/src/components/DynamicForm.tsx`. Find the local `validateField` function (lines 17-47) and `EMAIL_RE`/`PHONE_RE` (lines 17-18). Replace with an import.

Change:
```ts
import type { ModelFieldDefinition, ModelDefinition } from '../types/models.ts';
import { useTranslation } from '../hooks/useTranslation.ts';
import './DynamicForm.css';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_RE = /^[+]?[\d\s\-().]{7,}$/;

function validateField(field: ModelFieldDefinition, value: unknown): string | null {
  // ...the existing 30 lines...
}
```

To:
```ts
import type { ModelFieldDefinition, ModelDefinition } from '../types/models.ts';
import { useTranslation } from '../hooks/useTranslation.ts';
import { validateField } from '../utils/validateField.ts';
import './DynamicForm.css';
```

(Delete the local `EMAIL_RE`, `PHONE_RE`, and `validateField` definitions.)

- [ ] **Step 3: Type-check + lint**

Run:
```
npx tsc -b --noEmit
npm run lint
```
Expected: both pass. The single-add modal continues working unchanged because behaviour is identical.

- [ ] **Step 4: Commit Phase 2**

```bash
cd /Users/kennylee/Development/NeoApex
git add admindash/frontend/src/utils/parseDetail.ts \
  admindash/frontend/src/utils/csvParse.ts \
  admindash/frontend/src/utils/csvMapping.ts \
  admindash/frontend/src/utils/validateField.ts \
  admindash/frontend/src/api/bulkAddOrchestrators.ts \
  admindash/frontend/src/components/DynamicForm.tsx
git commit -m "$(cat <<'EOF'
feat(admindash): add bulk-add orchestrators and CSV utilities

Adds parseDetailError + fetchOrThrow, the three orchestrators
(extractStudentBatch, bulkCheckDuplicates, bulkCreateStudents) all
running through runBounded with BULK_ADD_CONCURRENCY, the CSV parse
helper (header + cap validation), the column-mapping helper
(auto-match + apply with multi-select split-on-semicolon), and
extracts validateField from DynamicForm into a shared util so the
pre-submit gate can reuse the same field-validation logic.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Phase 3 — Page scaffold and routing

### Task 3.1: Bulk-add page skeleton

**Files:**
- Create: `admindash/frontend/src/pages/BulkAddStudentsPage.tsx`
- Create: `admindash/frontend/src/pages/BulkAddStudentsPage.css`

The page is a controlled state machine. Subsequent phases plug components in. This commit lands a working empty page (mode-select state) plus the no-active-model error path.

- [ ] **Step 1: Write the skeleton**

```tsx
// admindash/frontend/src/pages/BulkAddStudentsPage.tsx
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useModel } from '../contexts/ModelContext.tsx';
import { useTranslation } from '../hooks/useTranslation.ts';
import type { Phase, BulkRow, BatchMode, ColumnMapping } from '../types/bulkAdd.ts';
import { newBatchId } from '../types/bulkAdd.ts';
import type { ModelDefinition } from '../types/models.ts';
import './BulkAddStudentsPage.css';

interface BulkAddStudentsPageProps {
  tenant: string;
}

export default function BulkAddStudentsPage({ tenant }: BulkAddStudentsPageProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { getModel } = useModel();

  const [modelDef, setModelDef] = useState<ModelDefinition | null>(null);
  const [modelError, setModelError] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>('mode_select');
  const [mode, setMode] = useState<BatchMode | null>(null);
  const [batchId] = useState<string>(() => newBatchId());
  const [rows, setRows] = useState<BulkRow[]>([]);
  const [columnMapping, setColumnMapping] = useState<ColumnMapping | null>(null);

  // Fetch active model on mount; if missing, render the error state.
  useEffect(() => {
    let cancelled = false;
    getModel(tenant, 'student')
      .then((def) => {
        if (!cancelled) setModelDef(def);
      })
      .catch((e: unknown) => {
        if (!cancelled) setModelError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      cancelled = true;
    };
  }, [tenant, getModel]);

  if (modelError != null) {
    return (
      <div className="bulk-add-page bulk-add-page--error">
        <h1>{t('bulkAdd.title')}</h1>
        <div className="bulk-add-page__no-model">
          <p>{t('bulkAdd.noModelConfigured')}</p>
          <button
            className="bulk-add-page__btn-primary"
            onClick={() => navigate('/students')}
          >
            {t('bulkAdd.backToStudents')}
          </button>
        </div>
      </div>
    );
  }

  if (modelDef == null) {
    return (
      <div className="bulk-add-page">
        <h1>{t('bulkAdd.title')}</h1>
        <p>{t('common.loading')}</p>
      </div>
    );
  }

  return (
    <div className="bulk-add-page">
      <header className="bulk-add-page__header">
        <h1>{t('bulkAdd.title')}</h1>
        <button
          className="bulk-add-page__btn-secondary"
          onClick={() => navigate('/students')}
        >
          {t('common.cancel')}
        </button>
      </header>

      {phase === 'mode_select' && (
        <div className="bulk-add-page__mode-select-placeholder">
          {/* BulkModeSelector lands in Phase 4 */}
          <p>{t('bulkAdd.modeSelectPrompt')}</p>
        </div>
      )}
      {/* Other phases land in Phase 4–10. */}

      {/* Suppress unused-var warnings while phases land incrementally. */}
      <div hidden>
        {String(mode)} {String(batchId)} {String(rows.length)} {String(columnMapping)}
        {/* setters used by later phases */}
        {String(setMode)} {String(setRows)} {String(setColumnMapping)} {String(setPhase)}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Write the CSS**

```css
/* admindash/frontend/src/pages/BulkAddStudentsPage.css */
.bulk-add-page {
  padding: 24px 32px;
  max-width: 1400px;
  margin: 0 auto;
}

.bulk-add-page__header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 24px;
}

.bulk-add-page__header h1 {
  font-size: 24px;
  font-weight: 600;
  margin: 0;
}

.bulk-add-page__btn-primary,
.bulk-add-page__btn-secondary {
  padding: 8px 16px;
  border-radius: 6px;
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  border: 1px solid var(--color-border, #d1d5db);
}

.bulk-add-page__btn-primary {
  background: var(--color-primary, #2563eb);
  color: white;
  border-color: var(--color-primary, #2563eb);
}

.bulk-add-page__btn-secondary {
  background: var(--color-bg, white);
  color: var(--color-text, #111827);
}

.bulk-add-page--error .bulk-add-page__no-model {
  background: var(--color-bg-subtle, #f9fafb);
  border-radius: 8px;
  padding: 32px;
  text-align: center;
  color: var(--color-text-muted, #6b7280);
}
```

- [ ] **Step 3: Type-check**

Run: `npx tsc -b --noEmit`
Expected: PASS. (The temporary `<div hidden>{...}</div>` keeps unused state references quiet; later phases clean it up.)

---

### Task 3.2: Register the route

**Files:**
- Modify: `admindash/frontend/src/App.tsx`

- [ ] **Step 1: Add the import and route**

Find `App.tsx` and locate the `Routes` block inside the authenticated branch. Currently:
```tsx
import StudentsPage from './pages/StudentsPage.tsx';
```
Add (after the StudentsPage import):
```tsx
import BulkAddStudentsPage from './pages/BulkAddStudentsPage.tsx';
```

In the inner `<Routes>` block, add the route immediately after the `/students` route:
```tsx
<Route
  path="/students/bulk-add"
  element={<BulkAddStudentsPage tenant={tenant} />}
/>
```

The full snippet for context:
```tsx
<Route path="/home" element={<HomePage tenant={tenant} />} />
<Route
  path="/students"
  element={<StudentsPage tenant={tenant} />}
/>
<Route
  path="/students/bulk-add"
  element={<BulkAddStudentsPage tenant={tenant} />}
/>
<Route path="/leads" element={<LeadPage />} />
```

- [ ] **Step 2: Verify the route resolves**

Run: `npx tsc -b --noEmit`
Expected: PASS.

---

### Task 3.3: Add the StudentsPage entry button

**Files:**
- Modify: `admindash/frontend/src/pages/StudentsPage.tsx`

- [ ] **Step 1: Locate the existing "Add Student" button**

The existing primary button is at `StudentsPage.tsx:517` (or thereabouts):
```tsx
<button className="students-toolbar-primary" onClick={() => setShowAddModal(true)}>
```

- [ ] **Step 2: Add the secondary button next to it**

Insert immediately after the closing `</button>` of the primary "Add Student" button:
```tsx
<button
  className="students-toolbar-secondary"
  onClick={() => navigate('/students/bulk-add')}
>
  {t('bulkAdd.entryButton')}
</button>
```

If `navigate` is not yet imported in `StudentsPage.tsx`, add to the top:
```tsx
import { useNavigate } from 'react-router-dom';
```

And inside the component:
```tsx
const navigate = useNavigate();
```

- [ ] **Step 3: Add the matching CSS class**

Append to `StudentsPage.css`:
```css
.students-toolbar-secondary {
  margin-left: 8px;
  padding: 8px 16px;
  border-radius: 6px;
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  background: transparent;
  color: var(--color-primary, #2563eb);
  border: 1px solid var(--color-primary, #2563eb);
}

.students-toolbar-secondary:hover {
  background: var(--color-primary-subtle, #eff6ff);
}
```

- [ ] **Step 4: Type-check + lint**

```
npx tsc -b --noEmit
npm run lint
```
Expected: both pass.

---

### Task 3.4: Commit Phase 3

- [ ] **Step 1: Commit**

```bash
cd /Users/kennylee/Development/NeoApex
git add admindash/frontend/src/pages/BulkAddStudentsPage.tsx \
  admindash/frontend/src/pages/BulkAddStudentsPage.css \
  admindash/frontend/src/App.tsx \
  admindash/frontend/src/pages/StudentsPage.tsx \
  admindash/frontend/src/pages/StudentsPage.css
git commit -m "$(cat <<'EOF'
feat(admindash): scaffold bulk-add page and route

Adds the BulkAddStudentsPage skeleton with phase state machine and the
no-active-model error path, registers the /students/bulk-add route in
App.tsx, and adds a secondary "Bulk add" button on StudentsPage next
to the existing "Add Student" primary button.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Phase 4 — Mode selection and uploaders

### Task 4.1: BulkModeSelector

**Files:**
- Create: `admindash/frontend/src/components/BulkModeSelector.tsx`
- Create: `admindash/frontend/src/components/BulkModeSelector.css`

- [ ] **Step 1: Write the component**

```tsx
// admindash/frontend/src/components/BulkModeSelector.tsx
import { useTranslation } from '../hooks/useTranslation.ts';
import type { BatchMode } from '../types/bulkAdd.ts';
import './BulkModeSelector.css';

interface Props {
  onPick: (mode: BatchMode) => void;
}

export default function BulkModeSelector({ onPick }: Props) {
  const { t } = useTranslation();
  return (
    <div className="bulk-mode-selector">
      <button
        type="button"
        className="bulk-mode-card"
        onClick={() => onPick('documents')}
      >
        <h3>{t('bulkAdd.modeSelect.documents')}</h3>
        <p>{t('bulkAdd.modeSelect.documentsDesc')}</p>
      </button>
      <button
        type="button"
        className="bulk-mode-card"
        onClick={() => onPick('csv')}
      >
        <h3>{t('bulkAdd.modeSelect.csv')}</h3>
        <p>{t('bulkAdd.modeSelect.csvDesc')}</p>
      </button>
    </div>
  );
}
```

- [ ] **Step 2: Write the CSS**

```css
/* admindash/frontend/src/components/BulkModeSelector.css */
.bulk-mode-selector {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px;
  max-width: 800px;
  margin: 32px 0;
}

.bulk-mode-card {
  padding: 24px;
  border-radius: 8px;
  border: 1px solid var(--color-border, #d1d5db);
  background: white;
  text-align: left;
  cursor: pointer;
  transition: border-color 120ms, box-shadow 120ms;
}

.bulk-mode-card:hover {
  border-color: var(--color-primary, #2563eb);
  box-shadow: 0 2px 8px rgba(37, 99, 235, 0.1);
}

.bulk-mode-card h3 {
  font-size: 16px;
  margin: 0 0 8px 0;
}

.bulk-mode-card p {
  font-size: 14px;
  color: var(--color-text-muted, #6b7280);
  margin: 0;
}
```

- [ ] **Step 3: Wire into the page**

Modify `BulkAddStudentsPage.tsx`. Replace the `mode_select` placeholder with:

```tsx
import BulkModeSelector from '../components/BulkModeSelector.tsx';
// ...
{phase === 'mode_select' && (
  <BulkModeSelector
    onPick={(picked) => {
      setMode(picked);
      setPhase('uploading');
    }}
  />
)}
```

(Drop the temporary `<div hidden>...</div>` no-op references — by the end of this phase the values are all used.)

- [ ] **Step 4: Type-check**

Run: `npx tsc -b --noEmit`
Expected: PASS.

---

### Task 4.2: BulkDocumentDropzone

**Files:**
- Create: `admindash/frontend/src/components/BulkDocumentDropzone.tsx`
- Create: `admindash/frontend/src/components/BulkDocumentDropzone.css`

- [ ] **Step 1: Write the component**

```tsx
// admindash/frontend/src/components/BulkDocumentDropzone.tsx
import { useRef, useState } from 'react';
import { BULK_ADD_DOCUMENT_CAP } from '../config.ts';
import { useTranslation } from '../hooks/useTranslation.ts';
import './BulkDocumentDropzone.css';

const ACCEPTED_EXTS = ['.pdf', '.docx', '.txt'];

interface Props {
  onSelect: (files: File[]) => void;
  onCancel: () => void;
}

export default function BulkDocumentDropzone({ onSelect, onCancel }: Props) {
  const { t } = useTranslation();
  const inputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);

  const validateAndPick = (files: File[]) => {
    setError(null);
    if (files.length === 0) return;
    if (files.length > BULK_ADD_DOCUMENT_CAP) {
      setError(
        t('bulkAdd.errors.tooManyDocuments').replace('{cap}', String(BULK_ADD_DOCUMENT_CAP)),
      );
      return;
    }
    const valid: File[] = [];
    const invalid: string[] = [];
    for (const f of files) {
      const ext = '.' + (f.name.split('.').pop()?.toLowerCase() ?? '');
      if (ACCEPTED_EXTS.includes(ext)) valid.push(f);
      else invalid.push(f.name);
    }
    if (invalid.length > 0) {
      setError(t('bulkAdd.errors.unsupportedFiles').replace('{names}', invalid.join(', ')));
    }
    if (valid.length > 0) onSelect(valid);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    validateAndPick(Array.from(e.dataTransfer.files));
  };

  return (
    <div className="bulk-doc-dropzone-wrapper">
      <div
        className={`bulk-doc-dropzone ${dragging ? 'bulk-doc-dropzone--dragging' : ''}`}
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={handleDrop}
        onClick={() => inputRef.current?.click()}
      >
        <input
          ref={inputRef}
          type="file"
          multiple
          accept={ACCEPTED_EXTS.join(',')}
          style={{ display: 'none' }}
          onChange={(e) => validateAndPick(Array.from(e.target.files ?? []))}
        />
        <p className="bulk-doc-dropzone__title">{t('bulkAdd.dropzone.docsTitle')}</p>
        <p className="bulk-doc-dropzone__hint">
          {t('bulkAdd.dropzone.docsHint').replace('{cap}', String(BULK_ADD_DOCUMENT_CAP))}
        </p>
      </div>
      {error && <div className="bulk-doc-dropzone__error">{error}</div>}
      <div className="bulk-doc-dropzone__actions">
        <button type="button" onClick={onCancel}>
          {t('common.cancel')}
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Write the CSS**

```css
/* admindash/frontend/src/components/BulkDocumentDropzone.css */
.bulk-doc-dropzone-wrapper { max-width: 800px; }

.bulk-doc-dropzone {
  border: 2px dashed var(--color-border, #d1d5db);
  border-radius: 8px;
  padding: 48px 24px;
  text-align: center;
  cursor: pointer;
  background: var(--color-bg-subtle, #f9fafb);
  transition: border-color 120ms, background 120ms;
}

.bulk-doc-dropzone:hover,
.bulk-doc-dropzone--dragging {
  border-color: var(--color-primary, #2563eb);
  background: var(--color-primary-subtle, #eff6ff);
}

.bulk-doc-dropzone__title {
  font-size: 16px;
  font-weight: 500;
  margin: 0 0 4px 0;
}

.bulk-doc-dropzone__hint {
  font-size: 14px;
  color: var(--color-text-muted, #6b7280);
  margin: 0;
}

.bulk-doc-dropzone__error {
  margin-top: 12px;
  padding: 12px;
  background: var(--color-error-subtle, #fef2f2);
  color: var(--color-error, #b91c1c);
  border-radius: 6px;
  font-size: 14px;
}

.bulk-doc-dropzone__actions {
  margin-top: 16px;
  display: flex;
  justify-content: flex-end;
}

.bulk-doc-dropzone__actions button {
  padding: 8px 16px;
  border-radius: 6px;
  background: transparent;
  border: 1px solid var(--color-border, #d1d5db);
  cursor: pointer;
}
```

- [ ] **Step 3: Wire into the page**

Modify `BulkAddStudentsPage.tsx`:

```tsx
import BulkDocumentDropzone from '../components/BulkDocumentDropzone.tsx';
// ...
{phase === 'uploading' && mode === 'documents' && (
  <BulkDocumentDropzone
    onSelect={(files) => {
      // Phase 6 will plug in extraction here.
      // For now, just log and stay in uploading.
      console.log('Documents picked:', files.map((f) => f.name));
    }}
    onCancel={() => {
      setPhase('mode_select');
      setMode(null);
    }}
  />
)}
```

(The `console.log` is intentional and is replaced in Phase 6 — flagged in the verification step at the end of this phase.)

- [ ] **Step 4: Type-check**

Run: `npx tsc -b --noEmit`
Expected: PASS.

---

### Task 4.3: BulkCsvDropzone

**Files:**
- Create: `admindash/frontend/src/components/BulkCsvDropzone.tsx`
- Create: `admindash/frontend/src/components/BulkCsvDropzone.css`

- [ ] **Step 1: Write the component**

```tsx
// admindash/frontend/src/components/BulkCsvDropzone.tsx
import { useRef, useState } from 'react';
import { BULK_ADD_CSV_ROW_CAP } from '../config.ts';
import { parseCsvForBulk } from '../utils/csvParse.ts';
import { useTranslation } from '../hooks/useTranslation.ts';
import type { CsvParseResult } from '../types/bulkAdd.ts';
import './BulkCsvDropzone.css';

interface Props {
  onParsed: (parsed: CsvParseResult) => void;
  onCancel: () => void;
}

export default function BulkCsvDropzone({ onParsed, onCancel }: Props) {
  const { t } = useTranslation();
  const inputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [parsing, setParsing] = useState(false);
  const [dragging, setDragging] = useState(false);

  const handleFile = async (file: File) => {
    setError(null);
    setParsing(true);
    try {
      const outcome = await parseCsvForBulk(file);
      if (!outcome.ok) {
        setError(outcome.error.message);
      } else {
        onParsed(outcome.result);
      }
    } finally {
      setParsing(false);
    }
  };

  return (
    <div className="bulk-csv-dropzone-wrapper">
      <div
        className={`bulk-csv-dropzone ${dragging ? 'bulk-csv-dropzone--dragging' : ''}`}
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          const f = e.dataTransfer.files[0];
          if (f) handleFile(f);
        }}
        onClick={() => inputRef.current?.click()}
      >
        <input
          ref={inputRef}
          type="file"
          accept=".csv"
          style={{ display: 'none' }}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) handleFile(f);
          }}
        />
        <p className="bulk-csv-dropzone__title">{t('bulkAdd.dropzone.csvTitle')}</p>
        <p className="bulk-csv-dropzone__hint">
          {t('bulkAdd.dropzone.csvHint').replace('{cap}', String(BULK_ADD_CSV_ROW_CAP))}
        </p>
        {parsing && <p className="bulk-csv-dropzone__parsing">{t('common.loading')}</p>}
      </div>
      {error && <div className="bulk-csv-dropzone__error">{error}</div>}
      <div className="bulk-csv-dropzone__actions">
        <button type="button" onClick={onCancel}>{t('common.cancel')}</button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Write the CSS**

```css
/* admindash/frontend/src/components/BulkCsvDropzone.css */
.bulk-csv-dropzone-wrapper { max-width: 800px; }

.bulk-csv-dropzone {
  border: 2px dashed var(--color-border, #d1d5db);
  border-radius: 8px;
  padding: 48px 24px;
  text-align: center;
  cursor: pointer;
  background: var(--color-bg-subtle, #f9fafb);
}

.bulk-csv-dropzone:hover,
.bulk-csv-dropzone--dragging {
  border-color: var(--color-primary, #2563eb);
  background: var(--color-primary-subtle, #eff6ff);
}

.bulk-csv-dropzone__title { font-size: 16px; font-weight: 500; margin: 0 0 4px 0; }
.bulk-csv-dropzone__hint { font-size: 14px; color: var(--color-text-muted, #6b7280); margin: 0; }
.bulk-csv-dropzone__parsing { margin-top: 12px; color: var(--color-text-muted, #6b7280); }
.bulk-csv-dropzone__error { margin-top: 12px; padding: 12px; background: var(--color-error-subtle, #fef2f2); color: var(--color-error, #b91c1c); border-radius: 6px; }
.bulk-csv-dropzone__actions { margin-top: 16px; display: flex; justify-content: flex-end; }
.bulk-csv-dropzone__actions button { padding: 8px 16px; border-radius: 6px; background: transparent; border: 1px solid var(--color-border, #d1d5db); cursor: pointer; }
```

- [ ] **Step 3: Wire into the page**

In `BulkAddStudentsPage.tsx`:

```tsx
import BulkCsvDropzone from '../components/BulkCsvDropzone.tsx';
// inside the component, add a useState for the parsed CSV:
const [csvParsed, setCsvParsed] = useState<{ headers: string[]; rows: Record<string, string>[] } | null>(null);
// ...
{phase === 'uploading' && mode === 'csv' && (
  <BulkCsvDropzone
    onParsed={(parsed) => {
      setCsvParsed(parsed);
      setPhase('mapping');
    }}
    onCancel={() => {
      setPhase('mode_select');
      setMode(null);
    }}
  />
)}
```

- [ ] **Step 4: Lint + type-check + build**

```
npx tsc -b --noEmit
npm run lint
npm run build
```

If lint complains about the `console.log` left in the document dropzone branch, suppress for now with `// eslint-disable-next-line no-console` — it's removed in Phase 6.

- [ ] **Step 5: Commit Phase 4**

```bash
cd /Users/kennylee/Development/NeoApex
git add admindash/frontend/src/components/BulkModeSelector.tsx \
  admindash/frontend/src/components/BulkModeSelector.css \
  admindash/frontend/src/components/BulkDocumentDropzone.tsx \
  admindash/frontend/src/components/BulkDocumentDropzone.css \
  admindash/frontend/src/components/BulkCsvDropzone.tsx \
  admindash/frontend/src/components/BulkCsvDropzone.css \
  admindash/frontend/src/pages/BulkAddStudentsPage.tsx
git commit -m "$(cat <<'EOF'
feat(admindash): bulk-add mode selector and dropzones

Adds BulkModeSelector (Documents | CSV cards), BulkDocumentDropzone
(multi-file with extension and cap enforcement), and BulkCsvDropzone
(single-file with parse-and-validate via parseCsvForBulk). Wires both
into the page state machine; documents-mode extraction lands in Phase 6
and CSV mapping lands in Phase 5.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Phase 5 — CSV column-mapping step

### Task 5.1: CsvMappingStep component

**Files:**
- Create: `admindash/frontend/src/components/CsvMappingStep.tsx`
- Create: `admindash/frontend/src/components/CsvMappingStep.css`

- [ ] **Step 1: Write the component**

```tsx
// admindash/frontend/src/components/CsvMappingStep.tsx
import { useMemo, useState } from 'react';
import { useTranslation } from '../hooks/useTranslation.ts';
import type { ColumnMapping } from '../types/bulkAdd.ts';
import { SKIP_FIELD } from '../types/bulkAdd.ts';
import { autoMatchColumns, unmappedRequiredFields } from '../utils/csvMapping.ts';
import type { ModelDefinition, ModelFieldDefinition } from '../types/models.ts';
import './CsvMappingStep.css';

interface Props {
  headers: string[];
  modelDef: ModelDefinition;
  onApply: (mapping: ColumnMapping) => void;
  onCancel: () => void;
}

export default function CsvMappingStep({ headers, modelDef, onApply, onCancel }: Props) {
  const { t } = useTranslation();
  const [mapping, setMapping] = useState<ColumnMapping>(() => autoMatchColumns(headers, modelDef));

  const allFields: ModelFieldDefinition[] = useMemo(
    () => [...modelDef.base_fields, ...modelDef.custom_fields],
    [modelDef],
  );

  const missing = unmappedRequiredFields(mapping, modelDef);
  const canApply = missing.length === 0;

  const setColumn = (idx: number, value: string) => {
    setMapping((prev) => ({ ...prev, [idx]: value }));
  };

  return (
    <div className="csv-mapping-step">
      <h2>{t('bulkAdd.mapping.title')}</h2>
      <p className="csv-mapping-step__subtitle">{t('bulkAdd.mapping.subtitle')}</p>

      {missing.length > 0 && (
        <div className="csv-mapping-step__error">
          {t('bulkAdd.mapping.missingRequired').replace('{fields}', missing.join(', '))}
        </div>
      )}

      <div className="csv-mapping-step__grid">
        <div className="csv-mapping-step__head">
          <span>{t('bulkAdd.mapping.csvHeader')}</span>
          <span>{t('bulkAdd.mapping.modelField')}</span>
        </div>
        {headers.map((h, i) => (
          <div key={i} className="csv-mapping-step__row">
            <code className="csv-mapping-step__header">{h}</code>
            <select
              value={mapping[i] ?? SKIP_FIELD}
              onChange={(e) => setColumn(i, e.target.value)}
            >
              <option value={SKIP_FIELD}>{t('bulkAdd.mapping.skip')}</option>
              {allFields.map((f) => (
                <option key={f.name} value={f.name}>
                  {f.name}{f.required ? ' *' : ''}
                </option>
              ))}
            </select>
          </div>
        ))}
      </div>

      <div className="csv-mapping-step__actions">
        <button type="button" onClick={onCancel}>{t('common.cancel')}</button>
        <button
          type="button"
          className="csv-mapping-step__apply"
          disabled={!canApply}
          onClick={() => onApply(mapping)}
        >
          {t('bulkAdd.mapping.apply')}
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Write the CSS**

```css
/* admindash/frontend/src/components/CsvMappingStep.css */
.csv-mapping-step { max-width: 800px; }
.csv-mapping-step h2 { font-size: 18px; margin: 0 0 8px 0; }
.csv-mapping-step__subtitle { color: var(--color-text-muted, #6b7280); margin: 0 0 16px 0; }

.csv-mapping-step__error {
  padding: 12px;
  background: var(--color-error-subtle, #fef2f2);
  color: var(--color-error, #b91c1c);
  border-radius: 6px;
  margin-bottom: 16px;
}

.csv-mapping-step__grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0;
  border: 1px solid var(--color-border, #d1d5db);
  border-radius: 6px;
  overflow: hidden;
}

.csv-mapping-step__head, .csv-mapping-step__row {
  display: contents;
}

.csv-mapping-step__head > span {
  background: var(--color-bg-subtle, #f9fafb);
  padding: 12px;
  font-weight: 500;
  font-size: 14px;
}

.csv-mapping-step__row > * {
  padding: 12px;
  border-top: 1px solid var(--color-border, #d1d5db);
}

.csv-mapping-step__header {
  font-family: monospace;
  font-size: 13px;
}

.csv-mapping-step__row select {
  width: 100%;
  padding: 6px;
  border: 1px solid var(--color-border, #d1d5db);
  border-radius: 4px;
}

.csv-mapping-step__actions {
  margin-top: 16px;
  display: flex;
  gap: 8px;
  justify-content: flex-end;
}
.csv-mapping-step__actions button {
  padding: 8px 16px;
  border-radius: 6px;
  cursor: pointer;
}
.csv-mapping-step__apply {
  background: var(--color-primary, #2563eb);
  color: white;
  border: 1px solid var(--color-primary, #2563eb);
}
.csv-mapping-step__apply:disabled {
  background: var(--color-disabled, #9ca3af);
  border-color: var(--color-disabled, #9ca3af);
  cursor: not-allowed;
}
```

---

### Task 5.2: Wire mapping into the page

**Files:**
- Modify: `admindash/frontend/src/pages/BulkAddStudentsPage.tsx`

- [ ] **Step 1: Import and render the mapping step**

Add to imports:
```tsx
import CsvMappingStep from '../components/CsvMappingStep.tsx';
import { applyMapping } from '../utils/csvMapping.ts';
import { newRowId } from '../types/bulkAdd.ts';
```

Add the mapping branch:
```tsx
{phase === 'mapping' && mode === 'csv' && csvParsed && (
  <CsvMappingStep
    headers={csvParsed.headers}
    modelDef={modelDef}
    onApply={(mapping) => {
      const mappedRows = applyMapping(csvParsed.rows, csvParsed.headers, mapping, modelDef);
      const newRows: BulkRow[] = mappedRows.map((values, i) => ({
        id: newRowId(),
        source: `CSV row ${i + 2}`, // +2: header is row 1, first data row is row 2
        values,
        status: 'ready',
      }));
      setRows(newRows);
      setColumnMapping(mapping);
      setPhase('review');
    }}
    onCancel={() => {
      setCsvParsed(null);
      setPhase('uploading');
    }}
  />
)}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc -b --noEmit`
Expected: PASS.

---

### Task 5.3: Commit Phase 5

- [ ] **Step 1: Commit**

```bash
cd /Users/kennylee/Development/NeoApex
git add admindash/frontend/src/components/CsvMappingStep.tsx \
  admindash/frontend/src/components/CsvMappingStep.css \
  admindash/frontend/src/pages/BulkAddStudentsPage.tsx
git commit -m "$(cat <<'EOF'
feat(admindash): bulk-add CSV column mapping

Adds the CsvMappingStep component (auto-match + manual mapping with
Skip default and required-field-mapped validation gate) and wires it
into the page state machine. Multi-select cells split on ';' via
applyMapping; the page transitions mapping -> review on Apply.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Phase 6 — Documents extraction phase

### Task 6.1: ExtractionProgressBar

**Files:**
- Create: `admindash/frontend/src/components/ExtractionProgressBar.tsx`
- Create: `admindash/frontend/src/components/ExtractionProgressBar.css`

- [ ] **Step 1: Write the component**

```tsx
// admindash/frontend/src/components/ExtractionProgressBar.tsx
import { useTranslation } from '../hooks/useTranslation.ts';
import './ExtractionProgressBar.css';

interface Props {
  total: number;
  done: number;
  failed: number;
}

export default function ExtractionProgressBar({ total, done, failed }: Props) {
  const { t } = useTranslation();
  const pct = total === 0 ? 0 : Math.round((done / total) * 100);
  return (
    <div className="extraction-progress" role="status" aria-live="polite">
      <div className="extraction-progress__bar">
        <div className="extraction-progress__fill" style={{ width: `${pct}%` }} />
      </div>
      <p className="extraction-progress__label">
        {t('bulkAdd.progress.label')
          .replace('{done}', String(done))
          .replace('{total}', String(total))
          .replace('{failed}', String(failed))}
      </p>
    </div>
  );
}
```

- [ ] **Step 2: Write the CSS**

```css
/* admindash/frontend/src/components/ExtractionProgressBar.css */
.extraction-progress { margin: 16px 0; }
.extraction-progress__bar {
  width: 100%;
  height: 8px;
  background: var(--color-bg-subtle, #f3f4f6);
  border-radius: 999px;
  overflow: hidden;
}
.extraction-progress__fill {
  height: 100%;
  background: var(--color-primary, #2563eb);
  transition: width 200ms;
}
.extraction-progress__label {
  margin: 8px 0 0 0;
  font-size: 13px;
  color: var(--color-text-muted, #6b7280);
}
```

---

### Task 6.2: Wire extraction into the page

**Files:**
- Modify: `admindash/frontend/src/pages/BulkAddStudentsPage.tsx`

- [ ] **Step 1: Add the extraction trigger and per-row updater**

Replace the `console.log` in the documents-dropzone callback (Phase 4 placeholder) with the extraction call. Full revised section:

```tsx
import ExtractionProgressBar from '../components/ExtractionProgressBar.tsx';
import { extractStudentBatch } from '../api/bulkAddOrchestrators.ts';
// (newRowId already imported in Phase 5)
// ...

// Helper: update a single row's state by id.
const updateRow = (rowId: string, patch: Partial<BulkRow>) => {
  setRows((prev) => prev.map((r) => (r.id === rowId ? { ...r, ...patch } : r)));
};

const startDocumentExtraction = async (files: File[]) => {
  const seeded: BulkRow[] = files.map((f) => ({
    id: newRowId(),
    source: f.name,
    file: f,
    values: {},
    status: 'extracting',
  }));
  setRows(seeded);
  setPhase('extracting');

  const items = seeded.map((r) => ({ rowId: r.id, file: r.file as File }));
  await extractStudentBatch({
    tenantId: tenant,
    files: items,
    onRowResult: (rowId, result) => {
      if (result.error) {
        updateRow(rowId, { status: 'extract_failed', error: result.error });
      } else if (result.fields) {
        updateRow(rowId, { status: 'ready', values: { ...result.fields } });
      }
    },
  });

  setPhase('review');
};
```

- [ ] **Step 2: Replace the documents-dropzone branch's onSelect**

Find:
```tsx
{phase === 'uploading' && mode === 'documents' && (
  <BulkDocumentDropzone
    onSelect={(files) => {
      console.log('Documents picked:', files.map((f) => f.name));
    }}
    onCancel={...}
  />
)}
```

Replace with:
```tsx
{phase === 'uploading' && mode === 'documents' && (
  <BulkDocumentDropzone
    onSelect={(files) => { startDocumentExtraction(files); }}
    onCancel={() => {
      setPhase('mode_select');
      setMode(null);
    }}
  />
)}
```

- [ ] **Step 3: Render the extraction progress phase**

Add:
```tsx
{phase === 'extracting' && (
  <>
    <ExtractionProgressBar
      total={rows.length}
      done={rows.filter((r) => r.status === 'ready' || r.status === 'extract_failed').length}
      failed={rows.filter((r) => r.status === 'extract_failed').length}
    />
    {/* Review table renders behind in the next phase to show in-flight rows. */}
  </>
)}
```

- [ ] **Step 4: Type-check**

Run: `npx tsc -b --noEmit`
Expected: PASS.

---

### Task 6.3: Per-row "Retry extract"

The retry affordance lives on the row (clickable in the table column rendered in Phase 7). The handler logic uses the row's in-memory `file` reference.

**Files:**
- Modify: `admindash/frontend/src/pages/BulkAddStudentsPage.tsx`

- [ ] **Step 1: Add the retry handler**

Add inside the component:
```tsx
const retryExtract = async (rowId: string) => {
  const row = rows.find((r) => r.id === rowId);
  if (!row || !row.file) return;
  updateRow(rowId, { status: 'extracting', error: undefined });
  await extractStudentBatch({
    tenantId: tenant,
    files: [{ rowId, file: row.file }],
    onRowResult: (id, result) => {
      if (result.error) {
        updateRow(id, { status: 'extract_failed', error: result.error });
      } else if (result.fields) {
        updateRow(id, { status: 'ready', values: { ...result.fields } });
      }
    },
  });
};
```

(`retryExtract` is wired into `BulkReviewTable` in Phase 7.)

- [ ] **Step 2: Type-check**

Run: `npx tsc -b --noEmit`
Expected: PASS. (`retryExtract` is unused until Phase 7; if ESLint complains, suppress with `// eslint-disable-next-line @typescript-eslint/no-unused-vars` for the duration of this commit.)

- [ ] **Step 3: Commit Phase 6**

```bash
cd /Users/kennylee/Development/NeoApex
git add admindash/frontend/src/components/ExtractionProgressBar.tsx \
  admindash/frontend/src/components/ExtractionProgressBar.css \
  admindash/frontend/src/pages/BulkAddStudentsPage.tsx
git commit -m "$(cat <<'EOF'
feat(admindash): bulk-add extraction phase with retry

Wires extractStudentBatch into the page: documents drop seeds rows
in 'extracting' state, the bounded-parallel orchestrator (capped at
BULK_ADD_CONCURRENCY) updates each row to 'ready' or 'extract_failed'
as results arrive, and the new ExtractionProgressBar shows live
counts. Adds a per-row retryExtract handler ready to be wired into
the review table in the next phase.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Phase 7 — Review table and side drawer

### Task 7.1: BulkReviewTable

**Files:**
- Create: `admindash/frontend/src/components/BulkReviewTable.tsx`
- Create: `admindash/frontend/src/components/BulkReviewTable.css`

- [ ] **Step 1: Write the component**

```tsx
// admindash/frontend/src/components/BulkReviewTable.tsx
import { useMemo } from 'react';
import { useTranslation } from '../hooks/useTranslation.ts';
import type { BulkRow } from '../types/bulkAdd.ts';
import type { ModelDefinition } from '../types/models.ts';
import { validateRowAgainstModel } from '../utils/validateField.ts';
import './BulkReviewTable.css';

interface Props {
  rows: BulkRow[];
  modelDef: ModelDefinition;
  onEditRow: (rowId: string) => void;
  onDeleteRow: (rowId: string) => void;
  onRetryExtract: (rowId: string) => void;
}

export default function BulkReviewTable({
  rows, modelDef, onEditRow, onDeleteRow, onRetryExtract,
}: Props) {
  const { t } = useTranslation();

  const issuesByRow = useMemo(() => {
    const map = new Map<string, number>();
    for (const r of rows) {
      const errs = validateRowAgainstModel(r.values, modelDef);
      map.set(r.id, Object.keys(errs).length);
    }
    return map;
  }, [rows, modelDef]);

  return (
    <table className="bulk-review-table">
      <thead>
        <tr>
          <th>#</th>
          <th>{t('bulkAdd.table.status')}</th>
          <th>{t('bulkAdd.table.name')}</th>
          <th>{t('bulkAdd.table.dob')}</th>
          <th>{t('bulkAdd.table.source')}</th>
          <th>{t('bulkAdd.table.issues')}</th>
          <th>{t('bulkAdd.table.actions')}</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => {
          const issues = issuesByRow.get(r.id) ?? 0;
          return (
            <tr key={r.id} className={`bulk-review-row bulk-review-row--${r.status}`}>
              <td>{i + 1}</td>
              <td><StatusPill status={r.status} /></td>
              <td>
                {String(r.values.first_name ?? '')} {String(r.values.last_name ?? '')}
              </td>
              <td>{String(r.values.dob ?? '')}</td>
              <td className="bulk-review-table__source">{r.source}</td>
              <td className="bulk-review-table__issues">
                {r.error ? (
                  <span title={r.error.message} className="bulk-review-table__error-pill">
                    {r.error.message}
                  </span>
                ) : issues > 0 ? (
                  <span className="bulk-review-table__issue-count">{issues}</span>
                ) : (
                  <span className="bulk-review-table__ok">—</span>
                )}
              </td>
              <td className="bulk-review-table__actions">
                {r.status === 'extract_failed' ? (
                  <button onClick={() => onRetryExtract(r.id)}>
                    {t('bulkAdd.table.retryExtract')}
                  </button>
                ) : (
                  <button onClick={() => onEditRow(r.id)} disabled={r.status === 'extracting'}>
                    {t('bulkAdd.table.edit')}
                  </button>
                )}
                <button
                  onClick={() => onDeleteRow(r.id)}
                  className="bulk-review-table__delete"
                  disabled={r.status === 'extracting' || r.status === 'creating'}
                >
                  {t('bulkAdd.table.delete')}
                </button>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function StatusPill({ status }: { status: BulkRow['status'] }) {
  const { t } = useTranslation();
  return (
    <span className={`status-pill status-pill--${status}`}>
      {t(`bulkAdd.status.${status}`)}
    </span>
  );
}
```

- [ ] **Step 2: Write the CSS**

```css
/* admindash/frontend/src/components/BulkReviewTable.css */
.bulk-review-table { width: 100%; border-collapse: collapse; font-size: 14px; }
.bulk-review-table th, .bulk-review-table td {
  border-bottom: 1px solid var(--color-border, #e5e7eb);
  padding: 8px 12px; text-align: left;
}
.bulk-review-table th {
  background: var(--color-bg-subtle, #f9fafb);
  font-weight: 500;
}
.bulk-review-table__source {
  font-family: monospace;
  font-size: 12px;
  color: var(--color-text-muted, #6b7280);
}
.bulk-review-table__error-pill {
  background: var(--color-error-subtle, #fef2f2);
  color: var(--color-error, #b91c1c);
  padding: 2px 6px;
  border-radius: 4px;
  font-size: 12px;
}
.bulk-review-table__issue-count {
  background: var(--color-warning-subtle, #fef3c7);
  color: var(--color-warning, #92400e);
  padding: 2px 6px;
  border-radius: 4px;
}
.bulk-review-table__ok { color: var(--color-text-muted, #9ca3af); }
.bulk-review-table__actions { white-space: nowrap; }
.bulk-review-table__actions button {
  padding: 4px 8px;
  margin-right: 4px;
  border-radius: 4px;
  border: 1px solid var(--color-border, #d1d5db);
  background: white;
  cursor: pointer;
  font-size: 12px;
}
.bulk-review-table__delete { color: var(--color-error, #b91c1c); }

.status-pill {
  display: inline-block;
  padding: 2px 8px;
  border-radius: 999px;
  font-size: 11px;
  font-weight: 500;
}
.status-pill--extracting, .status-pill--creating { background: var(--color-info-subtle, #eff6ff); color: var(--color-info, #1d4ed8); }
.status-pill--ready, .status-pill--pending { background: var(--color-bg-subtle, #f3f4f6); color: var(--color-text, #374151); }
.status-pill--has_errors { background: var(--color-warning-subtle, #fef3c7); color: var(--color-warning, #92400e); }
.status-pill--created { background: var(--color-success-subtle, #d1fae5); color: var(--color-success, #065f46); }
.status-pill--failed, .status-pill--extract_failed { background: var(--color-error-subtle, #fef2f2); color: var(--color-error, #b91c1c); }
```

---

### Task 7.2: BulkRowDrawer with `key={row.id}` remount

**Files:**
- Create: `admindash/frontend/src/components/BulkRowDrawer.tsx`
- Create: `admindash/frontend/src/components/BulkRowDrawer.css`

The drawer wraps `DynamicForm` with `key={row.id}` so React unmounts and remounts on Prev/Next — this is the explicit fix for `DynamicForm`'s merge-not-replace `initialValues` effect.

- [ ] **Step 1: Write the component**

```tsx
// admindash/frontend/src/components/BulkRowDrawer.tsx
import { useState } from 'react';
import { useTranslation } from '../hooks/useTranslation.ts';
import DynamicForm from './DynamicForm.tsx';
import type { BulkRow } from '../types/bulkAdd.ts';
import type { ModelDefinition } from '../types/models.ts';
import './BulkRowDrawer.css';

interface Props {
  rows: BulkRow[];
  activeRowIndex: number;
  modelDef: ModelDefinition;
  onSaveRow: (rowId: string, baseData: Record<string, unknown>, customFields: Record<string, unknown>) => void;
  onClose: () => void;
  onNavigate: (newIndex: number) => void;
}

export default function BulkRowDrawer({
  rows, activeRowIndex, modelDef, onSaveRow, onClose, onNavigate,
}: Props) {
  const { t } = useTranslation();
  const [dirty, setDirty] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState<{ kind: 'close' } | { kind: 'navigate'; targetIndex: number } | null>(null);

  const row = rows[activeRowIndex];
  if (!row) return null;

  // DynamicForm uses controlled values internally; we treat any keystroke as dirty.
  // We can't directly observe DynamicForm's state, so we approximate by setting
  // dirty=true on first interaction inside the drawer body. (Submit clears dirty.)
  const handleSubmit = (baseData: Record<string, unknown>, customFields: Record<string, unknown>) => {
    onSaveRow(row.id, baseData, customFields);
    setDirty(false);
  };

  const requestNavigate = (target: number) => {
    if (dirty) {
      setConfirmDiscard({ kind: 'navigate', targetIndex: target });
    } else {
      onNavigate(target);
    }
  };

  const requestClose = () => {
    if (dirty) {
      setConfirmDiscard({ kind: 'close' });
    } else {
      onClose();
    }
  };

  const confirmDiscardAndProceed = () => {
    setDirty(false);
    if (confirmDiscard?.kind === 'navigate') {
      const target = confirmDiscard.targetIndex;
      setConfirmDiscard(null);
      onNavigate(target);
    } else {
      setConfirmDiscard(null);
      onClose();
    }
  };

  return (
    <>
      <div className="bulk-drawer-backdrop" onClick={requestClose} />
      <aside className="bulk-drawer" role="dialog" aria-modal="true">
        <header className="bulk-drawer__header">
          <h2>{t('bulkAdd.drawer.title').replace('{n}', String(activeRowIndex + 1))}</h2>
          <button className="bulk-drawer__close" onClick={requestClose} aria-label={t('common.close')}>
            &times;
          </button>
        </header>

        <div
          className="bulk-drawer__body"
          onChangeCapture={() => setDirty(true)}
        >
          {/* CRITICAL: key={row.id} forces unmount/remount across Prev/Next so
              DynamicForm's initialValues-merge-not-replace effect cannot leak
              values between rows (DynamicForm.tsx:235-245). */}
          <DynamicForm
            key={row.id}
            modelDefinition={modelDef}
            initialValues={row.values}
            onSubmit={handleSubmit}
            onCancel={requestClose}
          />
        </div>

        <nav className="bulk-drawer__nav">
          <button
            disabled={activeRowIndex === 0}
            onClick={() => requestNavigate(activeRowIndex - 1)}
          >
            {t('bulkAdd.drawer.prev')}
          </button>
          <span className="bulk-drawer__nav-pos">
            {activeRowIndex + 1} / {rows.length}
          </span>
          <button
            disabled={activeRowIndex >= rows.length - 1}
            onClick={() => requestNavigate(activeRowIndex + 1)}
          >
            {t('bulkAdd.drawer.next')}
          </button>
        </nav>
      </aside>

      {confirmDiscard && (
        <div className="bulk-drawer-confirm-overlay">
          <div className="bulk-drawer-confirm">
            <p>{t('bulkAdd.drawer.discardPrompt')}</p>
            <div className="bulk-drawer-confirm__actions">
              <button onClick={() => setConfirmDiscard(null)}>{t('common.cancel')}</button>
              <button
                className="bulk-drawer-confirm__danger"
                onClick={confirmDiscardAndProceed}
              >
                {t('bulkAdd.drawer.discard')}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
```

- [ ] **Step 2: Write the CSS**

```css
/* admindash/frontend/src/components/BulkRowDrawer.css */
.bulk-drawer-backdrop {
  position: fixed; inset: 0;
  background: rgba(0, 0, 0, 0.3);
  z-index: 50;
}
.bulk-drawer {
  position: fixed; top: 0; right: 0; bottom: 0;
  width: 480px;
  background: white;
  z-index: 51;
  box-shadow: -4px 0 16px rgba(0, 0, 0, 0.1);
  display: flex; flex-direction: column;
}
.bulk-drawer__header {
  padding: 16px 20px;
  border-bottom: 1px solid var(--color-border, #e5e7eb);
  display: flex; justify-content: space-between; align-items: center;
}
.bulk-drawer__header h2 { margin: 0; font-size: 16px; }
.bulk-drawer__close {
  background: none; border: none; font-size: 24px; cursor: pointer;
  color: var(--color-text-muted, #6b7280);
}
.bulk-drawer__body { flex: 1; overflow-y: auto; padding: 16px 20px; }
.bulk-drawer__nav {
  padding: 12px 20px;
  border-top: 1px solid var(--color-border, #e5e7eb);
  display: flex; justify-content: space-between; align-items: center;
}
.bulk-drawer__nav-pos { font-size: 13px; color: var(--color-text-muted, #6b7280); }
.bulk-drawer__nav button {
  padding: 6px 12px;
  border: 1px solid var(--color-border, #d1d5db);
  border-radius: 4px;
  background: white; cursor: pointer;
}
.bulk-drawer__nav button:disabled { opacity: 0.5; cursor: not-allowed; }

.bulk-drawer-confirm-overlay {
  position: fixed; inset: 0;
  background: rgba(0, 0, 0, 0.4);
  z-index: 60;
  display: flex; align-items: center; justify-content: center;
}
.bulk-drawer-confirm {
  background: white;
  padding: 20px;
  border-radius: 8px;
  max-width: 360px;
}
.bulk-drawer-confirm__actions {
  margin-top: 16px;
  display: flex; gap: 8px; justify-content: flex-end;
}
.bulk-drawer-confirm__actions button {
  padding: 6px 12px; border-radius: 4px; cursor: pointer;
  border: 1px solid var(--color-border, #d1d5db);
  background: white;
}
.bulk-drawer-confirm__danger {
  background: var(--color-error, #b91c1c);
  color: white;
  border-color: var(--color-error, #b91c1c);
}
```

---

### Task 7.3: Wire review table + drawer into the page

**Files:**
- Modify: `admindash/frontend/src/pages/BulkAddStudentsPage.tsx`

- [ ] **Step 1: Add imports and drawer state**

```tsx
import BulkReviewTable from '../components/BulkReviewTable.tsx';
import BulkRowDrawer from '../components/BulkRowDrawer.tsx';
// ...
const [activeDrawerIndex, setActiveDrawerIndex] = useState<number | null>(null);
```

- [ ] **Step 2: Render review table + drawer in `review`/`extracting` phases**

After the ExtractionProgressBar block, add:

```tsx
{(phase === 'extracting' || phase === 'review') && rows.length > 0 && (
  <BulkReviewTable
    rows={rows}
    modelDef={modelDef}
    onEditRow={(rowId) => {
      const idx = rows.findIndex((r) => r.id === rowId);
      if (idx >= 0) setActiveDrawerIndex(idx);
    }}
    onDeleteRow={(rowId) => {
      setRows((prev) => prev.filter((r) => r.id !== rowId));
    }}
    onRetryExtract={(rowId) => { void retryExtract(rowId); }}
  />
)}

{activeDrawerIndex != null && rows[activeDrawerIndex] && (
  <BulkRowDrawer
    rows={rows}
    activeRowIndex={activeDrawerIndex}
    modelDef={modelDef}
    onSaveRow={(rowId, baseData, customFields) => {
      const merged = { ...baseData, ...customFields };
      updateRow(rowId, { values: merged, status: 'ready', error: undefined });
    }}
    onClose={() => setActiveDrawerIndex(null)}
    onNavigate={(newIndex) => setActiveDrawerIndex(newIndex)}
  />
)}
```

- [ ] **Step 3: Type-check + lint + build**

```
npx tsc -b --noEmit
npm run lint
npm run build
```
Expected: all pass.

- [ ] **Step 4: Commit Phase 7**

```bash
cd /Users/kennylee/Development/NeoApex
git add admindash/frontend/src/components/BulkReviewTable.tsx \
  admindash/frontend/src/components/BulkReviewTable.css \
  admindash/frontend/src/components/BulkRowDrawer.tsx \
  admindash/frontend/src/components/BulkRowDrawer.css \
  admindash/frontend/src/pages/BulkAddStudentsPage.tsx
git commit -m "$(cat <<'EOF'
feat(admindash): bulk-add review table and side drawer

Adds BulkReviewTable (curated read-only summary columns, status pill,
issues count, edit/delete/retry-extract actions) and BulkRowDrawer
(reuses DynamicForm with key={row.id} to force unmount/remount on
Prev/Next, plus a discard-changes prompt when closing dirty edits).
Wires both into the page state machine for extracting + review phases.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

### Task 7.4: Manual smoke - drawer remount

- [ ] **Step 1: Verify Prev/Next does not leak values**

Run dev server: from `admindash/`: `uv run uvicorn app.main:app --app-dir backend --port 5610 --reload &` and from `admindash/frontend/`: `npm run dev`. Navigate to `/students/bulk-add`. Upload two test PDFs whose extracted `first_name`s are clearly different (or that fail extraction so you can edit by hand). Open the drawer on row 1, type `Alice` in `first_name`, save. Use the row 2 edit button — Alice must NOT appear in row 2's `first_name` field.

If Alice does appear, the `key={row.id}` is missing — fix by re-checking `BulkRowDrawer.tsx`.

(No commit — verification only.)

---

## Phase 8 — IndexedDB persistence and resume

### Task 8.1: Persist on every state change in review phase

**Files:**
- Modify: `admindash/frontend/src/pages/BulkAddStudentsPage.tsx`

The page debounces saves to IndexedDB with a 500ms timer once `phase` reaches `review` or beyond.

- [ ] **Step 1: Add the persistence hook**

```tsx
import { saveDraft, deleteDraft, findActiveDraftsForTenant, buildDraftId } from '../db/bulkAddDrafts.ts';
import type { BatchDraft } from '../types/bulkAdd.ts';
// ...

// inside the component:
useEffect(() => {
  // Skip persistence before review phase.
  if (phase !== 'review' && phase !== 'submitting' && phase !== 'post_submit') return;
  if (mode == null) return;

  const handle = window.setTimeout(() => {
    const draft: BatchDraft = {
      id: buildDraftId(tenant, batchId),
      tenantId: tenant,
      batchId,
      mode,
      rows: rows.map((r) => ({
        ...r,
        // Files cannot be persisted to IndexedDB efficiently; strip the File handle.
        // On resume, extract_failed rows lose their retry-source — this is documented.
        file: undefined,
      })),
      columnMapping: columnMapping ?? undefined,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    void saveDraft(draft);
  }, 500);

  return () => window.clearTimeout(handle);
}, [phase, mode, rows, columnMapping, tenant, batchId]);
```

- [ ] **Step 2: Type-check**

Run: `npx tsc -b --noEmit`
Expected: PASS.

---

### Task 8.2: ResumeBatchPrompt component

**Files:**
- Create: `admindash/frontend/src/components/ResumeBatchPrompt.tsx`
- Create: `admindash/frontend/src/components/ResumeBatchPrompt.css`

- [ ] **Step 1: Write the component**

```tsx
// admindash/frontend/src/components/ResumeBatchPrompt.tsx
import { useTranslation } from '../hooks/useTranslation.ts';
import type { BatchDraft } from '../types/bulkAdd.ts';
import './ResumeBatchPrompt.css';

interface Props {
  drafts: BatchDraft[];
  onResume: (draft: BatchDraft) => void;
  onDiscardOne: (draft: BatchDraft) => void;
  onDiscardAll: () => void;
  onCancel: () => void;
}

export default function ResumeBatchPrompt({
  drafts, onResume, onDiscardOne, onDiscardAll, onCancel,
}: Props) {
  const { t } = useTranslation();
  if (drafts.length === 0) return null;
  const [primary, ...others] = drafts;

  return (
    <div className="resume-prompt-overlay">
      <div className="resume-prompt">
        <h2>{t('bulkAdd.resume.title')}</h2>
        <div className="resume-prompt__primary">
          <p>
            <strong>
              {t('bulkAdd.resume.rowCount').replace('{n}', String(primary.rows.length))}
            </strong>
            {' '}— {new Date(primary.updatedAt).toLocaleString()}
          </p>
          <div className="resume-prompt__actions">
            <button onClick={onCancel}>{t('common.cancel')}</button>
            <button onClick={() => onDiscardOne(primary)}>{t('bulkAdd.resume.discardThis')}</button>
            <button
              className="resume-prompt__resume"
              onClick={() => onResume(primary)}
            >
              {t('bulkAdd.resume.resume')}
            </button>
          </div>
        </div>

        {others.length > 0 && (
          <details className="resume-prompt__others">
            <summary>{t('bulkAdd.resume.othersLabel').replace('{n}', String(others.length))}</summary>
            <ul>
              {others.map((d) => (
                <li key={d.id}>
                  <span>{d.rows.length} rows · {new Date(d.updatedAt).toLocaleString()}</span>
                  <button onClick={() => onResume(d)}>{t('bulkAdd.resume.resume')}</button>
                  <button onClick={() => onDiscardOne(d)}>{t('bulkAdd.resume.discardThis')}</button>
                </li>
              ))}
            </ul>
            <button onClick={onDiscardAll} className="resume-prompt__discard-all">
              {t('bulkAdd.resume.discardAll')}
            </button>
          </details>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Write the CSS**

```css
/* admindash/frontend/src/components/ResumeBatchPrompt.css */
.resume-prompt-overlay {
  position: fixed; inset: 0;
  background: rgba(0, 0, 0, 0.4);
  z-index: 70;
  display: flex; align-items: center; justify-content: center;
}
.resume-prompt {
  background: white; padding: 24px;
  border-radius: 8px; max-width: 480px; width: 90%;
}
.resume-prompt h2 { margin: 0 0 12px 0; font-size: 18px; }
.resume-prompt__actions {
  margin-top: 16px;
  display: flex; gap: 8px; justify-content: flex-end;
}
.resume-prompt__actions button {
  padding: 6px 12px; border-radius: 4px; cursor: pointer;
  border: 1px solid var(--color-border, #d1d5db); background: white;
}
.resume-prompt__resume {
  background: var(--color-primary, #2563eb); color: white;
  border-color: var(--color-primary, #2563eb);
}
.resume-prompt__others { margin-top: 16px; }
.resume-prompt__others summary { cursor: pointer; font-size: 14px; }
.resume-prompt__others ul { list-style: none; padding: 0; margin: 8px 0; }
.resume-prompt__others li {
  display: flex; gap: 8px; align-items: center; padding: 4px 0;
  font-size: 13px;
}
.resume-prompt__discard-all {
  margin-top: 8px; padding: 4px 8px; cursor: pointer;
  background: transparent; color: var(--color-error, #b91c1c);
  border: 1px solid var(--color-error, #b91c1c); border-radius: 4px;
}
```

---

### Task 8.3: Wire resume prompt into the page mount

**Files:**
- Modify: `admindash/frontend/src/pages/BulkAddStudentsPage.tsx`

- [ ] **Step 1: Detect drafts on mount and show the prompt**

```tsx
import ResumeBatchPrompt from '../components/ResumeBatchPrompt.tsx';
// ...
const [resumeDrafts, setResumeDrafts] = useState<BatchDraft[] | null>(null);

useEffect(() => {
  // Run once on mount alongside the model fetch.
  let cancelled = false;
  findActiveDraftsForTenant(tenant)
    .then((drafts) => {
      if (!cancelled && drafts.length > 0) setResumeDrafts(drafts);
    })
    .catch(() => { /* IndexedDB unavailable — ignore */ });
  return () => { cancelled = true; };
}, [tenant]);
```

- [ ] **Step 2: Render the prompt**

Right after the page header, before the phase branches:

```tsx
{resumeDrafts && (
  <ResumeBatchPrompt
    drafts={resumeDrafts}
    onCancel={() => setResumeDrafts(null)}
    onResume={(draft) => {
      // Hydrate page state from the draft, rebuilding row schemas.
      setRows(rebuildRowsForCurrentModel(draft.rows, modelDef));
      setMode(draft.mode);
      setColumnMapping(draft.columnMapping ?? null);
      setPhase('review');
      setResumeDrafts(null);
    }}
    onDiscardOne={(draft) => {
      void deleteDraft(draft.id);
      setResumeDrafts((prev) => prev?.filter((d) => d.id !== draft.id) ?? null);
    }}
    onDiscardAll={() => {
      const ids = resumeDrafts.map((d) => d.id);
      void Promise.all(ids.map((id) => deleteDraft(id)));
      setResumeDrafts(null);
    }}
  />
)}
```

- [ ] **Step 3: Add the `rebuildRowsForCurrentModel` helper**

In the same file, add:
```tsx
function rebuildRowsForCurrentModel(rows: BulkRow[], modelDef: ModelDefinition): BulkRow[] {
  const allFieldNames = new Set([
    ...modelDef.base_fields.map((f) => f.name),
    ...modelDef.custom_fields.map((f) => f.name),
  ]);
  return rows.map((r) => {
    const filteredValues: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(r.values)) {
      if (allFieldNames.has(k)) filteredValues[k] = v;
      // Orphaned values are dropped silently. (Spec calls for "Unknown field"
      // disclosure — a follow-up if admins ask for it; v1 just drops them.)
    }
    return {
      ...r,
      values: filteredValues,
      // Drop the in-memory File reference (it wasn't persisted anyway).
      file: undefined,
      // Status: rebuilt rows from a draft can't have extracting/creating in flight.
      status: r.status === 'extracting' || r.status === 'creating' ? 'ready' : r.status,
    };
  });
}
```

- [ ] **Step 4: Type-check**

Run: `npx tsc -b --noEmit`
Expected: PASS.

---

### Task 8.4: Beforeunload protection during ephemeral phases

**Files:**
- Modify: `admindash/frontend/src/pages/BulkAddStudentsPage.tsx`

- [ ] **Step 1: Add the listener**

```tsx
useEffect(() => {
  const ephemeral = phase === 'uploading' || phase === 'extracting';
  if (!ephemeral) return;
  const handler = (e: BeforeUnloadEvent) => {
    e.preventDefault();
    e.returnValue = '';
  };
  window.addEventListener('beforeunload', handler);
  return () => window.removeEventListener('beforeunload', handler);
}, [phase]);
```

- [ ] **Step 2: Type-check**

Run: `npx tsc -b --noEmit`
Expected: PASS.

---

### Task 8.5: Commit Phase 8

- [ ] **Step 1: Commit**

```bash
cd /Users/kennylee/Development/NeoApex
git add admindash/frontend/src/components/ResumeBatchPrompt.tsx \
  admindash/frontend/src/components/ResumeBatchPrompt.css \
  admindash/frontend/src/pages/BulkAddStudentsPage.tsx
git commit -m "$(cat <<'EOF'
feat(admindash): bulk-add IndexedDB persistence and resume

Persists batch draft to IndexedDB once the page enters review phase
(debounced 500ms), surfaces a ResumeBatchPrompt on mount when prior
drafts exist for the tenant (most-recent shown by default, others
listed under a disclosure), rebuilds row schemas against the current
model on resume (orphaned values dropped silently), and registers a
beforeunload warning during the ephemeral upload + extracting phases.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Phase 9 — Pre-submit gate and create fan-out

### Task 9.1: PreSubmitGate component

**Files:**
- Create: `admindash/frontend/src/components/PreSubmitGate.tsx`
- Create: `admindash/frontend/src/components/PreSubmitGate.css`

The gate runs validation + dup-check fan-out at open time, then renders five sections (Ready / Missing / Duplicates / Skipped / Failed). Per-row choices for duplicates: Skip (default) / Save anyway / Cancel & edit.

- [ ] **Step 1: Write the component**

```tsx
// admindash/frontend/src/components/PreSubmitGate.tsx
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from '../hooks/useTranslation.ts';
import type { BulkRow } from '../types/bulkAdd.ts';
import type { DuplicateMatch, ModelDefinition } from '../types/models.ts';
import { validateRowAgainstModel } from '../utils/validateField.ts';
import {
  bulkCheckDuplicates,
  type DupCheckOutcome,
} from '../api/bulkAddOrchestrators.ts';
import './PreSubmitGate.css';

export type DuplicateChoice = 'skip' | 'save_anyway';

export interface GateConfirmation {
  rowIdsToCreate: string[];
  /** Map of rowId → user's per-duplicate choice (only present for matched rows). */
  duplicateChoices: Record<string, DuplicateChoice>;
}

interface Props {
  rows: BulkRow[];
  modelDef: ModelDefinition;
  tenantId: string;
  onCancel: () => void;
  onConfirm: (c: GateConfirmation) => void;
  onCancelAndEdit: (rowId: string) => void;
}

interface RowBuckets {
  ready: BulkRow[];
  missing: { row: BulkRow; errors: Record<string, string> }[];
  duplicates: { row: BulkRow; matches: DuplicateMatch[] }[];
  skipped: { row: BulkRow; missingFields: string[] }[];
  failed: { row: BulkRow; error: string }[];
}

export default function PreSubmitGate({
  rows, modelDef, tenantId, onCancel, onConfirm, onCancelAndEdit,
}: Props) {
  const { t } = useTranslation();
  const [outcomes, setOutcomes] = useState<DupCheckOutcome[] | null>(null);
  const [duplicateChoices, setDuplicateChoices] = useState<Record<string, DuplicateChoice>>({});

  // Phase A: classify rows into validation buckets locally.
  const validationBuckets = useMemo(() => {
    const ready: BulkRow[] = [];
    const missing: { row: BulkRow; errors: Record<string, string> }[] = [];
    for (const r of rows) {
      const errs = validateRowAgainstModel(r.values, modelDef);
      if (Object.keys(errs).length > 0) missing.push({ row: r, errors: errs });
      else ready.push(r);
    }
    return { ready, missing };
  }, [rows, modelDef]);

  // Phase B: dup-check the valid rows.
  useEffect(() => {
    let cancelled = false;
    void bulkCheckDuplicates({ tenantId, rows: validationBuckets.ready })
      .then((res) => { if (!cancelled) setOutcomes(res); });
    return () => { cancelled = true; };
  }, [tenantId, validationBuckets.ready]);

  // Phase C: assemble final five-bucket view once outcomes resolve.
  const buckets: RowBuckets | null = useMemo(() => {
    if (outcomes == null) return null;
    const byRowId = new Map(outcomes.map((o) => [o.rowId, o]));
    const ready: BulkRow[] = [];
    const duplicates: { row: BulkRow; matches: DuplicateMatch[] }[] = [];
    const skipped: { row: BulkRow; missingFields: string[] }[] = [];
    const failed: { row: BulkRow; error: string }[] = [];
    for (const row of validationBuckets.ready) {
      const out = byRowId.get(row.id);
      if (!out) { ready.push(row); continue; }
      switch (out.kind) {
        case 'eligible_clean': ready.push(row); break;
        case 'eligible_match': duplicates.push({ row, matches: out.matches }); break;
        case 'skipped':
          ready.push(row);
          skipped.push({ row, missingFields: out.missingFields });
          break;
        case 'failed': failed.push({ row, error: out.error }); break;
      }
    }
    return { ready, missing: validationBuckets.missing, duplicates, skipped, failed };
  }, [outcomes, validationBuckets]);

  if (buckets == null) {
    return (
      <div className="pre-submit-gate-overlay">
        <div className="pre-submit-gate"><p>{t('bulkAdd.gate.checking')}</p></div>
      </div>
    );
  }

  // Compute the rows that will be created based on current selections.
  const rowIdsToCreate = useMemo(() => {
    const out = new Set<string>(buckets.ready.map((r) => r.id));
    for (const d of buckets.duplicates) {
      const choice = duplicateChoices[d.row.id] ?? 'skip';
      if (choice === 'save_anyway') out.add(d.row.id);
    }
    return [...out];
  }, [buckets, duplicateChoices]);

  return (
    <div className="pre-submit-gate-overlay">
      <div className="pre-submit-gate">
        <header>
          <h2>{t('bulkAdd.gate.title')}</h2>
          <button onClick={onCancel} className="pre-submit-gate__close" aria-label={t('common.close')}>&times;</button>
        </header>

        <Section
          label={t('bulkAdd.gate.ready')}
          count={buckets.ready.length}
          tone="ready"
        />
        <Section
          label={t('bulkAdd.gate.missing')}
          count={buckets.missing.length}
          tone="warn"
          renderBody={() => (
            <ul>
              {buckets.missing.map(({ row, errors }) => (
                <li key={row.id}>
                  <strong>{row.source}</strong>: {Object.keys(errors).join(', ')}
                  <button onClick={() => onCancelAndEdit(row.id)}>{t('bulkAdd.gate.edit')}</button>
                </li>
              ))}
            </ul>
          )}
        />
        <Section
          label={t('bulkAdd.gate.duplicates')}
          count={buckets.duplicates.length}
          tone="warn"
          renderBody={() => (
            <ul>
              {buckets.duplicates.map(({ row, matches }) => {
                const choice = duplicateChoices[row.id] ?? 'skip';
                return (
                  <li key={row.id}>
                    <div>
                      <strong>{String(row.values.first_name ?? '')} {String(row.values.last_name ?? '')}</strong>
                      {' — matches '}{matches.length}{' existing'}
                    </div>
                    <div className="pre-submit-gate__choices">
                      <label>
                        <input
                          type="radio"
                          checked={choice === 'skip'}
                          onChange={() => setDuplicateChoices((p) => ({ ...p, [row.id]: 'skip' }))}
                        /> {t('bulkAdd.gate.choiceSkip')}
                      </label>
                      <label>
                        <input
                          type="radio"
                          checked={choice === 'save_anyway'}
                          onChange={() => setDuplicateChoices((p) => ({ ...p, [row.id]: 'save_anyway' }))}
                        /> {t('bulkAdd.gate.choiceSaveAnyway')}
                      </label>
                      <button onClick={() => onCancelAndEdit(row.id)}>{t('bulkAdd.gate.choiceEdit')}</button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        />
        <Section
          label={t('bulkAdd.gate.skipped')}
          count={buckets.skipped.length}
          tone="info"
          renderBody={() => (
            <ul>
              {buckets.skipped.map(({ row, missingFields }) => (
                <li key={row.id}>
                  <strong>{row.source}</strong>: {t('bulkAdd.gate.skippedFields')} {missingFields.join(', ')}
                </li>
              ))}
            </ul>
          )}
        />
        <Section
          label={t('bulkAdd.gate.failed')}
          count={buckets.failed.length}
          tone="error"
          renderBody={() => (
            <ul>
              {buckets.failed.map(({ row, error }) => (
                <li key={row.id}>
                  <strong>{row.source}</strong>: {error}
                </li>
              ))}
            </ul>
          )}
        />

        <footer className="pre-submit-gate__footer">
          <p>{t('bulkAdd.gate.willCreate').replace('{n}', String(rowIdsToCreate.length))}</p>
          <div>
            <button onClick={onCancel}>{t('common.cancel')}</button>
            <button
              className="pre-submit-gate__confirm"
              disabled={rowIdsToCreate.length === 0}
              onClick={() => onConfirm({ rowIdsToCreate, duplicateChoices })}
            >
              {t('bulkAdd.gate.confirm')}
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}

function Section({
  label, count, tone, renderBody,
}: {
  label: string; count: number; tone: 'ready' | 'warn' | 'error' | 'info';
  renderBody?: () => React.ReactNode;
}) {
  const [expanded, setExpanded] = useState(false);
  return (
    <details
      className={`pre-submit-gate__section pre-submit-gate__section--${tone}`}
      open={expanded}
      onToggle={(e) => setExpanded((e.target as HTMLDetailsElement).open)}
    >
      <summary>
        {label} <span className="pre-submit-gate__count">({count})</span>
      </summary>
      {renderBody && count > 0 && <div className="pre-submit-gate__body">{renderBody()}</div>}
    </details>
  );
}
```

- [ ] **Step 2: Write the CSS**

```css
/* admindash/frontend/src/components/PreSubmitGate.css */
.pre-submit-gate-overlay {
  position: fixed; inset: 0;
  background: rgba(0, 0, 0, 0.5);
  z-index: 80;
  display: flex; align-items: center; justify-content: center;
}
.pre-submit-gate {
  background: white;
  border-radius: 8px;
  width: 600px; max-width: 90vw;
  max-height: 80vh; overflow-y: auto;
  padding: 20px;
}
.pre-submit-gate header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; }
.pre-submit-gate header h2 { margin: 0; font-size: 18px; }
.pre-submit-gate__close { background: none; border: none; font-size: 22px; cursor: pointer; color: var(--color-text-muted, #6b7280); }
.pre-submit-gate__section { margin-bottom: 8px; padding: 8px; border-radius: 6px; border: 1px solid var(--color-border, #e5e7eb); }
.pre-submit-gate__section--ready { background: var(--color-success-subtle, #f0fdf4); }
.pre-submit-gate__section--warn { background: var(--color-warning-subtle, #fef3c7); }
.pre-submit-gate__section--error { background: var(--color-error-subtle, #fef2f2); }
.pre-submit-gate__section--info { background: var(--color-info-subtle, #eff6ff); }
.pre-submit-gate__count { color: var(--color-text-muted, #6b7280); font-weight: 400; }
.pre-submit-gate__body { padding: 8px 0; }
.pre-submit-gate__body ul { list-style: none; padding-left: 0; margin: 0; }
.pre-submit-gate__body li { padding: 6px 0; border-top: 1px solid rgba(0,0,0,0.05); }
.pre-submit-gate__body li:first-child { border-top: none; }
.pre-submit-gate__choices { margin-top: 4px; display: flex; gap: 12px; align-items: center; font-size: 13px; }
.pre-submit-gate__choices button {
  padding: 2px 8px; border: 1px solid var(--color-border, #d1d5db);
  border-radius: 4px; background: white; cursor: pointer; font-size: 12px;
}
.pre-submit-gate__footer {
  margin-top: 16px;
  display: flex; justify-content: space-between; align-items: center;
  padding-top: 12px; border-top: 1px solid var(--color-border, #e5e7eb);
}
.pre-submit-gate__footer p { margin: 0; font-weight: 500; }
.pre-submit-gate__footer button {
  margin-left: 8px;
  padding: 8px 16px;
  border-radius: 6px;
  cursor: pointer;
  border: 1px solid var(--color-border, #d1d5db);
  background: white;
}
.pre-submit-gate__confirm {
  background: var(--color-primary, #2563eb) !important;
  color: white;
  border-color: var(--color-primary, #2563eb) !important;
}
.pre-submit-gate__confirm:disabled { opacity: 0.5; cursor: not-allowed; }
```

---

### Task 9.2: Wire the gate + create fan-out into the page

**Files:**
- Modify: `admindash/frontend/src/pages/BulkAddStudentsPage.tsx`

- [ ] **Step 1: Add gate visibility state and handlers**

```tsx
import PreSubmitGate, { type GateConfirmation } from '../components/PreSubmitGate.tsx';
import { bulkCreateStudents } from '../api/bulkAddOrchestrators.ts';
// ...

const [gateOpen, setGateOpen] = useState(false);

const handleCreateAll = () => {
  if (rows.length === 0) return;
  setGateOpen(true);
};

const submitFromGate = async (c: GateConfirmation) => {
  setGateOpen(false);
  setPhase('submitting');

  // Mark each selected row as 'creating'.
  const creating = c.rowIdsToCreate;
  setRows((prev) =>
    prev.map((r) => (creating.includes(r.id) ? { ...r, status: 'creating' } : r)),
  );

  // Build payloads — strip student_id from base if it has no explicit value (matches single-add).
  const baseFieldNames = new Set(modelDef.base_fields.map((f) => f.name));
  const customFieldNames = new Set(modelDef.custom_fields.map((f) => f.name));
  const payloads = creating
    .map((id) => rows.find((r) => r.id === id))
    .filter((r): r is BulkRow => r != null)
    .map((r) => {
      const baseData: Record<string, unknown> = {};
      const customFields: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(r.values)) {
        if (k === 'student_id' && (v == null || String(v).trim() === '')) continue;
        if (baseFieldNames.has(k)) baseData[k] = v;
        else if (customFieldNames.has(k)) customFields[k] = v;
      }
      return { rowId: r.id, baseData, customFields };
    });

  await bulkCreateStudents({
    tenantId: tenant,
    payloads,
    onRowResult: (rowId, outcome) => {
      if (outcome.kind === 'created') {
        updateRow(rowId, {
          status: 'created',
          assignedStudentId: outcome.assignedStudentId,
          error: undefined,
        });
      } else {
        updateRow(rowId, {
          status: 'failed',
          error: { source: 'create', message: outcome.error },
        });
      }
    },
  });

  setPhase('post_submit');
};
```

- [ ] **Step 2: Render the gate**

```tsx
{gateOpen && (
  <PreSubmitGate
    rows={rows.filter((r) =>
      r.status === 'ready' || r.status === 'has_errors' ||
      r.status === 'failed' || r.status === 'pending'
    )}
    modelDef={modelDef}
    tenantId={tenant}
    onCancel={() => setGateOpen(false)}
    onConfirm={(c) => { void submitFromGate(c); }}
    onCancelAndEdit={(rowId) => {
      setGateOpen(false);
      const idx = rows.findIndex((r) => r.id === rowId);
      if (idx >= 0) setActiveDrawerIndex(idx);
    }}
  />
)}
```

- [ ] **Step 3: Add the "Create All" button**

In the review-phase block, immediately above `BulkReviewTable`:

```tsx
{phase === 'review' && (
  <div className="bulk-add-page__toolbar">
    <button
      className="bulk-add-page__btn-primary"
      disabled={rows.length === 0}
      title={rows.length === 0 ? t('bulkAdd.toolbar.noRows') : undefined}
      onClick={handleCreateAll}
    >
      {t('bulkAdd.toolbar.createAll').replace('{n}', String(rows.length))}
    </button>
  </div>
)}
```

Append to `BulkAddStudentsPage.css`:
```css
.bulk-add-page__toolbar {
  display: flex; gap: 8px;
  margin-bottom: 12px;
  justify-content: flex-end;
}
.bulk-add-page__btn-primary:disabled {
  opacity: 0.5; cursor: not-allowed;
}
```

- [ ] **Step 4: Lint + type-check + build**

```
npx tsc -b --noEmit
npm run lint
npm run build
```
Expected: all pass.

- [ ] **Step 5: Commit Phase 9**

```bash
cd /Users/kennylee/Development/NeoApex
git add admindash/frontend/src/components/PreSubmitGate.tsx \
  admindash/frontend/src/components/PreSubmitGate.css \
  admindash/frontend/src/pages/BulkAddStudentsPage.tsx \
  admindash/frontend/src/pages/BulkAddStudentsPage.css
git commit -m "$(cat <<'EOF'
feat(admindash): bulk-add pre-submit gate and create fan-out

Adds the PreSubmitGate modal with five buckets (Ready, Missing
required, Potential duplicates, Dup-check skipped, Dup-check failed).
Validation runs locally via validateRowAgainstModel; dup-check fan-out
runs on the eligibility-pruned subset. Per-duplicate row choices
(Skip default, Save anyway, Cancel & edit) feed into the live "rows
that will be created" counter. On confirm, payloads strip empty
student_id (matching single-add) and route through bulkCreateStudents
with bounded parallelism. Successful rows transition to 'created'
with their assigned IDs; failed rows retain editability.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Phase 10 — Post-submit, retry-failed, success disclosure

### Task 10.1: PostSubmitSummary + CreatedStudentsDisclosure

**Files:**
- Create: `admindash/frontend/src/components/PostSubmitSummary.tsx`
- Create: `admindash/frontend/src/components/PostSubmitSummary.css`
- Create: `admindash/frontend/src/components/CreatedStudentsDisclosure.tsx`
- Create: `admindash/frontend/src/components/CreatedStudentsDisclosure.css`

- [ ] **Step 1: Write PostSubmitSummary**

```tsx
// admindash/frontend/src/components/PostSubmitSummary.tsx
import { useTranslation } from '../hooks/useTranslation.ts';
import './PostSubmitSummary.css';

interface Props {
  successCount: number;
  failedCount: number;
  onRetryFailed: () => void;
  onDone: () => void;
}

export default function PostSubmitSummary({
  successCount, failedCount, onRetryFailed, onDone,
}: Props) {
  const { t } = useTranslation();
  return (
    <div className="post-submit-summary">
      <div className="post-submit-summary__counts">
        <span className="post-submit-summary__success">
          {t('bulkAdd.postSubmit.success').replace('{n}', String(successCount))}
        </span>
        {failedCount > 0 && (
          <span className="post-submit-summary__failed">
            {t('bulkAdd.postSubmit.failed').replace('{n}', String(failedCount))}
          </span>
        )}
      </div>
      <div className="post-submit-summary__actions">
        {failedCount > 0 && (
          <button
            className="post-submit-summary__btn-retry"
            onClick={onRetryFailed}
          >
            {t('bulkAdd.postSubmit.retryFailed').replace('{n}', String(failedCount))}
          </button>
        )}
        <button
          className="post-submit-summary__btn-done"
          onClick={onDone}
        >
          {t('bulkAdd.postSubmit.done')}
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Write CreatedStudentsDisclosure**

```tsx
// admindash/frontend/src/components/CreatedStudentsDisclosure.tsx
import { Link } from 'react-router-dom';
import { useTranslation } from '../hooks/useTranslation.ts';
import type { BulkRow } from '../types/bulkAdd.ts';
import './CreatedStudentsDisclosure.css';

interface Props {
  rows: BulkRow[];
  defaultOpen?: boolean;
}

export default function CreatedStudentsDisclosure({ rows, defaultOpen = false }: Props) {
  const { t } = useTranslation();
  if (rows.length === 0) return null;
  return (
    <details className="created-disclosure" open={defaultOpen}>
      <summary>
        {t('bulkAdd.disclosure.label').replace('{n}', String(rows.length))}
      </summary>
      <ul>
        {rows.map((r) => (
          <li key={r.id}>
            <span>{String(r.values.first_name ?? '')} {String(r.values.last_name ?? '')}</span>
            <span className="created-disclosure__id">
              {r.assignedStudentId && (
                <Link to={`/students?id=${encodeURIComponent(r.assignedStudentId)}`}>
                  {r.assignedStudentId}
                </Link>
              )}
            </span>
            <span className="created-disclosure__source">{r.source}</span>
          </li>
        ))}
      </ul>
    </details>
  );
}
```

- [ ] **Step 3: Write the matching CSS files**

```css
/* admindash/frontend/src/components/PostSubmitSummary.css */
.post-submit-summary {
  background: var(--color-bg-subtle, #f9fafb);
  border-radius: 8px;
  padding: 16px;
  display: flex; justify-content: space-between; align-items: center;
  margin-bottom: 16px;
}
.post-submit-summary__counts { display: flex; gap: 12px; }
.post-submit-summary__success {
  font-weight: 500; color: var(--color-success, #065f46);
}
.post-submit-summary__failed {
  font-weight: 500; color: var(--color-error, #b91c1c);
}
.post-submit-summary__actions { display: flex; gap: 8px; }
.post-submit-summary__btn-retry,
.post-submit-summary__btn-done {
  padding: 6px 12px; border-radius: 6px; cursor: pointer;
}
.post-submit-summary__btn-retry {
  background: var(--color-warning, #d97706);
  color: white; border: 1px solid var(--color-warning, #d97706);
}
.post-submit-summary__btn-done {
  background: var(--color-primary, #2563eb);
  color: white; border: 1px solid var(--color-primary, #2563eb);
}
```

```css
/* admindash/frontend/src/components/CreatedStudentsDisclosure.css */
.created-disclosure { margin: 12px 0; }
.created-disclosure summary { cursor: pointer; font-weight: 500; }
.created-disclosure ul { list-style: none; padding: 12px 0; margin: 0; }
.created-disclosure li {
  display: grid;
  grid-template-columns: 1fr 120px 1fr;
  padding: 4px 0;
  font-size: 13px;
}
.created-disclosure__id { font-family: monospace; }
.created-disclosure__source { color: var(--color-text-muted, #6b7280); }
```

---

### Task 10.2: Wire post-submit state into the page

**Files:**
- Modify: `admindash/frontend/src/pages/BulkAddStudentsPage.tsx`

- [ ] **Step 1: Import + render**

```tsx
import PostSubmitSummary from '../components/PostSubmitSummary.tsx';
import CreatedStudentsDisclosure from '../components/CreatedStudentsDisclosure.tsx';
// ...
const successRows = rows.filter((r) => r.status === 'created');
const failedRows = rows.filter((r) => r.status === 'failed');
const allDone = phase === 'post_submit' && failedRows.length === 0;

const handleRetryFailed = async () => {
  // Re-route through the gate against just the failed rows.
  const failedIds = failedRows.map((r) => r.id);
  setRows((prev) =>
    prev.map((r) => (failedIds.includes(r.id) ? { ...r, status: 'pending', error: undefined } : r)),
  );
  setPhase('review');
  setGateOpen(true);
};

const handleDone = () => {
  if (allDone) {
    void deleteDraft(buildDraftId(tenant, batchId));
  }
  navigate('/students');
};
```

In the JSX, render the post-submit UI:

```tsx
{phase === 'post_submit' && (
  <>
    <PostSubmitSummary
      successCount={successRows.length}
      failedCount={failedRows.length}
      onRetryFailed={() => { void handleRetryFailed(); }}
      onDone={handleDone}
    />
    {failedRows.length > 0 && (
      <BulkReviewTable
        rows={failedRows}
        modelDef={modelDef}
        onEditRow={(rowId) => {
          const idx = rows.findIndex((r) => r.id === rowId);
          if (idx >= 0) setActiveDrawerIndex(idx);
        }}
        onDeleteRow={(rowId) => {
          setRows((prev) => prev.filter((r) => r.id !== rowId));
        }}
        onRetryExtract={() => { /* not applicable in post_submit */ }}
      />
    )}
    <CreatedStudentsDisclosure rows={successRows} defaultOpen={allDone} />
  </>
)}
```

- [ ] **Step 2: Type-check + lint + build**

```
npx tsc -b --noEmit
npm run lint
npm run build
```
Expected: all pass.

- [ ] **Step 3: Commit Phase 10**

```bash
cd /Users/kennylee/Development/NeoApex
git add admindash/frontend/src/components/PostSubmitSummary.tsx \
  admindash/frontend/src/components/PostSubmitSummary.css \
  admindash/frontend/src/components/CreatedStudentsDisclosure.tsx \
  admindash/frontend/src/components/CreatedStudentsDisclosure.css \
  admindash/frontend/src/pages/BulkAddStudentsPage.tsx
git commit -m "$(cat <<'EOF'
feat(admindash): bulk-add post-submit and retry-failed loop

Adds PostSubmitSummary (success/failure counts + Retry failed + Done
& return) and CreatedStudentsDisclosure (collapsed by default, links
each created row to its student detail page by assigned ID). Retry
failed re-routes through the existing gate + create fan-out against
just the failed rows. On all-success Done, the IndexedDB draft is
deleted before navigating back to /students.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Phase 11 — Cancel and discard

### Task 11.1: Cancel during upload + extracting phases

**Files:**
- Modify: `admindash/frontend/src/pages/BulkAddStudentsPage.tsx`

The page header already has a Cancel button (Phase 3). Wire its behavior to differ by phase.

- [ ] **Step 1: Replace the header Cancel button with phase-aware logic**

Locate the header Cancel button:
```tsx
<button
  className="bulk-add-page__btn-secondary"
  onClick={() => navigate('/students')}
>
  {t('common.cancel')}
</button>
```

Replace with:
```tsx
{(phase === 'mode_select' || phase === 'uploading') && (
  <button
    className="bulk-add-page__btn-secondary"
    onClick={() => navigate('/students')}
  >
    {t('common.cancel')}
  </button>
)}
{phase === 'extracting' && (
  <button
    className="bulk-add-page__btn-secondary"
    onClick={() => {
      // In-flight extracts are allowed to settle; we just navigate away.
      // No IndexedDB draft has been created yet (review phase boundary).
      navigate('/students');
    }}
  >
    {t('common.cancel')}
  </button>
)}
{(phase === 'review' || phase === 'post_submit') && (
  <button
    className="bulk-add-page__btn-secondary"
    onClick={() => {
      if (window.confirm(t('bulkAdd.discardConfirm'))) {
        void deleteDraft(buildDraftId(tenant, batchId));
        navigate('/students');
      }
    }}
  >
    {t('bulkAdd.discardBatch')}
  </button>
)}
{phase === 'submitting' && (
  <button className="bulk-add-page__btn-secondary" disabled>
    {t('bulkAdd.submittingDisabled')}
  </button>
)}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc -b --noEmit`
Expected: PASS.

---

### Task 11.2: Commit Phase 11

- [ ] **Step 1: Commit**

```bash
cd /Users/kennylee/Development/NeoApex
git add admindash/frontend/src/pages/BulkAddStudentsPage.tsx
git commit -m "$(cat <<'EOF'
feat(admindash): bulk-add cancel and discard semantics

Phase-aware header button: Cancel during upload + extracting (in-flight
extracts allowed to settle, navigate away — no IndexedDB draft was
created), Discard with confirmation during review + post_submit (deletes
draft from IndexedDB then navigates), disabled during submitting.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Phase 12 — Internationalization

### Task 12.1: Add all translation keys

**Files:**
- Modify: `admindash/frontend/src/i18n/translations.ts`

- [ ] **Step 1: Add keys to `en-US`**

Inside the `'en-US'` block, add (kept in `bulkAdd.*` flat-key form):

```ts
    // Bulk add
    'bulkAdd.title': 'Bulk Add Students',
    'bulkAdd.entryButton': 'Bulk add',
    'bulkAdd.noModelConfigured': 'No student model configured. Configure a model in Papermite first.',
    'bulkAdd.backToStudents': 'Back to Students',
    'bulkAdd.modeSelectPrompt': 'Choose a mode to begin.',
    'bulkAdd.modeSelect.documents': 'Upload Application Documents',
    'bulkAdd.modeSelect.documentsDesc': 'Drop multiple PDFs / DOCX / TXT files. Each file becomes one student record.',
    'bulkAdd.modeSelect.csv': 'Upload CSV',
    'bulkAdd.modeSelect.csvDesc': 'Drop a single CSV file. Each row becomes one student record.',
    'bulkAdd.dropzone.docsTitle': 'Drop documents here, or click to choose files',
    'bulkAdd.dropzone.docsHint': 'PDF, DOCX, or TXT — up to {cap} files per batch',
    'bulkAdd.dropzone.csvTitle': 'Drop CSV here, or click to choose a file',
    'bulkAdd.dropzone.csvHint': 'Header row required — up to {cap} data rows',
    'bulkAdd.errors.tooManyDocuments': 'Too many files — the cap is {cap} per batch.',
    'bulkAdd.errors.unsupportedFiles': 'Unsupported files skipped: {names}',
    'bulkAdd.mapping.title': 'Map CSV columns to fields',
    'bulkAdd.mapping.subtitle': 'Auto-matched columns are pre-filled. Map the rest or skip.',
    'bulkAdd.mapping.csvHeader': 'CSV column',
    'bulkAdd.mapping.modelField': 'Maps to',
    'bulkAdd.mapping.skip': '— Skip —',
    'bulkAdd.mapping.apply': 'Apply mapping',
    'bulkAdd.mapping.missingRequired': 'Required fields not mapped: {fields}',
    'bulkAdd.progress.label': 'Extracted {done} of {total} ({failed} failed)',
    'bulkAdd.table.status': 'Status',
    'bulkAdd.table.name': 'Name',
    'bulkAdd.table.dob': 'DOB',
    'bulkAdd.table.source': 'Source',
    'bulkAdd.table.issues': 'Issues',
    'bulkAdd.table.actions': 'Actions',
    'bulkAdd.table.edit': 'Edit',
    'bulkAdd.table.delete': 'Delete',
    'bulkAdd.table.retryExtract': 'Retry',
    'bulkAdd.status.extracting': 'Extracting…',
    'bulkAdd.status.extract_failed': 'Extract failed',
    'bulkAdd.status.ready': 'Ready',
    'bulkAdd.status.has_errors': 'Has errors',
    'bulkAdd.status.pending': 'Pending',
    'bulkAdd.status.creating': 'Creating…',
    'bulkAdd.status.created': 'Created',
    'bulkAdd.status.failed': 'Failed',
    'bulkAdd.drawer.title': 'Edit row {n}',
    'bulkAdd.drawer.prev': 'Previous',
    'bulkAdd.drawer.next': 'Next',
    'bulkAdd.drawer.discardPrompt': 'Discard unsaved changes?',
    'bulkAdd.drawer.discard': 'Discard',
    'bulkAdd.toolbar.createAll': 'Create All ({n})',
    'bulkAdd.toolbar.noRows': 'No rows to submit',
    'bulkAdd.gate.title': 'Review before creating',
    'bulkAdd.gate.checking': 'Validating and checking for duplicates…',
    'bulkAdd.gate.ready': 'Ready',
    'bulkAdd.gate.missing': 'Missing required fields',
    'bulkAdd.gate.duplicates': 'Potential duplicates',
    'bulkAdd.gate.skipped': 'Dup-check skipped',
    'bulkAdd.gate.skippedFields': 'missing dup-check fields:',
    'bulkAdd.gate.failed': 'Dup-check failed',
    'bulkAdd.gate.willCreate': '{n} rows will be created.',
    'bulkAdd.gate.confirm': 'Confirm and create',
    'bulkAdd.gate.choiceSkip': 'Skip',
    'bulkAdd.gate.choiceSaveAnyway': 'Save anyway',
    'bulkAdd.gate.choiceEdit': 'Cancel & edit',
    'bulkAdd.gate.edit': 'Edit',
    'bulkAdd.postSubmit.success': '{n} students created',
    'bulkAdd.postSubmit.failed': '{n} failed',
    'bulkAdd.postSubmit.retryFailed': 'Retry failed ({n})',
    'bulkAdd.postSubmit.done': 'Done & return to Students',
    'bulkAdd.disclosure.label': '{n} students created — click to view IDs',
    'bulkAdd.resume.title': 'Unfinished batch found',
    'bulkAdd.resume.rowCount': '{n} rows',
    'bulkAdd.resume.resume': 'Resume',
    'bulkAdd.resume.discardThis': 'Discard',
    'bulkAdd.resume.discardAll': 'Discard all',
    'bulkAdd.resume.othersLabel': '{n} other unfinished batches',
    'bulkAdd.discardBatch': 'Discard batch',
    'bulkAdd.discardConfirm': 'Discard this batch? Unsaved rows will be lost.',
    'bulkAdd.submittingDisabled': 'Submitting…',
```

- [ ] **Step 2: Add the same keys to `zh-CN`**

Inside the `'zh-CN'` block, add the matching keys with translated values. (For brevity, the implementer should translate using existing terminology. A starting set:)

```ts
    'bulkAdd.title': '批量添加学生',
    'bulkAdd.entryButton': '批量添加',
    'bulkAdd.noModelConfigured': '尚未配置学生模型，请先在 Papermite 中配置。',
    'bulkAdd.backToStudents': '返回学生列表',
    'bulkAdd.modeSelectPrompt': '请选择一种模式开始。',
    'bulkAdd.modeSelect.documents': '上传申请文件',
    'bulkAdd.modeSelect.documentsDesc': '拖入多份 PDF/DOCX/TXT 文件，每份对应一名学生。',
    'bulkAdd.modeSelect.csv': '上传 CSV',
    'bulkAdd.modeSelect.csvDesc': '拖入一份 CSV 文件，每行对应一名学生。',
    'bulkAdd.dropzone.docsTitle': '将文件拖到这里，或点击选择',
    'bulkAdd.dropzone.docsHint': 'PDF / DOCX / TXT — 每批最多 {cap} 份',
    'bulkAdd.dropzone.csvTitle': '将 CSV 拖到这里，或点击选择',
    'bulkAdd.dropzone.csvHint': '需要表头行 — 最多 {cap} 行数据',
    'bulkAdd.errors.tooManyDocuments': '文件过多 — 每批最多 {cap} 份。',
    'bulkAdd.errors.unsupportedFiles': '已跳过不支持的文件：{names}',
    'bulkAdd.mapping.title': '将 CSV 列映射到字段',
    'bulkAdd.mapping.subtitle': '已自动匹配的列已预填，其他列请手动映射或跳过。',
    'bulkAdd.mapping.csvHeader': 'CSV 列',
    'bulkAdd.mapping.modelField': '映射到',
    'bulkAdd.mapping.skip': '— 跳过 —',
    'bulkAdd.mapping.apply': '应用映射',
    'bulkAdd.mapping.missingRequired': '未映射的必填字段：{fields}',
    'bulkAdd.progress.label': '已提取 {done} / {total}（{failed} 失败）',
    'bulkAdd.table.status': '状态',
    'bulkAdd.table.name': '姓名',
    'bulkAdd.table.dob': '出生日期',
    'bulkAdd.table.source': '来源',
    'bulkAdd.table.issues': '问题',
    'bulkAdd.table.actions': '操作',
    'bulkAdd.table.edit': '编辑',
    'bulkAdd.table.delete': '删除',
    'bulkAdd.table.retryExtract': '重试',
    'bulkAdd.status.extracting': '提取中…',
    'bulkAdd.status.extract_failed': '提取失败',
    'bulkAdd.status.ready': '就绪',
    'bulkAdd.status.has_errors': '有错误',
    'bulkAdd.status.pending': '待处理',
    'bulkAdd.status.creating': '创建中…',
    'bulkAdd.status.created': '已创建',
    'bulkAdd.status.failed': '失败',
    'bulkAdd.drawer.title': '编辑第 {n} 行',
    'bulkAdd.drawer.prev': '上一条',
    'bulkAdd.drawer.next': '下一条',
    'bulkAdd.drawer.discardPrompt': '放弃未保存的修改？',
    'bulkAdd.drawer.discard': '放弃',
    'bulkAdd.toolbar.createAll': '全部创建（{n}）',
    'bulkAdd.toolbar.noRows': '没有可提交的行',
    'bulkAdd.gate.title': '创建前确认',
    'bulkAdd.gate.checking': '正在校验与查重…',
    'bulkAdd.gate.ready': '就绪',
    'bulkAdd.gate.missing': '缺少必填字段',
    'bulkAdd.gate.duplicates': '可能的重复项',
    'bulkAdd.gate.skipped': '跳过查重',
    'bulkAdd.gate.skippedFields': '查重所需字段缺失：',
    'bulkAdd.gate.failed': '查重失败',
    'bulkAdd.gate.willCreate': '将创建 {n} 条记录。',
    'bulkAdd.gate.confirm': '确认创建',
    'bulkAdd.gate.choiceSkip': '跳过',
    'bulkAdd.gate.choiceSaveAnyway': '仍然创建',
    'bulkAdd.gate.choiceEdit': '取消并编辑',
    'bulkAdd.gate.edit': '编辑',
    'bulkAdd.postSubmit.success': '已创建 {n} 名学生',
    'bulkAdd.postSubmit.failed': '{n} 条失败',
    'bulkAdd.postSubmit.retryFailed': '重试失败项（{n}）',
    'bulkAdd.postSubmit.done': '完成并返回学生列表',
    'bulkAdd.disclosure.label': '已创建 {n} 名学生 — 点击查看 ID',
    'bulkAdd.resume.title': '发现未完成的批次',
    'bulkAdd.resume.rowCount': '{n} 条',
    'bulkAdd.resume.resume': '继续',
    'bulkAdd.resume.discardThis': '丢弃',
    'bulkAdd.resume.discardAll': '全部丢弃',
    'bulkAdd.resume.othersLabel': '{n} 个其他未完成的批次',
    'bulkAdd.discardBatch': '丢弃批次',
    'bulkAdd.discardConfirm': '丢弃此批次？未保存的行将丢失。',
    'bulkAdd.submittingDisabled': '提交中…',
```

- [ ] **Step 3: Type-check + build**

```
npx tsc -b --noEmit
npm run build
```
Expected: PASS.

- [ ] **Step 4: Commit Phase 12**

```bash
cd /Users/kennylee/Development/NeoApex
git add admindash/frontend/src/i18n/translations.ts
git commit -m "$(cat <<'EOF'
feat(admindash): bulk-add translations en-US + zh-CN

Adds the bulkAdd.* flat translation keys for every user-facing string
in the bulk-add page (mode select, dropzones, CSV mapping, table,
drawer, gate, post-submit, resume prompt, cancel/discard flows).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Phase 13 — Verification (no commit)

This phase exercises the full feature end-to-end. None of these steps produce a commit; they produce confidence.

### Task 13.1: Static checks

- [ ] **Step 1: Lint + type-check + build**

```bash
cd /Users/kennylee/Development/NeoApex/admindash/frontend
npm run lint
npm run build
```
Both must pass with no errors.

### Task 13.2: Documents-mode happy path

- [ ] **Step 1: Start backends**

In one terminal:
```bash
cd /Users/kennylee/Development/NeoApex && ./start-services.sh
```

- [ ] **Step 2: Start the frontend**

```bash
cd /Users/kennylee/Development/NeoApex/admindash/frontend && npm run dev
```

- [ ] **Step 3: Smoke test**

In a browser:
1. Log in to AdminDash as an admin.
2. Click "Students" in the nav, then click "Bulk add."
3. Pick "Documents," drop 5 valid `.pdf` files (use any 5 sample apps from `papermite/sampledoc/`).
4. Watch the progress bar reach 5/5.
5. Open the drawer on row 1, verify all extracted fields are populated, save.
6. Click "Create All (5)."
7. In the gate, verify all 5 are in Ready, click Confirm.
8. Verify all 5 transition to "Created" and the success disclosure shows 5 IDs.

### Task 13.3: CSV-mode happy path

- [ ] **Step 1: Prepare a 5-row test CSV**

```csv
first_name,last_name,dob,primary_address
Alice,Smith,2014-05-12,123 Main St
Bob,Jones,2013-08-03,456 Elm Ave
Carol,Davis,2015-01-22,789 Oak Rd
Dan,Miller,2014-11-09,321 Pine St
Eve,Wilson,2013-04-18,654 Maple Ln
```

Save as `/tmp/bulk-test.csv`.

- [ ] **Step 2: Smoke test**

In the browser, navigate to `/students/bulk-add`. Pick "Upload CSV." Drop `/tmp/bulk-test.csv`. In the mapping screen all four columns should be auto-mapped. Click "Apply mapping." Verify 5 rows in review state. Click "Create All." Verify all 5 created.

### Task 13.4: Resume-mid-review

- [ ] **Step 1: Start a documents batch but don't submit**

Upload 3 docs, wait for extract to finish. Edit row 1 in drawer (change a field). Reload the browser tab.

- [ ] **Step 2: Verify resume prompt**

Resume prompt should appear with "3 rows" and a recent timestamp. Click Resume. Verify all 3 rows are restored with the edit you made.

### Task 13.5: Duplicate detection

- [ ] **Step 1: Trigger a duplicate**

Take an existing student record's `first_name`, `last_name`, `dob`, and `primary_address`. Create a CSV containing one row with exactly those values plus three other unique rows. Upload, map, run gate.

- [ ] **Step 2: Verify gate flags the duplicate**

The "Potential duplicates" section should contain the matched row. Click "Save anyway." Confirm. Verify the row is created (despite the duplicate match).

- [ ] **Step 3: Repeat with "Skip"**

Create another duplicate row. In the gate, leave the choice as "Skip" (default). Confirm. Verify only the non-duplicate rows are created.

### Task 13.6: Failed-row retry

- [ ] **Step 1: Trigger a create failure**

Upload a CSV where one row has a `dob` value the backend will reject (e.g., the field type is `date` but the value is "not-a-date"). Confirm the gate; the row will fail at create time.

- [ ] **Step 2: Verify post-submit state**

Verify the post-submit summary shows "N succeeded, 1 failed." Verify the failed row is editable in the table. Open the drawer, fix the bad value, save. Click "Retry failed (1)." Verify the row creates.

### Task 13.7: i18n smoke

- [ ] **Step 1: Switch locale**

Use the language switcher in the navbar to set `zh-CN`.

- [ ] **Step 2: Walk the entire flow**

Navigate to bulk-add, mode select, upload, map (CSV), review, gate, post-submit. Verify no English strings appear anywhere.

### Task 13.8: Document cap override

- [ ] **Step 1: Build with override**

```bash
cd /Users/kennylee/Development/NeoApex/admindash/frontend
VITE_BULK_ADD_DOCUMENT_CAP=10 VITE_BULK_ADD_CSV_ROW_CAP=20 npm run build
```

- [ ] **Step 2: Serve the production build**

```bash
npm run preview
```

- [ ] **Step 3: Verify caps are 10 / 20**

In the preview, attempt to drop 11 documents — message references "10." Attempt to upload a CSV with 21 rows — error references "20."

### Task 13.9: Concurrency override

- [ ] **Step 1: Build with `VITE_BULK_ADD_CONCURRENCY=2`**

```bash
VITE_BULK_ADD_CONCURRENCY=2 npm run build && npm run preview
```

- [ ] **Step 2: Verify only 2 concurrent extracts**

Open DevTools → Network. Drop 10 documents. Throughout the run, no more than 2 extract requests should be in `Pending` state simultaneously.

### Task 13.10: Drawer remount (no value leak)

- [ ] **Step 1: Setup**

Upload 2 documents whose `first_name` extracts differ (or set them via drawer to differ).

- [ ] **Step 2: Test Prev/Next**

Open drawer on row 1, verify `first_name = "Alice"`. Click Next. Row 2's `first_name` MUST be empty (not "Alice"). Click Prev. Row 1 still shows "Alice."

### Task 13.11: CSV BOM

- [ ] **Step 1: Prepare a CSV with BOM**

```bash
printf '\xEF\xBB\xBF' > /tmp/bom-test.csv
cat <<'EOF' >> /tmp/bom-test.csv
first_name,last_name,dob,primary_address
Alice,Smith,2014-05-12,123 Main St
EOF
```

- [ ] **Step 2: Upload and verify**

Upload `/tmp/bom-test.csv`. The mapping screen should show `first_name` (not `﻿first_name`) as the first header, and it should auto-match.

### Task 13.12: CSV multi-select split

- [ ] **Step 1: Prepare a CSV mapped to a multi-select field**

If your tenant model has any `selection` field with `multiple: true`, prepare a CSV with that column. Use the value `"reading; math; science"` for one row.

- [ ] **Step 2: Verify split**

In the drawer for that row, the field's checkboxes should be checked for "reading," "math," and "science." Submit and confirm the created entity carries the array.

### Task 13.13: No-active-model state

- [ ] **Step 1: Set up a tenant with no student model**

Use a fresh tenant (or temporarily archive the active student model in Papermite for a test tenant).

- [ ] **Step 2: Verify error state**

Navigate to `/students/bulk-add`. Page should render the "No student model configured" error state with a back button. No mode selector or upload UI should appear.

---

## Self-Review

**Spec coverage:**
- Page surface + entry point → Phase 3 (Tasks 3.1–3.3).
- Mode selection lock → Phase 4 + page state machine in 3.1.
- Documents cap + extension validation → Task 4.2.
- CSV cap + structural validation → Tasks 2.3, 4.3.
- CSV column mapping (auto + manual + multi-select split + BOM) → Tasks 2.4, 5.1, 13.11, 13.12.
- Documents extraction with bounded parallelism → Tasks 1.3, 2.2, 6.2.
- Side-drawer review with `key={row.id}` and dirty-discard prompt → Task 7.2.
- Pre-submit gate with five sections + per-row choices → Task 9.1.
- Best-effort fan-out + retry-failed → Tasks 9.2, 10.2.
- Auto-assigned student IDs (strip empty `student_id`) → Task 9.2 step 1.
- IndexedDB persistence + multi-draft resume → Tasks 1.4, 8.1, 8.2, 8.3.
- Cancel + discard semantics → Task 11.1.
- `beforeunload` protection → Task 8.4.
- i18n → Phase 12.
- Tenant-no-active-model → Task 3.1 + Task 13.13.
- Empty-batch disables Create All → Task 9.2 Step 3.

**Placeholder scan:** No `TBD` / `TODO` / "implement later" / "similar to task N" left. The temporary `console.log` in Phase 4 is replaced in Phase 6 (called out explicitly). The temporary `<div hidden>` in Task 3.1 is removed by end of Phase 4 (Task 4.1 step 3).

**Type consistency:** `BulkRow` shape stable from Task 1.2 onward. Orchestrator return shapes (`ExtractResult`, `DupCheckOutcome`, `CreateOutcome`) all defined in Task 2.2 and consumed unchanged by later phases. `Phase` enum values stable. `BatchDraft.id` keyPath stable as `${tenant}:${batch}` everywhere via `buildDraftId`.

**Known v1 limitations** (deferred per design.md non-goals):
- Mid-create-fan-out cancel is best-effort only (in-flight requests run to completion). Spec scenario "Submit cannot be aborted mid-fan-out" reflects this; smoke test 13.6 doesn't exercise it directly.
- Orphan field values on resume are silently dropped (not surfaced as "Unknown field" disclosure). Spec mentions this; we picked the simpler implementation. Task 8.3 step 3 documents the choice in code comments.
- Manual smoke tests (13.x) replace unit/integration tests because admindash frontend has no test framework. Adding a test framework is out of scope.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-05-02-bulk-student-upload.md`. Two execution options:

**1. Subagent-Driven (recommended)** — Dispatch a fresh subagent per task, review between tasks, fast iteration.

**2. Inline Execution** — Execute tasks in this session using `superpowers:executing-plans`, batch execution with checkpoints.

Which approach?
