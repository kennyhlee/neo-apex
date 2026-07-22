## ADDED Requirements

### Requirement: Manual lead entry

The system SHALL let an authenticated admin create a lead by entering its fields directly in AdminDash. Parent/guardian name is REQUIRED; at least one of email or phone is REQUIRED; all other fields are optional.

#### Scenario: Admin creates a lead manually

- **WHEN** an admin submits the manual-entry form with a guardian name and an email
- **THEN** the system SHALL create a lead with `source` = `manual`, `stage` = `New`, scoped to the admin's tenant
- **AND** SHALL return the created lead

#### Scenario: Missing required contact

- **WHEN** an admin submits the form with a guardian name but no email and no phone
- **THEN** the system SHALL reject the request with a validation error naming the missing contact requirement

### Requirement: Public web-form intake

The system SHALL expose a public, unauthenticated intake endpoint that accepts a lead submission scoped to a specific tenant identified in the request path or payload. Submissions SHALL be stored with `source` = `web_form` and `stage` = `New`. The endpoint SHALL accept only the prospect-facing fields (guardian name, email, phone, student name, grade/program of interest, message) and SHALL ignore/reject any attempt to set internal fields (stage, source, converted_family_id).

#### Scenario: Prospect submits the web form

- **WHEN** an unauthenticated prospect submits the web form for a valid tenant with a guardian name and email
- **THEN** the system SHALL create a lead for that tenant with `source` = `web_form` and `stage` = `New`
- **AND** SHALL return a success acknowledgement without exposing other tenants' data

#### Scenario: Unknown tenant

- **WHEN** a web-form submission references a tenant that does not exist
- **THEN** the system SHALL reject the submission and SHALL NOT create a lead

#### Scenario: Internal fields are not settable from public form

- **WHEN** a web-form payload includes `stage` = `Enrolled` or a `converted_family_id`
- **THEN** the system SHALL ignore those fields and store the lead as `New` with no conversion link

### Requirement: Email-import intake

The system SHALL let an authenticated admin import a lead from an inquiry email by pasting the email text. The system SHALL parse the text into candidate lead fields (guardian name, email, phone, student name, message) and present them for admin review and correction before the lead is saved. The lead is only persisted when the admin confirms.

#### Scenario: Parse then review

- **WHEN** an admin pastes an inquiry email and requests parsing
- **THEN** the system SHALL return candidate field values extracted from the text
- **AND** SHALL NOT persist a lead until the admin confirms

#### Scenario: Confirm import

- **WHEN** an admin confirms the reviewed fields from an email import
- **THEN** the system SHALL create a lead with `source` = `email_import` and `stage` = `New`

#### Scenario: Best-effort parsing

- **WHEN** the pasted email lacks a detectable phone or student name
- **THEN** the system SHALL return the fields it could extract and leave the rest blank for the admin to fill
