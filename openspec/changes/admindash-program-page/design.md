## Context

AdminDash has a working StudentsPage that demonstrates the full pattern: load model definition → build dynamic columns → query entities via SQL → render DataTable with filtering/sorting/pagination → CRUD via modals. The ProgramPage is currently a placeholder. DataCore already supports program entities via the same generic CRUD endpoints used for students. The API client (`client.ts`) has student-specific functions that need program equivalents.

The calendar view is a new UI pattern not yet used in AdminDash. Programs have date-related fields (school_year, and potentially start_date/end_date from custom fields) that make a calendar visualization useful for operations staff.

## Goals / Non-Goals

**Goals:**
- Full CRUD for program entities following established AdminDash patterns
- List view with dynamic columns from model definition (same pattern as StudentsPage)
- Week view (default calendar) showing daily program detail with ample vertical space
- Month view for navigation/overview with "+N more" overflow handling
- Toggle between List / Week / Month views
- Consistent UX with existing pages (filtering, sorting, pagination, modals)

**Non-Goals:**
- Backend changes — DataCore already supports all needed operations
- Drag-and-drop calendar editing
- Recurring program scheduling or complex calendar interactions
- Program enrollment management (separate future feature)
- Test framework setup (AdminDash has no test framework configured)

## Design Token Usage

All program page styling MUST use `@neoapex/ui-tokens` CSS variables. Key token mappings for new UI elements:

- **Calendar grid**: `--bg-secondary` (cell background), `--border-primary` (grid lines), `--bg-tertiary` (weekend/inactive cells)
- **Program chips**: Use tinted pairs — `--tint-blue-bg`/`--tint-blue-text`, `--tint-green-bg`/`--tint-green-text`, `--tint-amber-bg`/`--tint-amber-text`, `--tint-pink-bg`/`--tint-pink-text` — cycling through programs by index
- **Today highlight**: `--accent-muted` (background), `--border-accent` (border)
- **View toggle buttons**: `--accent` (active), `--bg-tertiary` (inactive), `--text-primary`/`--text-secondary`
- **"+N more" popover**: `--bg-card`, `--shadow-elevated`, `--border-primary`, `--radius-md`
- **Disabled states**: `--text-tertiary`, existing `:disabled` patterns
- **Section labels**: `--text-tertiary`, existing `.students-menu-section-label` pattern

If new tokens are needed (e.g., `--warning` for status), they should be added to `ui-tokens/tokens.css` rather than defined locally.

## Decisions

**1. Mirror StudentsPage architecture for list view**
- Reuse `useModel()`, `buildColumnsFromModel()`, `DataTable`, `FilterForm`, `DynamicForm` patterns
- Use consolidated generic API functions (`createEntity`, `updateEntity`, `fetchNextEntityId`, `archiveEntities`) with `'program'` entity type
- Rationale: API client functions have been generalized. No new API functions needed.

**2. Pure CSS calendar — no external library**
- Build week and month calendar views using CSS Grid
- **Week view (default calendar)**: 7-column grid showing one week at a time. Program chips listed per day with ample vertical space. Prev/next week navigation + "Today" button.
- **Month view**: Compact overview grid. Shows 2-3 program chips per day cell, with a "+N more" link for overflow. Clicking "+N more" opens a popover listing all programs for that day; clicking a program in the popover navigates to the week containing that day.
- Rationale: AdminDash uses no external UI libraries. Week view is the primary schedule view — it provides enough space per day to show many programs without clutter. Month view is for quick navigation and overview.

**3. View toggle as tab-style buttons in the toolbar**
- Three buttons ("List" / "Week" / "Month") in the toolbar area, styled like the existing filter/action area
- Active view persisted in `useTablePreferences` alongside other table state
- Rationale: Simple, discoverable, consistent with toolbar patterns. No routing changes needed — all views live on `/programs`.

**4. Calendar date field selection**
- Calendar uses `school_year` as the primary grouping, with `start_date` and `end_date` custom fields (if present in model) for positioning on the calendar
- If no date fields exist in the model, calendar view shows a message prompting the user to add date fields via Papermite
- Rationale: Program models are tenant-defined. Not all tenants will have date fields. The calendar should degrade gracefully.

**5. Reuse AddStudentModal pattern for AddProgramModal**
- Web form tab using DynamicForm (no "Upload Document" tab — programs aren't extracted from documents)
- Auto-generated program ID via `fetchNextEntityId(tenantId, 'program')`
- Rationale: Simpler than student creation (no OCR), but same form infrastructure.

## Risks / Trade-offs

- [Calendar without date fields] Tenant model may not have start/end dates → Calendar shows empty state with guidance message
- [Custom fields variety] Different tenants may have very different program models → Dynamic columns + DynamicForm handle this by design
- [Large program counts] Month view could be cluttered → Cap at 2-3 chips per cell with "+N more" popover; week view has ample space per day
- [No test framework] Cannot add automated tests → Manual verification via build + lint + visual testing
