## Context

The StudentsPage currently navigates to a separate AddStudentPage (`/students/add`) when the user clicks "Add Student." The AddStudentPage contains a tabbed interface (Web Form / Upload Document), auto-ID generation, duplicate detection, and form submission via DynamicForm.

The StudentsPage already has an inline Edit Student modal using the `students-confirm-overlay` / `students-edit-modal` pattern. The goal is to bring add-student functionality into a similar modal on the same page.

## Goals / Non-Goals

**Goals:**
- Move add-student UI into a modal dialog on StudentsPage, reusing the existing overlay pattern
- Preserve all current functionality: tabbed form/upload, auto-ID generation, duplicate detection, success feedback
- Remove the `/students/add` route and AddStudentPage from the router
- Keep the student list visible behind the modal overlay so the user stays oriented

**Non-Goals:**
- Refactoring DynamicForm, DocumentUpload, or DuplicateWarningModal components — they are reused as-is
- Changing the add-student API calls or backend behavior
- Creating a shared "AddStudentModal" component for use in other pages — this is StudentsPage-only for now
- Changing the edit student modal behavior

## Decisions

### 1. Extract logic into an AddStudentModal component

**Decision:** Create a new `AddStudentModal` component that encapsulates all add-student logic currently in AddStudentPage (state management, tab switching, form submission, duplicate detection, auto-ID).

**Why:** Inlining all add-student state and handlers directly into StudentsPage would bloat an already large component (~600 lines). A self-contained modal component keeps StudentsPage manageable and makes the add-student logic easy to find and modify.

**Alternative considered:** Inline everything into StudentsPage. Rejected because StudentsPage already has edit-modal state, table preferences, filtering, pagination, and column management. Adding another ~150 lines of state/handlers would hurt readability.

### 2. Reuse the existing overlay CSS pattern

**Decision:** Use the same `students-confirm-overlay` class for the backdrop. Create a new `students-add-modal` class for the modal card itself, wider than `students-edit-modal` to accommodate tabs.

**Why:** Visual consistency with the edit modal. The overlay backdrop behavior (click-outside handling, z-index) is already working.

### 3. Modal width and scroll

**Decision:** The add modal will use `max-width: 780px` (vs 640px for edit) and `max-height: 85vh` with overflow-y scroll on the body, matching the edit modal's scroll pattern.

**Why:** The add form has tabs + the upload area, which needs more horizontal space than the edit form. 780px keeps it comfortable without feeling oversized.

### 4. On-success behavior

**Decision:** After successful student creation, close the modal, refresh the student list, and highlight the new row — same as the current page-based flow which navigates back with `highlightEntityId` state.

**Why:** The user should immediately see the new student in their list without a page reload or navigation.

### 5. Remove AddStudentPage route

**Decision:** Remove the `/students/add` route from App.tsx. Keep AddStudentPage.tsx file in the codebase but unused (no route points to it), to reduce risk. It can be deleted in a follow-up cleanup.

**Why:** Removing the route is the breaking change. Keeping the file avoids accidental loss of reference code and makes rollback trivial.

## Risks / Trade-offs

- **Modal stacking:** The add modal may trigger the DuplicateWarningModal, creating a modal-on-modal situation. This already works in AddStudentPage (duplicate modal overlays the page), and will work the same way in the modal context since DuplicateWarningModal uses its own fixed overlay with higher z-index. No mitigation needed.
- **State reset on close:** If the user closes the modal mid-form, all entered data is lost. This matches the current page behavior (navigating away loses data). Acceptable for now.
- **Large modal on mobile:** 780px max-width with tabs may feel cramped on small screens. The existing responsive breakpoints in AddStudentPage.css can be adapted. Low risk since AdminDash is primarily a desktop tool.
