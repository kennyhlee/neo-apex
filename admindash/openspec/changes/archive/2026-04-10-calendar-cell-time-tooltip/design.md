## Context

`ProgramMonthView` and `ProgramWeekView` render program events as colored chips. Today each chip shows only `name ?? program_id` and uses the native browser `title` attribute for hover text, which is slow to appear, unstyled, and cannot show multiple fields. The Program domain model stores scheduling info in separate `start_date`/`end_date` (date) and `start_time`/`end_time` (string) base fields — the time columns are invisible to the calendar today. Secondary fields like `_status`, `location`, and `days_of_week` are present on the row but never surfaced in the calendar UI either.

Both views share identical chip-rendering logic and live in the same folder, styled by `ProgramCalendar.css`. The month view also reuses the chip markup inside its "+N more" popover.

## Goals / Non-Goals

**Goals:**
- Show start/end time on the chip when the underlying field carries a time component, using a compact format that fits inside the existing chip width.
- Show a rich hover card with name, status, location, full when/where details, and days-of-week — reusing the same data already fetched.
- Share rendering logic between month and week views so both stay in sync.
- Preserve click-to-edit behavior and keyboard accessibility (Escape dismisses the tooltip).

**Non-Goals:**
- No backend, API, or model changes. We only use fields the query already returns.
- No drag-to-reschedule, no inline editing inside the tooltip, no multi-day chip spans beyond what already exists.
- No new tooltip library dependency. We'll build a small lightweight component local to admindash.
- No change to chip color assignment or overall calendar layout.

## Decisions

**1. Read `start_time` / `end_time` directly from the row; do not consult date fields.**
The Program domain model (`papermite/backend/app/models/domain.py` commit `36c2e4f`) stores schedule info in four separate base fields: `start_date`, `end_date` (typed as `date`) and `start_time`, `end_time` (typed as `str` in the finalized model because papermite's `_infer_field_type` has no `*_time` rule). The calendar cell's position already conveys the day, so date is redundant on the chip. We read `row.start_time` / `row.end_time` directly, by name. Alternative considered: detect a `datetime`-typed field and parse its time portion — rejected because the data model uses split `date` + `time` fields and would never provide one.

**2. Compact time format.**
Use lowercase abbreviated 12-hour: `9a`, `9:30a`, `9–10a`, `9:30a–10:30a`. Drop the minutes when `:00`, drop the leading meridiem when both ends share it. Rationale: chips are narrow (~110–140px); a full `9:00 AM – 10:30 AM` would wrap or truncate the program name. This can be revisited later if users want a locale-aware format — for now it's a single formatter in a shared util.

**3. Permissive time-string parser.**
Python `datetime.time` serializes to `"HH:MM:SS"` (or with microseconds), but AI extraction may also produce `"9:30 AM"` or `"9am"`. The parser in `calendarTime.ts` accepts both 24-hour `HH:MM[:SS][.ffffff]` and 12-hour `H[:MM] AM/PM` forms. Unparseable values return `null`, producing an empty time label (no throw, no crash).

**4. Build a small custom `CalendarChipTooltip` component; no library.**
AdminDash already avoids CSS-in-JS and runtime UI libs (see CLAUDE.md). A ~130-line React component using `ReactDOM.createPortal` into `document.body` with an absolutely-positioned div anchored via `getBoundingClientRect()` is enough. It opens after a ~250ms hover delay, closes on `mouseleave` (handled by the chip, not the tooltip), and on `Escape`. The tooltip itself has `pointer-events: none` so clicks pass through to the chip. Alternative considered: reuse the existing month-view "+N more" popover — rejected because that popover is click-triggered and modal-ish; hover semantics differ.

**5. Share chip rendering via a `CalendarChip` component.**
Extract the current inline `<button className="calendar-chip">...</button>` from both views into `CalendarChip.tsx`. It takes `{ program, onEdit, extraClassName? }` and handles tint, label, time sub-label, and tooltip wiring. Month view, week view, AND the month "+N more" popover all use it. This removes the existing duplication between month and week and ensures the tooltip behavior is identical everywhere. Alternative considered: inline the tooltip in each view — rejected because the chip already appears in three places and we'd drift.

**6. Tooltip field list is hardcoded but defensive.**
The tooltip shows a fixed list of rows: **Name** (header), **When** (compact time range from `start_time`/`end_time`; no date), **Where** (from `location`), **Status** (from `_status`), **Days** (from `days_of_week`). Missing fields are omitted rather than shown as blank. Rationale: the Program model is customer-configurable, but these five are the ones users asked for and map to well-known conventional names. We read them defensively via `row[key]` with `String()` coercion, the same pattern existing code uses.

## Risks / Trade-offs

- **Risk:** The chip gets visually busy when time is shown, making the name harder to read. → **Mitigation:** Render the time as a small, muted second line inside the chip (not inline with the name). If the chip height becomes an issue on dense month cells, the time line is omitted on month view (month view already caps at 3 chips with "+N more"; the tooltip still shows full time).
- **Risk:** Portal-free tooltip can be clipped by the month cell's `overflow: hidden` container. → **Mitigation:** Either remove `overflow: hidden` from the chip's row container (keeping it on the cell itself) or render the tooltip via `createPortal` into `document.body`. Prefer portal for simplicity and correctness.
- **Risk:** Hardcoded field names (`location`, `_status`, `days_of_week`) won't match every customer's model. → **Mitigation:** The tooltip omits rows whose values are nullish/empty, so misses degrade gracefully. A follow-up change can make the tooltip configurable via model metadata.
- **Risk:** Hover tooltips are inaccessible on touch devices. → **Mitigation:** On touch (no `hover` media query), keep the existing click-to-edit behavior as the primary path; the tooltip simply never shows. A long-press variant is out of scope for this change.
- **Trade-off:** Extracting `CalendarChip` into its own file touches both views at once, slightly enlarging the diff. Accepted because it prevents ongoing duplication and keeps the tooltip behavior consistent across month, week, and the "+N more" popover.
