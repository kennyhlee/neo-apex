## ADDED Requirements

### Requirement: Dynamic columns from model definition
The program list view SHALL build table columns dynamically from the program model definition (base fields + custom fields), using the same `buildColumnsFromModel` pattern as StudentsPage.

#### Scenario: Model loaded with base and custom fields
- **WHEN** the program model definition is loaded and contains base fields (program_id, name, school_year) and custom fields
- **THEN** the DataTable SHALL render columns for each field, with appropriate renderers for field types (StatusBadge for selection/bool, plain text for others)

#### Scenario: Model not yet loaded
- **WHEN** the page loads and the model definition has not been fetched yet
- **THEN** the page SHALL show a loading state and fall back to default columns (program_id, name, school_year) if model loading fails

### Requirement: Query programs with filtering
The program list view SHALL query program entities from DataCore using SQL via `postQuery()`, with support for text filtering on base fields.

#### Scenario: Filter by program name
- **WHEN** the user enters a search term in the name filter field and clicks Search
- **THEN** the query SHALL include `name ILIKE '%{term}%'` in the WHERE clause and display matching results

#### Scenario: Reset filters
- **WHEN** the user clicks the Reset button on the filter form
- **THEN** all filter fields SHALL be cleared and the full unfiltered list SHALL be reloaded

### Requirement: Sorting and pagination
The program list view SHALL support column sorting (ascending/descending toggle) and pagination with configurable page size.

#### Scenario: Sort by column
- **WHEN** the user clicks a column header
- **THEN** the data SHALL be re-queried with the corresponding ORDER BY clause, toggling between ASC and DESC

#### Scenario: Navigate pages
- **WHEN** the user clicks a pagination control
- **THEN** the data SHALL be re-queried with the appropriate OFFSET, and the current page indicator SHALL update

### Requirement: Row selection for bulk actions
The program list view SHALL support checkbox-based row selection for use with action menu operations (edit, archive, export).

#### Scenario: Select individual rows
- **WHEN** the user checks the checkbox on one or more program rows
- **THEN** the selected count SHALL display in the toolbar and action menu items SHALL become enabled

#### Scenario: Select all on current page
- **WHEN** the user checks the "select all" header checkbox
- **THEN** all rows on the current page SHALL be selected

### Requirement: Table preferences persistence
The program list view SHALL persist user preferences (sort column, sort direction, page size, hidden columns) using `useTablePreferences` with a `'program'` key.

#### Scenario: Preferences restored on reload
- **WHEN** the user returns to the Programs page after navigating away
- **THEN** the table SHALL restore the previously saved sort, page size, and hidden columns

### Requirement: Action menu with disabled states
The three-dots action menu SHALL always display action items (Edit Selected, Delete Selected, Export Selected), greyed out when no rows are selected, enabled when rows are selected.

#### Scenario: No selection
- **WHEN** no program rows are selected
- **THEN** action items SHALL be visible but disabled (greyed out, not clickable)

#### Scenario: With selection
- **WHEN** one or more program rows are selected
- **THEN** action items SHALL be enabled and clickable
