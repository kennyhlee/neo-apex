## ADDED Requirements

### Requirement: Single denormalized activity collection

The system SHALL record lead activities in a single tenant-scoped `lead_activities` collection. Each activity SHALL have: id, tenant_id, lead_id, a `type` enum (`call`, `email`, `note`, `stage_change`), a free-text `body`, an optional structured `metadata` object (used by `stage_change` to hold `from`/`to`), `created_by` (the acting user, or `system` for auto-logged entries), and `created_at`. Activities are deliberately NOT split into per-type tables.

#### Scenario: Activity shape is uniform

- **WHEN** an activity of any type is stored
- **THEN** it SHALL use the same record shape distinguished only by its `type` field

### Requirement: Manual activity logging

The system SHALL let an authenticated admin add a `call`, `email`, or `note` activity to a lead, with body text.

#### Scenario: Admin logs a call

- **WHEN** an admin adds a `call` activity with body "Left voicemail" to a lead
- **THEN** the system SHALL store a `lead_activities` record of type `call` linked to that lead, with `created_by` set to the admin and `created_at` set

#### Scenario: Activity requires a known type

- **WHEN** an admin submits an activity with a type outside the enum
- **THEN** the system SHALL reject it with a validation error

### Requirement: Auto-logged stage changes

The system SHALL automatically record a `stage_change` activity whenever a lead's stage changes, capturing the previous and new stage in `metadata` and `created_by` = `system`.

#### Scenario: Stage change appears in the log

- **WHEN** a lead moves from `Contacted` to `Tour Scheduled`
- **THEN** a `stage_change` activity SHALL be recorded with metadata `{from: "Contacted", to: "Tour Scheduled"}`

### Requirement: View activity timeline

The system SHALL let an authenticated admin retrieve all activities for a lead, ordered most-recent-first, scoped to the tenant.

#### Scenario: Timeline is chronological

- **WHEN** an admin opens a lead's detail view
- **THEN** the system SHALL return that lead's activities ordered by `created_at` descending
- **AND** SHALL include both manual activities and auto-logged stage changes
