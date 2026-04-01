## Context

AdminDash has a StudentsPage with a non-functional "Add Student" button. This change adds the frontend flow for entering student data. It depends on two prerequisite changes in other repos:
- **datacore/add-student-entry**: REST API for model retrieval and entity storage (TOON-unified)
- **papermite/add-student-entry**: Document extraction endpoint

Responsibility boundaries:
- **Datacore** = storage only (model retrieval, entity CRUD)
- **Papermite** = document extraction (OCR/parsing, field extraction)
- **AdminDash** = UI (form rendering, user interaction)

Model definition structure (from papermite, stored in datacore):
```
{
  "base_fields": [
    {"name": "first_name", "type": "str", "required": true},
    {"name": "gender", "type": "selection", "required": true, "options": ["M", "F", "Other"], "multiple": false}
  ],
  "custom_fields": [
    {"name": "bus_route", "type": "str", "required": false}
  ]
}
```

Field types: `str`, `number`, `bool`, `date`, `datetime`, `email`, `phone`, `selection` (with `options` array and `multiple` flag).

## Goals / Non-Goals

**Goals:**
- Dynamic add-student form driven by model definition from datacore API
- Two entry modes: manual web form, or document upload with extraction via papermite API
- Form fields strictly match the entity model — no ad-hoc fields
- Student data submitted to datacore for storage

**Non-Goals:**
- Student list retrieval/filtering enhancements (next iteration)
- Batch student import (future)
- Ad-hoc field entry — new fields require a model update via papermite
- Backend changes (tracked in datacore and papermite changes)

## Decisions

### Decision 1: Full-page form with two entry modes

Clicking "Add Student" navigates to a new route (`/students/add`) rather than opening a modal. The form has two tabs/modes:

1. **Web Form**: Renders dynamic fields from model definition. User fills in manually.
2. **Upload Document**: User uploads a completed application form (PDF/image). Papermite extracts fields and pre-populates the web form. User reviews, corrects, and submits.

Both modes converge on the same form — upload just pre-fills it.

**Alternative considered:** Modal dialog. Rejected because the form could have many fields depending on the model definition — a full page provides better UX for data entry.

### Decision 2: Dynamic form generation — strict model alignment

The form renders ALL fields from both `base_fields` and `custom_fields` arrays in the model definition. No ad-hoc field entry is allowed — the model definition is the single source of truth, managed exclusively through papermite.

Field type → form control mapping:

| Model type | Form control |
|------------|-------------|
| `str` | Text input |
| `number` | Number input |
| `bool` | Checkbox |
| `date` | Date picker |
| `datetime` | Datetime picker |
| `email` | Email input (with email validation) |
| `phone` | Phone input (with phone formatting) |
| `selection` (`multiple: false`) | Single-select dropdown |
| `selection` (`multiple: true`) | Multi-select dropdown / checkboxes |

On submission, fields from `base_fields` are sent as `base_data` and fields from `custom_fields` are sent as `custom_fields` — the split mirrors the model definition exactly.

### Decision 3: Two API targets from the frontend

The frontend calls two separate backends:
- **Datacore API** (e.g., `:8081`): model retrieval, entity creation
- **Papermite API** (e.g., `:8000`): document extraction

Each gets its own base URL config in the API client. The existing `:8080` API is unchanged.

**Alternative considered:** Proxying everything through `:8080`. Rejected — each service owns its own API, and an API gateway can unify them later if needed.

### Decision 4: DynamicForm as a reusable component

`DynamicForm` takes a model definition and renders the form. It is entity-type agnostic — while this change uses it for students, it can render forms for any entity type whose model is in datacore. This avoids building a student-specific form that would need duplication for staff, guardians, etc.

### Decision 5: Document upload flow

1. User switches to "Upload Document" tab
2. Drags/selects a file (PDF, PNG, JPG, JPEG)
3. File is sent to papermite's extraction API
4. Extracted values pre-populate the web form
5. Tab automatically switches to "Web Form" for review
6. User corrects any fields and submits

Extraction is best-effort — partial results are expected. The form shows whatever was extracted and leaves the rest empty for manual entry.

## Risks / Trade-offs

- **Model definition not found** → The form can't render without a model definition. The UI shows a clear error ("No student model configured — set up via papermite first") rather than an empty form.
- **Document extraction quality** → Extracted fields may be inaccurate. The review-before-submit flow mitigates this — users always see and can correct the data.
- **Three API targets** → Admindash frontend now talks to :8080 (existing), datacore (storage), and papermite (extraction). CORS configuration needed on both backends — handled by their respective changes.
- **Model definition changes after student entry** → Students stored with an older model version still have their data intact. No frontend concern — datacore handles this.
