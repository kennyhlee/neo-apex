## Why

Adding a student currently navigates the user away from the Students list page to a separate AddStudentPage. This page-to-page transition breaks workflow continuity — the user loses sight of their student list, and after saving they're redirected back. A modal dialog keeps the user in context, reduces navigation friction, and aligns with the existing Edit Student modal pattern already in use on the same page.

## What Changes

- Replace the "Add Student" button's navigation (`/students/add`) with opening a modal dialog on the StudentsPage
- The modal replicates the full AddStudentPage functionality: "Web Form" tab with DynamicForm, "Upload Document" tab with document extraction, duplicate detection, and auto-ID generation
- Remove the `/students/add` route from App.tsx and the AddStudentPage component (or deprecate)
- Reuse the existing overlay/modal CSS pattern (`students-confirm-overlay` / `students-edit-modal`) already used by the Edit Student modal

## Capabilities

### New Capabilities
- `add-student-modal`: Modal dialog for adding students inline on the StudentsPage, with tabbed interface (web form + document upload) and duplicate detection

### Modified Capabilities

## Impact

- **StudentsPage.tsx**: New modal state, add student logic moved here (or extracted to a shared component)
- **AddStudentPage.tsx**: No longer routed to; may be removed or kept as a standalone fallback
- **App.tsx**: `/students/add` route removed
- **StudentsPage.css**: Modal sizing adjustments (add modal needs more width than edit modal for tabs)
- **DynamicForm.tsx**: No changes expected — reused as-is
- **DuplicateWarningModal.tsx**: No changes expected — reused as-is
