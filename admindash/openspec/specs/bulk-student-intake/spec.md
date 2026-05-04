# bulk-student-intake

## Purpose

Multi-document and multi-row CSV student creation in AdminDash, with per-row review, validation, duplicate detection, and best-effort submit-with-retry semantics. Lets school admins ingest a cohort of student applications in a single sitting instead of one at a time, composing the existing extract / duplicate-check / create endpoints behind a dedicated review surface.

## Requirements

### Requirement: Bulk-add page surface and entry point

The system SHALL expose a dedicated page at the route `/students/bulk-add` for processing multiple student records in a single batch. The system SHALL render a "Bulk add" secondary button on `StudentsPage` adjacent to the existing primary "Add Student" button. Authorization for bulk operations SHALL be enforced server-side by the existing extract / duplicate-check / create endpoints; no new UI-level role gate is introduced.

#### Scenario: Admin opens the bulk-add page
- **WHEN** an authenticated admin clicks the "Bulk add" button on `StudentsPage`
- **THEN** the browser navigates to `/students/bulk-add` and the page renders its empty mode-selection state.

#### Scenario: Non-admin reaches the page and is blocked at submit
- **WHEN** a non-admin user navigates to `/students/bulk-add` and attempts to upload, extract, or submit
- **THEN** the upstream endpoints reject the request with the auth error and the row's failure reason surfaces that error; no UI-only role gate prevents page render.

### Requirement: Tenant must have an active model

The page SHALL fetch the tenant's active student model via `useModel().getModel(tenant_id, 'student')` on mount. If no active model is configured, the system SHALL render a non-dismissable error state ("No student model configured. Configure a model in Papermite first.") and SHALL NOT render the mode-selection UI.

#### Scenario: Tenant has no active model
- **WHEN** the page loads for a tenant whose `student` model has not been configured
- **THEN** the page renders a "No student model configured" message with a link to Papermite and does not render mode-selection or any upload UI.

### Requirement: Mode selection at upload time

The system SHALL offer two mutually-exclusive input modes — `documents` and `csv` — selectable from the empty-state of the bulk-add page. Once the admin drops files in either mode, that mode SHALL be locked for the remainder of the batch and SHALL NOT be switchable without discarding the batch.

#### Scenario: Admin picks documents mode and uploads files
- **WHEN** an admin selects the documents mode card and drops one or more `.pdf`, `.docx`, or `.txt` files
- **THEN** the page locks the mode to `documents` and proceeds to the extraction phase.

#### Scenario: Admin picks CSV mode and uploads a file
- **WHEN** an admin selects the CSV mode card and drops a single `.csv` file
- **THEN** the page locks the mode to `csv` and proceeds to the column-mapping phase.

#### Scenario: Admin tries to switch modes after upload
- **WHEN** an admin has uploaded files in one mode and attempts to invoke the other mode card
- **THEN** the page prompts to discard the current batch first; mode switching does not happen silently.

### Requirement: Documents-mode batch caps and file validation

In documents mode, the system SHALL accept at most `BULK_ADD_DOCUMENT_CAP` files per batch (default `50`, configurable at build time via the `VITE_BULK_ADD_DOCUMENT_CAP` Vite environment variable; invalid or missing values fall back to the default). Each file MUST have an extension of `.pdf`, `.docx`, or `.txt`. Files exceeding the cap or with unsupported extensions SHALL be rejected at upload time with a clear error that names the active cap value.

#### Scenario: Admin drops more files than the cap allows
- **WHEN** an admin attempts to upload more documents than `BULK_ADD_DOCUMENT_CAP` in a single drop
- **THEN** the page rejects the upload entirely with a message naming the active cap value.

#### Scenario: Admin drops a file with unsupported extension
- **WHEN** an admin includes a `.jpg` or other unsupported file in the drop
- **THEN** that file is rejected with a clear error and the remaining valid files are accepted.

#### Scenario: Override raises the documents cap
- **WHEN** the build was produced with `VITE_BULK_ADD_DOCUMENT_CAP=100` and an admin drops 75 documents
- **THEN** the upload is accepted and proceeds to extraction.

### Requirement: CSV-mode batch caps and structural validation

In CSV mode, the system SHALL accept exactly one `.csv` file containing at most `BULK_ADD_CSV_ROW_CAP` data rows plus one header row (default cap `500`, configurable at build time via the `VITE_BULK_ADD_CSV_ROW_CAP` Vite environment variable; invalid or missing values fall back to the default). CSV files without a header row, exceeding the active row cap, or with no data rows SHALL be rejected with a clear error that names the active cap value.

#### Scenario: Admin uploads a CSV exceeding the row cap
- **WHEN** an admin uploads a CSV containing more data rows than `BULK_ADD_CSV_ROW_CAP`
- **THEN** the page rejects the file with a message naming the active cap value and suggests splitting.

#### Scenario: Admin uploads a CSV without headers
- **WHEN** an admin uploads a CSV whose first row appears to be data (no recognizable column names)
- **THEN** the page rejects the file with a message requiring a header row.

#### Scenario: Admin uploads an empty CSV
- **WHEN** an admin uploads a CSV with only a header row or zero rows
- **THEN** the page rejects the file with a "no data rows" error.

### Requirement: CSV column mapping with auto-match and validation

In CSV mode, the system SHALL display a column-mapping step before the review table. The system SHALL auto-match CSV header names against the tenant model's base + custom field names using normalized comparison (case-insensitive, whitespace-and-punctuation collapsed to underscore). Unmatched columns SHALL default to "Skip." The admin SHALL be able to manually map any unmatched column to a model field. The mapping screen SHALL block progression with an error if any required base field is unmapped. When a CSV column is mapped to a `selection` field with `multiple: true`, the cell value SHALL be split on `;` (semicolon) into trimmed tokens, with empty tokens dropped; cells mapped to single-select fields SHALL be passed through as a single value with no splitting.

#### Scenario: Headers auto-match cleanly
- **WHEN** all CSV headers normalize to known base or custom field names
- **THEN** the mapping screen pre-fills every dropdown with its match and the admin can apply mapping without manual changes.

#### Scenario: Required field is unmapped
- **WHEN** a required base field has no CSV column mapped to it
- **THEN** the "Apply mapping" action is disabled and an error names the unmapped required fields.

#### Scenario: Admin manually maps an unmatched column
- **WHEN** a CSV column did not auto-match and the admin selects a model field for it from the dropdown
- **THEN** the column is mapped to that field and the row preview updates.

#### Scenario: Mapping does not mutate the model
- **WHEN** a CSV column has no model field to map to
- **THEN** the only options are "Skip" or pick an existing model field; the system never offers to create a new custom field.

#### Scenario: CSV cell splits into multi-select tokens
- **WHEN** a CSV column is mapped to a `selection` field with `multiple: true` and a row's cell value is `"reading; math; science"`
- **THEN** the resulting row carries the array `["reading", "math", "science"]` for that field after applying the mapping.

#### Scenario: CSV cell with BOM is parsed correctly
- **WHEN** an admin uploads a CSV whose file begins with a UTF-8 BOM (byte order mark) and a header `first_name`
- **THEN** the first header is parsed as `first_name` (not `﻿first_name`) and auto-matches normally.

### Requirement: Documents extraction with bounded parallelism and per-row state

In documents mode, the system SHALL fan out extract requests to `POST /api/extract/{tenant_id}/student` with at most `BULK_ADD_CONCURRENCY` concurrent in-flight calls (default `5`, configurable at build time via the `VITE_BULK_ADD_CONCURRENCY` Vite environment variable; invalid or missing values fall back to the default). Each file SHALL appear immediately as a row in the review table in `extracting` state, transitioning to `ready` on success or `extract_failed` with a reason on failure. The system SHALL display a header progress chip showing extracted-vs-total counts and failure count, updated live.

#### Scenario: Admin uploads many files
- **WHEN** an admin drops 30 valid documents
- **THEN** 30 rows appear immediately in the table; at most `BULK_ADD_CONCURRENCY` are simultaneously in `extracting` state at any moment; the header chip shows progress as each completes.

#### Scenario: Override changes extract concurrency
- **WHEN** the build was produced with `VITE_BULK_ADD_CONCURRENCY=2` and an admin drops 30 documents
- **THEN** at most 2 rows are in `extracting` state simultaneously throughout the run.

#### Scenario: A row fails to extract
- **WHEN** the extract endpoint returns an error for one file
- **THEN** that row enters `extract_failed` state with the error reason visible and offers a "Retry extract" affordance.

#### Scenario: Editing during extraction
- **WHEN** the admin opens the drawer on a row that has already reached `ready` state while other rows are still extracting
- **THEN** the drawer is fully editable and saves do not interfere with in-flight extracts.

### Requirement: Side-drawer review using DynamicForm

The system SHALL render the review table with a fixed set of read-only summary columns (row number, status, name, dob, source, issues count, edit/delete actions). Clicking a row's edit affordance SHALL open a side drawer rendering the `DynamicForm` component against the tenant's active `ModelDefinition` for that row's data. The drawer SHALL provide Previous and Next controls for navigating between rows without closing. The drawer SHALL render `DynamicForm` with a `key` bound to the row's identifier so that navigating between rows fully unmounts and remounts the form (avoiding the merge-not-replace behavior of `DynamicForm`'s `initialValues` effect). If the admin attempts to close the drawer with unsaved field edits, the system SHALL prompt for confirmation before discarding the in-progress changes.

#### Scenario: Admin opens drawer to edit a row
- **WHEN** the admin clicks the edit icon on row #5
- **THEN** a drawer slides in showing every base and custom field for that row in `DynamicForm`, populated from the row's current values, with the table still visible behind it.

#### Scenario: Admin navigates between rows in the drawer
- **WHEN** the admin clicks "Next" inside the open drawer
- **THEN** the drawer's content swaps to the next row's data without closing or losing focus.

#### Scenario: Drawer save persists to the row
- **WHEN** the admin edits fields in the drawer and clicks "Save"
- **THEN** the row in the table reflects the new values and the IndexedDB draft is updated.

#### Scenario: Drawer Prev/Next does not leak values across rows
- **WHEN** the admin opens the drawer on Row A (`first_name: "Alice"`), clicks Next to Row B whose `first_name` is empty
- **THEN** the drawer's `first_name` field is empty (not "Alice"); the form has been unmounted and remounted between navigations.

#### Scenario: Closing the drawer with dirty edits prompts to discard
- **WHEN** the admin has typed into a field and clicks "Cancel" or the drawer's close affordance without saving
- **THEN** a confirmation prompt appears; on confirm, the in-progress edits are discarded and the row's persisted values are unchanged.

### Requirement: Pre-submit validation and duplicate-detection gate

When the admin clicks "Create All," the system SHALL run a validation gate before any create call. The gate SHALL:

1. Validate every row against required-field rules derived from the tenant model (using the same `validateField` logic that `DynamicForm` enforces).
2. Determine dup-check eligibility per row: a row is eligible only if it carries non-empty values for all four fields fixed by the `DuplicateCheckRequest` contract — `first_name`, `last_name`, `dob`, `primary_address`. Ineligible rows are flagged `dup_check_skipped` and bypass the dup-check entirely.
3. For eligible rows, call `checkDuplicateStudents` with at most `BULK_ADD_CONCURRENCY` concurrent in-flight calls.
4. Display a summary dialog grouping rows into expandable sections: **Ready** (passes validation, no duplicate match, includes dup-check-skipped rows by default), **Missing required** (fails tenant model validation), **Potential duplicates** (dup-check returned matches), **Dup-check failed** (network/upstream error during check), **Dup-check skipped** (ineligible per the four-field contract — informational, included in Ready by default).

Duplicate rows SHALL offer per-row choices: **Skip**, **Save anyway**, **Cancel & edit**. The gate SHALL display a live count of "rows that will be created" reflecting the current selections and a final confirm action. Closing the gate without confirming SHALL return to the review state with all row data unchanged and SHALL NOT persist the gate's per-row Skip / Save-anyway selections.

#### Scenario: All rows ready
- **WHEN** the admin clicks "Create All" on a batch where every row passes validation and has zero duplicates
- **THEN** the gate shows a single "N ready" summary and a confirm button to proceed.

#### Scenario: Mixed validation states
- **WHEN** the admin clicks "Create All" on a batch with some rows missing required fields, some flagged as duplicates, and some that failed dup-check
- **THEN** the gate dialog groups rows by these statuses, each section expandable, and the confirm count reflects only the rows currently selected for creation.

#### Scenario: Admin chooses Save Anyway for a duplicate
- **WHEN** the admin clicks "Save anyway" on a duplicate-flagged row in the gate
- **THEN** that row is included in the create batch as a new student despite the match, and the confirm count increments by one.

#### Scenario: Admin clicks Cancel & Edit on a row
- **WHEN** the admin clicks "Cancel & edit" on a row inside the gate
- **THEN** the gate closes, the table scrolls to the offending row, and the drawer opens for that row.

#### Scenario: Row is dup-check-skipped due to missing fields
- **WHEN** a row is missing one or more of the four fields required by the dup-check contract (e.g., `primary_address` is empty)
- **THEN** the row is included in the Ready section with a `dup_check_skipped` flag and listed in the gate's "Dup-check skipped" disclosure; the row is submitted on confirm if the admin does not override.

#### Scenario: Closing the gate dialog discards selections
- **WHEN** the admin made per-row Skip / Save-anyway choices in the gate, then closes the dialog without confirming
- **THEN** the gate disappears, the page returns to the review state, and the row data and statuses are unchanged; reopening the gate starts fresh.

#### Scenario: Empty batch disables Create All
- **WHEN** the admin has deleted all rows so the review table contains zero rows
- **THEN** the "Create All" button is disabled and tooltip explains "No rows to submit."

### Requirement: Best-effort per-row submit with bounded parallelism

On gate confirmation, the system SHALL fan out create requests to `POST /api/entities/{tenant_id}/student` with at most `BULK_ADD_CONCURRENCY` concurrent in-flight calls. Each row's state SHALL transition `pending → creating → created` on success or `pending → creating → failed` with a reason on error. The system SHALL NOT roll back successful creates if other rows fail; failures and successes co-exist. The fan-out SHALL run to completion once started; v1 SHALL NOT support cancelling an in-progress submit.

#### Scenario: Some rows fail
- **WHEN** the create fan-out completes with mixed outcomes
- **THEN** every successful row is durably created in DataCore and every failed row retains its data, error reason, and editability for retry.

#### Scenario: A failed row exposes the upstream detail message
- **WHEN** a row's create call returns a 4xx or 5xx error with a FastAPI `{detail: "..."}` body
- **THEN** the row's state is `failed` and the row's issues column displays the parsed `detail` message; if no body is returned, the row falls back to displaying `HTTP <status>`.

#### Scenario: Submit cannot be aborted mid-fan-out
- **WHEN** the admin clicks the page-level back button or attempts to navigate away while create fan-out is in progress
- **THEN** the in-flight requests are allowed to complete; the page either ignores navigation until completion or warns via `beforeunload` and only proceeds after the fan-out resolves.

### Requirement: Post-submit summary, success disclosure, and retry-failed loop

After fan-out completes, the system SHALL enter a post-submit state showing (1) a header summary card with success count and failure count, (2) a collapsed "N students created" disclosure listing assigned student IDs with links to the student detail page, and (3) the failed rows promoted into the active editable table. The system SHALL provide a "Retry failed (N)" action that re-runs the entire submit pipeline (validation gate + create fan-out) against the failed rows only.

#### Scenario: All rows succeed
- **WHEN** the create fan-out completes with no failures
- **THEN** the page transitions to a "Done" state with the success disclosure expanded by default and a "Return to Students" action.

#### Scenario: Admin clicks Retry Failed
- **WHEN** the admin clicks "Retry failed" with N failed rows present
- **THEN** the validation gate opens for just those N rows; on confirm, only those rows are submitted; rows that succeed move into the success disclosure and rows that fail again remain in the active table with potentially updated error reasons.

#### Scenario: Admin returns with failures still open
- **WHEN** the admin clicks "Done & return to Students" while failed rows remain
- **THEN** the browser navigates to `StudentsPage` and the failed-rows state persists in IndexedDB for resumption.

### Requirement: Auto-assigned student IDs

The system SHALL NOT pre-fetch or pre-display student IDs in the review table for documents mode. The system SHALL strip `student_id` from the create payload for any row that does not carry an explicit user-provided value (matching the existing single-add behavior). For CSV mode rows where the CSV included a `student_id` column with a value, the system SHALL include that value in the create payload subject to backend uniqueness enforcement.

#### Scenario: Documents-mode row creation
- **WHEN** a row created via documents mode is submitted
- **THEN** the create payload omits `student_id` and the backend's assigned ID appears in the post-submit success disclosure.

#### Scenario: CSV row with explicit student_id
- **WHEN** a CSV row with a non-empty `student_id` value is submitted
- **THEN** the create payload includes that value and a backend conflict error surfaces in the row's failed state if it collides with an existing student.

### Requirement: Hybrid IndexedDB persistence with resume

The system SHALL persist the bulk-add batch state to IndexedDB, keyed by `{tenant_id, batch_id}`, beginning when the page transitions into the review phase (after extraction or after CSV mapping). The system SHALL update the persisted record on every row edit with at most 500ms debounce. The system SHALL NOT persist file blobs. On page load, the system SHALL detect unfinished batches for the current tenant via `findActiveDraftsForTenant(tenant_id)`. If exactly one draft exists, the system SHALL prompt Resume or Discard. If multiple drafts exist (admin used multiple tabs), the system SHALL surface the most-recent draft in the prompt and append a footer disclosure listing the remaining drafts by last-edited timestamp; the admin MAY pick any one to resume or discard the rest in bulk. The system SHALL clear the persisted record on successful full submit (no failures) or on explicit Discard.

#### Scenario: Admin reloads mid-review
- **WHEN** the admin reloads the page with rows present in the review table and an open IndexedDB draft for this tenant
- **THEN** the page presents a "Resume previous batch" prompt with row count and last-edited timestamp; on Resume, the rows are restored.

#### Scenario: Admin reloads mid-extract
- **WHEN** the admin reloads the page while the extract phase is still in progress
- **THEN** the rows are not restored (no draft was written yet); the admin re-uploads the files.

#### Scenario: Model has changed since draft was saved
- **WHEN** the admin resumes a draft after the tenant model has been updated (custom field added or removed)
- **THEN** the page rebuilds row schemas from the current model; orphaned values display as "Unknown field" with a discard option; new required fields surface as missing-field validation errors.

#### Scenario: Successful submit clears the draft
- **WHEN** the create fan-out completes with zero failures and the admin clicks Done
- **THEN** the IndexedDB record for this batch is deleted.

#### Scenario: Multiple unfinished drafts exist
- **WHEN** the admin loads `/students/bulk-add` and `findActiveDraftsForTenant` returns two or more drafts
- **THEN** the resume prompt highlights the most recent draft as the default Resume target and lists the others (with row counts and timestamps) as alternatives the admin can resume or discard.

### Requirement: Cancel and discard semantics

The system SHALL provide a "Cancel" action visible during the upload and extraction phases, and a "Discard batch" action visible during the review phase. Cancel during extraction SHALL stop firing new extract calls (in-flight calls are allowed to complete) and navigate back to `StudentsPage`. Discard SHALL prompt for confirmation, then clear in-memory state, delete any IndexedDB draft for this batch, and navigate back to `StudentsPage`.

#### Scenario: Cancel mid-extract
- **WHEN** the admin clicks "Cancel" while extracts are still in progress
- **THEN** no further extract calls are fired, the page navigates to `StudentsPage`, and no IndexedDB draft is created.

#### Scenario: Discard with confirmation
- **WHEN** the admin clicks "Discard batch" during review
- **THEN** a confirmation prompt appears; on confirm, the draft is deleted from IndexedDB and the admin returns to `StudentsPage`.

### Requirement: Beforeunload protection during ephemeral phases

The system SHALL register a `beforeunload` warning whenever there are unsaved rows in memory and no IndexedDB draft yet exists for the current batch (i.e., during upload and extraction). The warning SHALL be removed once persistence begins or after successful full submit.

#### Scenario: Admin attempts to close tab during extraction
- **WHEN** the admin attempts to close the tab while extracts are still in progress
- **THEN** the browser's native `beforeunload` confirmation appears.

#### Scenario: Admin closes tab during review
- **WHEN** the admin closes the tab during the review phase
- **THEN** no warning fires (the IndexedDB draft already preserves state) and the admin can resume on next visit.

### Requirement: Internationalization

The system SHALL render all user-facing strings on the bulk-add page through the `useTranslation` hook, with translation keys defined for both `en-US` and `zh-CN` locales in `i18n/translations.ts`. New keys SHALL follow the existing flat dot-key convention used elsewhere in admindash.

#### Scenario: Admin views the page in zh-CN
- **WHEN** the admin's locale is `zh-CN`
- **THEN** every label, button, error, and helper text on the bulk-add page renders in Chinese; no untranslated English strings appear.
