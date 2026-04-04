## ADDED Requirements

### Requirement: Onboarding stepper UI
The system SHALL display a step-by-step onboarding wizard after sign-up with a progress indicator showing the current step.

#### Scenario: New admin sees onboarding after signup
- **WHEN** a newly registered admin is redirected after signup
- **THEN** the onboarding wizard is displayed at `/onboard`
- **AND** a stepper/progress bar shows steps: "Set Up Model" → "Tenant Details"
- **AND** the first step ("Set Up Model") is active

#### Scenario: Returning admin with incomplete onboarding
- **WHEN** an admin logs in and their tenant's onboarding is not complete
- **THEN** the app redirects to `/onboard` with the stepper showing the first incomplete step
- **AND** the admin cannot access the landing page or any other app pages until onboarding is complete

#### Scenario: Non-admin login before onboarding complete
- **WHEN** a staff, teacher, or parent user logs in and the tenant's onboarding is not complete
- **THEN** the user sees a message indicating the admin needs to complete setup first
- **AND** the user cannot access any app pages

### Requirement: Model setup step
The onboarding wizard's first step SHALL guide the admin to set up the data model via Papermite.

#### Scenario: Admin starts model setup
- **WHEN** the admin is on the "Set Up Model" step
- **AND** clicks "Set Up Model"
- **THEN** the admin is redirected to Papermite's upload page with a return URL parameter
- **AND** after completing the upload → review → finalize flow in Papermite, the admin is returned to the onboarding wizard
- **AND** the "Set Up Model" step shows as complete

### Requirement: Tenant details step
The onboarding wizard's second step SHALL present a model-compliant form for entering tenant details. The form is dynamically rendered from the Tenant model definition in datacore. This step is only accessible after model setup is complete.

#### Scenario: Admin fills tenant details
- **WHEN** the admin is on the "Tenant Details" step
- **AND** the Tenant model has been defined in Papermite (model setup step is complete)
- **THEN** the form reads the Tenant model definition from datacore
- **AND** renders all base fields and custom fields with type-aware inputs (text, number, date, selection, etc.)
- **AND** tenant name is shown as read-only (set at registration)
- **AND** required fields (as defined in the model) are enforced
- **AND** the admin can save the details

#### Scenario: Admin completes onboarding
- **WHEN** the admin has completed all required steps (model setup and tenant details)
- **THEN** the onboarding is marked complete on the tenant record (`onboarding_complete: true`)
- **AND** the admin is redirected to the landing page
- **AND** all users in the tenant can now access the app normally

### Requirement: Onboarding status tracking
The backend SHALL track onboarding completion status per tenant.

#### Scenario: Querying onboarding status
- **WHEN** the frontend calls `GET /api/tenants/{tenant_id}/onboarding-status`
- **THEN** the backend returns `{ steps: [{ id, label, completed }], is_complete }` reflecting which steps the tenant has finished

#### Scenario: Marking a step complete
- **WHEN** the frontend calls `POST /api/tenants/{tenant_id}/onboarding-status` with `{ step_id, completed: true }`
- **THEN** the backend updates the step's completion status
- **AND** sets `is_complete: true` if all steps are now done
