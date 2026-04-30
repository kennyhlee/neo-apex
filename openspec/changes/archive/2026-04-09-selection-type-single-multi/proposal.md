## Why

Selection fields in entity models currently treat all selection types the same — the `multiple` flag is set during extraction/mapping but there's no explicit way in the model definition to declare whether a field should allow single or multiple selection. Fields like gender, status, and grade level on the Student entity are semantically single-choice but the system defaults them to multi-select behavior. This creates a confusing UX where users can select multiple genders or multiple statuses when only one value makes sense. The model definition needs to express selection cardinality explicitly, and the UI needs to render the appropriate control (radio buttons for single, checkboxes for multiple).

## What Changes

- Add `json_schema_extra={"multiple": True}` on domain model `List[str]` fields that need multi-select (e.g., `days_of_week`). Fields without this annotation default to single-select — no annotation needed for single-select fields.
- Update the backend field mapper (`papermite/backend/app/services/mapper.py`) to read `json_schema_extra` for the `multiple` flag, falling back to `False` when absent
- Student model fields (grade_level, gender, status) remain as-is (no annotation = single-select by default). Program model: `days_of_week` and `grade_levels` get `json_schema_extra={"multiple": True}`; `status` remains single-select
- Fix consolidator in mapper (`_consolidate_entities`) to preserve field cardinality instead of forcing `multiple=True` when merging options
- Update AdminDash `DynamicForm.tsx` to render radio buttons for single-select fields (instead of `<select>` dropdown) and checkboxes for multi-select fields
- Update Launchpad `FieldInput.tsx` to render radio buttons for single-select and checkboxes for multi-select
- Update Papermite `FieldRow.tsx` / `OptionsEditor` to allow toggling single vs multiple when editing model definitions
- Ensure stored data format is consistent: single-select stores a plain string, multi-select stores a JSON array

## Capabilities

### New Capabilities
- `selection-cardinality`: Define and enforce single vs multiple selection mode on selection-type fields, with corresponding UI controls (radio buttons vs checkboxes)

### Modified Capabilities

_(none — no existing specs are affected)_

## Impact

- **Model definition schema**: `FieldDefinition.multiple` becomes an explicit, user-facing property rather than an inference artifact
- **Backend**: `papermite/backend/app/services/mapper.py` — field mapping logic for selection fields
- **Backend**: `papermite/backend/app/models/domain.py` — Student model field annotations
- **Frontend (AdminDash)**: `admindash/frontend/src/components/DynamicForm.tsx` — form rendering
- **Frontend (Launchpad)**: `launchpad/frontend/src/components/FieldInput.tsx` — form rendering
- **Frontend (Papermite)**: `papermite/frontend/src/components/FieldRow.tsx` — model definition editor
- **Data format**: Single-select values stored as strings; multi-select as JSON arrays (already partially the case)
- **No breaking API changes** — the `multiple` field already exists in `FieldDefinition`; this change makes it explicit and respected consistently
