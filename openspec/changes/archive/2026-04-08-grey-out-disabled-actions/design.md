## Context

The AdminDash Students page (`StudentsPage.tsx`) has an inline three-dots action menu with two sections: Actions (Edit Selected, Delete Selected, Export Selected) and Columns (toggle visibility). The Actions section is currently conditionally rendered with `{selectedIds.size > 0 && (...)}`, completely hiding it when no rows are selected.

## Goals / Non-Goals

**Goals:**
- Always render action menu items so users can discover available actions
- Visually communicate disabled state (greyed out, non-interactive) when no selection exists
- Enable action items when selection criteria are met

**Non-Goals:**
- Changing the menu's position, layout, or the Columns section
- Adding new action items or changing existing action behavior
- Refactoring the menu into a separate reusable component

## Decisions

**1. Replace conditional rendering with native `disabled` attribute**
- Remove `{selectedIds.size > 0 && (...)}` guard around the Actions section
- Add `disabled={selectedIds.size === 0}` to each action `<button>`
- Rationale: The CSS already defines `.students-menu-item:disabled` and `.students-menu-item:disabled:hover` styles (lines 107-114 of StudentsPage.css). No new CSS class is needed — the native `disabled` attribute activates existing styles and prevents clicks natively.

**2. Handle danger variant when disabled**
- Add `.students-menu-item-danger:disabled` CSS rule to override the red color with `var(--text-tertiary)` when disabled
- Rationale: Without this, the `.students-menu-item-danger` rule (`color: var(--danger)`) would keep "Delete Selected" red even when disabled, which is visually inconsistent.

**3. Keep the divider always visible**
- The `<div className="students-menu-divider">` between Actions and Columns sections should always render alongside the Actions section
- Rationale: The divider is structural, separating two always-visible sections.

## Risks / Trade-offs

- [Minor visual shift] Users accustomed to the hidden menu items may notice the change → Low risk, this is an intentional UX improvement
- [Accessibility] Disabled buttons are still focusable by default → Native `disabled` attribute handles this correctly (removes from tab order in most browsers)
