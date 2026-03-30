# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build & Run

```bash
# Backend (from backend/)
source /Users/kennylee/Development/NeoApex/papermite/.venv/bin/activate
uvicorn app.main:app --reload --port 8000

# Frontend (from frontend/)
npm run dev          # Dev server on :5173
npm run build        # Production build
npm run lint         # ESLint
```

Install: `pip install -e ".[dev]"` (backend, from project root), `npm install` (frontend).

## Architecture

Papermite is the **data ingestion gateway** for NeoApex. Tenant admins upload policy/application documents, AI extracts structured entities, users review/edit, then finalize a **model definition** (schema only, not data instances) stored in LanceDB.

### Backend (FastAPI)

**Processing pipeline**: Upload → Parse (Docling) → Extract (pydantic-ai Agent) → Map (base vs custom field classification + type inference) → Review → Preview → Confirm (LanceDB)

**API routes** registered in `app/main.py`, all under `/api`:
- `auth.py` — `GET /me`, `require_tenant_admin()` guard
- `upload.py` — `POST /tenants/{tenant_id}/upload` (file → parse → extract → map)
- `extraction.py` — `GET /schema`, `GET /config/models`, `GET /tenants/{tenant_id}/model`
- `finalize.py` — `POST /tenants/{tenant_id}/finalize/preview` (dry run) and `/commit` (two-step: preview then confirm)

**Key design decisions**:
- `models/domain.py`: Entity classes (Student, Family, Contact, Program, etc.) with `ENTITY_CLASSES` dict for schema introspection. All extend `BaseEntity` with `custom_fields: Dict[str, Any]`. Family is a household/billing unit. Contact replaces Guardian/EmergencyContact/MedicalContact with a `role` field (guardian | emergency_contact | medical_contact) and flat `student_id` for per-student associations.
- `models/extraction.py`: `RawExtraction` uses dicts (not strict Pydantic) so AI-extracted extra fields aren't dropped. `FieldMapping` tracks provenance (field_name, value, source, required, field_type, options, multiple).
- `services/mapper.py`: Fields in `model_class.model_fields` → `base_model` (required=True default); everything else → `custom_field` (required=False default). `_infer_field_type()` does best-effort type detection from field name patterns (e.g. `dob` → `date`, `email` → `email`). `_extract_options()` pulls selection options from list/dict/CSV values. `_consolidate_entities()` merges multiple entities of the same type into one (union of fields, merged options).
- `storage/lance_store.py`: Single `tenant_models` table, versioned per tenant (max 50 versions, oldest trimmed). Each record has `version` (int), `status` (active/archived), `created_by` (user name), `created_at` (timestamp). Model definition = `{entity_type: {base_fields: [...], custom_fields: [...]}}` where each field has `name`, `type`, `required`, and optionally `options`/`multiple` for selection type. Change detection via normalized comparison skips writes when unchanged. `preview_finalize()` returns diff without storing; `commit_finalize()` stores and archives previous.

**Config** (`app/config.py`): Env prefix `PAPERMITE_`. Test user loaded from `test_user.json` at project root. LLM models configurable (Claude Haiku/Sonnet, GPT-4.1/5, Ollama).

### Field Type System

8 supported types: `str`, `number`, `bool`, `date`, `datetime`, `email`, `phone`, `selection`.

- Types are inferred from field names on upload (e.g. `*_email` → email, `dob` → date, `is_*` → bool, `*_fee` → number)
- `selection` type supports `options` (list of allowed values) and `multiple` (allow multi-select)
- Options are extracted from AI output: lists become options with `multiple=true`, dicts use keys as options, comma-separated strings are split
- Users can change types and edit selection options on the Review page

### Frontend (React + TypeScript + Vite)

**4-page flow**: Landing → Upload → Review → Finalize (preview + confirm/cancel)

- `api/client.ts`: All API calls. `previewFinalize()` for dry run, `commitFinalize()` for actual store. `modelToExtraction()` converts stored model back to ExtractionResult for editing.
- `db/indexedDb.ts`: Draft persistence in IndexedDB (keyed by extraction_id). Cleared after finalization.
- `types/models.ts`: TypeScript interfaces mirroring backend Pydantic models. `FIELD_TYPES` constant defines allowed types.
- Components: `EntityCard` → `FieldRow` (inline edit, type dropdown, required toggle, base/custom badge, selection options editor) → `AddFieldForm`.

**Page behaviors**:
- **Landing**: Shows active model card (version badge, timestamp, updated-by name, entity types, field counts) with Edit Model / Upload New Document actions. No model → upload prompt.
- **Upload**: File upload with LLM model selector. Cancel button navigates back. Confirmation dialog when replacing existing model.
- **Review**: Two modes — upload flow (full editing + Show Source) and edit flow (no source button, Finalize disabled until changes detected). Change detection compares field names, sources, required flags, types, and selection options against original.
- **Finalize**: Preview-first flow — calls `/preview` on load (no DB write). Shows entity summary tables with type-aware sample data. User must click "Confirm & Save" to commit or "Cancel" to discard. React Strict Mode double-fire guarded with useRef.

**State**: Page-level React state only, no global store. IndexedDB for cross-page draft persistence.

## Tenant Scoping

All data is tenant-isolated. Tenant derived from authenticated user profile (test config for dev). API routes enforce `tenant_id` match via `require_tenant_admin()`. LanceDB records, file uploads, and IndexedDB drafts all scoped by tenant.

## Cross-Project Context

Papermite **writes** model definitions to LanceDB. Read access is via **apexapi** (separate NeoApex sub-project). Downstream apps (admindash, familyhub, enrollx, datacore, apexflow) read model definitions to dynamically construct entity views. Papermite's scope is ingestion only.
