## 1. Create AddStudentModal Component

- [ ] 1.1 Create `frontend/src/components/AddStudentModal.tsx` — extract all add-student logic from AddStudentPage into a self-contained modal component (state management, tab switching, auto-ID fetch, form submission, duplicate detection, success handling). Props: `tenant`, `onClose`, `onSuccess(entityId: string)`. No close on overlay click (match edit modal pattern). Call `invalidateStudentCount()` via `useDashboard` on successful creation.
- [ ] 1.2 Create `frontend/src/components/AddStudentModal.css` — modal card styling (780px max-width, 85vh max-height, scrollable body, tab styles adapted from AddStudentPage.css)

## 2. Integrate Modal into StudentsPage

- [ ] 2.1 Add `showAddModal` state to StudentsPage and wire the "Add Student" button to open the modal instead of navigating to `/students/add`
- [ ] 2.2 Render `AddStudentModal` in StudentsPage with props for tenant, onClose, and onSuccess — onSuccess should call `loadData(page, filters)` to refresh the list and set highlight state for the new entity ID

## 3. Remove AddStudentPage Route

- [ ] 3.1 Remove the `/students/add` route from App.tsx
- [ ] 3.2 Remove the AddStudentPage import from App.tsx

## 4. Verify and Build

- [ ] 4.1 Run `npm run build` to verify TypeScript compilation and no import errors
- [ ] 4.2 Manual verification: open StudentsPage, click Add Student, verify modal opens with tabs, submit a student, confirm list refreshes with highlight
