## ADDED Requirements

### Requirement: Preferences stored in localStorage per user and tenant
Table display preferences SHALL be stored in localStorage under the key `admindash_table_prefs_{user_id}_{tenant_id}`. The stored value SHALL be a JSON object with the schema: `{ hiddenColumns: string[], pageSize: number, sortBy: string, sortDir: "asc" | "desc" }`.

#### Scenario: Preferences saved on change
- **WHEN** user hides a column, changes page size, or changes sort
- **THEN** the updated preferences are immediately written to localStorage

#### Scenario: Preferences loaded on page mount
- **WHEN** user navigates to StudentsPage
- **THEN** preferences are loaded from localStorage and applied to the table

### Requirement: Default preferences when no cache exists
When no localStorage entry exists (first visit or cache cleared), the system SHALL use defaults: all columns visible, page size 20, sort by `last_name` ascending, status filter `active`.

#### Scenario: First visit
- **WHEN** user opens StudentsPage with no cached preferences
- **THEN** all columns are visible, page size is 20, sorted by last_name ASC

#### Scenario: Cache cleared
- **WHEN** user clears browser localStorage and reloads
- **THEN** preferences revert to defaults

### Requirement: Stale column references are pruned
When loading preferences, any `hiddenColumns` entries that do not match a current column key SHALL be silently removed from the loaded preferences.

#### Scenario: Model adds new field
- **WHEN** cached `hiddenColumns` includes `"old_field"` but `old_field` no longer exists in the column set
- **THEN** `"old_field"` is removed from `hiddenColumns` and the remaining preferences are applied

### Requirement: Page size constrained to valid values
The stored `pageSize` SHALL be one of: 10, 20, 30, 40, 50. If the cached value is not in this set, it SHALL default to 20.

#### Scenario: Invalid cached page size
- **WHEN** cached `pageSize` is 25
- **THEN** page size defaults to 20
