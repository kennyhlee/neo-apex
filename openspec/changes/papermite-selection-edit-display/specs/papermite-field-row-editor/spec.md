## ADDED Requirements

### Requirement: FieldRow display value safely serializes objects and arrays
The Papermite Review-page `FieldRow` component SHALL display a field's `value` without producing the string `"[object Object]"`. For `null`, `undefined`, or empty-string values, the row SHALL render an em-dash placeholder. For values whose `typeof` is `"object"` (including arrays and plain objects), the row SHALL render `JSON.stringify(value)`. For all other values, the row SHALL render `String(value)`. The same serialization helper SHALL be used for both display text and any text-input edit-mode initialization, so the two paths cannot drift.

#### Scenario: Object value renders as JSON
- **WHEN** a FieldRow receives a value of `{ a: 1 }`
- **THEN** the display SHALL show `{"a":1}` and SHALL NOT show `"[object Object]"`

#### Scenario: Array-of-objects value renders as JSON
- **WHEN** a FieldRow receives a value of `[{ x: 1 }, { y: 2 }]`
- **THEN** the display SHALL show `[{"x":1},{"y":2}]` and SHALL NOT show `"[object Object],[object Object]"`

#### Scenario: Null value renders as placeholder
- **WHEN** a FieldRow receives a value of `null`, `undefined`, or `""`
- **THEN** the display SHALL show the em-dash placeholder `"—"`

#### Scenario: Primitive value renders as string
- **WHEN** a FieldRow receives a value of `"Active"` or `42` or `true`
- **THEN** the display SHALL show `"Active"` or `"42"` or `"true"` respectively

### Requirement: Text-input edit mode initialization mirrors display serialization
For non-selection fields and selection fields with no options defined, the FieldRow SHALL preserve its existing click-to-edit text-input behavior. When entering text-edit mode, the input's initial value SHALL be produced by the same serialization helper used for display. The input value SHALL NEVER be initialized via `String(value)` on a non-null object or array.

#### Scenario: Object value in text-edit input
- **WHEN** a non-selection field with value `{ a: 1 }` enters edit mode
- **THEN** the text input SHALL be initialized to `{"a":1}`
- **AND** SHALL NOT be initialized to `"[object Object]"`

#### Scenario: Array-of-strings value in text-edit input
- **WHEN** a non-selection field with value `["Monday","Tuesday"]` enters edit mode
- **THEN** the text input SHALL be initialized to `'["Monday","Tuesday"]'`

### Requirement: Selection field with options renders an inline always-visible control
When a FieldRow has `fieldType === "selection"` and `options.length > 0`, the Value cell SHALL render an inline always-visible control sized to the cell — bypassing the click-to-edit pattern used by text fields. The control SHALL be a `<select>` dropdown for `multiple: false` (or absent) and a checkbox group for `multiple: true`. No "Done" button or edit-mode toggle SHALL be required to interact with the control.

#### Scenario: Single-select with options always renders a dropdown
- **WHEN** a selection field with `multiple: false` and `options: ["Active","Inactive"]` is rendered
- **THEN** the Value cell SHALL contain a `<select>` element with one `<option>` per allowed value plus an empty placeholder option
- **AND** no click-to-edit transition SHALL be required

#### Scenario: Multi-select with options always renders a checkbox group
- **WHEN** a selection field with `multiple: true` and `options: ["Mon","Tue","Wed"]` is rendered
- **THEN** the Value cell SHALL contain three checkboxes, one per option, each with its option label
- **AND** no click-to-edit transition SHALL be required

#### Scenario: Choosing a dropdown option saves immediately
- **WHEN** the user selects an option from the inline dropdown
- **THEN** the field's value SHALL be updated to that option string
- **AND** no additional confirmation action SHALL be required

#### Scenario: Toggling a checkbox updates the value array
- **WHEN** the user checks the `"Tue"` checkbox on a field whose current value is `["Mon"]`
- **THEN** the field's value SHALL become an array containing both `"Mon"` and `"Tue"` (any order)
- **AND** no additional confirmation action SHALL be required

### Requirement: Inline selection control binds defensively to legacy values
The inline selection control SHALL bind its current state defensively from the field's `value`, recovering gracefully when `value` does not match the declared cardinality. The control SHALL NEVER raise an error or display `"[object Object]"` for malformed values.

#### Scenario: Single-select dropdown ignores legacy array value
- **WHEN** a single-select field has a current value of `["Active"]` (legacy array)
- **THEN** the dropdown SHALL preselect `"Active"` (the first string element)

#### Scenario: Single-select dropdown shows no selection for object value
- **WHEN** a single-select field has a current value of `{ x: 1 }` or `[{ x: 1 }]`
- **THEN** the dropdown SHALL show no option selected (the empty placeholder)
- **AND** SHALL NOT raise an error

#### Scenario: Multi-select checkboxes wrap a string legacy value
- **WHEN** a multi-select field has a current value of `"Mon"` (legacy string)
- **THEN** the editor SHALL render with the `"Mon"` checkbox pre-checked and other options unchecked

#### Scenario: Multi-select checkboxes ignore non-string array entries
- **WHEN** a multi-select field has a current value of `[{ x: 1 }, "Mon"]`
- **THEN** only the `"Mon"` checkbox SHALL be pre-checked
- **AND** the editor SHALL NOT raise an error

### Requirement: Selection field with no options falls back to text editor
When a FieldRow has `fieldType === "selection"` but `options` is empty or undefined, the Value cell SHALL preserve the existing click-to-edit text-input behavior, so users can seed values before defining the option list via the `OptionsEditor` panel.

#### Scenario: No options yet — text input fallback
- **WHEN** a selection field has `options: []` and the user clicks the Value cell
- **THEN** the editor SHALL be the same text input used for non-selection fields
- **AND** the input value SHALL be initialized via the safe serialization helper
