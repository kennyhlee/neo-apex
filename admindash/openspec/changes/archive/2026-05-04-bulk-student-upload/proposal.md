## Why

School administrators enrolling a cohort at the start of a term currently have to add students one at a time through the existing single-student modal — extracting one application document or filling one form per student. For a school with 30+ new applicants, that's 30+ round-trips of upload → wait for extract → review → submit. Term-start enrollment becomes a multi-hour task that locks the admin out of other work.

This change introduces a bulk-add page that lets an admin process a batch of applications (up to 50 documents or 500 CSV rows) in a single sitting: upload everything, review extracted values in a table, fix issues, and submit. It composes the existing extract / duplicate-check / create endpoints — no backend work — and is purely a frontend addition.

## What Changes

- **New dedicated page** at `/students/bulk-add` with two mutually-exclusive input modes (documents vs CSV), mode-locked at upload time.
- **Documents mode**: drag/drop multiple `.pdf` / `.docx` / `.txt` files (default cap 50 per batch, override via `VITE_BULK_ADD_DOCUMENT_CAP`). Each file extracted via the existing single-extract endpoint, fanned out with bounded parallelism (default 5 concurrent, override via `VITE_BULK_ADD_CONCURRENCY`).
- **CSV mode**: drop one `.csv` (default cap 500 rows, override via `VITE_BULK_ADD_CSV_ROW_CAP`; header row required). Auto-match headers to base + custom field names, blocking error if required base fields are unmapped, manual mapping screen for the rest. No on-the-fly model mutation.
- **Review table** with side-drawer editing: read-only summary columns in the table, click-row opens a drawer using the existing `DynamicForm` component for the full schema-aware edit experience. Drawer has prev/next navigation between rows.
- **Pre-submit validation gate**: required-field check + bounded-parallel duplicate detection on every row. Per-row choices for duplicates (Skip / Save anyway / Cancel & edit) before fan-out.
- **Per-row best-effort submit**: existing `createEntity` API called per-row with bounded parallelism. Successful rows move to a collapsed "N students created" disclosure; failed rows stay in the active table with their error reason and a "Retry failed" affordance.
- **IndexedDB-backed batch persistence** once the review phase begins, keyed by `{tenant_id, batch_id}`. "Resume previous batch?" prompt on page load. Cleared on successful full submit or explicit discard.
- **Entry point** on `StudentsPage`: secondary "Bulk add" button next to the existing primary "Add Student" button. Authorization is enforced server-side by the existing extract / create endpoints (matching the current single-add pattern); no new UI-level role gate is added.

Out of scope for v1 (deferred): source-document retention, eager (during-review) duplicate warnings, inline cell editing in the table, saved CSV column-mapping presets, range-based ID reservation.

## Capabilities

### New Capabilities

- `bulk-student-intake`: Multi-document and multi-row CSV student creation with per-row review, validation, duplicate detection, and best-effort submit-with-retry semantics.

### Modified Capabilities

(none — this change adds a parallel workflow alongside the existing single-add flow without changing any current behavior.)

## Impact

**Code**:
- New page `admindash/frontend/src/pages/BulkAddStudentsPage.tsx` and CSS.
- New components for the bulk flow: mode selector, multi-file dropzone, CSV column-mapper, review table, edit drawer, validation gate, post-submit summary.
- New `admindash/frontend/src/db/bulkAddDrafts.ts` IndexedDB module mirroring Papermite's `db/indexedDb.ts` pattern.
- New helpers in `api/client.ts` for bounded-parallel fan-out (or a small concurrency utility under `utils/`).
- New route registered in `App.tsx`, new "Bulk add" button on `StudentsPage`.
- New i18n keys in `i18n/translations.ts` (en-US + zh-CN).

**APIs**: none. Reuses existing admindash backend endpoints:
- `POST /api/extract/{tenant_id}/student` (single file extract)
- `POST /api/entities/{tenant_id}/student/duplicate-check`
- `POST /api/entities/{tenant_id}/student` (single create)
- `GET /api/config/models` (for the extraction-model display)

**Dependencies**: a CSV-parsing library on the frontend (e.g. `papaparse`). No backend dependencies.

**Systems**: no DataCore changes, no Papermite changes, no schema migrations. The bulk-add page is a pure additive frontend feature in admindash.
