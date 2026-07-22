## ADDED Requirements

### Requirement: Lead is a seeded, customer-definable model

The system SHALL define `lead` as a per-tenant model entity in the default model (`base_model.json`), seeded by the same "use default model" onboarding path as tenant/student/program. The default lead model SHALL contain the current lead capture fields as `base_fields` and an empty `custom_fields` list. A tenant that makes no changes SHALL retain today's fields and stages.

#### Scenario: Use-default seeds the lead model

- **WHEN** a tenant runs the onboarding "use default model" action
- **THEN** the persisted model definition SHALL include a `lead` entity with the default base fields
- **AND** the lead `stage` field SHALL be a `selection` field whose options are `New, Contacted, Tour Scheduled, Toured, Enrolled, Lost` in that order

#### Scenario: Unchanged model preserves current behavior

- **WHEN** a tenant does not customize the lead model
- **THEN** the effective lead fields and stages SHALL equal the current defaults

### Requirement: Stages are the options of the `stage` selection field

The system SHALL represent the lead pipeline stages as the ordered `options` of a `selection` field named `stage` in the lead model. The order of the options SHALL define the pipeline order. The system SHALL NOT introduce a separate pipeline/stages schema.

#### Scenario: Editing stage options redefines the pipeline

- **WHEN** a customer edits the `stage` field's options (add, remove, reorder) through the model-definition editor
- **THEN** the tenant's lead pipeline SHALL consist of exactly those options in that order

#### Scenario: Source is a selection field

- **WHEN** the lead model is seeded
- **THEN** `source` SHALL be a `selection` field with options `web_form, manual, email_import`

### Requirement: Lead is editable through the existing model-definition flow

The system SHALL make the `lead` entity available in the Papermite extraction review/edit UI (add/remove fields, change types, edit selection options, mark required), the same way student/program are, by registering a `Lead` domain model. The system SHALL NOT require a new bespoke editor for lead fields or stages.

#### Scenario: Lead appears in the review editor

- **WHEN** a customer defines their model through Papermite's review flow and the extraction includes a lead entity
- **THEN** the lead entity SHALL be editable there (fields and `stage`/`source` options) like other entities

### Requirement: Lead activity log is not modelled

The system SHALL keep `lead_activity` as a non-configurable transactional log — it SHALL NOT appear in the model definition or the model-definition editor.

#### Scenario: Activity log excluded from model

- **WHEN** the default model is seeded
- **THEN** no `lead_activity` entity SHALL be present in the model definition
