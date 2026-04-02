## Why

The current add student flow requires manual entry of student IDs with no intelligence — users must know and type the correct ID format, leading to inconsistencies and data entry errors. There is also no duplicate detection, so the same student can be enrolled multiple times without warning. Auto-generating student IDs from a predictable pattern (tenant abbreviation + entity type + sequential number) reduces friction, and semantic similarity checking on save prevents costly duplicate records.

## What Changes

- **Auto-generate student IDs**: When adding a student, the system queries the most recent student ID for the tenant, parses the pattern (`{tenant_abbrev}{entity_abbrev}{sequence}`), and pre-fills the next sequential ID as a read-only field. Example: if the last ID is `ACCST0042`, the next generated ID is `ACCST0043`.
- **Semantic duplicate detection on save**: When the user clicks Save, the system performs a similarity search against existing student records using a vector DB. Fields compared include first name, last name, date of birth, and primary_address. If similar records are found, a warning modal displays the matches and lets the user abort or proceed.
- **New API endpoints**: Backend endpoints needed for ID generation and semantic similarity search.

## Capabilities

### New Capabilities
- `auto-student-id`: Auto-generation of sequential student IDs based on tenant abbreviation + entity type abbreviation + incrementing number, displayed as a read-only field.
- `student-duplicate-detection`: Semantic similarity search on student records (first name, last name, DOB, primary_address) using vector DB to warn about potential duplicates before saving.

### Modified Capabilities
<!-- No existing spec-level capabilities are changing -->

## Impact

- **Frontend**: `AddStudentPage` — auto-ID fetch, duplicate detection intercept, modal state; `DynamicForm` — new generic `readOnlyFields` prop; new `DuplicateWarningModal` component
- **API client**: New API functions for next-ID generation and similarity search
- **Backend (datacore)**: New endpoints: `GET /api/entities/{tenant}/student/next-id`, `POST /api/entities/{tenant}/student/similarity-search`
- **Infrastructure**: Vector DB integration (e.g., pgvector extension or dedicated vector store) for semantic search on student records
- **Types**: New interfaces for ID generation response, similarity search request/response
