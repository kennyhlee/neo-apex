## ADDED Requirements

### Requirement: Dynamic form generation from model definition
The system SHALL fetch the active student model definition from datacore and dynamically generate form fields for every field in both the `base_fields` and `custom_fields` arrays of the model definition.

#### Scenario: Model definition available
- **WHEN** user navigates to the add student form
- **THEN** system fetches the active model for `entity_type: "student"` from datacore API and renders a form field for each field in the model definition's `base_fields` and `custom_fields` arrays

#### Scenario: String field renders text input
- **WHEN** the model definition contains a field with type `str`
- **THEN** the form renders a text input for that field

#### Scenario: Number field renders number input
- **WHEN** the model definition contains a field with type `number`
- **THEN** the form renders a number input for that field

#### Scenario: Boolean field renders checkbox
- **WHEN** the model definition contains a field with type `bool`
- **THEN** the form renders a checkbox for that field

#### Scenario: Date field renders date picker
- **WHEN** the model definition contains a field with type `date`
- **THEN** the form renders a date picker input for that field

#### Scenario: Datetime field renders datetime picker
- **WHEN** the model definition contains a field with type `datetime`
- **THEN** the form renders a datetime picker input for that field

#### Scenario: Email field renders email input with validation
- **WHEN** the model definition contains a field with type `email`
- **THEN** the form renders an email input with email format validation

#### Scenario: Phone field renders phone input
- **WHEN** the model definition contains a field with type `phone`
- **THEN** the form renders a phone input for that field

#### Scenario: Single-select field renders dropdown
- **WHEN** the model definition contains a field with type `selection` and `multiple: false`
- **THEN** the form renders a single-select dropdown populated with the field's `options` array

#### Scenario: Multi-select field renders multi-select control
- **WHEN** the model definition contains a field with type `selection` and `multiple: true`
- **THEN** the form renders a multi-select control populated with the field's `options` array

#### Scenario: Required fields are enforced
- **WHEN** a field in the model definition has `required: true`
- **THEN** the form marks the field as required and prevents submission if it is empty

#### Scenario: Model definition not found
- **WHEN** no active student model definition exists for the tenant
- **THEN** the system displays an error message indicating the student model must be configured via papermite before students can be added

### Requirement: No ad-hoc field entry
The form SHALL NOT allow users to add fields that are not defined in the model definition. New fields require a model update via papermite's model workflow.

#### Scenario: Form fields match model exactly
- **WHEN** the form is rendered from a model definition
- **THEN** only fields defined in the model's `base_fields` and `custom_fields` arrays are shown — no mechanism exists to add arbitrary fields

### Requirement: Add student navigation
The system SHALL navigate to a dedicated add-student page when the user clicks the "Add Student" button on StudentsPage.

#### Scenario: Click add student button
- **WHEN** user clicks the "Add Student" button on the students list page
- **THEN** the system navigates to `/students/add`

#### Scenario: Back navigation
- **WHEN** user clicks cancel or back on the add student form
- **THEN** the system navigates back to the students list page

### Requirement: Two entry mode tabs
The add student page SHALL provide two tabs: "Web Form" for manual entry and "Upload Document" for document-based entry.

#### Scenario: Default tab
- **WHEN** user navigates to the add student page
- **THEN** the "Web Form" tab is selected by default

#### Scenario: Switch to upload tab
- **WHEN** user clicks the "Upload Document" tab
- **THEN** the view switches to the document upload interface

### Requirement: Form submission stores student entity
The system SHALL submit the completed form data to datacore as a new student entity, splitting fields according to the model definition — `base_fields` values sent as `base_data`, `custom_fields` values sent as `custom_fields`, both TOON-encoded by datacore.

#### Scenario: Successful submission
- **WHEN** user fills in all required fields and clicks submit
- **THEN** the system calls `POST /api/entities/{tenant_id}/student` on datacore with `base_data` containing model `base_fields` values and `custom_fields` containing model `custom_fields` values
- **AND** the system navigates back to the students list page with a success message

#### Scenario: Submission failure
- **WHEN** the API returns an error on submission
- **THEN** the system displays the error message and keeps the form data intact for correction
