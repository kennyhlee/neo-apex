## ADDED Requirements

### Requirement: Custom-field name cells SHALL be inline-editable; base-field name cells SHALL NOT

On the Papermite review screen, every row whose mapping has `source: "custom_field"` SHALL render its field name in a control that toggles between a display element and a text input. The interaction SHALL match the existing inline edit pattern for the field value cell: clicking the displayed name swaps it for an `<input>` that is auto-focused and pre-filled with the current name. The display element SHALL carry `title="Click to edit"` as an affordance hint, mirroring the value cell.

Rows whose mapping has `source: "base_model"` SHALL continue to render the field name as static `<code>{fieldName}</code>` with no click handler, no hover affordance, and no `title`. Clicking a base-field name SHALL have no effect. This mirrors the existing lock pattern on base-field type (`<span className="field-row__type-locked">`) and base-field required toggle (`disabled={isBase}`).

#### Scenario: Clicking a custom-field name enters edit mode

- **GIVEN** a field row whose mapping has `source: "custom_field"`
- **WHEN** the user clicks on the displayed name
- **THEN** the name cell SHALL switch to an `<input>` element
- **AND** the input SHALL be auto-focused with the cursor positioned for editing
- **AND** the input value SHALL equal the current field name

#### Scenario: Clicking a base-field name does nothing

- **GIVEN** a field row whose mapping has `source: "base_model"`
- **WHEN** the user clicks on the displayed name
- **THEN** the name cell SHALL remain a static `<code>` element
- **AND** no input SHALL appear
- **AND** the `ExtractionResult` SHALL NOT be modified

#### Scenario: Pressing Enter commits the rename

- **GIVEN** a custom-field name cell is in edit mode with a non-empty, unique trimmed value
- **WHEN** the user presses Enter
- **THEN** the input SHALL exit edit mode and revert to the display element showing the new name
- **AND** the in-memory `ExtractionResult` SHALL be updated as defined in the propagation requirement below

#### Scenario: Blurring the input commits the rename

- **GIVEN** a custom-field name cell is in edit mode with a non-empty, unique trimmed value
- **WHEN** the input loses focus (blur)
- **THEN** the rename SHALL be committed using the same logic as pressing Enter

#### Scenario: Pressing Escape cancels the rename

- **GIVEN** a custom-field name cell is in edit mode
- **WHEN** the user presses Escape
- **THEN** the input SHALL exit edit mode and revert to the original name
- **AND** the `ExtractionResult` SHALL NOT be modified

### Requirement: Renames SHALL be validated for non-emptiness and per-entity uniqueness against ALL mappings

When a rename is committed, the new name (after trimming leading and trailing whitespace) MUST satisfy:

1. Length greater than zero.
2. Differ from the `field_name` of every other `FieldMapping` in the same entity — comparing against **both** `source: "base_model"` and `source: "custom_field"` mappings (case-sensitive).

If validation fails, the rename SHALL be rejected: the input SHALL revert to the original name, the in-memory `ExtractionResult` SHALL NOT be modified, and a brief inline error message SHALL appear adjacent to the cell and auto-clear after approximately 3 seconds.

The handler the parent passes to `FieldRow` SHALL return a discriminated result of the shape `{ ok: true } | { ok: false, error: string }`; it SHALL NOT throw.

#### Scenario: Empty name is rejected

- **GIVEN** a custom-field name cell is in edit mode
- **WHEN** the user clears the input and commits (Enter or blur)
- **THEN** the input SHALL revert to the original name
- **AND** the `ExtractionResult` SHALL NOT be modified
- **AND** an inline error indicating the name cannot be empty SHALL appear briefly

#### Scenario: Whitespace-only name is rejected

- **GIVEN** a custom-field name cell is in edit mode
- **WHEN** the user enters only whitespace characters and commits
- **THEN** the rename SHALL be rejected with the same behavior as an empty name

#### Scenario: Duplicate name colliding with another custom field is rejected

- **GIVEN** an entity has two custom-field mappings named `nickname` and `pronouns`
- **AND** the user is editing the `pronouns` cell
- **WHEN** the user enters `nickname` and commits
- **THEN** the input SHALL revert to `pronouns`
- **AND** the `ExtractionResult` SHALL NOT be modified
- **AND** an inline error indicating the name is already used SHALL appear briefly

#### Scenario: Duplicate name colliding with a base field is rejected

- **GIVEN** an entity has a base-field mapping named `first_name` and a custom-field mapping named `nickname`
- **AND** the user is editing the `nickname` cell
- **WHEN** the user enters `first_name` and commits
- **THEN** the input SHALL revert to `nickname`
- **AND** the `ExtractionResult` SHALL NOT be modified
- **AND** an inline error SHALL appear briefly

#### Scenario: Duplicate name across different entities is allowed

- **GIVEN** entity `student` has a custom field `note` and entity `family` has a custom field `comment`
- **WHEN** the user renames `family.comment` to `note`
- **THEN** the rename SHALL succeed
- **AND** both entities SHALL have a `note` field afterward

#### Scenario: Committing the unchanged name is a no-op

- **GIVEN** a custom-field name cell is in edit mode showing the current name
- **WHEN** the user commits without changing the value
- **THEN** the input SHALL exit edit mode
- **AND** no error SHALL be shown
- **AND** the `ExtractionResult` SHALL NOT be modified

### Requirement: A successful rename SHALL update field_mappings, entity.entity, and entity.entity.custom_fields in lockstep

When a rename is committed and passes validation, the `EntityResult` returned to `ReviewPage` SHALL reflect all three of the following changes, applied to a single new object (no partial application):

1. In `entity.field_mappings`, the matching mapping's `field_name` is replaced with the new (trimmed) name at the same array index. All other properties of the mapping (`value`, `source`, `required`, `field_type`, `options`, `multiple`) SHALL be unchanged.
2. In `entity.entity`, the key under the old name is removed and a new key with the same value is set under the new name.
3. In `entity.entity.custom_fields` (when present), the key under the old name is removed and a new key with the same value is set under the new name.

This mirrors the cleanup pattern of `handleFieldDelete` in `EntityCard.tsx`.

#### Scenario: field_mappings entry is renamed in place

- **GIVEN** an entity has a custom field mapping at index 2 with `field_name: "dob"`, `value: "2010-01-01"`, `field_type: "date"`, `required: false`
- **WHEN** the user renames the field to `date_of_birth`
- **THEN** the mapping at index 2 SHALL have `field_name: "date_of_birth"`
- **AND** the mapping at index 2 SHALL still have `value: "2010-01-01"`, `field_type: "date"`, `required: false`, `source: "custom_field"`
- **AND** the array length SHALL be unchanged
- **AND** no other mapping in the array SHALL be modified

#### Scenario: entity.entity key is renamed

- **GIVEN** an entity has `entity.entity = { first_name: "Sam", dob: "2010-01-01", custom_fields: { dob: "2010-01-01" } }`
- **WHEN** the user renames custom field `dob` to `date_of_birth`
- **THEN** `entity.entity` SHALL NOT have a key `dob`
- **AND** `entity.entity.date_of_birth` SHALL equal `"2010-01-01"`
- **AND** `entity.entity.first_name` SHALL still equal `"Sam"`

#### Scenario: entity.entity.custom_fields key is renamed

- **GIVEN** the same starting state as the previous scenario
- **WHEN** the user renames custom field `dob` to `date_of_birth`
- **THEN** `entity.entity.custom_fields` SHALL NOT have a key `dob`
- **AND** `entity.entity.custom_fields.date_of_birth` SHALL equal `"2010-01-01"`

### Requirement: Renames SHALL propagate through finalize to the saved model definition

When a renamed `ExtractionResult` is submitted via `POST /tenants/{tenant_id}/finalize/commit`, the resulting model definition stored in DataCore SHALL contain the renamed custom field under its new name, with all other field properties (`type`, `required`, `options`, `multiple`) preserved from the edit session. The backend SHALL NOT introduce any validator or transformation that would reject or alter the `field_name` value supplied by the client.

#### Scenario: Renamed custom field is persisted with the new name

- **GIVEN** the user has renamed a custom field from `dob` to `date_of_birth` in the review screen, with `field_type: "date"`, `required: false`
- **WHEN** the user clicks Finalize and the backend processes the commit
- **THEN** the JSON payload sent in the `httpx.put` call to DataCore's `/models/{tenant_id}` endpoint SHALL contain, in `model_definition[<entity_type>]["custom_fields"]`, an object with `{"name": "date_of_birth", "type": "date", "required": false}`
- **AND** SHALL NOT contain any object with `"name": "dob"` in either `custom_fields` or `base_fields` of that entity

#### Scenario: Backend does not reject renamed field_name values

- **GIVEN** a finalize request payload with one or more renamed custom-field `field_name` values
- **WHEN** the request is processed by `_build_model_definition`
- **THEN** the function SHALL produce a model definition using the new names without raising
- **AND** the call to `PUT /models/{tenant_id}` on DataCore SHALL be made with those new names in the payload

### Requirement: Reopening a saved model SHALL allow further custom-field renames

When a user reopens a previously-saved model definition for editing (LandingPage → Edit), every custom-field name SHALL be editable through the same interaction. Names persisted from a prior session SHALL appear as the current values in the review screen and SHALL remain renameable. Base-field names SHALL remain non-editable.

#### Scenario: Renamed custom field can be renamed again on next edit

- **GIVEN** a model definition exists in DataCore with a custom field originally named `dob`, renamed to `date_of_birth` in a prior session
- **WHEN** the user opens the model via the LandingPage Edit action
- **THEN** the review screen SHALL show the field as `date_of_birth`
- **AND** clicking the name SHALL enter edit mode
- **AND** the user SHALL be able to rename it to `birth_date` and commit
