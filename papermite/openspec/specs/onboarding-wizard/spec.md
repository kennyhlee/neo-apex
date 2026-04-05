# Spec: Onboarding Wizard

## Purpose

Step-by-step onboarding flow for newly registered tenants, guiding admins through model setup and tenant details configuration.

## Requirements

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
The onboarding wizard's first step SHALL guide the admin to upload a document and define the data model using the existing upload → review → finalize flow.

#### Scenario: Admin completes model setup
- **WHEN** the admin is on the "Set Up Model" step
- **AND** clicks "Upload Document"
- **THEN** the admin is navigated to the existing `/upload` page
- **AND** after completing the upload → review → finalize flow, the admin is returned to the onboarding wizard
- **AND** the "Set Up Model" step shows as complete with a summary of the model created

#### Scenario: Admin skips model setup
- **WHEN** the admin clicks "Skip for now" on the model setup step
- **THEN** the wizard advances to the next step
- **AND** the skipped step shows as incomplete in the stepper

### Requirement: Tenant details step
The onboarding wizard's second step SHALL present a form for entering tenant details.

#### Scenario: Admin fills tenant details
- **WHEN** the admin is on the "Tenant Details" step
- **THEN** a form is displayed with fields: display name, contact email, address, license number, capacity, accreditation, insurance provider
- **AND** tenant name is pre-filled from registration and editable
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
