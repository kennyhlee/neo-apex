## 1. CSS: Handle Danger Variant When Disabled

- [ ] 1.1 Add `.students-menu-item-danger:disabled` rule to `StudentsPage.css` that sets `color: var(--text-tertiary)` so the red Delete button appears greyed out when disabled

## 2. Remove Conditional Rendering and Add Disabled Attribute

- [ ] 2.1 In `StudentsPage.tsx`, remove the `{selectedIds.size > 0 && (...)}` conditional wrapper around the Actions section so action items, section label, and divider always render
- [ ] 2.2 Add `disabled={selectedIds.size === 0}` to each action button (Edit Selected, Delete Selected, Export Selected)

## 3. Verification

- [ ] 3.1 Run `npm run build` in admindash/frontend to confirm no TypeScript errors
- [ ] 3.2 Run `npm run lint` in admindash/frontend to confirm no lint errors
