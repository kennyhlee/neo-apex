## 1. Shared utilities

- [x] 1.1 Add `formatTimeRangeFromStrings(startValue, endValue)` to `frontend/src/components/calendarTime.ts` — takes raw `start_time`/`end_time` string values from the row, returns `""` when either is unset/unparseable, otherwise produces compact lowercase labels (`9a`, `9:30a`, `9–10a`, `9:30a–10:30a`).
- [x] 1.2 Add a permissive `parseTimeString` helper (file-local) accepting 24-hour `HH:MM[:SS][.ffffff]` (Python `datetime.time` serialization) AND 12-hour `H[:MM] AM/PM` forms. Returns `{h, m}` or `null`.
- [x] 1.3 Date-field probing (`parseDateTimeValue` / `formatTimeRange`) was initially implemented for the original spec but removed when the data model turned out to use split `start_date` + `start_time` fields. Final code only parses raw time strings.

## 2. Extract shared CalendarChip component

- [x] 2.1 Create `frontend/src/components/CalendarChip.tsx` exporting a default `CalendarChip` component with props `{ program, onEdit, extraClassName? }`. _(Final: no startField/endField props — time is read directly from `program.start_time` / `program.end_time`.)_
- [x] 2.2 Move tint-hash logic (`getTintForProgram`) from the two view files into the shared component (or a sibling helper).
- [x] 2.3 Render the chip's primary line as `name ?? program_id ?? '(unnamed)'` and the secondary line as `formatTimeRangeFromStrings(program.start_time, program.end_time)` when non-empty; omit the secondary line entirely otherwise.
- [x] 2.4 Wire `onClick={() => onEdit(program)}` preserving existing behavior. Remove the `title={label}` attribute — the new tooltip replaces it.

## 3. Tooltip component

- [x] 3.1 Create `frontend/src/components/CalendarChipTooltip.tsx`. Accepts `{ anchorRect: DOMRect | null, program: DataRow, onClose }` and renders via `ReactDOM.createPortal` into `document.body`.
- [x] 3.2 Implement row rendering for **Name** (header), **When** (time range from `start_time`/`end_time`; no date), **Where** (`location`), **Status** (`_status`), **Days** (`days_of_week` — local `parseDaysOfWeek`, sorted comma-separated day names). Each row is conditional on a non-empty value.
- [x] 3.3 Position the tooltip below-and-right of `anchorRect`, flipping to above/left if it would overflow the viewport.
- [x] 3.4 Dismiss on `Escape` via a `keydown` listener mounted only while visible.

## 4. Hover wiring inside CalendarChip

- [x] 4.1 In `CalendarChip`, track `isHovering` state with a ~250ms open delay via `setTimeout`, cleared on `mouseleave`.
- [x] 4.2 Capture the chip's bounding rect on open (via a `ref` + `getBoundingClientRect()`), pass to `CalendarChipTooltip`.
- [x] 4.3 Ensure hovering onto the tooltip keeps it open — implemented by giving the tooltip `pointer-events: none` (inline style in `CalendarChipTooltip.tsx`) and closing strictly on chip mouseleave.
- [x] 4.4 Click still triggers `onEdit` — tooltip's `pointer-events: none` lets clicks pass through to the chip. Confirmed by code inspection.

## 5. Integrate into month and week views

- [x] 5.1 In `ProgramMonthView.tsx`, replace the inline chip `<button>` in the day cell's chip list with `<CalendarChip ... />`. Deleted `TINT_PAIRS` and the local `getTintForProgram`.
- [x] 5.2 Also replaced the inline chip inside the "+N more" popover list with `<CalendarChip ... />` (wraps `onEdit` to preserve `setMorePopover(null)` + `onSwitchToWeek(cell)` behavior) and passes `extraClassName="calendar-chip-popover"`.
- [x] 5.3 In `ProgramWeekView.tsx`, replaced the inline chip `<button>` with `<CalendarChip ... />`. Deleted `TINT_PAIRS` and `getTintForProgram`. Other helpers (date parsing, days-of-week, isInRange) kept — still used by `getProgramsForDay`.
- [x] 5.4 Neither view passes field-definition props to `CalendarChip` — time is read directly from `program.start_time` / `program.end_time` inside the chip.

## 6. Styles

- [x] 6.1 Added `.calendar-chip-name` + `.calendar-chip-time` rules. Relaxed parent `.calendar-chip` (removed `white-space:nowrap`/`text-overflow`, added `line-height:1.2`) so children manage their own ellipsis.
- [x] 6.2 Added `.calendar-chip-tooltip`: `bg-card`, `border-primary`, `shadow-elevated`, `radius-md`, max-width 260px, z-index 200.
- [x] 6.3 Added `.calendar-chip-tooltip-title`, `.calendar-chip-tooltip-row`, `.calendar-chip-tooltip-label`, `.calendar-chip-tooltip-value`.
- [x] 6.4 Tooltip is portaled to `document.body` so month-cell `overflow:hidden` cannot clip it. z-index 200 is above the `.calendar-month-popover` (z-index 150).

## 7. i18n

- [x] 7.1 Add translation keys to `frontend/src/i18n/translations.ts` (en-US): `program.calendarTooltipWhen`, `program.calendarTooltipWhere`, `program.calendarTooltipStatus`, `program.calendarTooltipDays`. _(Note: admindash i18n is a TS file, not separate JSON files)_
- [x] 7.2 Add matching Chinese keys to `frontend/src/i18n/translations.ts` (zh-CN).
- [x] 7.3 Use `t(...)` from `useTranslation` in `CalendarChipTooltip` for each row label.

## 8. Verification

- [x] 8.1 `npm run lint` — 7 errors all pre-existing (see list in Batch C notes); zero new issues introduced.
- [x] 8.2 `npm run build` — passes (`✓ built in 192ms`; index bundle 313.56 kB, CSS 38.11 kB). Required deleting a pre-existing dangling symlink `admindash/frontend/public/test_user.json` that pointed to a file removed in commit d9b928d.
- [ ] 8.3 Manual smoke test: seed a program with `datetime` start/end, `location`, `_status`, and `days_of_week`; verify chip shows compact time, tooltip shows all four rows, hover delay feels right, click still opens edit modal. _(User to perform.)_
- [ ] 8.4 Manual smoke test: program with plain `date` start field — chip has no time line, tooltip shows only Name + When (date-only). _(User to perform.)_
- [ ] 8.5 Manual smoke test: chip inside month-view "+N more" popover also shows tooltip. _(User to perform.)_
- [ ] 8.6 Toggle language to zh-CN and verify row labels render in Chinese. _(User to perform.)_
