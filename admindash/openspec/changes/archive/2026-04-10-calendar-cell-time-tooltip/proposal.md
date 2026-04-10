## Why

The Program calendar views (month and week) currently render each event as a compact chip showing only the program name. Users cannot see when an event starts or ends without opening the edit modal, and there is no way to preview secondary details like status or location. This makes the calendar hard to scan at a glance and forces unnecessary clicks to gather basic scheduling context.

## What Changes

- Display a concise time label on each calendar chip when the program has non-empty `start_time` / `end_time` fields — e.g. `9a`, `9–10a`, or `9:30a–10:30a`. Date fields are not consulted; the chip's position in the calendar already conveys the day.
- On hover, show a rich tooltip over the chip containing: program name, time range, location, status, and days-of-week (when available).
- Tooltip behavior: opens after a short hover delay, anchors to the chip, dismisses on mouse-out or Escape, and does not interfere with click-to-edit.
- Gracefully degrade when fields are missing: chips without time info show only the name; tooltip omits missing rows rather than showing blanks.
- Apply consistently to both `ProgramMonthView` and `ProgramWeekView`, including chips inside the month-view "+N more" popover.

## Capabilities

### New Capabilities
- `program-calendar-cell-details`: Time-aware chip rendering and hover tooltip for the Program calendar views, covering both month and week layouts.

### Modified Capabilities
<!-- None. No existing admindash spec governs the Program calendar views. -->

## Impact

- **Affected code**: `admindash/frontend/src/components/ProgramMonthView.tsx`, `admindash/frontend/src/components/ProgramWeekView.tsx`, `admindash/frontend/src/components/ProgramCalendar.css`, plus three new files: `CalendarChip.tsx`, `CalendarChipTooltip.tsx`, `calendarTime.ts`.
- **Data**: No backend or API changes. Uses existing fields already fetched in the program query (`name`, `program_id`, `_status`, `location`, `start_time`, `end_time`, `days_of_week`). Fields are read defensively — missing values are tolerated.
- **i18n**: New translation keys for tooltip row labels ("When", "Where", "Status", "Days") in `en-US` and `zh-CN`.
- **No breaking changes.** The native `title` attribute is replaced by a custom tooltip; click-to-edit behavior is preserved.
