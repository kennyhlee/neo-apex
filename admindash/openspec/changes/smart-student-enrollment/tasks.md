## 1. Types and API Client

- [ ] 1.1 Add TypeScript interfaces for next-id response (`NextIdResponse`), similarity search request/response (`SimilaritySearchRequest`, `SimilaritySearchResponse`, `SimilarityMatch`)
- [ ] 1.2 Add API client function `fetchNextStudentId(tenant: string): Promise<NextIdResponse>` calling `GET /api/entities/{tenant}/student/next-id`
- [ ] 1.3 Add API client function `searchSimilarStudents(tenant: string, data: SimilaritySearchRequest): Promise<SimilaritySearchResponse>` calling `POST /api/entities/{tenant}/student/similarity-search`

## 2. DynamicForm readOnlyFields Support

- [ ] 2.1 Add `readOnlyFields?: string[]` prop to `DynamicForm` component
- [ ] 2.2 In `renderField`, disable inputs and apply muted styling for fields whose names appear in `readOnlyFields`
- [ ] 2.3 Display helper text ("Auto-generated") below read-only fields
- [ ] 2.4 Ensure read-only fields are still included in form submission data (`baseData`/`customFields`)

## 3. Student ID Auto-Generation UI

- [ ] 3.1 In `AddStudentPage`, call `fetchNextStudentId` on mount (after model loads) and store the result in state
- [ ] 3.2 Pass the auto-generated student ID as `initialValues` and `readOnlyFields={['student_id']}` to `DynamicForm`
- [ ] 3.3 Handle `fetchNextStudentId` failure gracefully — leave the field empty and editable with an inline message

## 4. Duplicate Detection on Save

- [ ] 4.1 Intercept the form submission in `AddStudentPage` — after DynamicForm validates but before calling `createStudent`, call `searchSimilarStudents` with first_name, last_name, dob, and primary_address
- [ ] 4.2 Show a loading state on the Save button ("Checking for duplicates...") while the similarity search runs
- [ ] 4.3 If no matches are returned, proceed with `createStudent` as normal

## 5. Duplicate Warning Modal

- [ ] 5.1 Create a `DuplicateWarningModal` component that displays matched records with student ID, name, DOB, primary_address, and similarity score (as percentage)
- [ ] 5.2 Sort matches by similarity score (highest first), display max 5
- [ ] 5.3 Add "Go Back" button that closes the modal and returns to the form with data preserved
- [ ] 5.4 Add "Save Anyway" button that proceeds with `createStudent` and follows normal post-save flow
- [ ] 5.5 Handle similarity search failure — show warning that duplicate checking is unavailable, allow proceed or cancel

## 6. Integration and Polish

- [ ] 6.1 Wire up the full flow end-to-end: form load → auto-ID → save → similarity check → modal or create
- [ ] 6.2 Add i18n translation keys for all new UI strings (en-US and zh-CN)
- [ ] 6.3 Style the duplicate warning modal and read-only ID field to match the existing AdminDash theme
