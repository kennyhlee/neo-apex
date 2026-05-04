## 1. Foundation: dependencies, types, utilities

- [x] 1.1 Add `papaparse`, `@types/papaparse`, and `idb` (matching Papermite's `^8.0.3`) to `admindash/frontend/package.json`; run `npm install`.
- [x] 1.2 Define batch-state TypeScript types in `admindash/frontend/src/types/bulkAdd.ts`: `BulkRow`, `RowStatus` (extracting | ready | has_errors | pending | creating | created | failed | extract_failed), `BatchMode` ('documents' | 'csv'), `BatchDraft`, `ColumnMapping`, `RowError`.
- [x] 1.3 Create `admindash/frontend/src/utils/boundedParallel.ts` with a `runBounded<T, R>(items, fn, { concurrency, onProgress })` helper used for both extract and submit fan-out.
- [x] 1.4 Create `admindash/frontend/src/db/bulkAddDrafts.ts` IndexedDB module using the `idb` library (match Papermite's `db/indexedDb.ts` shape — `openDB`, `keyPath`, single object store). API: `saveDraft(draft)`, `loadDraft(tenantId, batchId)`, `findActiveDraftsForTenant(tenantId)` returning all drafts for a tenant sorted by `updated_at` descending, `deleteDraft(batchId)`. Use `${tenantId}:${batchId}` as the keyPath (string), or compound `[tenantId, batchId]`; pick whichever queries more cleanly for `findActiveDraftsForTenant`.
- [x] 1.5 Add `BULK_ADD_DOCUMENT_CAP`, `BULK_ADD_CSV_ROW_CAP`, and `BULK_ADD_CONCURRENCY` constants in `admindash/frontend/src/config.ts`, resolved from `import.meta.env.VITE_BULK_ADD_DOCUMENT_CAP` (default `50`), `VITE_BULK_ADD_CSV_ROW_CAP` (default `500`), and `VITE_BULK_ADD_CONCURRENCY` (default `5`) — all using `parseInt` + NaN fallback to default.

## 2. API + parsing helpers

- [x] 2.1 Add `extractStudentBatch` orchestrator in `admindash/frontend/src/api/client.ts` (or alongside) that takes `File[]`, calls `extractStudentFromDocument` per file via `runBounded` with `BULK_ADD_CONCURRENCY`, emits per-row progress, returns array of `{ file, fields | error }` results. Wrap each call to parse FastAPI's `{detail: "..."}` response body when present and surface that as the error message; fall back to `HTTP <status>` only when no body is returned.
- [x] 2.2 Add `bulkCheckDuplicates` orchestrator that runs `checkDuplicateStudents` per row via `runBounded` with `BULK_ADD_CONCURRENCY` and aggregates results. Use the same `detail`-parsing error wrapper as task 2.1. Skip rows that lack any of the four fixed dup-check fields (`first_name`, `last_name`, `dob`, `primary_address`) and mark them `dup_check_skipped`.
- [x] 2.3 Add `bulkCreateStudents` orchestrator that calls `createEntity` per row via `runBounded` with `BULK_ADD_CONCURRENCY` and per-row state callbacks. Use the same `detail`-parsing error wrapper as task 2.1.
- [x] 2.4 Create `admindash/frontend/src/utils/csvParse.ts` wrapping `papaparse` with header normalization, header-required validation, row-cap validation, and a `parseCsvForBulk(file, opts)` API returning `{ headers, rows }` or a typed error.
- [x] 2.5 Create `admindash/frontend/src/utils/csvMapping.ts` with `autoMatchColumns(csvHeaders, modelDefinition)` returning a `ColumnMapping` with auto-filled matches and unmatched-as-Skip.

## 3. Page scaffolding and routing

- [x] 3.1 Create `admindash/frontend/src/pages/BulkAddStudentsPage.tsx` skeleton with phase-state machine (`mode_select | uploading | mapping | extracting | review | submitting | post_submit`). On mount, call `useModel().getModel(tenant_id, 'student')`; if it rejects with "Model not configured," render a permanent error state ("No student model configured. Configure a model in Papermite first.") with a link/button to Papermite and skip the mode-select UI entirely.
- [x] 3.2 Register the route `/students/bulk-add` in `admindash/frontend/src/App.tsx` inside the existing authenticated route group (no new UI-level role gate; backend endpoints enforce admin role). Pass `tenant` prop the same way `StudentsPage` receives it.
- [x] 3.3 Add a "Bulk add" secondary button to `admindash/frontend/src/pages/StudentsPage.tsx` next to the primary "Add Student" button (no UI role gate, matching the existing button); navigates to `/students/bulk-add`.
- [x] 3.4 Create `admindash/frontend/src/pages/BulkAddStudentsPage.css` with the page-layout styles (header bar, table area, drawer, gate dialog overlay, post-submit summary card).

## 4. Mode selection + uploaders

- [x] 4.1 Build `BulkModeSelector` component (two cards: Documents | CSV) for the empty state of the page.
- [x] 4.2 Build `BulkDocumentDropzone` component supporting multiple file selection, MIME/extension filtering, cap enforcement using `BULK_ADD_DOCUMENT_CAP` from config, rejection messaging that names the active cap.
- [x] 4.3 Build `BulkCsvDropzone` component accepting a single `.csv`, calling `parseCsvForBulk` with `BULK_ADD_CSV_ROW_CAP` from config, surfacing typed parse errors clearly (including cap-exceeded with the active cap value).

## 5. CSV column-mapping step

- [x] 5.1 Build `CsvMappingStep` component showing each CSV header on the left, a model-field dropdown on the right (populated from the tenant `ModelDefinition`), pre-filled from `autoMatchColumns`.
- [x] 5.2 Implement required-field-mapped validation: "Apply mapping" disabled if any required base field is unmapped; surface specific missing-field error messages.
- [x] 5.3 On apply, transform CSV rows through the mapping into `BulkRow[]` and transition to the review phase. For columns mapped to `selection` fields with `multiple: true`, split the cell value on `;`, trim each token, drop empty tokens; for single-select fields, pass the cell value through unchanged.

## 6. Documents extraction phase

- [x] 6.1 Wire `BulkAddStudentsPage` to instantiate rows in `extracting` state for every uploaded file, then call `extractStudentBatch` and update each row to `ready` or `extract_failed` as results arrive.
- [x] 6.2 Build `ExtractionProgressBar` component with extracted/total/failed counters, displayed at the top of the page during the `extracting` phase.
- [x] 6.3 Implement per-row "Retry extract" affordance that re-fires the single-file extract for that row's original `File` object (held in memory until page exit or batch submit).

## 7. Review table + side drawer

- [x] 7.1 Build `BulkReviewTable` component: row #, status pill, name (first + last), DOB, source (filename or "CSV row N"), issues count, edit/delete actions.
- [x] 7.2 Build `BulkRowDrawer` component using the existing `DynamicForm` with the active tenant's `ModelDefinition`. Render `DynamicForm` with `key={row.id}` so React unmounts and remounts on Prev/Next navigation (avoids `DynamicForm`'s merge-not-replace `initialValues` effect leaking values between rows). Include Prev/Next buttons that swap the rendered row, and a "Discard changes?" confirmation prompt when the drawer is closed with dirty unsaved edits.
- [x] 7.3 On drawer save, update the row in page state, recompute the row's validation/issues count, and persist the updated draft to IndexedDB (debounced 500ms).
- [x] 7.4 On row delete, remove the row from page state and persist the updated draft.

## 8. IndexedDB persistence + resume flow

- [x] 8.1 Hook `BulkAddStudentsPage` to write to IndexedDB on every state change once the page has entered the review phase, debounced via the same 500ms timer used for drawer saves.
- [x] 8.2 On page mount, call `findActiveDraftsForTenant(currentTenantId)`; if exactly one draft exists, render a `ResumeBatchPrompt` modal with row count, last-edited timestamp, and Resume / Discard actions. If multiple drafts exist, default the prompt to the most-recent draft and surface a footer disclosure listing the rest with timestamps so the admin can pick a specific one or discard the others in bulk.
- [x] 8.3 On Resume, hydrate page state from the chosen draft and rebuild row schemas against the *current* tenant model; mark orphaned values as "Unknown field" and surface new missing-required-field validation errors per affected row.
- [x] 8.4 On Discard from the resume prompt, delete the draft from IndexedDB and continue to the empty mode-select state.
- [x] 8.5 Register a `beforeunload` listener active only during the upload + extracting phases; remove it once the review phase begins.

## 9. Pre-submit gate + submit fan-out

- [x] 9.1 Build `PreSubmitGate` modal component grouping rows into Ready / Missing required / Potential duplicates / Dup-check failed / Dup-check skipped sections, each expandable. Closing the gate without confirming returns to review with all per-row Skip/Save-anyway selections discarded.
- [x] 9.2 Implement local required-field validation per row by reusing the same field-validation logic that `DynamicForm` enforces (extract `validateField` from `DynamicForm.tsx:20` into a shared util, or duplicate it cleanly to keep behavior consistent). Invoke when "Create All" is clicked.
- [x] 9.3 Implement bounded-parallel duplicate-check fan-out via `bulkCheckDuplicates`. Eligibility: only rows with non-empty `first_name`, `last_name`, `dob`, and `primary_address` are checked; ineligible rows are flagged `dup_check_skipped` and listed in their own gate section.
- [x] 9.4 Render duplicate sub-rows with per-row choices: Skip (default), Save anyway, Cancel & edit. Track selection state inside the gate.
- [x] 9.5 Implement gate's live "rows that will be created" counter and Confirm action that triggers `bulkCreateStudents` against the selected rows. Disable the page-level "Create All" button when the review table contains zero rows (with a tooltip explaining "No rows to submit").
- [x] 9.6 During submit, transition each row through `pending → creating → created` or `failed`; render row state visually in the table behind the gate.

## 10. Post-submit state, retry-failed, and disclosure

- [x] 10.1 Build `PostSubmitSummary` header component showing success and failure counts, plus action buttons (Retry failed, Done & return).
- [x] 10.2 Build `CreatedStudentsDisclosure` collapsed-by-default component listing every successful row with its assigned `student_id` and a link to the student detail page.
- [x] 10.3 Filter the active table to failed rows only in post-submit state; keep drawer editing fully available for these rows.
- [x] 10.4 Wire the "Retry failed" action to re-run the entire submit pipeline (gate + fan-out) against just the currently-failed rows; rows that succeed move to the disclosure, rows that fail again remain in the table with updated error reasons.
- [x] 10.5 On successful full submit (zero failures), clear the IndexedDB draft and transition to a "Done" state with the disclosure expanded by default.
- [x] 10.6 "Done & return to Students" action navigates to `StudentsPage` regardless of remaining failures (draft persists in IndexedDB for resumption).

## 11. Cancel / discard

- [x] 11.1 Add a "Cancel" button visible during upload + extraction phases that stops firing new extracts (in-flight allowed to complete), navigates to `StudentsPage`, and ensures no IndexedDB draft was created.
- [x] 11.2 Add a "Discard batch" button visible during review + post-submit phases that prompts for confirmation, then deletes the draft from IndexedDB and navigates to `StudentsPage`.

## 12. Internationalization

- [x] 12.1 Add all new bulk-add translation keys to `admindash/frontend/src/i18n/translations.ts` for both `en-US` and `zh-CN`. Use the existing flat dot-key convention (e.g., `'bulkAdd.title'`, `'bulkAdd.modeSelect.documents'`); keys are flat strings, not nested objects.
- [x] 12.2 Replace every hardcoded user-facing string in the bulk-add components with `t(...)` lookups; verify no untranslated strings render in `zh-CN`.

## 13. Verification

- [x] 13.1 Run `cd admindash/frontend && npm run lint` and `npm run build` (TypeScript check + Vite build); resolve any errors.
- [x] 13.2 Manual smoke test in dev: upload 5 documents → review → edit one row via drawer → submit; verify all 5 created.
- [x] 13.3 Manual smoke test: upload 5-row CSV → map columns → review → submit; verify all 5 created.
- [x] 13.4 Manual smoke test: upload 3 documents → reload mid-review → resume prompt → restore rows → submit.
- [x] 13.5 Manual smoke test: trigger a duplicate match (re-add an existing student) → verify pre-submit gate flags it → choose Save anyway → verify created; choose Skip → verify excluded.
- [x] 13.6 Manual smoke test: simulate a create failure (e.g., temporarily break the create endpoint or use invalid data) → verify post-submit failed-rows view, retry the failed rows, verify they succeed on retry.
- [x] 13.7 Manual smoke test: switch locale to `zh-CN` → walk the entire flow → verify no English strings appear.
- [x] 13.8 Manual smoke test: build with `VITE_BULK_ADD_DOCUMENT_CAP=10` and `VITE_BULK_ADD_CSV_ROW_CAP=20`; verify documents upload of 11 files is rejected and CSV upload of 21 rows is rejected, both messages naming the override values.
- [x] 13.9 Manual smoke test: build with `VITE_BULK_ADD_CONCURRENCY=2` and upload 10 documents; observe (via network tab or logging) that at most 2 extract requests are in flight at a time.
- [x] 13.10 Manual smoke test: open the drawer on Row A with `first_name="Alice"`, click Next to Row B whose `first_name` is empty; verify the field shows empty (not "Alice") — exercises the `key={row.id}` remount.
- [x] 13.11 Manual smoke test: upload a CSV whose file begins with a UTF-8 BOM and verify the first header parses correctly and auto-matches.
- [x] 13.12 Manual smoke test: upload a CSV with a `;`-separated multi-select cell ("reading; math; science") for a `selection` field with `multiple: true`; verify the resulting row carries the array of three values and submits correctly.
- [x] 13.13 Manual smoke test: load the page on a tenant whose student model is not configured; verify the "No student model configured" state renders and no upload UI appears.
