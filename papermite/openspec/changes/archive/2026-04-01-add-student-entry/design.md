## Context

Papermite is the document ingestion gateway for NeoApex. It already has a FastAPI backend with extraction capabilities (`app/api/extraction.py`). The add-student-entry feature requires admindash to upload application documents and get back extracted field values. This endpoint belongs in papermite because document extraction is papermite's responsibility — datacore is strictly storage, admindash is strictly UI.

Papermite already uses datacore for model storage via `lance_store.py` and has an existing extraction pipeline.

## Goals / Non-Goals

**Goals:**
- New extraction endpoint: `POST /api/extract/{tenant_id}/{entity_type}`
- Accept file uploads (PDF, PNG, JPG, JPEG)
- Return extracted field values mapped to the entity model's field names
- Update CORS to allow admindash origin (`localhost:5174`)

**Non-Goals:**
- Storage of extracted data (that's datacore's job — admindash submits to datacore after user review)
- Form rendering (admindash's responsibility)
- Model definition management (already handled by existing papermite flows)

## Decisions

### Decision 1: New endpoint on existing extraction router

Add `POST /api/extract/{tenant_id}/{entity_type}` to papermite's existing FastAPI app. This sits alongside the current extraction routes but serves a different purpose — it extracts fields from a single document and returns them without storing anything.

The endpoint:
1. Accepts a file upload (multipart/form-data)
2. Validates file format (PDF, PNG, JPG, JPEG)
3. Fetches the model definition from datacore to know which fields to extract
4. Runs the document through the existing extraction pipeline
5. Maps extracted values to model field names
6. Returns a JSON object: `{"fields": {"first_name": "Jane", "last_name": "Doe", ...}}`

### Decision 2: Partial extraction is success, not failure

If the extraction pipeline can only extract some fields, the endpoint returns HTTP 200 with whatever it found. Missing fields are simply absent from the response. The frontend handles empty fields as manual-entry prompts. Only return an error (422) for truly unsupported formats or extraction pipeline failures.

### Decision 3: CORS update

Add `localhost:5174` to the existing CORS allowed origins list (currently only allows `localhost:5173`).

## Risks / Trade-offs

- **Extraction quality** → Varies by document format and quality. Partial extraction is expected and handled gracefully.
- **Dependency on datacore** → The endpoint fetches the model definition from datacore to know what fields to look for. If datacore is down, extraction fails. This is acceptable for local development.
