# Edit Student Modal — Design Spec

**Date:** 2026-04-07

## Context

AdminDash has an Add Student page but no way to edit existing students. The StudentsPage ⋮ menu has an "Edit Selected" placeholder. This adds a modal-based edit flow for single student selection.

## Scope

- Single student edit via modal dialog from StudentsPage
- Multiple selection: "Coming soon" dialog
- No duplicate check (identity fields are read-only, already checked at creation)
- No new routes — modal opens in-place on StudentsPage

## Edit Student Modal

**Trigger**: ⋮ menu → "Edit Selected" with exactly 1 row selected.

**Modal**:
- Full-screen overlay with centered dialog (same pattern as archive confirmation, but larger)
- Title: "Edit Student" with student name subtitle
- Body: `DynamicForm` component with:
  - `initialValues`: populated from the selected student row (already in StudentsPage `data` state, looked up by `entity_id` from `selectedIds`)
  - `readOnlyFields`: `['student_id', 'first_name', 'last_name', 'middle_name', 'family_id']` — greyed out, not editable
  - Required field validation: DynamicForm already validates required fields. If any required field is empty, Save is disabled and the field shows an error indicator.
- Footer: Cancel (closes modal) + Save (calls update API)

**Save flow**:
1. DynamicForm validates required fields — blocks submit if any empty
2. Calls `updateStudent(tenant, entityId, baseData, customFields)`
3. On success: close modal, refresh student list, clear selection
4. On error: show error message in modal

**Batch edit (multiple selection)**:
- "Edit Selected" shows a simple "Coming soon" dialog instead of the edit modal

## Backend: Update Entity Endpoint

**New endpoint**: `PUT /api/entities/{tenant_id}/{entity_type}/{entity_id}`

Request:
```json
{
  "base_data": {"dob": "2019-05-01", "grade_level": "Kinder"},
  "custom_fields": {"transportation": "bus"}
}
```

Response (200):
```json
{
  "entity_type": "student",
  "entity_id": "abc123",
  "base_data": {...},
  "custom_fields": {...},
  "_version": 3,
  "_status": "active"
}
```

Uses existing `store.put_entity()` which archives the old version and creates a new one with incremented `_version`. Returns 404 if entity doesn't exist, 400 if tenant not set up.

Uses the same `CreateEntityRequest` model (base_data + optional custom_fields).

## Files Changed

| File | Action | Responsibility |
|---|---|---|
| `datacore/src/datacore/api/routes.py` | Modify | Add `PUT /api/entities/{tenant_id}/{entity_type}/{entity_id}` |
| `datacore/tests/test_update_entity_api.py` | Create | Tests for update endpoint |
| `admindash/frontend/src/api/client.ts` | Modify | Add `updateStudent()` function |
| `admindash/frontend/src/pages/StudentsPage.tsx` | Modify | Add edit modal, "coming soon" dialog for batch, wire menu items |
| `admindash/frontend/src/pages/StudentsPage.css` | Modify | Edit modal styles |

## Out of Scope

- Batch edit (multiple students at once) — shows "Coming soon"
- Duplicate detection on edit — identity fields are read-only
- Edit student as separate page/route — modal keeps user in context
- Document upload during edit
