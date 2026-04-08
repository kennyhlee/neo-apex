# Grey Out Disabled Action Menu Items — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Always show action menu items in the AdminDash Students page three-dots menu, greyed out when no student is selected, enabled when students are selected.

**Architecture:** Remove the conditional rendering guard (`selectedIds.size > 0 &&`) around the Actions section in `StudentsPage.tsx`. Add `disabled={selectedIds.size === 0}` to each action button. Add one CSS rule for the danger variant's disabled state. Existing `:disabled` CSS rules handle everything else.

**Tech Stack:** React 19, TypeScript, CSS

**OpenSpec Change:** `openspec/changes/grey-out-disabled-actions/`

---

### Task 1: Add CSS rule for danger variant disabled state

**Files:**
- Modify: `admindash/frontend/src/pages/StudentsPage.css:116-118`

The existing `.students-menu-item:disabled` rules (lines 107-114) handle greyed-out text and cursor. But `.students-menu-item-danger` (line 116-118) sets `color: var(--danger)` which would override the disabled color due to specificity. We need a rule to suppress the red color when disabled.

- [ ] **Step 1: Add the danger disabled rule**

In `admindash/frontend/src/pages/StudentsPage.css`, add the following rule immediately after the `.students-menu-item-danger` block (after line 118):

```css
.students-menu-item-danger:disabled {
  color: var(--text-tertiary);
}
```

The file should read (lines 116-122):
```css
.students-menu-item-danger {
  color: var(--danger);
}

.students-menu-item-danger:disabled {
  color: var(--text-tertiary);
}
```

- [ ] **Step 2: Verify build**

Run: `cd admindash/frontend && npm run build`
Expected: Clean build, no errors.

- [ ] **Step 3: Commit**

```bash
git add admindash/frontend/src/pages/StudentsPage.css
git commit -m "style(admindash): add disabled state for danger menu items"
```

---

### Task 2: Remove conditional rendering and add disabled attribute

**Files:**
- Modify: `admindash/frontend/src/pages/StudentsPage.tsx:539-571`

Remove the `{selectedIds.size > 0 && (<>...</>)}` wrapper so the Actions section always renders. Add `disabled={selectedIds.size === 0}` to each of the three action buttons.

- [ ] **Step 1: Replace the conditional block**

In `admindash/frontend/src/pages/StudentsPage.tsx`, replace lines 539-571:

```tsx
              {selectedIds.size > 0 && (
                <>
                  <div className="students-menu-section-label">Actions</div>
                  <button
                    className="students-menu-item"
                    onClick={() => {
                      setShowMenu(false);
                      if (selectedIds.size === 1) {
                        const entityId = [...selectedIds][0];
                        const row = data.find((r) => String(r.entity_id) === entityId);
                        if (row) setEditingEntity(row);
                      } else {
                        setShowComingSoon(true);
                      }
                    }}
                  >
                    Edit Selected
                  </button>
                  <button
                    className="students-menu-item students-menu-item-danger"
                    onClick={() => { setShowMenu(false); setShowArchiveConfirm(true); }}
                  >
                    Delete Selected
                  </button>
                  <button
                    className="students-menu-item"
                    onClick={() => { setShowMenu(false); alert('Export coming soon'); }}
                  >
                    Export Selected
                  </button>
                  <div className="students-menu-divider" />
                </>
              )}
```

With this (no conditional wrapper, `disabled` prop on each button):

```tsx
              <div className="students-menu-section-label">Actions</div>
              <button
                className="students-menu-item"
                disabled={selectedIds.size === 0}
                onClick={() => {
                  setShowMenu(false);
                  if (selectedIds.size === 1) {
                    const entityId = [...selectedIds][0];
                    const row = data.find((r) => String(r.entity_id) === entityId);
                    if (row) setEditingEntity(row);
                  } else {
                    setShowComingSoon(true);
                  }
                }}
              >
                Edit Selected
              </button>
              <button
                className="students-menu-item students-menu-item-danger"
                disabled={selectedIds.size === 0}
                onClick={() => { setShowMenu(false); setShowArchiveConfirm(true); }}
              >
                Delete Selected
              </button>
              <button
                className="students-menu-item"
                disabled={selectedIds.size === 0}
                onClick={() => { setShowMenu(false); alert('Export coming soon'); }}
              >
                Export Selected
              </button>
              <div className="students-menu-divider" />
```

- [ ] **Step 2: Verify build**

Run: `cd admindash/frontend && npm run build`
Expected: Clean build, no TypeScript errors.

- [ ] **Step 3: Verify lint**

Run: `cd admindash/frontend && npm run lint`
Expected: No lint errors.

- [ ] **Step 4: Commit**

```bash
git add admindash/frontend/src/pages/StudentsPage.tsx
git commit -m "feat(admindash): show disabled action menu items when no student selected"
```
