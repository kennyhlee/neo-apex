## ADDED Requirements

### Requirement: Default status filter pre-selected to Active
When StudentsPage loads, the status dropdown SHALL be pre-selected to "Active" and the initial data fetch SHALL include `_status=active`.

#### Scenario: Page load
- **WHEN** user navigates to StudentsPage
- **THEN** the Status dropdown shows "Active" and only active students are displayed

#### Scenario: User selects different status
- **WHEN** user selects "Graduated" in the Status dropdown
- **THEN** data is re-fetched with `_status=graduated` and the table updates

### Requirement: Adaptive page size with user control
The default page size SHALL be 20 if the viewport can fit 20 rows; otherwise the system SHALL calculate the best-fit row count for the available vertical space. The user SHALL be able to change page size in increments of 10 (10, 20, 30, 40, 50) via a page size selector near the pagination controls.

#### Scenario: Viewport fits 20 rows
- **WHEN** viewport height allows 20 rows
- **THEN** page size defaults to 20

#### Scenario: Small viewport
- **WHEN** viewport height only fits 12 rows
- **THEN** page size defaults to 10 (rounded down to nearest valid increment)

#### Scenario: User changes page size
- **WHEN** user selects 30 from the page size selector
- **THEN** table re-fetches with limit=30 and preference is saved

### Requirement: Column order base-first then custom
Table columns SHALL be ordered with all base data fields first (left), followed by custom data fields (right). Within each group, the order SHALL follow the model definition's field order.

#### Scenario: Mixed base and custom fields
- **WHEN** student data has base fields `first_name`, `last_name`, `email` and custom fields `school_name`, `emergency_phone`
- **THEN** columns appear in order: first_name, last_name, email, school_name, emergency_phone

### Requirement: Column visibility toggle
Users SHALL be able to hide or show any column via a column settings control. Hidden columns SHALL not be rendered in the table. The column settings control SHALL show all available columns with checkboxes.

#### Scenario: User hides a column
- **WHEN** user unchecks "Email" in column settings
- **THEN** the Email column is removed from the table and preference is saved

#### Scenario: User shows a hidden column
- **WHEN** user checks "Email" in column settings
- **THEN** the Email column reappears in its original position

### Requirement: Newly added student highlighted and pinned
When a student is created via AddStudentPage and the user returns to StudentsPage, the newly created student SHALL appear at the top of the list with a visually distinct highlighted row background. The highlight and top-pinning SHALL persist until the user navigates away from StudentsPage or changes the sort field.

#### Scenario: Return from AddStudentPage after creation
- **WHEN** user creates a student and is redirected to StudentsPage
- **THEN** the new student appears as the first row with a highlighted background

#### Scenario: User changes sort field
- **WHEN** a newly added student is pinned at top and user changes sort to `first_name`
- **THEN** the highlight is removed and the student sorts into its natural position

#### Scenario: User navigates away and returns
- **WHEN** a newly added student is highlighted, user navigates to Home, then back to Students
- **THEN** no student is highlighted; normal sort order applies

### Requirement: Search pane filters by all base fields
The search pane SHALL provide input fields for all base fields returned by the model definition. Filter values SHALL be sent as query params to the datacore query endpoint. The search pane SHALL include a Search button to apply filters and a Reset button to clear all filters.

#### Scenario: User searches by name
- **WHEN** user enters "Smith" in the Last Name search field and clicks Search
- **THEN** the table shows only students whose last_name contains "Smith"

#### Scenario: User resets filters
- **WHEN** user clicks Reset
- **THEN** all search fields are cleared and the table shows the default filtered results (active students)

### Requirement: Address search supports fuzzy matching
The search pane SHALL include an Address search field. The address search SHALL match against address, city, state, and zip fields using substring matching. For example, entering a city name SHALL match students in that city.

#### Scenario: Search by city
- **WHEN** user enters "Portland" in the Address search field
- **THEN** students with "Portland" in their address, city, state, or zip are shown

### Requirement: Sort by clicking column headers
Users SHALL be able to sort the table by clicking any column header. Clicking a header SHALL toggle between ascending and descending order. The currently sorted column SHALL have a visual sort indicator.

#### Scenario: Click unsorted column
- **WHEN** user clicks the "Email" column header
- **THEN** table sorts by email ascending and shows an ascending indicator

#### Scenario: Click already-sorted column
- **WHEN** table is sorted by email ascending and user clicks "Email" header again
- **THEN** table sorts by email descending and indicator changes
