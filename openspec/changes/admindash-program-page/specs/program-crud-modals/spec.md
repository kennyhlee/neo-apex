## ADDED Requirements

### Requirement: Add program modal
The system SHALL provide an Add Program modal that renders a DynamicForm based on the program model definition, with auto-generated program ID.

#### Scenario: Open add modal
- **WHEN** the user clicks the "Add Program" button in the toolbar
- **THEN** a modal SHALL open containing a DynamicForm with all fields from the program model definition, with program_id pre-filled and read-only

#### Scenario: Submit new program
- **WHEN** the user fills out the form and clicks Save
- **THEN** the system SHALL call `createProgram()` with base data and custom fields, close the modal, and reload the program list

#### Scenario: Cancel add
- **WHEN** the user clicks Cancel on the add modal
- **THEN** the modal SHALL close without creating a program

### Requirement: Edit program modal
The system SHALL provide an Edit Program modal that pre-populates a DynamicForm with the selected program's data.

#### Scenario: Open edit modal for single selection
- **WHEN** the user selects one program row and clicks "Edit Selected" in the action menu
- **THEN** an edit modal SHALL open with DynamicForm pre-populated with the selected program's data, with program_id read-only

#### Scenario: Submit edit
- **WHEN** the user modifies fields and clicks Save
- **THEN** the system SHALL call `updateProgram()` with the updated data, close the modal, and reload the program list

#### Scenario: Multi-select edit
- **WHEN** the user selects multiple program rows and clicks "Edit Selected"
- **THEN** a dialog SHALL display indicating batch edit is coming soon

### Requirement: Archive confirmation dialog
The system SHALL provide an archive confirmation dialog before deleting selected programs.

#### Scenario: Confirm archive
- **WHEN** the user clicks "Delete Selected" and confirms in the dialog
- **THEN** the system SHALL call `archivePrograms()` with the selected entity IDs, close the dialog, clear the selection, and reload the program list

#### Scenario: Cancel archive
- **WHEN** the user clicks Cancel on the archive confirmation dialog
- **THEN** the dialog SHALL close without archiving any programs

### Requirement: I18n support for all modal text
All modal text (titles, buttons, labels, confirmations) SHALL use translation keys via the `useTranslation` hook, with keys for both en-US and zh-CN.

#### Scenario: Modal text in selected language
- **WHEN** the user's language is set to zh-CN
- **THEN** all modal titles, buttons, and labels SHALL display in Chinese
