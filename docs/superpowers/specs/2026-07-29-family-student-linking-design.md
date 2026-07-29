# Family ↔ Student Linking (AdminDash)

**Date:** 2026-07-29
**Status:** Design — approved direction, pending spec review
**Scope:** admindash frontend + backend, datacore (via existing proxies). **Papermite unchanged in Phase 1.**

## Goal

Let school staff link students to families throughout AdminDash:

1. When adding a student (web form, single-doc extract, and batch import), link the student to an **existing** family or **create a new** family inline — so siblings share one family record.
2. Add a **Families tab**: search families and view a family's linked students, with a shortcut to add another student to that family.

## Confirmed decisions

- **Workflow: Hybrid B + C.** Inline family field on the single-record flows (web form + single-doc), a reconciliation layer for batch, plus a family-centric Families tab.
- **Phasing: Phase 1 = admindash + datacore only.** Family fields are *not* auto-extracted from documents yet (that needs a Papermite change → Phase 2). In Phase 1, document-based flows still link families **manually** via the shared family picker / reconciliation UI.

## Current state (ground truth)

- **Family entity already exists**, created today only during lead→family conversion (`backend/app/api/leads.py:267`). Fields: `family_name`, `primary_address`, `primary_email`, `primary_phone`.
- **Student links to family via `family_id` — a single string** (the family's `entity_id`), set in `student_base` at `leads.py:278`. It is **one family per student**.
- The `Student` TS interface (`frontend/src/types/models.ts:9`) does **not** declare `family_id` yet; it must be added. Guardians are a *separate* entity (`guardian_ids`, `Guardian` interface) and are **out of scope** here.
- Entity create/read all go through the generic proxy: `POST /api/entities/{tenant}/{entity_type}` (→ DataCore) and SQL via `POST /api/query`. No family-specific backend routes exist, and none are strictly required.
- Single-add: `AddStudentModal.tsx` (Web Form tab uses `DynamicForm`; Upload Document tab → `/api/extract/{tenant}/student` → **student fields only**). `family_id` is never set today.
- Batch: `BulkAddStudentsPage.tsx` + `bulkAddOrchestrators.ts` (CSV mapping *or* bulk-doc extraction → `BulkReviewTable` → `PreSubmitGate` → parallel one-create-per-row; IndexedDB draft resume via `bulkAddDrafts.ts`). No family notion anywhere today.
- Nav (`Navbar.tsx`): Home / Leads / Students / Programs. No Families tab.

## Design decisions (defaults chosen — flag during review if any should change)

| # | Decision | Rationale |
|---|---|---|
| D1 | **One family per student.** `family_id` stays a scalar string. Split-household / multi-family is out of scope. | Matches existing convert code and afterschool mental model; avoids array churn. |
| D2 | **Family fields (Phase 1):** `family_name` (required), `primary_email`, `primary_phone`, `primary_address`. | Reuse the exact four fields lead-conversion already writes, so all families are consistent. |
| D3 | **Family form is model-driven when possible.** Render the create-new-family mini-form from a registered `family` model definition via `ModelContext`/`DynamicForm` if present; otherwise fall back to the four D2 base fields. | Consistent with how student forms render; future-proof for custom family fields. |
| D4 | **Family match signature** (auto-match + dedup), in priority order: (1) exact normalized `primary_email`, (2) exact normalized `primary_phone`, (3) `family_name` + `primary_address` (normalized). | Email/phone are strongest identifiers; name+address catches the rest. |
| D5 | **No human-readable family ID / next-id in Phase 1.** Use `entity_id`. | Families are looked up by name/contact, not typed IDs. |
| D6 | **Pure, testable core.** Family matching, dedup, and sibling clustering live in a pure util module (`utils/familyMatch.ts`) with no I/O. | Frontend has no test runner today; keeping this pure lets us add Vitest for just this logic (see Testing). |

## Architecture

Three shared pieces power everything:

1. **`FamilyPicker` component** (`frontend/src/components/FamilyPicker.tsx`) — the reusable inline control. A search-as-you-type combobox over families (queries DataCore via `/api/query`) with a "＋ Create new family" affordance that expands the D3 mini-form. Emits either `{ mode: 'existing', familyId }` or `{ mode: 'new', familyData }`.
2. **`familyMatch.ts` util** — pure functions: `normalizeSignature(fields)`, `matchFamily(signature, candidates)`, `clusterSiblings(rows)`. Used by the picker's auto-match and by batch reconciliation.
3. **`familyApi` helpers** (`frontend/src/api/client.ts`) — `searchFamilies(tenant, q)`, `getFamilyById`, `getStudentsByFamily(tenant, familyId)`, `createFamily(tenant, familyData)` (thin wrappers over the existing `/api/query` and `/api/entities` proxies). **No new backend endpoints.**

### Data flow — single record (web form & single-doc)

```
open Add Student
  → (single-doc: extract student fields as today — no family fields in Phase 1)
  → Web Form tab now includes <FamilyPicker/>
      → user searches → picks existing family  ⇒ family_id = chosen id
      → OR "Create new family" → mini-form      ⇒ mode:'new'
  → Submit:
      if new: POST /api/entities/{t}/family  → family_id = result.entity_id
      POST /api/entities/{t}/student  with base_data.family_id = family_id
```
Family is created **before** the student so the student can carry `family_id`. If family creation fails, the student is not created and the error surfaces on the picker.

### Data flow — batch (CSV & bulk-doc)

```
CSV mode:  CsvMappingStep gains a "Family" section — map columns to
           family_name / primary_email / primary_phone / primary_address.
Doc mode:  Phase 1 extracts student fields only; family stays "unassigned".

Review:    familyMatch clusters rows into families (D4 signature) and
           auto-matches each cluster to an existing family.
           BulkReviewTable gains a "Family" column per row:
             [Existing: Nguyen Family] | [New: Nguyen] | [Unassigned] | [⚠ pick]
           BulkRowDrawer lets the user override via the same <FamilyPicker/>.

Submit (two-phase, in bulkAddOrchestrators.ts):
  Phase A  bulkCreateFamilies(uniqueNewClusters)  → clusterKey → familyId
  Phase B  bulkCreateStudents(rows)  with base_data.family_id resolved from
           (existing match id) or (Phase-A created id)
  Error handling: if a family create fails, its cluster's students fail as a
  group and are reported in PostSubmitSummary for retry.
```

### Families tab

- New nav item `Families` (`Navbar.tsx`) + route `/families` (`App.tsx`) → `pages/FamiliesPage.tsx`.
- **List/search:** query families via `/api/query` (same pattern as StudentsPage), searchable by `family_name` / `primary_email` / `primary_phone`. Columns: family name, primary contact, # students.
- **Family detail** (drawer or sub-page): shows family fields + **linked students** (`getStudentsByFamily` = `SELECT * FROM data WHERE entity_type='student' AND family_id='{id}'`). Each student row links to the student. A **"＋ Add student"** button opens `AddStudentModal` with the family **pre-linked** (picker preset to this family).
- Edit family fields inline (PUT via generic entity proxy).

## Components & files touched (Phase 1)

**New**
- `frontend/src/components/FamilyPicker.tsx` (+ `.css`)
- `frontend/src/utils/familyMatch.ts`
- `frontend/src/pages/FamiliesPage.tsx` (+ `.css`)
- `frontend/src/components/FamilyDetailDrawer.tsx` (+ `.css`)

**Modified**
- `frontend/src/types/models.ts` — add `family_id?: string` to `Student`; add `Family` interface.
- `frontend/src/api/client.ts` — family API helpers (D-flow above).
- `frontend/src/components/AddStudentModal.tsx` — embed `FamilyPicker`; create-family-then-student on submit; accept a `presetFamilyId` prop.
- `frontend/src/pages/StudentsPage.tsx` — show family as a link (read → click through to family), pass through to modal.
- `frontend/src/components/Navbar.tsx`, `frontend/src/App.tsx` — Families nav + route.
- `frontend/src/i18n/translations.ts` — new strings (en-US, zh-CN).
- **Batch:** `utils/csvMapping.ts` (+ `CsvMappingStep.tsx`) family columns; `types/bulkAdd.ts` (family resolution on `BulkRow`, `BatchDraft` unchanged shape but carries new row fields); `components/BulkReviewTable.tsx` family column; `components/BulkRowDrawer.tsx` family override; `pages/BulkAddStudentsPage.tsx` clustering before submit; `api/bulkAddOrchestrators.ts` `bulkCreateFamilies()` + link students; `db/bulkAddDrafts.ts` persists family resolution.

**Backend:** none required (generic proxies cover family CRUD, query, students-by-family). Follows existing JWT-delegation proxy pattern. (Known tenant-match proxy gap is pre-existing and out of scope.)

## Out of scope / deferred

- **Phase 2 (Papermite):** extend the extraction schema/prompt to emit family fields, so single-doc and bulk-doc flows **auto-populate and auto-cluster** families from documents. Reuses the exact same `FamilyPicker` / reconciliation UI — Phase 1 leaves clean hook points.
- Guardian linkage in this flow, multi-family per student, family merge/split tooling, family-level dedup warnings beyond the D4 match.

## Testing

- **Pure logic (`familyMatch.ts`, CSV family mapping):** add **Vitest** to the frontend (currently no test runner) and unit-test signature normalization, matching priority (D4), and sibling clustering with fixtures (siblings same family, ambiguous, no-family). This is the highest-value, lowest-cost coverage.
- **Backend:** proxy behavior is unchanged; existing `pytest` suite continues to cover entity/query proxying. Add a test asserting `family_id` round-trips through the student create proxy if not already covered.
- **Manual QA checklist:** (1) web-form link existing, (2) web-form create-new, (3) single-doc → manual link, (4) CSV with family columns → siblings grouped into one new family, (5) CSV mixing existing + new families, (6) bulk-doc manual family assignment, (7) draft resume preserves family resolution, (8) Families tab search + detail + "Add student" pre-link, (9) two-phase failure (family create fails → students reported for retry).

## Open questions for review

1. **Vitest adoption** — OK to add a frontend test runner for the pure family logic, or keep logic pure + manual-only for now?
2. **Bulk-doc in Phase 1** — confirm it's acceptable that bulk *document* imports assign family **manually** (no auto-group) until Phase 2; CSV gets full auto-grouping now.
3. **Families tab detail** — drawer (consistent with `LeadDetailDrawer`) vs. full sub-page. Default: drawer.
