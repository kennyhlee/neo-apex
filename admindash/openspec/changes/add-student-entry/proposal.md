## Why

AdminDash currently lists students but has no way to add them. The "Add Student" button exists in the UI but is non-functional. Schools need to onboard students either by manually entering information or by uploading completed application forms. The student model definition lives in the vector DB (defined via papermite's model flow), so the web form should be dynamically generated from that model — ensuring the form always matches the current schema without frontend redeployment.

## What Changes

- Wire up the "Add Student" button on StudentsPage to open an add-student flow
- Provide two entry paths: (1) manual web form entry, (2) upload a completed application document for extraction
- Web form is dynamically built by reading the student model definition from the vector DB via datacore's `get_active_model()` API — form fields strictly match the model definition (both `base_fields` and `custom_fields` arrays), no ad-hoc fields allowed
- Document upload sends the file to **papermite's extraction API** (document extraction is papermite's responsibility), which returns extracted field values to pre-populate the web form for review/correction before submission
- On submit, student data is stored via datacore's `put_entity()` into the tenant's `{tenant_id}_entities` table with `entity_type: "student"` — both `base_data` and `custom_fields` TOON-encoded for consistency, all queryable via DuckDB/Arrow
- **Prerequisites** (tracked as separate openspec changes in their respective repos):
  - `datacore/add-student-entry`: TOON unification, `custom_fields` rename, REST API layer
  - `papermite/add-student-entry`: Document extraction endpoint, CORS update
- Implementation order: datacore → papermite → admindash
- Tenant tables are auto-created if they don't exist on first write
- **Scope**: This round focuses on student data entry and storage only — retrieval/filtering enhancements are deferred
- **Separation of concerns**: Datacore = storage, Papermite = document extraction, AdminDash = UI. No cross-cutting of responsibilities.

## Capabilities

### New Capabilities
- `student-entry-form`: Dynamic web form generation from vector DB model definition, manual data entry, and form submission — form fields strictly match the entity model
- `student-document-upload`: Application document upload via papermite extraction API, and web form pre-population for review

### Modified Capabilities

_(none — no existing specs are affected)_

## Impact

- **Frontend (admindash)**: StudentsPage add student button, new form/upload components, new API client functions calling both datacore (storage) and papermite (extraction)
- **Backend (datacore)**: New REST API layer (FastAPI) wrapping existing Store and QueryEngine classes — model retrieval and entity CRUD only. Both `base_data` and `custom_fields` TOON-encoded.
- **Backend (papermite)**: New extraction endpoint accepting document uploads and returning extracted field values mapped to the entity model
- **Storage**: Uses datacore's existing `{tenant_id}_entities` table design — student records stored with `entity_type: "student"`, base fields in `base_data` (TOON), custom fields in `custom_fields` (TOON). All fields queryable via DuckDB over Arrow tables.
- **Cross-project**: admindash frontend → datacore REST API (storage) + papermite API (extraction) → LanceDB. Tenant tables auto-created on first entity write.
