## Context

AdminDash's add student flow currently renders a dynamic form driven by datacore's model definition. Student IDs are manually entered with no auto-generation or validation beyond required-field checks. There is no duplicate detection — identical students can be enrolled multiple times. The backend (datacore) runs at `:8081` and manages entity CRUD via `POST /api/entities/{tenant}/student`. The frontend is a React SPA at `:5174`.

Key constraints:
- Frontend-only changes ship fastest; backend changes require coordinating with the datacore service
- The model-driven form (DynamicForm) renders fields dynamically from `ModelDefinition` — student ID generation must work within this pattern
- Tenant isolation is enforced at the API level via tenant path parameter

## Goals / Non-Goals

**Goals:**
- Auto-generate the next sequential student ID in the format `{TENANT_ABBREV}{ST}{NNNN}` (e.g., `ACCST0043`)
- Display the generated ID as a read-only field (no manual override)
- Detect potential duplicate students on save using semantic similarity (vector DB) on name, DOB, primary_address
- Present duplicate warnings with enough detail for users to make an informed decision

**Non-Goals:**
- Changing the student data model or adding new base fields
- Auto-generating IDs for entity types other than student (future work)
- Deduplication of existing records (this is prevention, not remediation)
- Family ID handling — the full enrollment flow (student → family → contacts) is planned as future work; family ID is left unfilled in this change
- Configuring similarity thresholds via UI (hardcoded reasonable defaults)
- Tenant abbreviation management UI (deferred to tenant admin flow)

## Decisions

### 1. ID Generation: Backend-driven via new endpoint

**Decision**: Add `GET /api/entities/{tenant}/student/next-id` to datacore that returns the next sequential ID.

**Rationale**: The backend owns the entity store and can atomically query the latest ID. Generating IDs on the frontend would require fetching all existing IDs and introduces race conditions when multiple users add students simultaneously.

**Alternatives considered**:
- *Frontend-side generation*: Query all student IDs, parse, increment. Rejected — race conditions, requires full ID list fetch.
- *UUID-based IDs*: Globally unique but not human-readable or sequential. Rejected — user requirement is meaningful, sequential IDs.

### 2. ID Format: `{TENANT_ABBREV}{ENTITY_ABBREV}{ZERO_PADDED_SEQ}`

**Decision**: Student IDs follow pattern like `ACCST0001` where `ACC` = tenant abbreviation, `ST` = student entity type, `0001` = 4-digit zero-padded sequence.

**Rationale**: Embedding the tenant and entity type makes IDs self-describing and prevents cross-tenant collision. Zero-padding to 4 digits supports up to 9999 students per tenant (sufficient for education centers; can extend to 5+ digits later).

**Details**:
- Tenant abbreviation: a stored field on the tenant record (`tenant_abbrev`), seeded via migration by deriving from `tenant.name`:
  - Single word → first 3 letters uppercased (e.g., "Summit" → `SUM`)
  - Two words → first 1-2 letters of each word (e.g., "Green Valley" → `GV`)
  - Three+ words → first letter of the first 2-3 words (e.g., "Acme Child Center" → `ACC`)
- Entity abbreviation: `ST` for student (fixed)
- Sequence: parsed from the last known ID, incremented by 1. If no records exist, starts at `0001`.
- The backend endpoint returns both the suggested ID and the parsed components so the frontend can display the pattern.
- No tenant abbreviation management UI in this change — deferred to a future tenant admin flow.

### 3. Read-Only Student ID Field

**Decision**: The auto-generated student ID is displayed as a read-only field. Users cannot modify it.

**Rationale**: Guarantees consistent ID format across all records, eliminates typos and format drift, and removes the need for a uniqueness validation endpoint. The auto-generated ID is already guaranteed unique by the backend's atomic increment. Editability can be added later if a concrete need arises.

**Alternatives considered**:
- *Editable with debounced uniqueness check*: More flexible but adds complexity (new endpoint, validation UI, error states) without a clear use case. Deferred.

### 4. Duplicate Detection: Vector similarity search via new endpoint

**Decision**: Add `POST /api/entities/{tenant}/student/similarity-search` to datacore. This endpoint accepts a student record fragment and returns similar existing records with similarity scores.

**Rationale**: Exact-match dedup misses typos and name variations. Vector similarity (embedding first+last name, DOB, primary_address into a dense vector) catches near-duplicates like "Jon Smith" vs "John Smith" or transposed addresses.

**Implementation approach**:
- Datacore uses pgvector (PostgreSQL extension) to store pre-computed embeddings for each student record
- On save, the frontend sends the new student's data to the similarity endpoint
- Backend computes an embedding for the input, queries nearest neighbors, returns matches above a threshold (e.g., cosine similarity > 0.85)
- Frontend displays matches in a warning modal with side-by-side comparison

**Alternatives considered**:
- *Exact field matching*: Too rigid — misses typos, abbreviations. Rejected for primary detection (could supplement).
- *Fuzzy string matching (Levenshtein)*: Better than exact but doesn't capture semantic similarity across multiple fields holistically. Rejected as primary.
- *External vector DB (Pinecone, Weaviate)*: Adds infrastructure dependency. pgvector keeps it in the existing PostgreSQL stack. Rejected for simplicity.

### 5. Frontend Integration: `readOnlyFields` prop on DynamicForm

**Decision**: Add a generic `readOnlyFields?: string[]` prop to `DynamicForm`. `AddStudentPage` passes `['student_id']` along with `initialValues` to pre-populate and lock the field. Duplicate detection is handled in `AddStudentPage` — intercepting after DynamicForm's `onSubmit` but before `createStudent`.

**Rationale**: A generic `readOnlyFields` prop keeps DynamicForm reusable across entity types while supporting the read-only student ID requirement. The alternative (rendering the ID outside the form) would break the visual field layout and require manually injecting the value into submission data.

## Risks / Trade-offs

- **Race condition on ID generation** → The `next-id` endpoint should use a database sequence or atomic increment to prevent two concurrent users from getting the same suggested ID. Mitigation: backend uses `SELECT ... FOR UPDATE` or a dedicated sequence table.
- **Vector DB cold start** → Existing student records need embeddings generated before similarity search works. Mitigation: add a one-time migration/backfill job to compute embeddings for existing records.
- **Similarity threshold tuning** → Too sensitive = false positives (warning on every save), too loose = misses duplicates. Mitigation: start with cosine similarity > 0.85, monitor feedback, adjust. Log similarity scores for tuning.
- **pgvector availability** → Requires PostgreSQL with pgvector extension. If datacore uses a different DB, this approach needs adaptation. Mitigation: confirm datacore's DB stack supports pgvector.
- **Latency on save** → Similarity search adds a round-trip before save completes. Mitigation: the endpoint should respond in <500ms for typical dataset sizes (<10k students). Show a loading indicator during the check.
