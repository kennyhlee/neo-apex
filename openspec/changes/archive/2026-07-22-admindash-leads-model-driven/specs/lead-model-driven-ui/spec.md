## ADDED Requirements

### Requirement: Pipeline board and stage control derive from the model

The system SHALL build the AdminDash leads pipeline board and the lead detail stage control from the tenant lead model's `stage` field options, in option order. It SHALL NOT use a hard-coded stage list when a lead model exists.

#### Scenario: Board reflects custom stages

- **WHEN** a tenant's lead model defines stages `Inquiry, Visit, Applied, Won, Withdrawn`
- **THEN** the pipeline board SHALL show exactly those five columns in that order
- **AND** the lead detail stage dropdown SHALL offer exactly those options

#### Scenario: Leads with an unknown stage are still shown

- **WHEN** a lead's stored `stage` value is not among the current model options (e.g. after a rename)
- **THEN** the board SHALL display that lead in an "Other"/uncategorized column rather than hiding it

### Requirement: Capture and edit forms derive from the model

The system SHALL render the manual add-lead form and the lead edit form from the tenant lead model (all base and custom fields), using the shared dynamic form. Field requiredness SHALL come from the model's `required` flags. The system SHALL persist values as `base_data`/`custom_fields` accordingly.

#### Scenario: Custom field appears in the form

- **WHEN** a tenant adds a custom lead field `referral_source`
- **THEN** the add-lead and edit forms SHALL include an input for `referral_source`
- **AND** submitting it SHALL persist it on the lead

#### Scenario: Requiredness comes from the model

- **WHEN** the model marks `guardian_name` required and `email` optional
- **THEN** the form SHALL block submit without `guardian_name` and SHALL allow submit without `email`

### Requirement: Custom fields survive stage and conversion updates

The system SHALL preserve all model fields (including customer-added fields) when it performs a read-modify-write update to a lead (stage change, conversion). It SHALL NOT drop fields that are outside a fixed built-in field list.

#### Scenario: Stage change keeps custom fields

- **WHEN** a lead with a custom field `referral_source = "Friend"` has its stage changed
- **THEN** after the update the lead SHALL still have `referral_source = "Friend"`

### Requirement: Stage validation uses the model

The system SHALL validate a requested lead stage against the tenant lead model's `stage` options (not a hard-coded constant). A stage not among the model options SHALL be rejected.

#### Scenario: Reject unknown stage

- **WHEN** an admin attempts to move a lead to a stage that is not in the tenant's `stage` options
- **THEN** the system SHALL reject the request with a validation error

#### Scenario: Accept a customer-defined stage

- **WHEN** the tenant's stages include `Won` and an admin moves a lead to `Won`
- **THEN** the system SHALL accept it and record a `stage_change` activity from the previous stage to `Won`

### Requirement: Convert-to-Family moves to an admin-selected stage

The system SHALL let the admin choose the target stage during Convert-to-Family, defaulting to the last stage in the pipeline, validated against the model. Conversion SHALL create and link Family/Student and guard against double-conversion, and SHALL NOT assume a hard-coded `Enrolled` stage.

#### Scenario: Convert to a chosen stage

- **WHEN** an admin converts a lead and selects target stage `Won`
- **THEN** the lead SHALL be linked to the created family and moved to `Won` with a `stage_change` activity

#### Scenario: Convert defaults to the last stage

- **WHEN** an admin converts a lead without choosing a stage
- **THEN** the lead SHALL be moved to the last stage in the tenant's pipeline

#### Scenario: Double-conversion still guarded

- **WHEN** an admin converts a lead that already has a `converted_family_id`
- **THEN** the system SHALL reject it and SHALL NOT create a duplicate family

### Requirement: Public inquiry form derives from the model

The system SHALL render the public inquiry web form from the tenant lead model's prospect fields — the base fields excluding the reserved internal fields `stage`, `source`, `converted_family_id`, and `lead_id`. It SHALL fetch the model without authentication and SHALL continue to force `source = web_form` and a default stage server-side regardless of the model.

#### Scenario: Public form shows a custom prospect field

- **WHEN** a tenant adds a custom lead field `hear_about_us` and a prospect opens the public form
- **THEN** the form SHALL include `hear_about_us`
- **AND** SHALL NOT include `stage`, `source`, `converted_family_id`, or `lead_id`

### Requirement: Graceful fallback without a lead model

The system SHALL fall back to the current default fields and stages when a tenant has no `lead` model, so the leads UI and backend continue to function during rollout.

#### Scenario: No lead model present

- **WHEN** a tenant has no `lead` entry in its model definition
- **THEN** the leads board, forms, and stage validation SHALL use the built-in default fields and stages
