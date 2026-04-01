## 1. Routing & Page Structure

- [ ] 1.1 Add `/students/add` route in `App.tsx` pointing to new `AddStudentPage` component
- [ ] 1.2 Create `AddStudentPage` component with two-tab layout (Web Form / Upload Document)
- [ ] 1.3 Wire "Add Student" button on `StudentsPage` to navigate to `/students/add`
- [ ] 1.4 Add cancel/back navigation from `AddStudentPage` to `/students`

## 2. API Client Functions

- [ ] 2.1 Add datacore and papermite API base URL configs (separate from existing :8080 API)
- [ ] 2.2 Add `fetchStudentModel(tenantId)` — calls `GET /api/models/{tenant_id}/student` on datacore API
- [ ] 2.3 Add `createStudent(tenantId, baseData, customFields)` — calls `POST /api/entities/{tenant_id}/student` on datacore API
- [ ] 2.4 Add `extractStudentFromDocument(tenantId, file)` — calls `POST /api/extract/{tenant_id}/student` on papermite API

## 3. Dynamic Form Generation

- [ ] 3.1 Build `DynamicForm` component that renders fields from a model definition — supports all field types: `str`, `number`, `bool`, `date`, `datetime`, `email`, `phone`, `selection` (single and multi-select)
- [ ] 3.2 Implement required field validation and form-level validation before submit
- [ ] 3.3 Handle model-not-found state with error message directing user to papermite

## 4. Document Upload & Extraction

- [ ] 4.1 Build upload area component on "Upload Document" tab (drag & drop, file picker, format validation for PDF/PNG/JPG/JPEG)
- [ ] 4.2 On upload, call papermite extraction API and show loading state
- [ ] 4.3 On extraction success, populate form fields and switch to "Web Form" tab for review
- [ ] 4.4 Handle extraction errors and partial extraction (unfilled fields remain empty)

## 5. Form Submission & UX

- [ ] 5.1 On submit, split form data into `base_data` (model `base_fields`) and `custom_fields` (model `custom_fields`), call datacore create API
- [ ] 5.2 Show success message and navigate back to students list on successful creation
- [ ] 5.3 Show error message and preserve form data on submission failure
- [ ] 5.4 Add i18n translation keys for all new UI text (en-US and zh-CN)
- [ ] 5.5 Style the add student page and form components using existing CSS variable system
