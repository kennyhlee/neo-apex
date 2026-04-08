## Why

The AdminDash Students page has a three-dots action menu that completely hides action items (Edit, Delete, Export) until a student row is selected. This means users don't know what actions are available until they select something. Showing greyed-out menu items instead communicates available functionality upfront and follows standard UI conventions for disabled states.

## What Changes

- Always render action menu items (Edit Selected, Delete Selected, Export Selected) regardless of selection state
- Grey out (visually disable) action items when no student rows are selected
- Enable action items when one or more students are selected
- Keep the Columns section unchanged (it's already always visible)

## Capabilities

### New Capabilities
- `disabled-action-menu`: Disabled state styling and behavior for action menu items in the Students page three-dots menu

### Modified Capabilities

## Impact

- `admindash/frontend/src/pages/StudentsPage.tsx` — Remove conditional rendering (`selectedIds.size > 0 &&`) around the Actions section; add disabled prop/class logic
- `admindash/frontend/src/pages/StudentsPage.css` — Add disabled state styles (greyed-out text, no hover effects, cursor: not-allowed)
