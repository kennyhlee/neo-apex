## ADDED Requirements

### Requirement: Week view as default calendar
The calendar SHALL default to a week view — a 7-column CSS Grid showing one week at a time with program chips listed per day.

#### Scenario: Calendar renders current week
- **WHEN** the user switches to Week view
- **THEN** the calendar SHALL display a 7-day grid for the current week, with day headers (Mon-Sun) and program chips listed under each day

#### Scenario: Navigate between weeks
- **WHEN** the user clicks the previous or next week button
- **THEN** the calendar SHALL update to display the target week and re-query programs for that date range

#### Scenario: Jump to today
- **WHEN** the user clicks the "Today" button
- **THEN** the calendar SHALL navigate to the week containing today's date

### Requirement: Month view with overflow handling
The calendar SHALL provide a month view as a secondary compact overview, with a cap of 2-3 program chips per day cell and a "+N more" link for overflow.

#### Scenario: Month view renders current month
- **WHEN** the user switches to Month view
- **THEN** the calendar SHALL display a month grid with day numbers and up to 3 program chips per cell

#### Scenario: Overflow with "+N more" link
- **WHEN** a day cell has more than 3 programs
- **THEN** the cell SHALL show 2-3 chips and a "+N more" link for the remaining programs

#### Scenario: Click "+N more" opens popover
- **WHEN** the user clicks the "+N more" link on a day cell
- **THEN** a popover SHALL open listing all programs for that day

#### Scenario: Click program in popover navigates to week
- **WHEN** the user clicks a program in the "+N more" popover
- **THEN** the view SHALL switch to Week view showing the week containing that day, and open the edit modal for that program

#### Scenario: Navigate between months
- **WHEN** the user clicks the previous or next month button
- **THEN** the calendar SHALL update to display the target month

### Requirement: Programs displayed on date fields
Programs SHALL be rendered as colored chips on the calendar based on date-type fields from the model definition. The calendar SHALL auto-detect date and datetime fields from the model.

#### Scenario: Program with start and end dates
- **WHEN** a program has both a start date and an end date field
- **THEN** the program SHALL appear on each day within that range (week view) or as a spanning bar (month view)

#### Scenario: Program with single date field
- **WHEN** a program has only one date field
- **THEN** the program SHALL appear as a chip on that single date

#### Scenario: Program with no date fields
- **WHEN** no date-type fields exist in the program model definition
- **THEN** the calendar views SHALL display an empty state message indicating that date fields need to be added to the program model via Papermite

### Requirement: Calendar program interaction
Clicking a program chip on the calendar SHALL open the edit modal for that program.

#### Scenario: Click program chip in week view
- **WHEN** the user clicks a program chip in the week view
- **THEN** the edit modal SHALL open pre-populated with that program's data

#### Scenario: Click program chip in month view
- **WHEN** the user clicks a program chip in the month view
- **THEN** the edit modal SHALL open pre-populated with that program's data

### Requirement: Today indicator
The calendar SHALL visually highlight the current date.

#### Scenario: Today cell styling in week view
- **WHEN** the week view displays a week containing today's date
- **THEN** today's column SHALL have a distinct visual highlight

#### Scenario: Today cell styling in month view
- **WHEN** the month view displays a month containing today's date
- **THEN** today's cell SHALL have a distinct visual highlight
