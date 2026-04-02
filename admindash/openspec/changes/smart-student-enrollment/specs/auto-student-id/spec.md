## ADDED Requirements

### Requirement: Auto-generate sequential student ID on form load
The system SHALL generate the next sequential student ID when the add student form loads. The ID format SHALL be `{TENANT_ABBREV}{ST}{ZERO_PADDED_SEQ}` where `TENANT_ABBREV` is a stored uppercase abbreviation on the tenant record (derived from `tenant.name`: single word → first 3 letters, two words → first 1-2 letters of each, three+ words → first letter of first 2-3 words), `ST` is the fixed entity type abbreviation for students, and `ZERO_PADDED_SEQ` is a 4-digit zero-padded incrementing number.

#### Scenario: First student for a tenant
- **WHEN** the add student form loads and the tenant has no existing students
- **THEN** the student ID field SHALL be pre-populated with `{TENANT_ABBREV}ST0001`

#### Scenario: Subsequent student with existing records
- **WHEN** the add student form loads and the tenant's most recent student ID is `ACCST0042`
- **THEN** the student ID field SHALL be pre-populated with `ACCST0043`

#### Scenario: ID generation API failure
- **WHEN** the next-id endpoint returns an error or is unreachable
- **THEN** the student ID field SHALL be left empty and editable, and the user SHALL see an inline message indicating auto-generation is unavailable

### Requirement: Student ID field is read-only via DynamicForm readOnlyFields prop
The system SHALL display the auto-generated student ID as a read-only field using a generic `readOnlyFields` prop on `DynamicForm`. The `DynamicForm` component SHALL accept an optional `readOnlyFields?: string[]` prop. Fields whose names appear in this array SHALL be rendered as disabled inputs with visually distinct styling. The field SHALL display helper text indicating the value was auto-generated (e.g., "Auto-generated").

#### Scenario: Auto-generated ID displayed as read-only
- **WHEN** the form loads successfully with a generated ID and `readOnlyFields` includes `'student_id'`
- **THEN** the student ID field SHALL show the generated value, be non-editable (disabled), and display helper text indicating it was auto-generated

#### Scenario: Read-only field styling
- **WHEN** a field name is included in the `readOnlyFields` array
- **THEN** the field SHALL have a visually distinct style (e.g., muted background) to indicate it is not editable

#### Scenario: readOnlyFields prop is generic
- **WHEN** `readOnlyFields` is passed with any field name
- **THEN** that field SHALL be rendered as read-only regardless of entity type — the prop is not student-specific

### Requirement: Auto-generated ID included in form submission
The system SHALL include the auto-generated student ID in the form data when the user submits the form.

#### Scenario: Form submission includes generated ID
- **WHEN** the user submits the add student form with an auto-generated ID
- **THEN** the student ID SHALL be included in the `base_data` payload sent to `createStudent`

### Requirement: Backend next-id endpoint
The datacore service SHALL expose `GET /api/entities/{tenant}/student/next-id` that returns the next available sequential student ID for the given tenant.

#### Scenario: Endpoint returns next ID
- **WHEN** a GET request is made to `/api/entities/{tenant}/student/next-id`
- **THEN** the response SHALL include `{ "next_id": "<generated_id>", "tenant_abbrev": "<abbrev>", "entity_abbrev": "ST", "sequence": <next_number> }`

#### Scenario: Concurrent requests
- **WHEN** two concurrent requests are made to the next-id endpoint
- **THEN** each request SHALL return a unique, non-conflicting ID (atomic increment)
