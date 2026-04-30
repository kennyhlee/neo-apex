## 1. API Client Functions

Already done: `createStudent`, `updateStudent`, `fetchNextStudentId` consolidated into generic `createEntity`, `updateEntity`, `fetchNextEntityId`. Programs use these with `'program'`. DataCore `DEFAULT_ABBREVS` updated with `"program": "PR"`. No new API tasks needed.

## 2. UI Tokens Integration

- [ ] 2.1 Add `@neoapex/ui-tokens` dependency to `admindash/frontend/package.json` and import in `index.css` (replacing duplicated token definitions)
- [ ] 2.2 Add `--warning` and `--warning-muted` tokens to `ui-tokens/tokens.css` (currently only in admindash locally)
- [ ] 2.3 Ensure all program page CSS uses ui-tokens variables — no hardcoded colors, radii, or shadows. Use tinted pairs for program chips, accent tokens for today highlight, shadow/border tokens for popovers.

## 3. I18n Translation Keys

- [ ] 2.1 Add program-related translation keys for en-US and zh-CN in `translations.ts`

## 4. Dashboard Context

- [ ] 4.1 Add `getProgramCount()` and `invalidateProgramCount()` to DashboardContext

## 5. Program List View

- [ ] 5.1 Implement ProgramPage with model loading, dynamic column building, data querying, FilterForm, DataTable, sorting, pagination, and row selection
- [ ] 5.2 Add action menu with disabled states (Edit Selected, Delete Selected, Export Selected) and Columns toggle
- [ ] 5.3 Add `useTablePreferences('program')` for persistence of sort, page size, hidden columns
- [ ] 5.4 Add ProgramPage.css with styles for toolbar, filters, menu, and layout

## 6. Program CRUD Modals

- [ ] 6.1 Add "Add Program" modal with DynamicForm, auto-generated program ID, and create flow
- [ ] 6.2 Add "Edit Program" modal with DynamicForm pre-populated from selected row
- [ ] 6.3 Add archive confirmation dialog with multi-select support

## 7. Week View

- [ ] 7.1 Build ProgramWeekView component with 7-column CSS Grid, day headers, program chips per day
- [ ] 7.2 Add week navigation (prev/next week, "Today" button)
- [ ] 7.3 Add program chip rendering based on date-type fields from model, with click-to-edit
- [ ] 7.4 Add today column highlight
- [ ] 7.5 Add empty state for when model has no date fields

## 8. Month View

- [ ] 8.1 Build ProgramMonthView component with month CSS Grid, day cells, month navigation
- [ ] 8.2 Add program chip rendering with 2-3 chip cap per cell and "+N more" link
- [ ] 8.3 Add "+N more" popover listing all programs for a day, with click navigating to week view
- [ ] 8.4 Add today cell highlight
- [ ] 8.5 Add ProgramCalendar.css with shared calendar styles (week + month)

## 9. View Toggle

- [ ] 9.1 Add List/Week/Month view toggle buttons in toolbar, persisted via useTablePreferences

## 10. Verification

- [ ] 10.1 Run `npm run build` in admindash/frontend to confirm no TypeScript errors
- [ ] 10.2 Run `npm run lint` in admindash/frontend to confirm no lint errors
