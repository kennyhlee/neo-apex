# field-default-values Specification

## Purpose

Per-field default values flow from Papermite's form builder (Review page) through the stored model definition into AdminDash's Add Entity form. Tenant admins set a default on any field; the value is persisted under each field's `default` key in the model definition; AdminDash prefills the value when the entity form has no per-record override. Defaults remain user-editable at the form level.

## Requirements

### Requirement: Papermite Review page SHALL render a Default cell per field row

The Review page table (`EntityCard` → `FieldRow`) SHALL render a new column labeled **Default**, positioned between the existing **Value** column and the **Data Type** column. The column header SHALL appear in the `<thead>` row for every entity table. Every field row (both `source: "base_model"` and `source: "custom_field"`) SHALL render a corresponding `<td>` for this column.

For non-`selection` field types (`str`, `number`, `bool`, `date`, `datetime`, `email`, `phone`), the cell SHALL use the same inline-edit pattern as the existing Value cell: a clickable display element that swaps for an auto-focused `<input>` on click, with Enter or blur committing and Escape canceling. For `bool` field type, the cell SHALL render a checkbox bound to the default value (no inline-edit toggle needed).

For `selection` field type with `multiple: false`, the cell SHALL render a single `<select>` with a `— none —` option followed by the configured options. For `selection` with `multiple: true`, the cell SHALL render a checkbox group bound to the array default, mirroring the existing multi-select pattern in the Value cell.

#### Scenario: Default column appears in the table header

- **GIVEN** the user opens the Review page for an extraction with at least one entity
- **WHEN** the entity table renders
- **THEN** the `<thead>` SHALL contain a `<th>` with the text `Default` positioned between the Value header and the Data Type header

#### Scenario: Clicking an empty Default cell enters edit mode

- **GIVEN** a string field with no default set (`default` is undefined)
- **WHEN** the user clicks the Default cell
- **THEN** the cell SHALL switch to an `<input>` element
- **AND** the input SHALL be auto-focused
- **AND** the input value SHALL be empty

#### Scenario: Pressing Enter in the Default input commits the value

- **GIVEN** the Default cell for a string field is in edit mode with the user-typed value `"9"`
- **WHEN** the user presses Enter
- **THEN** the cell SHALL exit edit mode and display `"9"`
- **AND** the corresponding `FieldMapping` in the in-memory `ExtractionResult` SHALL have `default: "9"`

#### Scenario: Pressing Escape cancels the Default edit

- **GIVEN** the Default cell for a string field is in edit mode with a typed but uncommitted value
- **WHEN** the user presses Escape
- **THEN** the cell SHALL exit edit mode and revert to the prior display
- **AND** the in-memory `FieldMapping.default` SHALL NOT be modified

#### Scenario: Clearing the Default cell removes the default

- **GIVEN** a field whose `FieldMapping.default` is `"9"`
- **WHEN** the user opens the Default cell, clears the input, and commits
- **THEN** the cell SHALL display as empty
- **AND** the in-memory `FieldMapping.default` SHALL be undefined (not the empty string)

#### Scenario: Default for a selection field uses the configured options

- **GIVEN** a `selection` field with `multiple: false` and `options: ["9", "10", "11", "12"]`
- **WHEN** the Default cell renders
- **THEN** the cell SHALL render a `<select>` whose options are exactly `— none —`, `"9"`, `"10"`, `"11"`, `"12"`
- **AND** selecting `"10"` SHALL set `FieldMapping.default` to `"10"`

#### Scenario: Default for a multi-select uses checkboxes

- **GIVEN** a `selection` field with `multiple: true` and `options: ["math", "science", "history"]`
- **WHEN** the Default cell renders
- **THEN** the cell SHALL render three checkboxes, one per option
- **AND** checking `"math"` and `"science"` SHALL set `FieldMapping.default` to `["math", "science"]`

#### Scenario: Default for a bool field is a checkbox

- **GIVEN** a `bool` field with no default set
- **WHEN** the Default cell renders
- **THEN** the cell SHALL render a `<input type="checkbox">` that is unchecked
- **AND** checking the box SHALL set `FieldMapping.default` to `true`

### Requirement: AddFieldForm SHALL accept an optional default value

When the tenant admin adds a new custom field via the `AddFieldForm` component, the form SHALL include an optional **Default** input below the existing Name and Type inputs. The input MAY be left empty. If provided, the value SHALL be passed through into the newly-created `FieldMapping` as the `default` property.

For `selection` field types, the Default input SHALL be hidden in `AddFieldForm` (selection defaults are set after creation once options exist, in the row-level Default cell). For `bool`, the Default input SHALL render as a checkbox.

#### Scenario: Adding a string field with a default

- **GIVEN** the user opens AddFieldForm and selects type `str`
- **WHEN** the user enters name `"school_year"`, default `"2026-2027"`, and clicks Add
- **THEN** the newly added `FieldMapping` SHALL have `field_name: "school_year"`, `source: "custom_field"`, `field_type: "str"`, and `default: "2026-2027"`

#### Scenario: Adding a field with no default

- **GIVEN** the user opens AddFieldForm
- **WHEN** the user enters a name and type but leaves Default empty, then clicks Add
- **THEN** the newly added `FieldMapping.default` SHALL be undefined (not the empty string)

#### Scenario: Selection fields do not show a Default input in AddFieldForm

- **GIVEN** the user opens AddFieldForm and selects type `selection`
- **WHEN** the form re-renders
- **THEN** no Default input SHALL be visible
- **AND** the user MAY set the default later in the row-level Default cell once options are configured

### Requirement: FieldMapping and FieldDefinition SHALL carry an optional `default`

The Pydantic `FieldMapping` model in `papermite/backend/app/models/extraction.py` SHALL include a field `default: Optional[Any] = None`. The TypeScript `FieldMapping` interface in `papermite/frontend/src/types/models.ts` SHALL include a field `default?: unknown`. The TypeScript `FieldDefinition` (Papermite) and `ModelFieldDefinition` (AdminDash) interfaces SHALL each include `default?: unknown`.

#### Scenario: Pydantic accepts a FieldMapping without default

- **WHEN** a `FieldMapping` is constructed with `field_name="age"`, `value=10`, `source="base_model"`, `required=True`, `field_type="number"`
- **THEN** the resulting `FieldMapping.default` SHALL equal `None`

#### Scenario: Pydantic accepts a FieldMapping with a default

- **WHEN** a `FieldMapping` is constructed with the same arguments plus `default=9`
- **THEN** the resulting `FieldMapping.default` SHALL equal `9`

### Requirement: `_build_model_definition` SHALL include `default` when present and omit it when absent

In `papermite/backend/app/api/finalize.py`, the `_build_model_definition` function SHALL include `"default": mapping.default` in each field's dict if and only if `mapping.default` is not `None`. When `mapping.default` is `None`, the resulting field dict SHALL NOT contain a `default` key. It MUST NOT emit `"default": null`.

This applies to both `base_fields[]` and `custom_fields[]` entries in the model definition.

#### Scenario: Field with default is persisted with the default key

- **GIVEN** an `EntityResult` with one custom field mapping having `field_name="school_year"`, `field_type="str"`, `required=False`, `default="2026-2027"`
- **WHEN** `_build_model_definition([entity])` is called
- **THEN** the returned model definition SHALL contain, under that entity type's `custom_fields[0]`, an object equal to `{"name": "school_year", "type": "str", "required": False, "default": "2026-2027"}`

#### Scenario: Field without default is persisted without the default key

- **GIVEN** an `EntityResult` with one custom field mapping where `default` is `None`
- **WHEN** `_build_model_definition([entity])` is called
- **THEN** the returned field dict SHALL NOT contain the key `"default"`

#### Scenario: Selection field default is preserved verbatim

- **GIVEN** an `EntityResult` with a base field mapping having `field_type="selection"`, `options=["math","science"]`, `multiple=True`, `default=["math"]`
- **WHEN** `_build_model_definition([entity])` is called
- **THEN** the returned field dict SHALL equal `{"name": <name>, "type": "selection", "required": <required>, "options": ["math","science"], "multiple": True, "default": ["math"]}`

#### Scenario: Default flows through finalize/commit to DataCore PUT payload

- **GIVEN** a finalize request whose extraction has at least one field mapping with `default="9"`
- **WHEN** `POST /tenants/{tenant_id}/finalize/commit` is processed
- **THEN** the JSON body sent in the `httpx.put` call to DataCore's `/models/{tenant_id}` endpoint SHALL contain that field's dict with `"default": "9"` under `model_definition[<entity_type>][<bucket>]`

### Requirement: `modelToExtraction` SHALL restore `default` when reopening a saved model

The `modelToExtraction` helper in `papermite/frontend/src/api/client.ts` SHALL copy each field's `default` (when present in the stored model) into the corresponding `FieldMapping.default` of the produced `ExtractionResult`. If `default` is absent in the stored model, `FieldMapping.default` SHALL be `undefined`.

#### Scenario: Existing default round-trips into the Review page

- **GIVEN** a stored model definition for entity `student` whose `custom_fields` contains `{"name": "school_year", "type": "str", "required": false, "default": "2026-2027"}`
- **WHEN** the user opens the model via LandingPage → Edit
- **THEN** the Review page SHALL show the corresponding row's Default cell displaying `"2026-2027"`
- **AND** the in-memory `FieldMapping.default` for that row SHALL equal `"2026-2027"`

#### Scenario: Field without stored default produces undefined

- **GIVEN** a stored model definition where a field has no `default` key
- **WHEN** the model is opened via `modelToExtraction`
- **THEN** the corresponding `FieldMapping.default` SHALL be `undefined`
- **AND** the Default cell SHALL render blank

### Requirement: AdminDash DynamicForm SHALL prefill from `field.default` when no override exists

In `admindash/frontend/src/components/DynamicForm.tsx`, the `buildValues` function SHALL compute the initial value for each field using the precedence:

1. `overrides?.[field.name]` (the existing `initialValues` argument) when present;
2. otherwise `field.default` when it is not `undefined`;
3. otherwise the existing fallback (`false` for `bool`, `''` otherwise).

The behavior of `initialValues` overriding the default SHALL apply both to the initial render and to the `useEffect` that re-populates values when `initialValues` changes (e.g., after document extraction).

#### Scenario: Add form prefills from default when no initialValues passed

- **GIVEN** a model whose `custom_fields` contains `{"name": "school_year", "type": "str", "required": false, "default": "2026-2027"}`
- **AND** `DynamicForm` is rendered with no `initialValues` for `school_year`
- **WHEN** the form mounts
- **THEN** the `school_year` input SHALL display the value `"2026-2027"`

#### Scenario: User can edit the prefilled default

- **GIVEN** the form prefilled `school_year` to `"2026-2027"` from its default
- **WHEN** the user changes the input to `"2027-2028"` and submits
- **THEN** the `onSubmit` callback SHALL receive `customFields.school_year === "2027-2028"`

#### Scenario: initialValues override the default

- **GIVEN** a field with `default: "9"` and `DynamicForm` is rendered with `initialValues: { grade_level: "11" }`
- **WHEN** the form mounts
- **THEN** the `grade_level` input SHALL display `"11"` (not `"9"`)

#### Scenario: Field with no default and no initialValues falls back to empty

- **GIVEN** a `str` field with `default: undefined` and no `initialValues` entry
- **WHEN** the form mounts
- **THEN** the input SHALL display the empty string

#### Scenario: Bool field default of true prefills the checkbox

- **GIVEN** a `bool` field with `default: true` and no `initialValues` entry
- **WHEN** the form mounts
- **THEN** the checkbox SHALL be checked

#### Scenario: Selection (single) default prefills the radio group

- **GIVEN** a `selection` field with `multiple: false`, `options: ["9","10","11"]`, `default: "10"`
- **WHEN** the form mounts
- **THEN** the radio for `"10"` SHALL be selected and the others SHALL NOT be

#### Scenario: Selection (multi) default prefills the checkboxes

- **GIVEN** a `selection` field with `multiple: true`, `options: ["math","science","history"]`, `default: ["math","science"]`
- **WHEN** the form mounts
- **THEN** the checkboxes for `"math"` and `"science"` SHALL be checked and `"history"` SHALL NOT be

#### Scenario: Edit mode (initialValues is the existing entity) still wins

- **GIVEN** a field with `default: "9"` and the user opens the Edit dialog for an entity whose stored value is `"12"`
- **WHEN** `DynamicForm` is rendered with `initialValues: { grade_level: "12" }`
- **THEN** the input SHALL display `"12"`

### Requirement: Changing a field's type SHALL clear its default

When the tenant admin changes the data type of a field via the type `<select>` in `FieldRow`, `handleTypeChange` in `EntityCard.tsx` SHALL set `default` to `undefined` on the affected mapping in the same immutable update that changes `field_type`. This mirrors the existing rule that clears `options` and `multiple` when switching away from `selection`, and applies to every type transition (including selection-to-selection-with-different-multiple, which is covered by the separate `multiple`-toggle requirement below).

#### Scenario: Switching str to number clears the default

- **GIVEN** a custom field with `field_type: "str"` and `default: "abc"`
- **WHEN** the user changes the type to `number` via the type `<select>`
- **THEN** the resulting mapping SHALL have `field_type: "number"` and `default: undefined`

#### Scenario: Switching selection to str clears the default

- **GIVEN** a custom field with `field_type: "selection"`, `multiple: false`, `options: ["a","b"]`, `default: "a"`
- **WHEN** the user changes the type to `str`
- **THEN** the resulting mapping SHALL have `field_type: "str"`, `options: undefined`, `multiple: undefined`, and `default: undefined`

#### Scenario: Switching str to selection clears the default

- **GIVEN** a custom field with `field_type: "str"` and `default: "abc"`
- **WHEN** the user changes the type to `selection`
- **THEN** the resulting mapping SHALL have `field_type: "selection"`, `options: []`, `multiple: false`, and `default: undefined`

### Requirement: Toggling `multiple` on a selection field SHALL clear its default

When the tenant admin toggles the `multiple` checkbox in `OptionsEditor` (the "Allow multiple" control), `handleOptionsChange` in `EntityCard.tsx` SHALL set `default` to `undefined` on the affected mapping in the same immutable update that flips `multiple`. Changes to `options` alone (adding or removing an option without toggling `multiple`) SHALL NOT clear the default.

#### Scenario: Toggling single to multi clears the default

- **GIVEN** a selection field with `multiple: false`, `options: ["math","science"]`, `default: "math"`
- **WHEN** the user checks the "Allow multiple" checkbox
- **THEN** the resulting mapping SHALL have `multiple: true` and `default: undefined`

#### Scenario: Toggling multi to single clears the default

- **GIVEN** a selection field with `multiple: true`, `options: ["math","science"]`, `default: ["math"]`
- **WHEN** the user unchecks the "Allow multiple" checkbox
- **THEN** the resulting mapping SHALL have `multiple: false` and `default: undefined`

#### Scenario: Adding an option does not clear the default

- **GIVEN** a selection field with `multiple: false`, `options: ["math","science"]`, `default: "math"`
- **WHEN** the user adds the option `"history"` via `OptionsEditor`
- **THEN** the resulting mapping SHALL have `options: ["math","science","history"]`, `multiple: false`, and `default: "math"` (unchanged)

### Requirement: AdminDash `DynamicForm` SHALL coerce prefilled number defaults to Number

In `admindash/frontend/src/components/DynamicForm.tsx`, when `buildValues` resolves the prefill for a field with `field.type === 'number'`, and the resolved value is not `''`, `null`, or `undefined`, the function SHALL pass that value through `Number(...)` before assigning it into the values map. If the conversion yields `NaN`, the field's value SHALL fall back to `''` (the existing empty-string fallback for non-bool types).

This rule applies whether the prefill source is `overrides[field.name]` or `field.default`. It does NOT apply to fields of other types.

#### Scenario: Number default of "9" prefills as the number 9

- **GIVEN** a field with `type: "number"` and `default: "9"`, with no `initialValues` for the field
- **WHEN** the form mounts
- **THEN** the values map for that field SHALL equal `9` (the number), not `"9"` (the string)
- **AND** if the user submits without editing the field, the submitted `customFields` SHALL contain `9` (number)

#### Scenario: Number default of 9 (already a number) prefills unchanged

- **GIVEN** a field with `type: "number"` and `default: 9`
- **WHEN** the form mounts
- **THEN** the values map for that field SHALL equal `9`

#### Scenario: Invalid number default falls back to empty

- **GIVEN** a field with `type: "number"` and `default: "abc"`
- **WHEN** the form mounts
- **THEN** the values map for that field SHALL equal `''` (the empty-string fallback for non-bool)
- **AND** the field SHALL render as an empty `<input type="number">`
