## 1. Backend: Domain Model & Mapper

- [ ] 1.1 Add `json_schema_extra={"multiple": True}` to multi-select `List[str]` fields in `papermite/backend/app/models/domain.py`: Program `days_of_week` and `grade_levels`. Single-select fields (Student `grade_level`, `gender`, `status`; Program `status`) need no annotation — single is the default.
- [ ] 1.2 Update mapper in `papermite/backend/app/services/mapper.py` to read `model_field.json_schema_extra.get("multiple", False)` when setting the `multiple` flag on selection FieldMappings, instead of hardcoding `multiple=False`
- [ ] 1.3 Fix `_consolidate_entities()` in `papermite/backend/app/services/mapper.py` (line 260) to preserve the original `multiple` value when merging selection options, instead of forcing `multiple=True`
- [ ] 1.4 Verify mapper output: confirm Student base fields produce `multiple: false`, Program `days_of_week` and `grade_levels` produce `multiple: true`, and consolidation preserves cardinality

## 2. Frontend: AdminDash DynamicForm

- [ ] 2.1 Update `admindash/frontend/src/components/DynamicForm.tsx` single-select rendering: replace `<select>` dropdown with radio button group for selection fields where `multiple` is false or absent
- [ ] 2.2 Ensure multi-select rendering remains as checkboxes (already implemented, verify no regression)
- [ ] 2.3 Add legacy data handling: if a single-select field has an array value, use the first element; if a multi-select field has a string value, treat as single-element array
- [ ] 2.4 Ensure single-select onChange stores a plain string, multi-select onChange stores an array

## 3. Frontend: Launchpad FieldInput

- [ ] 3.1 Update `launchpad/frontend/src/components/FieldInput.tsx` to render radio buttons for single-select fields instead of `<select>` dropdown
- [ ] 3.2 Update multi-select rendering to use checkboxes instead of `<select multiple>`
- [ ] 3.3 Add same legacy data handling as AdminDash (array→first element for single, string→array for multi)

## 4. Frontend: Papermite Model Editor

- [ ] 4.1 Update `papermite/frontend/src/components/FieldRow.tsx` OptionsEditor to add an "Allow multiple selections" checkbox toggle, visible only when field type is `selection`
- [ ] 4.2 Wire the toggle to set/unset the `multiple` property on the field definition and persist it through the save flow

## 5. Styling & Polish

- [ ] 5.1 Add CSS styles for radio button groups in AdminDash DynamicForm (consistent spacing, alignment with existing checkbox styles)
- [ ] 5.2 Add CSS styles for radio button groups in Launchpad FieldInput
- [ ] 5.3 Verify visual consistency across all three frontends for both single-select (radio) and multi-select (checkbox) rendering
