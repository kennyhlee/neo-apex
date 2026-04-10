# program-calendar-cell-details Specification

## Purpose
TBD - created by archiving change calendar-cell-time-tooltip. Update Purpose after archive.
## Requirements
### Requirement: Calendar chip SHALL display start/end time when set on the program

When a program row has a non-empty `start_time` value, the chip SHALL render a compact time label below the program name. When `end_time` is also non-empty, the chip SHALL render a `start–end` time range. Date fields (`start_date`, `end_date`) are intentionally NOT consulted — the chip's position in the calendar already conveys the day.

The `start_time` / `end_time` values MAY be stored as strings from Python `datetime.time` serialization (e.g. `"09:00:00"`, `"09:00:00.000000"`) or from AI extraction (e.g. `"9:30 AM"`, `"9am"`). The parser SHALL accept both 24-hour `HH:MM[:SS]` form and 12-hour `H:MM AM/PM` form, and SHALL fall back to no time label when the value is unparseable.

The time format SHALL be lowercase 12-hour, dropping zero minutes and collapsing a shared meridiem:
- `9a`, `9:30a`, `5:15p` for a single time
- `9–10a`, `9:30a–10:30a`, `11a–1p` for a range

#### Scenario: start_time with integer hour, no end_time
- **WHEN** a program has `start_time = "09:00:00"` and no `end_time`
- **THEN** the chip displays the program name and the time label `9a`

#### Scenario: start_time and end_time share a meridiem
- **WHEN** a program has `start_time = "09:30:00"` and `end_time = "10:30:00"`
- **THEN** the chip displays the program name and the time label `9:30a–10:30a`

#### Scenario: start_time and end_time cross meridiem
- **WHEN** a program has `start_time = "11:00"` and `end_time = "13:00"`
- **THEN** the chip displays the program name and the time label `11a–1p`

#### Scenario: No start_time set
- **WHEN** a program has no `start_time` (null, undefined, or empty string)
- **THEN** the chip displays only the program name, with no time label

#### Scenario: Unparseable time value
- **WHEN** a program's `start_time` cannot be parsed as a time
- **THEN** the chip displays only the program name, with no time label, and does not throw

#### Scenario: Date fields are ignored
- **WHEN** a program has `start_date = "2026-04-10"` but no `start_time`
- **THEN** the chip displays only the program name; the date is not formatted onto the chip

### Requirement: Calendar chip SHALL show a hover tooltip with rich details

Hovering a calendar chip SHALL display a tooltip after a short delay (~250ms) containing program details drawn from the row's fields. The tooltip SHALL include the following rows when the corresponding value is present and non-empty, and SHALL omit rows whose value is missing or empty:

- **Name** (header): from `name`, falling back to `program_id`
- **When**: time range formatted from `start_time` / `end_time` (same formatter as the chip). No date is shown — the calendar cell already conveys the day.
- **Where**: from `location`
- **Status**: from `_status`
- **Days**: from `days_of_week`

The tooltip SHALL dismiss on mouseleave from the chip and on the Escape key. Clicking the chip SHALL continue to open the program edit modal; opening the tooltip SHALL NOT suppress or delay the click.

The tooltip SHALL apply to chips in all three rendering contexts: `ProgramMonthView` day cells, `ProgramWeekView` day columns, and the `ProgramMonthView` "+N more" overflow popover.

#### Scenario: Hover reveals tooltip with available fields
- **WHEN** the user hovers a chip for a program whose row has `name = "Art Class"`, `_status = "active"`, `location = "Room 204"`, `start_time = "09:00:00"`, and `end_time = "10:00:00"`
- **THEN** after the hover delay, a tooltip appears showing rows for Name, When (`9–10a`), Where, and Status

#### Scenario: Missing optional fields are omitted
- **WHEN** the user hovers a chip for a program that has only a `name` and no other fields populated
- **THEN** the tooltip shows only the Name header, with no When, Where, Status, or Days rows

#### Scenario: Tooltip dismisses on mouseleave
- **WHEN** the tooltip is visible and the user moves the cursor off the chip
- **THEN** the tooltip disappears

#### Scenario: Tooltip dismisses on Escape
- **WHEN** the tooltip is visible and the user presses the Escape key
- **THEN** the tooltip disappears

#### Scenario: Click-to-edit is preserved
- **WHEN** the user clicks a chip (with or without a visible tooltip)
- **THEN** the program edit modal opens, the same as before this change

#### Scenario: Tooltip appears inside the "+N more" popover
- **WHEN** the user opens the month-view "+N more" popover and hovers a chip inside it
- **THEN** the same tooltip appears for that chip

### Requirement: Calendar chip rendering SHALL be shared between month and week views

Chip markup, color assignment, time-label formatting, and tooltip wiring SHALL live in a single shared `CalendarChip` component used by `ProgramMonthView`, `ProgramWeekView`, and the month-view "+N more" popover. Changes to chip appearance or tooltip behavior SHALL only require editing the shared component.

#### Scenario: Single source of truth
- **WHEN** a developer modifies the time-label formatter or tooltip field list
- **THEN** the change takes effect in all three rendering locations without further edits

### Requirement: Calendar tooltip labels SHALL be translatable

Row labels inside the tooltip ("When", "Where", "Status", "Days") SHALL be provided by the existing `useTranslation` hook, with entries added to `en-US` and `zh-CN` translation files.

#### Scenario: Localized labels
- **WHEN** the user has selected the `zh-CN` locale and hovers a chip
- **THEN** the tooltip row labels are rendered in Chinese

