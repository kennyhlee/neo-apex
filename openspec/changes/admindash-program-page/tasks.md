## 1. API Client Functions

Already done: `createStudent`, `updateStudent`, `fetchNextStudentId` consolidated into generic `createEntity`, `updateEntity`, `fetchNextEntityId`. Programs use these with `'program'`. DataCore `DEFAULT_ABBREVS` updated with `"program": "PR"`. No new API tasks needed.

## 2. UI Tokens Integration

- [x] 2.1 Add `@neoapex/ui-tokens` dependency to `admindash/frontend/package.json` and import in `index.css` (replacing duplicated token definitions)
- [x] 2.2 Add `--warning` and `--warning-muted` tokens to `ui-tokens/tokens.css` (currently only in admindash locally)
- [x] 2.3 Ensure all program page CSS uses ui-tokens variables — no hardcoded colors, radii, or shadows. Use tinted pairs for program chips, accent tokens for today highlight, shadow/border tokens for popovers.

## 3. I18n Translation Keys

- [x] 2.1 Add program-related translation keys for en-US and zh-CN in `translations.ts` (includes menu/toolbar keys added for full M9 compliance: `editTitle`, `selectedSuffix`, `moreActions`, `actionsLabel`, `columnsLabel`, `editSelected`, `deleteSelected`, `exportSelected`, `filterAll`)

## 4. Dashboard Context

- [x] 4.1 Add `getProgramCount()` and `invalidateProgramCount()` to DashboardContext

## 5. Program List View

- [x] 5.1 Implement ProgramPage with model loading, dynamic column building, data querying, FilterForm, DataTable, sorting, pagination, and row selection
- [x] 5.2 Add action menu with disabled states (Edit Selected, Delete Selected, Export Selected) and Columns toggle
- [x] 5.3 Add `useTablePreferences` for program with `namespace: 'program'` + `defaultSortBy: 'name'` — persists sort, page size, hidden columns in a program-scoped slot (no longer collides with the Students table)
- [x] 5.4 Add ProgramPage.css with styles for toolbar, filters, menu, and layout

## 6. Program CRUD Modals

- [x] 6.1 Add "Add Program" modal with DynamicForm, auto-generated program ID, and create flow
- [x] 6.2 Add "Edit Program" modal with DynamicForm pre-populated from selected row
- [x] 6.3 Add archive confirmation dialog with multi-select support

## 7. Week View

- [x] 7.1 Build ProgramWeekView component with 7-column CSS Grid, day headers, program chips per day
- [x] 7.2 Add week navigation (prev/next week, "Today" button)
- [x] 7.3 Add program chip rendering based on date-type fields from model, with click-to-edit (opens the edit modal per spec C11)
- [x] 7.4 Add today column highlight
- [x] 7.5 Add empty state for when model has no date fields

## 8. Month View

- [x] 8.1 Build ProgramMonthView component with month CSS Grid, day cells, month navigation
- [x] 8.2 Add program chip rendering with 2-3 chip cap per cell and "+N more" link
- [x] 8.3 Add "+N more" popover listing all programs for a day, with click navigating to week view
- [x] 8.4 Add today cell highlight
- [x] 8.5 Add ProgramCalendar.css with shared calendar styles (week + month)

## 9. View Toggle

- [x] 9.1 Add List/Week/Month view toggle buttons in toolbar, persisted via useTablePreferences

## 10. Verification

- [x] 10.1 Run `npm run build` in admindash/frontend to confirm no TypeScript errors — PASSES clean.
- [~] 10.2 Run `npm run lint` in admindash/frontend. The 2 lint errors touching this change's files (`ProgramWeekView.tsx`, `useTablePreferences.ts`) were fixed by converting setState-in-effect to the React-recommended adjust-state-during-render pattern. 5 pre-existing systemic errors remain in shared infra (`AuthContext`, `ModelContext`, `DashboardContext`, `DynamicForm`) — `react-refresh/only-export-components` on every context file and two older `set-state-in-effect` cases. These are blame-confirmed to predate this change (authored 2026-03-22 → 2026-04-07) and require a codebase-wide refactor (splitting hooks out of context files); tracked as a separate follow-up.

## Post-implementation spec-compliance fixes (2026-07-15)

Verification against the delta specs surfaced three deviations, all now fixed:
- **C11**: calendar chip click now opens the **edit** modal (was a read-only detail modal). The dead view-only modal + `viewingEntity` state were removed.
- **L8**: `useTablePreferences` is now namespaced per entity type — Programs and Students no longer clobber each other's persisted table state.
- **M9**: hardcoded English menu/toolbar strings replaced with i18n keys (en-US + zh-CN).

Note: StudentsPage shares the same M9 hardcoded-string gap for its own menu/toolbar (pre-existing pattern); bringing it to full i18n parity is tracked as a separate follow-up.
