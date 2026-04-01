## ADDED Requirements

### Requirement: Document upload interface
The system SHALL provide a file upload area on the "Upload Document" tab that accepts application documents (PDF, images).

#### Scenario: Upload a document
- **WHEN** user selects or drags a file onto the upload area
- **THEN** the system uploads the file to papermite's extraction API (`POST /api/extract/{tenant_id}/student`)
- **AND** displays a loading indicator during extraction

#### Scenario: Unsupported file type
- **WHEN** user selects a file that is not a supported format (PDF, PNG, JPG, JPEG)
- **THEN** the system displays a validation error and does not upload the file

### Requirement: Extraction populates web form
The system SHALL use the extraction response from papermite to pre-populate the web form fields, then switch to the "Web Form" tab for review.

#### Scenario: Successful extraction
- **WHEN** papermite's extraction API returns extracted field values
- **THEN** the system populates matching form fields with the extracted values
- **AND** switches to the "Web Form" tab so the user can review and correct the data

#### Scenario: Partial extraction
- **WHEN** the extraction API returns values for some but not all model fields
- **THEN** the populated fields show extracted values and unpopulated fields remain empty for manual entry

#### Scenario: Extraction failure
- **WHEN** the extraction API returns an error
- **THEN** the system displays the error message and the user can retry the upload or switch to manual entry

### Requirement: Review before submit
The system SHALL NOT auto-submit extracted data. The user MUST review and explicitly submit after extraction.

#### Scenario: User reviews extracted data
- **WHEN** extraction completes and form is pre-populated
- **THEN** the submit button is available but not triggered automatically
- **AND** the user can modify any pre-populated field before submitting
