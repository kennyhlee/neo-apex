# Capability: Dashboard Student Count

## Purpose
Display the active student count on the Employee Dashboard, fetched from datacore and scoped to the current tenant.

## Requirements

### Requirement: Dashboard shows active student count
The Employee Dashboard "Total Students" stat card SHALL display the count of active students for the current tenant, fetched from datacore on page mount.

#### Scenario: Active students exist
- **WHEN** the tenant has 5 active student records in datacore
- **THEN** the stat card displays `5`

#### Scenario: No active students but records exist
- **WHEN** the tenant has student records but none with `_status=active`
- **THEN** the stat card displays `0`

#### Scenario: No student entity table
- **WHEN** the datacore query fails (no entity table, API unreachable)
- **THEN** the stat card displays `—` (em dash)

### Requirement: Count fetched on page mount
The active student count SHALL be fetched when HomePage mounts. The stat card SHALL show a loading state while the fetch is in progress.

#### Scenario: Loading state
- **WHEN** the page is loading and the count has not yet been fetched
- **THEN** the stat card displays `—` (em dash) until the count is available

#### Scenario: Tenant changes
- **WHEN** the user switches to a different tenant
- **THEN** the count is re-fetched for the new tenant

### Requirement: HomePage receives tenant prop
HomePage SHALL receive the current `tenant` string as a prop from the App router, consistent with how StudentsPage and AddStudentPage receive it.

#### Scenario: Tenant prop wired
- **WHEN** HomePage renders
- **THEN** it has access to the current tenant ID for scoping the datacore query
