## ADDED Requirements

### Requirement: Add Student modal opens from StudentsPage
The system SHALL display an "Add Student" modal dialog when the user clicks the "Add Student" button on the StudentsPage. The modal SHALL overlay the current page without navigating away.

#### Scenario: User clicks Add Student button
- **WHEN** the user clicks the "Add Student" button on the StudentsPage
- **THEN** a modal dialog opens with a semi-transparent overlay behind it
- **THEN** the students list remains visible (dimmed) behind the overlay

#### Scenario: Modal uses consistent overlay pattern
- **WHEN** the Add Student modal is displayed
- **THEN** it SHALL use the same overlay pattern (`students-confirm-overlay`) as the Edit Student modal
- **THEN** the modal card SHALL have a max-width of 780px and max-height of 85vh with scrollable body

### Requirement: Add Student modal has tabbed interface
The modal SHALL contain two tabs: "Web Form" and "Upload Document", matching the current AddStudentPage functionality.

#### Scenario: Default tab is Web Form
- **WHEN** the Add Student modal opens
- **THEN** the "Web Form" tab is active by default
- **THEN** a DynamicForm is displayed with the student model fields

#### Scenario: User switches to Upload Document tab
- **WHEN** the user clicks the "Upload Document" tab
- **THEN** the DocumentUpload component is displayed
- **THEN** the Web Form tab becomes inactive

#### Scenario: Document extraction switches to form tab
- **WHEN** a document is uploaded and fields are extracted
- **THEN** the modal switches to the "Web Form" tab
- **THEN** the extracted values are pre-filled in the form fields

### Requirement: Auto-generated student ID
The modal SHALL fetch and display an auto-generated student ID when it opens.

#### Scenario: Student ID is pre-filled and read-only
- **WHEN** the Add Student modal opens
- **THEN** the system fetches the next available student ID
- **THEN** the student_id field is pre-filled with the generated ID and marked read-only

#### Scenario: Auto-ID service is unavailable
- **WHEN** the next student ID cannot be fetched
- **THEN** a warning message is displayed in the modal
- **THEN** the student_id field remains editable

### Requirement: Duplicate detection before submission
The modal SHALL check for duplicate students before creating a new record.

#### Scenario: Duplicates found
- **WHEN** the user submits the form and duplicate matches are found
- **THEN** the DuplicateWarningModal is displayed over the Add Student modal
- **THEN** the user can choose to go back or save anyway

#### Scenario: No duplicates found
- **WHEN** the user submits the form and no duplicates are found
- **THEN** the student is created immediately

#### Scenario: Duplicate check fails
- **WHEN** the duplicate check service is unavailable
- **THEN** a fallback dialog is shown asking the user whether to proceed without the check

### Requirement: Successful creation closes modal and refreshes list
The system SHALL close the modal and update the student list after successful creation.

#### Scenario: Student created successfully
- **WHEN** a student is successfully created
- **THEN** a success message is briefly displayed
- **THEN** the modal closes automatically
- **THEN** the student list refreshes and highlights the newly added student row

### Requirement: Modal can be closed without saving
The user SHALL be able to close the modal without creating a student.

#### Scenario: User clicks cancel button
- **WHEN** the user clicks the cancel button in the form
- **THEN** the modal closes
- **THEN** no student is created
- **THEN** the student list remains unchanged

### Requirement: AddStudentPage route is removed
The `/students/add` route SHALL be removed from the application router.

#### Scenario: Direct navigation to /students/add
- **WHEN** a user navigates to `/students/add`
- **THEN** they are redirected to `/students` (or the default route)
- **THEN** the Add Student modal is NOT automatically opened
