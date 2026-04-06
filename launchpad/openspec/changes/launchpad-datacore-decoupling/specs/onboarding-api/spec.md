## ADDED Requirements

### Requirement: Onboarding status API endpoints on DataCore

DataCore exposes REST endpoints for managing onboarding status records in the global registry table.

#### Scenario: Get onboarding status
- **WHEN** `GET /api/registry/onboarding/{tenant_id}` is called
- **THEN** return onboarding status object `{tenant_id, steps: [{id, label, completed}], is_complete}`, or 404 if not found

#### Scenario: Mark onboarding step complete
- **WHEN** `POST /api/registry/onboarding/{tenant_id}/complete-step` is called with `{step_id}`
- **THEN** mark the step as completed, update `is_complete` flag if all steps are done, return updated onboarding status
- **WHEN** the tenant has no onboarding record
- **THEN** return 404
