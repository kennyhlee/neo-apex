# template-model-compatibility Specification

## Purpose
Derived compatibility between shipped workflow templates and a tenant's current entity models: missing fields reported on the template catalog, surfaced in the gallery, with an explicit sync-or-omit choice at apply time, plus apexflow's read-only model-preflight endpoint. Created by archiving change derived-template-model-sync.
## Requirements
### Requirement: Templates route derives missing fields per entity model
`GET /api/workflows/{tenant_id}/templates` SHALL include on every catalog entry a `missing_fields` object mapping entity model name to the sorted list of field names the template's form-step sections pick that do not exist (as base or custom field) on the tenant's current model of that type. Only entity models the tenant has SHALL appear as keys; a model already listed in `missing_models` SHALL NOT appear. Keys SHALL be sorted. The key `missing_fields` SHALL always be present, as `{}` when nothing is missing.

#### Scenario: Tenant model lags the template
- **WHEN** the tenant's `registration_application` has every base field except `handbook_acknowledged` and `signature_date`, and every other referenced model is complete
- **THEN** the enrollment entry's `missing_fields` is `{"registration_application": ["handbook_acknowledged", "signature_date"]}`

#### Scenario: Custom field satisfies a pick
- **WHEN** `signature_date` is absent from the tenant's `registration_application.base_fields` but present in its `custom_fields`
- **THEN** `signature_date` is not reported

#### Scenario: Missing model is not double-reported
- **WHEN** the tenant has no `contact` model
- **THEN** `contact` is in `missing_models` and absent from `missing_fields`

#### Scenario: Complete tenant
- **WHEN** every referenced model has every picked field
- **THEN** `missing_fields` is `{}` on every entry

### Requirement: Gallery shows missing fields before apply
The templates gallery SHALL show the "Needs setup" badge when a template has missing models or missing fields, and the card copy SHALL name the missing fields grouped by model. The apply dialog SHALL list the missing fields per model and state that syncing the model in LaunchPad's tenant settings adds them.

#### Scenario: Card with missing fields
- **WHEN** an entry has `missing_fields: {"registration_application": ["signature_date"]}` and no missing models
- **THEN** the card shows the badge and copy naming `registration_application: signature_date`

#### Scenario: Card with nothing missing
- **WHEN** an entry has empty `missing_models` and `{}` `missing_fields`
- **THEN** no badge or warning copy is shown

### Requirement: Applying with missing fields omits them explicitly
When the active template has any missing fields, the apply dialog's confirm button SHALL read "Create without {n} fields" where `{n}` is the total count. On confirm, the created draft's steps SHALL equal the template's steps with every pick named in `missing_fields` removed from the section of the matching entity model. Sections, section ids, modes, repeat specs, step order and the machine SHALL be unchanged. When no fields are missing the button and the request SHALL be exactly as today.

#### Scenario: Missing picks are stripped on create
- **WHEN** `missing_fields` is `{"registration_application": ["handbook_acknowledged", "signature_date"]}` and the admin confirms
- **THEN** the `POST /definitions` body's `application_section.fields` has no `handbook_acknowledged` or `signature_date` pick and every other pick is intact

#### Scenario: Only the matching model's section is affected
- **WHEN** `missing_fields` is `{"registration_application": ["signature_date"]}` and the `student` section also contains no field of that name
- **THEN** the `student` section's picks are unchanged

#### Scenario: Nothing missing
- **WHEN** `missing_fields` is `{}`
- **THEN** the request body's steps are deep-equal to the catalog entry's steps

### Requirement: Model preflight evaluates published definitions against proposed models
`POST /api/workflows/{tenant_id}/model-preflight` with body `{"models": {entity_type: definition}}` SHALL return `{"definitions": [...]}` with one entry per **published** `workflow_definition` row whose lineage is active (`lineage_status == "active"`): `{definition_id, name, version, health_before, health_after}`. `health_before` SHALL be `definition_health` against the tenant's stored models; `health_after` against the stored models with the body's entries overlaid. Stored models SHALL be fetched once for the union of referenced entity types. A row whose machine or steps fail to parse SHALL report `"broken"` for both. The route SHALL require staff or admin with a matching tenant, and SHALL write nothing.

#### Scenario: New required field makes a workflow stale
- **WHEN** the body's `student` adds a `required: true` field with no default that no published section picks
- **THEN** that definition reports `health_before: "current"` and `health_after: "stale"`

#### Scenario: Additive optional fields leave health unchanged
- **WHEN** the body's `registration_application` only adds optional fields
- **THEN** every definition reports `health_after` equal to `health_before`

#### Scenario: Drafts are excluded
- **WHEN** the tenant has one draft and one published definition
- **THEN** only the published one appears

#### Scenario: Inactive lineages are excluded
- **WHEN** the tenant has one published definition on an active lineage and one published definition whose lineage is `deprecated`
- **THEN** only the active one appears, since `engine.create_instance` already refuses non-active lineages

#### Scenario: Wrong tenant
- **WHEN** the token's tenant does not match the path
- **THEN** the response is 403
