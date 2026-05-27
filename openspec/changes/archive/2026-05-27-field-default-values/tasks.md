## 1. Papermite backend — model and finalize

- [ ] 1.1 Add `default: Optional[Any] = None` to `FieldMapping` in `papermite/backend/app/models/extraction.py`.
- [ ] 1.2 Update `_build_model_definition` in `papermite/backend/app/api/finalize.py` so each field dict includes `"default": mapping.default` only when `mapping.default is not None`. MUST NOT emit `"default": null`. Apply to both `base_fields` and `custom_fields` branches.
- [ ] 1.3 Add tests in `papermite/backend/tests/test_finalize_helpers.py` covering: (a) field with `default` → key present in output, (b) field with `default=None` → key absent (not `"default": null`), (c) selection field with multi default `["math"]` → preserved verbatim, (d) bool default `False` → key present with value `False` (not omitted).
- [ ] 1.4 Add a test in `papermite/backend/tests/test_finalize_api.py` (or extend an existing finalize-commit integration test) asserting the PUT payload to DataCore's `/models/{tenant_id}` carries `default` for fields that set it.
- [ ] 1.5 Add a test asserting that a model whose fields previously had no `default` keys, re-finalized with no defaults added, produces a PUT payload byte-identical (after DataCore normalize) to the prior version — i.e., no spurious version bump.

## 2. Papermite frontend — types, FieldRow, EntityCard, AddFieldForm

- [ ] 2.1 In `papermite/frontend/src/types/models.ts`, add `default?: unknown` to both `FieldMapping` and `FieldDefinition`.
- [ ] 2.2 In `papermite/frontend/src/components/FieldRow.tsx`: add new props `defaultVal: unknown` and `onDefaultChange: (fieldName: string, value: unknown) => void`. (Use `defaultVal`, not `default` — JS reserved word — nor `defaultValue` — DOM-reserved prop name on form elements.) Render a new `<td className="field-row__default">` positioned between the existing `<td className="field-row__value">` and the data-type `<td>`. Reuse the inline-edit state pattern (`editingDefault`, `editDefault`, `handleDefaultSave`, key handlers) — mirror the value cell. For `selection` (single), render a `<select>` with `— none —`; for `selection` (multi), render the checkbox group. For `bool`, render a bound `<input type="checkbox">`. For all other types (`str`/`number`/`date`/`datetime`/`email`/`phone`), use the click-to-edit `<input>` (plain text — same pattern as the existing Value cell).
- [ ] 2.3 Treat an empty trimmed string committed in the Default cell as "clear default": call `onDefaultChange(fieldName, undefined)`. For multi-select with an empty array, also call with `undefined`. For single-select where the user picks the `— none —` option, call with `undefined`.
- [ ] 2.4 In `papermite/frontend/src/components/EntityCard.tsx`:
  - Add `<th>Default</th>` to the table header between `<th>Value</th>` and `<th>Data Type</th>`.
  - Add `handleDefaultChange(fieldName, value)` mirroring `handleFieldUpdate`'s shape, updating `field_mappings[i].default`.
  - **Modify `handleTypeChange`**: in the immutable update, also set `default: undefined` on the affected mapping (alongside the existing `options`/`multiple` resets). The cleared default must be `undefined` (not absent), so the spread preserves the change.
  - **Modify `handleOptionsChange`**: when the new `multiple` differs from the prior `multiple` value on the mapping, also set `default: undefined`. When only `options` changes (multiple unchanged), preserve the existing default. (Read the prior mapping in the `.map` callback to detect the toggle.)
  - Pass `defaultVal={mapping.default}` and `onDefaultChange={handleDefaultChange}` through to each `FieldRow`.
- [ ] 2.5 In `papermite/frontend/src/components/AddFieldForm.tsx`: add an optional Default input below the existing inputs. Hide it when the selected type is `selection`. Render a checkbox for `bool`. Render a plain text `<input>` for all other types. On submit, attach `default: <value>` (or omit if empty) to the new `FieldMapping`. Extend the `onAdd` callback signature (or add a sibling param) to carry the optional default — also update `EntityCard.handleAddField` to pass it into the new mapping.
- [ ] 2.6 In `papermite/frontend/src/api/client.ts`, update `modelToExtraction()` to copy `default` from each stored field into the produced `FieldMapping` (only set the property if defined in the source, mirroring the conditional spread pattern used for `options`/`multiple`).
- [ ] 2.7 Extend `FieldRow.test.tsx` covering: (a) clicking an empty Default cell enters edit, (b) Enter commits, (c) Escape cancels, (d) clearing the input commits `undefined`, (e) bool checkbox toggle sets `true`/`false`, (f) selection-single picking `— none —` commits `undefined`, (g) selection-multi checkboxes set arrays, (h) selection-multi empty array commits `undefined`.
- [ ] 2.8 Add a test (in `FieldRow.test.tsx` or a new `EntityCard.test.tsx`) covering `handleTypeChange` clears `default`, and `handleOptionsChange` clears `default` on `multiple` toggle but NOT on options-only change.

## 3. AdminDash frontend — types and DynamicForm prefill

- [ ] 3.1 In `admindash/frontend/src/types/models.ts`, add `default?: unknown` to `ModelFieldDefinition`.
- [ ] 3.2 In `admindash/frontend/src/components/DynamicForm.tsx`:
  - Change `buildValues` so each field's initial value is computed as `overrides?.[field.name] ?? field.default ?? (field.type === 'bool' ? false : '')`.
  - For `field.type === 'number'`: after resolving the prefill, if the value is not `''`, `null`, or `undefined`, coerce via `Number(...)`. If the result is `NaN`, fall back to `''`.
  - Apply the same precedence inside the `useEffect` that re-populates from `initialValues` (the existing `if (val != null && val !== '')` guard preserves user-typed values — verify the default-prefilled value is not stomped by a later empty `initialValues` push).
- [ ] 3.3 Verify by manual browser test that `AddStudentModal`, `ProgramPage` (Add), and any other `DynamicForm` Add caller correctly prefill from `field.default`, and that Edit callers (which pass the entity as `initialValues`) still show the saved value. (Note: AdminDash frontend has no test framework — manual verification only, per `admindash/CLAUDE.md`.)

## 4. End-to-end verification

- [ ] 4.1 In Papermite, upload a document, set a Default value for a base field (e.g., `grade_level = "9"`) and a custom field, finalize. Verify via DataCore's `/api/query` or `/models/{tenant_id}` that the stored model definition contains the `default` keys.
- [ ] 4.2 Reopen the same model in Papermite (Landing → Edit). Verify the Default cells render the previously-set values. Change a field's type and confirm the Default cell clears.
- [ ] 4.3 In AdminDash, open Add Student. Verify the form prefills the fields with `default` set in Papermite, and that the user can edit them before saving. Submit without editing a prefilled `number` field and confirm the persisted value is numeric (not a string) via DataCore `/api/query`.
- [ ] 4.4 In AdminDash, open Edit on an existing student whose `grade_level` differs from the default. Verify the form shows the saved value (default does not override).
- [ ] 4.5 In Papermite, re-finalize a model that already exists in DataCore without changing any defaults. Verify the response status is `"unchanged"` (no version bump) — confirms byte-equality with pre-feature models.
- [ ] 4.6 Run `cd papermite/backend && uv run pytest -v` and `cd papermite/frontend && npm run lint && npm run build` and `cd admindash/frontend && npm run lint && npm run build` — all SHALL pass.
