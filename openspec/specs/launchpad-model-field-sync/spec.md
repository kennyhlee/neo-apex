# launchpad-model-field-sync Specification

## Purpose
Field-level, additive sync of LaunchPad's base_model.json into a tenant's existing entity models, with a per-type change report and a guard that refuses to make published workflows stale unless forced. Created by archiving change derived-template-model-sync.
## Requirements
### Requirement: Merge rule lives in LaunchPad and is the only one
LaunchPad SHALL provide `merge_model_definition(base_fields, existing) -> {"base_fields", "custom_fields"}` in `launchpad/backend/app/model_merge.py` with the behavior the dev reseed script established: base fields always win; every `existing` field not named by a base field is kept as a custom field, deduped by name first-write-wins, fields with no name skipped; a kept field that is `required: true` with no `default` is demoted to `required: false`; a kept field with a `default` keeps its `required` flag. The function MUST be pure. The dev reseed script MUST import this function rather than define its own.

#### Scenario: Base field wins over a tenant field of the same name
- **WHEN** `base_fields` declares `status` as a selection and `existing` has a `status` field of type `str`
- **THEN** the result's `base_fields` contains the base declaration and `custom_fields` has no `status`

#### Scenario: Carried-forward required field without default is demoted
- **WHEN** `existing` has `config_version` with `required: true` and no `default`, and no base field is named `config_version`
- **THEN** the result's `custom_fields` contains `config_version` with `required: false`

#### Scenario: Carried-forward required field with default keeps its flag
- **WHEN** `existing` has `transportation_needed` with `required: true` and `default: true`
- **THEN** the result's `custom_fields` contains it unchanged

#### Scenario: Reseed script has no local copy
- **WHEN** `scripts/apexflow-reseed-dev.py` is inspected
- **THEN** it defines no `merge_model_definition` and its `merge_model_definition` attribute is the LaunchPad function

### Requirement: Sync adds missing base fields to existing entity types
`POST /api/tenants/{tenant_id}/model/sync-defaults` SHALL, for every entity type in `base_model.json` that the tenant already has, merge the base fields into the tenant's stored definition with `merge_model_definition` and write the merged definition back only when it differs from the stored one. Entity types the tenant lacks SHALL be added as before. Entity types the tenant has that the base model does not declare SHALL be left untouched. All written types SHALL go in one PUT to DataCore. A base field the tenant already has, as base or custom, SHALL keep the tenant's stored declaration; the base model supplies only fields the tenant lacks.

#### Scenario: Tenant model predates eight application fields
- **WHEN** the tenant's `registration_application` lacks `requested_start_date`, `schedule_days`, `pickup_method`, `handbook_acknowledged`, `liability_waiver_signed`, `tuition_agreement_signed`, `signature_name`, `signature_date` and has one Papermite custom field `packet_notes`
- **THEN** one PUT is sent whose `registration_application.base_fields` equals the base model's and whose `custom_fields` still contains `packet_notes`

#### Scenario: Tenant-edited base field is kept
- **WHEN** the tenant's `student.grade_level` carries custom `options` that differ from the base model's, and the sync writes `student` because another base field is missing
- **THEN** the written `student` definition keeps the tenant's `grade_level` options

#### Scenario: Nothing to do
- **WHEN** every entity type is present and every one already equals its merged definition
- **THEN** no PUT is sent and the response has empty `added_entities`, empty `changed`, empty `workflows_at_risk`

#### Scenario: Only changed types are written
- **WHEN** `student` already matches the base model and `registration_application` does not
- **THEN** the PUT's `model_definition` contains `registration_application` and not `student`

#### Scenario: Tenant-only entity type is preserved
- **WHEN** the tenant has an entity type `scholarship` absent from the base model
- **THEN** it is neither written nor reported

### Requirement: Sync reports what it changed
The sync response SHALL be `{"added_entities": [...], "changed": {entity_type: {"added_fields": [...], "demoted_fields": [...]}}, "workflows_at_risk": [...]}`. `added_fields` SHALL list base field names newly present in the written definition; `demoted_fields` SHALL list custom field names whose `required` flipped from `true` to `false`. All lists SHALL be sorted.

#### Scenario: Report names the added and demoted fields
- **WHEN** the merge adds `signature_date` to `registration_application` and demotes its carried-forward `channel_started`
- **THEN** `changed.registration_application` is `{"added_fields": ["signature_date"], "demoted_fields": ["channel_started"]}`

### Requirement: Sync refuses to stall published workflows unless forced
Before writing, the sync SHALL call apexflow's `POST /api/workflows/{tenant_id}/model-preflight` with the merged definitions of every type it would write, forwarding the caller's `Authorization` header. Every returned definition whose `health_after` is worse than `health_before` (`current` < `stale` < `broken`) SHALL be listed in `workflows_at_risk` as `{definition_id, name, version, health_before, health_after}`. If that list is non-empty and the request body does not contain `force: true`, the sync SHALL respond **409** with `{"reason": "workflows_at_risk", ...full report...}` and write nothing. With `force: true` it SHALL write and return 200 with the same report. If no type would be written, the preflight SHALL NOT be called.

#### Scenario: A published workflow would go stale
- **WHEN** preflight reports `enrollment` v2 as `current` before and `stale` after, and the request has no `force`
- **THEN** the response is 409, no PUT is sent, and `workflows_at_risk` contains that definition

#### Scenario: Forced
- **WHEN** the same preflight result is returned and the body is `{"force": true}`
- **THEN** the PUT is sent and the response is 200 with `workflows_at_risk` still populated

#### Scenario: Health unchanged or improved
- **WHEN** preflight reports every definition with `health_after` equal to or better than `health_before`
- **THEN** the PUT is sent and `workflows_at_risk` is empty

#### Scenario: Preflight unavailable
- **WHEN** the preflight call fails or returns non-200 and the request has no `force`
- **THEN** the response is 502 and no PUT is sent

#### Scenario: Preflight unavailable but forced
- **WHEN** the preflight call fails and the body is `{"force": true}`
- **THEN** the PUT is sent and the response is 200 with `workflows_at_risk` empty and `preflight: "unavailable"`

### Requirement: Settings page shows the report and offers force
LaunchPad's tenant settings page SHALL show, after a sync, the added entity types, the added and demoted fields per entity type, and the workflows at risk. On a 409 it SHALL show the at-risk workflows and a second action that re-runs the sync with `force: true`.

#### Scenario: Successful sync with changes
- **WHEN** the sync returns 200 with one changed type
- **THEN** the page lists that type's added and demoted fields

#### Scenario: Refused sync
- **WHEN** the sync returns 409
- **THEN** the page lists the at-risk workflows and shows a "Sync anyway" action that sends `force: true`

### Requirement: LaunchPad knows apexflow's backend URL
LaunchPad settings SHALL expose `apexflow_backend_url`, defaulting to the `apexflow-backend` entry in `services.json` and overridable by `LAUNCHPAD_APEXFLOW_BACKEND_URL`.

#### Scenario: Default from services.json
- **WHEN** no override is set
- **THEN** `settings.apexflow_backend_url` is `http://localhost:5910`

### Requirement: Base-model evolution rule is documented
The root `CLAUDE.md` SHALL state under Conventions that new base fields ship optional or with a `default`, and that a required field without a default re-versions every live workflow on that model because instance creation refuses a stale definition.

#### Scenario: Rule is present
- **WHEN** `CLAUDE.md` is read
- **THEN** the Conventions section contains the rule and names `base_model.json`
