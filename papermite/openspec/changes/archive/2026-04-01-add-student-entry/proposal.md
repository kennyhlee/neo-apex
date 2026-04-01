## Why

Papermite needs a document extraction endpoint to support the add-student-entry feature. AdminDash will upload application documents to papermite for field extraction, then submit the extracted data to datacore for storage. This keeps extraction logic in papermite (where it belongs) separate from storage (datacore) and UI (admindash).

## What Changes

- Add `POST /api/extract/{tenant_id}/{entity_type}` endpoint to accept document uploads and return extracted field values mapped to the entity model
- Update CORS to also allow admindash origin (`localhost:5174`)
- Leverage existing extraction pipeline for document processing

## Capabilities

### New Capabilities
- `document-field-extraction`: HTTP endpoint accepting document uploads and returning extracted field values mapped to entity model field names

### Modified Capabilities

_(none)_

## Impact

- **API**: New extraction endpoint on existing FastAPI app
- **CORS**: Add `localhost:5174` to allowed origins
- **Part of**: Cross-project `add-student-entry` change (datacore → papermite → admindash)
