## Why

The AdminDash Programs page is currently a placeholder ("Coming soon"). Program entities already exist in the data model (DataCore stores them with model definitions from Papermite), but there is no UI for admins to create, view, edit, or delete programs. Programs are a core entity — students enroll in programs, so this page is a prerequisite for the enrollment flow.

## What Changes

- Add API client functions for program CRUD (create, update, archive, query) in `client.ts`
- Replace the placeholder `ProgramPage` with a full page featuring:
  - **List view**: DataTable with dynamic columns from model definition, filtering, sorting, pagination, row selection
  - **Calendar view**: Visual calendar showing programs by date (school year, start/end dates)
  - **View toggle**: Switch between list and calendar views
  - **Create program**: Modal with DynamicForm driven by model definition, auto-generated program ID
  - **Edit program**: Modal with DynamicForm, pre-populated with selected program data
  - **Delete (archive) programs**: Multi-select archive with confirmation dialog
- Add program-specific i18n translation keys
- Add `useTablePreferences` for program table state persistence
- Add dashboard context support for program count on home page

## Capabilities

### New Capabilities
- `program-api`: API client functions for program entity CRUD operations and queries
- `program-list-view`: DataTable-based list view with dynamic columns, filtering, sorting, pagination
- `program-calendar-view`: Calendar visualization of programs by date fields
- `program-crud-modals`: Create, edit, and archive modals for program entities

### Modified Capabilities

## Impact

- `admindash/frontend/src/api/client.ts` — Add program CRUD functions
- `admindash/frontend/src/pages/ProgramPage.tsx` — Full rewrite from placeholder
- `admindash/frontend/src/pages/ProgramPage.css` — New styles for program page + calendar
- `admindash/frontend/src/i18n/translations.ts` — Add program keys for en-US and zh-CN
- `admindash/frontend/src/contexts/DashboardContext.tsx` — Add program count cache
- No backend changes needed — DataCore already supports program entity CRUD via existing endpoints
