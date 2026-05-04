## Context

AdminDash today supports adding one student at a time through `AddStudentModal`. The modal has a tab to upload a single application document (PDF / DOCX / TXT), which is sent to `/api/extract/{tenant_id}/student` (proxied to Papermite's `extract_for_entity`). Extracted fields populate a `DynamicForm` derived from the tenant's active model definition. On submit, `checkDuplicateStudents` runs first; if matches exist, `DuplicateWarningModal` blocks until the user picks Go-Back or Save-Anyway. `createEntity` then writes the record via DataCore.

For an admin enrolling a cohort, this single-student loop is the bottleneck. The building blocks already work end-to-end; what's missing is a fan-out + review-many surface that reuses them.

The tenant model is dynamic — `base_fields` and `custom_fields` vary per tenant — so any review UI must derive its shape from the live `ModelDefinition` (already exposed via `useModel()`).

## Goals / Non-Goals

**Goals:**

- Let an admin process up to 50 application documents or 500 CSV rows in a single sitting.
- Reuse every existing endpoint and the `DynamicForm` component without modification.
- Survive accidental tab close once the admin has invested editing effort.
- Surface duplicate-detection results pre-submit so the admin can resolve them in one batched gate, not one-by-one.
- Allow the admin to recover from partial failures with a "Retry failed" loop, without losing the rows that already succeeded.

**Non-Goals:**

- Source document retention or audit trail (deferred — comes with vector-DB document storage in a later phase).
- Eager / live duplicate warnings during review (re-runs would go stale on every edit; submit-time check is sufficient).
- Inline cell editing in the review table (drawer with `DynamicForm` covers all field types correctly).
- Transactional all-or-nothing creates (would require new DataCore primitives; best-effort + retry is enough).
- Range-based student-ID reservation (the existing single-flow already lets the backend assign IDs at create time; we just adopt that for bulk).
- Saved CSV column-mapping presets, on-the-fly custom-field creation from CSV headers, no-header CSV support.

## Decisions

### Surface: dedicated page over modal

A new route `/students/bulk-add` rather than a third tab in `AddStudentModal` or a sub-modal of `StudentsPage`. The review table is the dominant UI and needs full-page width; long-running batches deserve a stable URL; admins can reload without losing context (paired with IndexedDB persistence). The existing single-add modal stays small and fast for the one-off case.

**Alternative considered:** add a "Bulk" tab inside `AddStudentModal`. Rejected — modals are awkward for tables with N rows, and the state machine for a multi-phase flow (upload → extract → review → submit → post-submit) doesn't fit comfortably inside a modal designed for a single form.

### Two input modes, mode-locked at upload

The page entry shows two choice cards: **Documents** or **CSV**. Once the admin picks files, the mode is locked for that batch — no mode switching mid-flow. This keeps the state machine simple and avoids "what does it mean to have a CSV row alongside a PDF in the same batch."

Downstream (review table, validation, submit, retry) is identical regardless of mode. Only the *source step* differs.

### Hard caps with env-var override

Default caps:
- **Documents: 50 / batch.** LLM cost, extraction time, in-flight memory. Beyond 50 the admin should split into batches.
- **CSV: 500 / batch.** Review table becomes unusable past a few hundred rows; duplicate-check fan-out at submit gets expensive. School-level imports above this belong in a future "data migration" tool, not an interactive page.

Both caps SHALL be overridable at build time via Vite environment variables:
- `VITE_BULK_ADD_DOCUMENT_CAP` (default `50`)
- `VITE_BULK_ADD_CSV_ROW_CAP` (default `500`)

Resolution lives in `admindash/frontend/src/config.ts` alongside the existing `VITE_ADMINDASH_API_URL` pattern: `parseInt(import.meta.env.VITE_BULK_ADD_DOCUMENT_CAP ?? '', 10) || 50`. Invalid or missing values fall back to defaults silently — no runtime errors. Caps are exported as `BULK_ADD_DOCUMENT_CAP` and `BULK_ADD_CSV_ROW_CAP` constants and consumed by the upload validators and user-facing error messages.

Caps are hard (file picker rejects extras with a clear error referencing the active cap), not soft warnings. Soft warnings get clicked through; we'd rather force the split.

**Why env vars and not server-side config:** the cap is a frontend-enforced UX guardrail, not a server-side authorization rule. Bypassing the frontend cap with a hand-crafted request still works (the backend accepts whatever the bounded-parallel fan-out sends). If we need server-side enforcement later, add it to the admindash backend, but for v1 the cap exists to keep the page responsive and admin expectations realistic — a build-time override per environment is enough.

### Documents extraction: bounded parallel, frontend-driven

Frontend fans out to existing `POST /api/extract/{tenant_id}/student` with a Promise queue capped at the configured concurrency limit (default **5**, see "Concurrency configuration" below). No new backend endpoint; the per-file extract endpoint is reused as-is.

**Alternative considered:** new bulk-extract endpoint that takes N files and streams results. Rejected — streaming over multipart is more complex on both ends, and per-file calls give us natural per-row progress UX for free. Bounded parallelism handles LLM rate limits and is fast enough (30 files ≈ 30s at 5 concurrent vs ≈ 5 min sequential).

Per-row state machine: `extracting → ready` or `extract_failed (reason)`. Failed rows have a "Retry extract" affordance using the original file (held in memory until the page is left or the batch is submitted).

### CSV mapping: auto-match + manual mapping screen

After CSV upload, the page shows a column-mapping step before the review table:

- Headers are normalized (`First Name` → `first_name`, lowercase, underscore) and matched against base + custom field names.
- Auto-matched columns are pre-filled in dropdowns; unmatched columns default to "Skip."
- **Required base fields not mapped → blocking error** ("Required field `dob` not mapped to any column"). Admin must map or fix the CSV.
- Mapping is per-batch only; no persistence across sessions in v1.

Header row is required. No-header CSVs are rejected with a clear error. No on-the-fly custom field creation; that mutation belongs in Papermite, not in a data import.

**CSV cells → multi-select fields.** When a CSV column is mapped to a `selection` field with `multiple: true`, the cell value is split on `;` (semicolon) into an array of options. Trailing/leading whitespace per token is trimmed. Empty tokens are dropped. Single-select fields treat the entire cell as one value (no splitting). Comma is intentionally not used as the multi-select delimiter to avoid ambiguity with quoted CSV values that contain commas.

**BOM and quoting.** `papaparse` handles UTF-8 BOM and quoted-value escapes by default; we rely on its defaults. The smoke-test plan covers a CSV with a leading BOM to verify.

### Review table: read-only summary + side drawer for editing

Table columns (curated, fixed): `#`, `Status`, `Name`, `DOB`, `Source`, `Issues`, actions (`Edit`, `Delete`). Read-only at the cell level.

Click any row → side drawer with the existing `DynamicForm` rendered against the tenant's `ModelDefinition`. Drawer has Prev/Next buttons to navigate between rows without closing.

**Important: drawer remounts `DynamicForm` per row.** `DynamicForm`'s `useEffect` on `initialValues` *merges* rather than replaces (`DynamicForm.tsx:235-245`) — empty values on the new row would not overwrite carry-over values from the previous row. To avoid that bug without modifying `DynamicForm`, the drawer renders the form with `key={row.id}` so React unmounts and remounts on Prev/Next navigation. Each row gets a fresh form bound to its values.

**Drawer cancel with dirty edits.** Closing the drawer with unsaved field changes prompts for confirmation ("Discard changes?"). Confirmed close discards in-progress edits; the row's persisted values are unchanged.

**Why side drawer over inline cell edit:** inline editing requires custom editors for all 8 field types (str, number, bool, date, datetime, email, phone, selection-with-options-and-multiple). `DynamicForm` already handles all of them with consistent validation and label rendering. Reusing it eliminates an entire class of UI bugs and matches the look-and-feel of single-add.

**Why side drawer over row-expand:** drawer keeps the table visible while editing; row-expand reflows the table on every click.

**Why side drawer over modal:** modal blocks the whole page; drawer leaves the rest of the table visible for navigation context.

### Auto-ID: backend-assigned, no pre-display

The single-add flow strips `student_id` from the create payload (`AddStudentModal.tsx:89`); the backend assigns it. We adopt the same behavior for bulk and skip pre-fetching predicted IDs entirely. No `student_id` column in the table pre-submit. After successful create, the response carries the assigned ID, populated into the post-submit success disclosure.

CSV mode with a `student_id` column: admin's value is sent as-is and subject to the backend's uniqueness check. Bare CSV without `student_id` → backend assigns.

**Alternative considered:** range reservation (new endpoint reserves N consecutive IDs up front). Rejected — would require real DataCore work for what is at best a UX nicety, and abandoned reservations leak gaps.

### Submit: pre-submit gate + best-effort fan-out + retry-failed loop

Submit pipeline:

1. Local required-field validation per row (using the same logic `DynamicForm` already enforces — `validateField` in `DynamicForm.tsx:20`; we extract or duplicate the function for batch-level validation outside the form).
2. **Dup-check eligibility check.** `DuplicateCheckRequest` is hard-coded to four fields: `first_name`, `last_name`, `dob`, `primary_address`. Rows missing any of these four cannot be checked; they are flagged as `dup_check_skipped` (a separate gate section from "missing required fields"). This is independent of the tenant model's required-field set — a tenant could omit `primary_address` from its model entirely, in which case every row's dup-check is "skipped" and that becomes a known limitation.
3. Bounded-parallel `checkDuplicateStudents` for every eligible row (concurrency = `BULK_ADD_CONCURRENCY`).
4. **Pre-submit gate dialog** summarizes:
   - **Ready** (count) — pass validation, no duplicate match, ineligible-skipped rows are included here as ready.
   - **Missing required** (count) — fails the tenant model's required-field validation.
   - **Potential duplicates** (count) — dup-check returned matches.
   - **Dup-check failed** (count) — network/upstream error during the check.
   - **Dup-check skipped** (count) — row missing one of the four hard-coded dup-check fields, included in Ready by default but listed here for transparency.
   Each section is expandable. The duplicates section is a sub-table with per-row choices: **Skip** (default), **Save anyway**, **Cancel & edit** (closes gate, scrolls to row).
5. On confirm, fan-out to existing `POST /api/entities/{tenant_id}/student` with bounded parallelism. Per-row state: `pending → creating → created` or `failed (reason)`.
6. After fan-out completes, page enters post-submit state.

**Cancel and abort semantics across the submit pipeline.**
- Closing the gate dialog without confirming returns to the review state with all row data unchanged. Selections made inside the gate (Skip / Save anyway choices) are discarded.
- Once create fan-out begins, there is no in-flight cancel: the submit progresses to completion. A "Stop after current" affordance can be added later if needed; v1 accepts that the only abort is to close the tab (and recover via the IndexedDB resume flow).

**Error message extraction.** `createEntity`, `extractStudentFromDocument`, and `checkDuplicateStudents` in the existing `api/client.ts` throw `Error("HTTP ${status}")` with no body parsing. Bare status codes are not actionable in the row's `Issues` column. The bulk orchestrators (`bulkCreateStudents`, `extractStudentBatch`, `bulkCheckDuplicates`) wrap each call to parse the response body when present and surface FastAPI's `{detail: "..."}` field as the row's error message; falling back to `HTTP ${status}` only when no body is returned.

Post-submit:

- Successful rows move into a collapsed "**N students created**" disclosure with assigned IDs (links to detail pages).
- Failed rows take over the active table — fully editable via drawer, error reason visible per row.
- "Retry failed (N)" re-runs the pipeline against just the failed rows.
- "Done & return to Students" navigates to `StudentsPage` regardless of whether any failures remain (the IndexedDB draft persists; admin can resume later).

**Alternative considered:** transactional all-or-nothing. Rejected — would require DataCore work, and an admin who edited 30 rows for 20 minutes does not want 2 duplicates to nuke the whole submission.

### Persistence: hybrid IndexedDB

- **Upload + extracting phases:** in-memory only, plus `beforeunload` warning if unsaved rows exist. Files cannot reasonably be persisted (PDFs are MBs each), and re-uploading is the only way to retry an extract failure anyway.
- **Review phase onward:** rows are written to IndexedDB on every edit (debounced ~500ms). Schema mirrors Papermite's `db/indexedDb.ts` pattern: a single object store keyed by `{tenant_id, batch_id}` with `mode`, `rows`, `column_mapping` (CSV only), `created_at`, `updated_at`.
- **On page load:** call `findActiveDraftsForTenant(tenantId)`. If exactly one draft exists, prompt "Resume previous batch?" with row count and last-edited timestamp; choices Resume / Discard. If multiple drafts exist (admin used multiple tabs), surface the most-recent in the prompt and append a footer line "N other unfinished batches" listing the rest by timestamp; admin can pick any one to resume or discard the rest in bulk.
- **Cleared:** on successful full submit (no failures), or on explicit "Discard batch."
- **Model-version mismatch on resume:** rebuild row schema from the *current* tenant model. Orphaned field values (custom field deleted from model) display as "Unknown field" with a discard option. New required fields not present in the draft show as missing-field validation errors. We do not attempt automatic migration.

### Concurrency utility

Extract, duplicate-check, and submit all need bounded-parallel fan-out with per-row progress callbacks. We add a small `utils/boundedParallel.ts` with a `runBounded<T, R>(items, fn, { concurrency, onProgress })` helper. Single source of truth, used in three places.

### Authorization

Authorization for bulk-add operations is delegated entirely to the existing backend endpoints (extract / duplicate-check / create), which already enforce admin role via DataCore's auth layer. The bulk-add page does not introduce a new UI-level role gate — matching the pattern of the existing single-add button on `StudentsPage`. A non-admin user who reaches the page (e.g., by typing the URL) will see the UI render but every server call will fail with the upstream's permission error, which surfaces as the row's failure reason via the standard error-extraction path.

### Concurrency configuration

All three fan-out points (extract, duplicate-check, create) share a single configured concurrency limit. Default is **5**, overridable at build time via the Vite environment variable `VITE_BULK_ADD_CONCURRENCY`. Resolution lives in `admindash/frontend/src/config.ts` next to the cap constants and follows the same `parseInt` + NaN-fallback pattern. The constant is exported as `BULK_ADD_CONCURRENCY` and consumed by every `runBounded` call.

**Why one knob over three:** the three fan-outs have different ideal concurrencies (extract is LLM-heavy and rate-limited; duplicate-check and create are DataCore-bound and faster). A single knob is a compromise but covers the common case — in v1 we tune one number per environment, not three. If operations later show the three need separate tuning, we can split into `VITE_BULK_ADD_EXTRACT_CONCURRENCY` / `VITE_BULK_ADD_DATACORE_CONCURRENCY` without changing call-site shape.

**Why a frontend env var and not a server-side setting:** the concurrency limit is a frontend-side fan-out decision (we control how many requests we open in parallel from the browser), not a server-rate-limit. If we need to throttle server-side later, that's a separate concern for the admindash backend or DataCore.

### CSV parsing library

Use `papaparse` on the frontend. Standard, well-maintained, handles quoted values / escapes correctly, ~45KB gzipped. Parsing happens entirely client-side; no backend involvement for CSV.

## Risks / Trade-offs

- **[LLM rate limits during extract]** → bounded parallel 5 stays safely under Anthropic concurrent-request caps for vision-heavy calls. If a tenant somehow saturates their quota, extracts fail per-row with the upstream error and admin can retry individually.
- **[Duplicate check stale by submit time]** → submit-time check, not eager, so the decision is made on current data. The `Save anyway` choice covers the "I know this is a duplicate" case.
- **[IndexedDB quota / model drift on resume]** → rows-only persistence keeps payload small; model rebuild on resume handles drift gracefully with a discard path for orphaned values.
- **[Mid-extract close = lost progress]** → accepted. Files can't reasonably persist; re-upload is the recovery. `beforeunload` warning catches accidental closes.
- **[Backend-assigned IDs invisible pre-submit]** → admins can't see "what IDs am I about to create." Mitigation: post-submit disclosure shows assigned IDs prominently. In practice, the IDs are not actionable pre-submit.
- **[Bounded-parallel submit means partial state]** → some rows succeed, some fail. Post-submit retry-failed loop is the explicit recovery model. Successful rows are durably created in DataCore; nothing rolls back.
- **[CSV mapping screen is asymmetric with doc mode]** → docs go straight to extract; CSV needs an extra mapping step. Acceptable cost for the only place to surface "your CSV is missing required columns" before the admin wastes review time.
- **[`papaparse` dependency]** → adds ~45KB to the bundle. Justified by handling CSV edge cases (quoted values, escapes, BOM) we'd otherwise reinvent.

## Migration Plan

No data or schema migration. Pure additive frontend feature.

Deploy steps:

1. Ship the new page behind no flag (it's an isolated route; broken UI cannot affect existing single-add).
2. Verify `StudentsPage` "Bulk add" button is visible to admin role only.
3. Smoke-test with a 5-document batch and a 5-row CSV in staging.
4. Roll forward to production.

Rollback: remove the route registration and the StudentsPage button entry; everything else is dormant code.

## Open Questions

None at design time. Implementation may surface questions about table virtualization (do we need it at 500 rows?) and `papaparse` streaming for large CSVs — both can be handled in the writing-plans phase based on measured behavior.
