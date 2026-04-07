# Students Toolbar Redesign — Unified Three-Dot Menu

**Date:** 2026-04-06

## Context

The StudentsPage toolbar has too many buttons (Export, Batch Actions, Add Student, Column Settings). Column settings is currently a button that opens a popover. There's no way to act on selected rows (delete, edit).

## Design

### Toolbar Layout

Two elements only:
- **Left**: `+ Add Student` button (primary blue), anchored to the left edge
- **Right**: selection count label + `⋮` (three-dot) menu button, anchored to the right edge

Empty space between them separates "create new" from "act on existing." Everything else lives inside the ⋮ menu.

### Three-Dot Menu Structure

Right-aligned dropdown with two sections:

**ACTIONS section** — only visible when 1+ rows are selected:
- "Edit Selected" — disabled when multiple rows selected, shows tooltip "Select one student to edit". Single selection: placeholder for future edit page navigation.
- "Delete Selected" — archives selected students (sets `_status` to `archived`). Shows confirmation: "Delete {n} student(s)?"
- "Export Selected" — placeholder for future export functionality

**COLUMNS section** — always visible:
- Checkbox list of all table columns, toggling visibility (same behavior as current column popover)

When no rows are selected, only the COLUMNS section appears in the menu.

Selection count (e.g. "3 selected") displayed as label text next to the ⋮ button, only when rows are selected.

### DataTable Selection Exposure

Currently `selectedIds` is internal state in DataTable. To enable bulk actions from StudentsPage:

- Add `onSelectionChange?: (ids: Set<string>) => void` callback prop to DataTable
- StudentsPage holds `selectedIds` state, passes to DataTable and receives changes
- Add `selectedIds?: Set<string>` prop so DataTable can be controlled externally

### Archive Endpoint (DataCore)

**New endpoint**: `POST /api/entities/{tenant_id}/{entity_type}/archive`

Request:
```json
{
  "entity_ids": ["id1", "id2", "id3"]
}
```

Response: `200 OK` with `{"archived": 3}`

**Store method**: `store.archive_entity(tenant_id, entity_type, entity_id)` — updates `_status` to `archived` on the active version record in LanceDB. No new version created.

### Delete Flow

1. User selects rows via checkboxes in DataTable
2. Opens ⋮ menu, sees ACTIONS section with "Delete Selected"
3. Clicks "Delete Selected" → confirmation dialog: "Delete {n} student(s)?"
4. On confirm → calls `POST /api/entities/{tenant_id}/student/archive` with entity_ids
5. On success → refreshes student list, clears selection

### Edit Flow (Placeholder)

- Single selection + "Edit Selected" → placeholder (console.log or alert for now, edit page is future work)
- Multiple selection → "Edit Selected" is disabled

### Files Changed

| File | Action | Responsibility |
|---|---|---|
| `datacore/src/datacore/store.py` | Modify | Add `archive_entity()` method |
| `datacore/src/datacore/api/routes.py` | Modify | Add `POST /api/entities/{tenant_id}/{entity_type}/archive` |
| `datacore/tests/test_unified_api.py` | Modify | Add archive endpoint tests |
| `admindash/frontend/src/components/DataTable.tsx` | Modify | Expose selection via props |
| `admindash/frontend/src/pages/StudentsPage.tsx` | Modify | Replace toolbar with ⋮ menu, add archive logic |
| `admindash/frontend/src/pages/StudentsPage.css` | Modify | Restyle toolbar, add menu styles |
| `admindash/frontend/src/api/client.ts` | Modify | Add `archiveStudents()` function |

### Out of Scope

- Restore/unarchive UI
- Actual edit page for students
- Actual export functionality
- Batch edit for multiple students
