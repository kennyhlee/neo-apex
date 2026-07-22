# lead-conversion Specification

## Purpose
TBD - created by archiving change admindash-leads-module. Update Purpose after archive.
## Requirements
### Requirement: Convert a lead to a Family and Student

The system SHALL provide a "Convert to Family" action that, from an existing lead, creates a Family record and an initial Student record pre-filled from the lead's data, using the same Family/Student creation paths AdminDash already uses. The mapping SHALL be: lead guardian name/email/phone → Family primary contact fields; lead student first/last name and grade/program of interest → the initial Student record. Fields the lead does not have are left blank for the admin to complete.

#### Scenario: Convert pre-fills from lead data

- **WHEN** an admin invokes Convert to Family on a lead that has a guardian name, email, and a student first name
- **THEN** the system SHALL create a Family whose primary contact is populated from the lead
- **AND** SHALL create a Student under that family populated from the lead's student fields
- **AND** the created records SHALL be scoped to the lead's tenant

#### Scenario: Admin reviews before commit

- **WHEN** an admin opens the Convert to Family action
- **THEN** the system SHALL present the pre-filled Family/Student fields for review and editing before the records are created

### Requirement: Link and mark converted

The system SHALL, upon successful conversion, set the lead's `converted_family_id` to the created family's id and move the lead to the `Enrolled` stage (recording a `stage_change` activity per lead-pipeline).

#### Scenario: Lead is linked and marked enrolled

- **WHEN** conversion completes successfully
- **THEN** the lead's `converted_family_id` SHALL reference the new family
- **AND** the lead's stage SHALL be `Enrolled`
- **AND** a `stage_change` activity to `Enrolled` SHALL be recorded

### Requirement: Guard against double conversion

The system SHALL prevent converting a lead that has already been converted.

#### Scenario: Already converted

- **WHEN** an admin invokes Convert to Family on a lead that already has a `converted_family_id`
- **THEN** the system SHALL reject the action and SHALL NOT create a duplicate family
- **AND** SHALL surface that the lead is already converted, linking to the existing family

