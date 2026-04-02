## ADDED Requirements

### Requirement: Similarity check on save
The system SHALL perform a semantic similarity search against existing student records when the user clicks Save. The search SHALL compare the new student's first name, last name, date of birth, and primary_address against all existing students for the tenant.

#### Scenario: No similar records found
- **WHEN** the user clicks Save and the similarity search returns no matches above the threshold
- **THEN** the system SHALL proceed with creating the student record normally

#### Scenario: Similar records found
- **WHEN** the user clicks Save and the similarity search returns one or more matches above the similarity threshold (cosine similarity > 0.85)
- **THEN** the system SHALL pause the save operation and display a duplicate warning modal

#### Scenario: Similarity search API failure
- **WHEN** the similarity search endpoint returns an error or times out
- **THEN** the system SHALL display a warning that duplicate checking is unavailable and allow the user to proceed with save or cancel

### Requirement: Duplicate warning modal
The system SHALL display a modal when potential duplicate students are detected. The modal SHALL show a comparison between the new student data and each matched existing record.

#### Scenario: Modal displays matched records
- **WHEN** the duplicate warning modal appears
- **THEN** the modal SHALL display each matched record with: student ID, first name, last name, date of birth, primary_address, and similarity score (as a percentage)

#### Scenario: User aborts save
- **WHEN** the user clicks "Cancel" or "Go Back" in the duplicate warning modal
- **THEN** the system SHALL close the modal and return the user to the form with all entered data preserved

#### Scenario: User proceeds despite warning
- **WHEN** the user clicks "Save Anyway" in the duplicate warning modal
- **THEN** the system SHALL proceed with creating the student record and follow the normal post-save flow (success message, navigate to student list)

#### Scenario: Multiple matches displayed
- **WHEN** the similarity search returns multiple matches
- **THEN** the modal SHALL display all matches sorted by similarity score (highest first), with a maximum of 5 displayed

### Requirement: Loading state during similarity check
The system SHALL display a loading indicator while the similarity search is in progress. The Save button SHALL be disabled during this time.

#### Scenario: Similarity check in progress
- **WHEN** the user clicks Save and the similarity search is running
- **THEN** the Save button SHALL show a loading spinner and be disabled, with text changing to "Checking for duplicates..."

### Requirement: Backend similarity search endpoint
The datacore service SHALL expose `POST /api/entities/{tenant}/student/similarity-search` that accepts a student record fragment and returns similar existing records.

#### Scenario: Search with valid input
- **WHEN** a POST request is made with `{ "first_name": "John", "last_name": "Smith", "dob": "2015-03-10", "primary_address": "123 Main St" }`
- **THEN** the response SHALL include `{ "matches": [{ "entity_id": "...", "student_id": "...", "first_name": "...", "last_name": "...", "dob": "...", "primary_address": "...", "similarity_score": 0.92 }] }` containing records with similarity > 0.85

#### Scenario: Search with partial input
- **WHEN** a POST request is made with only some fields (e.g., only first_name and last_name)
- **THEN** the endpoint SHALL perform the similarity search using available fields and return matches accordingly

#### Scenario: No matches above threshold
- **WHEN** no existing records have similarity > 0.85 to the input
- **THEN** the response SHALL be `{ "matches": [] }`

### Requirement: Embeddings for existing records
The datacore service SHALL maintain vector embeddings for all student records. When a new student is created or an existing student is updated, the system SHALL compute and store/update the embedding.

#### Scenario: New student embedding
- **WHEN** a new student record is successfully created
- **THEN** the system SHALL compute and store a vector embedding for that record

#### Scenario: Backfill existing records
- **WHEN** the similarity search feature is deployed for the first time
- **THEN** a migration SHALL compute and store embeddings for all existing student records
