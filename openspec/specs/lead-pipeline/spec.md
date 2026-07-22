# lead-pipeline Specification

## Purpose
TBD - created by archiving change admindash-leads-module. Update Purpose after archive.
## Requirements
### Requirement: Lead entity

The system SHALL provide a tenant-scoped Lead entity representing a prospective family's inquiry. A Lead SHALL have: a unique id, tenant_id, prospect contact fields (parent/guardian name, email, phone), student interest fields (student first name, student last name, grade/program of interest — all optional), a free-text `notes` field, a `source` field indicating how the lead arrived (`web_form`, `manual`, `email_import`), a `stage` field, timestamps (`created_at`, `updated_at`), and an optional `converted_family_id` link. All Lead data is scoped to the tenant embedded in the request.

#### Scenario: Lead is created with defaults

- **WHEN** a lead is created without an explicit stage
- **THEN** its `stage` SHALL default to `New`
- **AND** `created_at` and `updated_at` SHALL be set to the creation time
- **AND** it SHALL be scoped to the requesting tenant

#### Scenario: Leads are tenant-isolated

- **WHEN** a user requests leads
- **THEN** the system SHALL return only leads whose `tenant_id` matches the tenant in the caller's token
- **AND** SHALL never return leads belonging to another tenant

### Requirement: Pipeline stages

The system SHALL define a fixed, ordered set of pipeline stages: `New`, `Contacted`, `Tour Scheduled`, `Toured`, `Enrolled`, `Lost`. Every lead SHALL be in exactly one stage. `Enrolled` and `Lost` are terminal stages.

#### Scenario: Stage must be a known value

- **WHEN** a lead is created or updated with a `stage` not in the defined set
- **THEN** the system SHALL reject the request with a validation error

### Requirement: Stage transitions

The system SHALL allow an authenticated admin to move a lead to any other stage. Each stage change SHALL update the lead's `stage` and `updated_at`, and SHALL record a `stage_change` activity capturing the previous and new stage (see lead-activity-log).

#### Scenario: Admin advances a lead

- **WHEN** an admin changes a lead's stage from `New` to `Contacted`
- **THEN** the lead's `stage` SHALL become `Contacted`
- **AND** a `stage_change` activity SHALL be recorded with from=`New`, to=`Contacted`

#### Scenario: Stage change is idempotent-safe

- **WHEN** an admin sets a lead to the stage it is already in
- **THEN** the system SHALL accept the request without creating a redundant `stage_change` activity

### Requirement: List and filter leads

The system SHALL let an authenticated admin list leads for their tenant and filter the list by stage.

#### Scenario: Filter by stage

- **WHEN** an admin lists leads filtered by stage `Toured`
- **THEN** the system SHALL return only that tenant's leads currently in stage `Toured`

#### Scenario: Board view grouping

- **WHEN** an admin views the pipeline board
- **THEN** leads SHALL be grouped by stage in the defined stage order

