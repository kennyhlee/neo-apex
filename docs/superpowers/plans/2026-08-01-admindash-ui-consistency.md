# AdminDash UI Consistency + Ease-of-Use Pass Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax. On branch `feat/family-student-linking`.

**Goal:** Make admindash visually consistent and easier to use — with the explicit priority that the **student table, family table, and the student-list-under-a-family share identical column/row/cell treatment** (name cell, status badge, padding, hover, clickable affordances). Establish a small shared foundation (tokens, status badge, name cell, buttons, modal shell) and migrate the highest-impact surfaces to it.

**Architecture:** Add a canonical design-token layer so the ~30 `var(--x, #hex)` fallbacks resolve to ONE source of truth (behavior-neutral). Extract shared primitives — `StatusBadge` (className+tokens), `StudentNameCell` (avatar+name), `.btn-*` buttons, `.modal`/`.modal-overlay` shell. Make the family's student list render through the SAME `DataTable` + shared cell renderers as `StudentsPage`. Migrate app-wide hardcoded `#378ADD`→`var(--accent)` (identical value → no visual change, just consistency).

**Tech Stack:** React 19 + TS + Vite; CSS variables (no CSS-in-JS); custom i18n; Vitest for pure logic (currently 25). `@neoapex/ui-tokens` provides base tokens.

## Global Constraints

- **Behavior-preserving unless explicitly an improvement.** The ONLY intended VISUAL changes are: (a) the family student-list now matches the student table (status badge + name cell + cell styling); (b) the Family ID cell looks clickable; (c) de-duplicated buttons/modals render identically to today. Everything else keeps the same computed colors/sizes — we centralize, we don't re-theme. Keep the existing blue `#378ADD` accent.
- **Single accent source:** canonical `--accent: #378ADD`. All hardcoded `#378ADD` and `var(--color-primary,#378ADD)`/`var(--color-accent,…)` usages resolve to it.
- **One enrollment `StatusBadge`** used in the students list, the family student-list, and student detail. (The bulk-add row-status pills are a DIFFERENT semantic — batch processing state — and are OUT OF SCOPE here.)
- **No new libraries.** No functional/logic changes to data flow, API calls, or entity handling. CSS + presentational components only.
- **i18n** unaffected (no new user-facing strings except where noted). Lint baseline = 5 pre-existing errors (gate = no NEW). Vitest stays 25. Branch `feat/family-student-linking`. Frontend: `cd admindash/frontend && npm run build && npm run lint && npm run test`.
- **Scope note:** deep unification of ALL drawers' z-index and converting `BulkReviewTable` to `DataTable` are explicitly DEFERRED (documented at the end) — they carry higher risk and less visible payoff than the tasks here.

---

### Task 1: Canonical design-token layer

**Files:**
- Create: `admindash/frontend/src/styles/theme.css`
- Modify: `admindash/frontend/src/index.css` (import theme.css after the ui-tokens import)

**Interfaces:** a `:root` block defining `--accent` + aliases for every fallback token name currently used, at values matching today's fallbacks (so nothing changes visually).

- [ ] **Step 1: Create the token layer**

Create `admindash/frontend/src/styles/theme.css`:
```css
/* Canonical admindash design tokens — single source of truth.
   Values match the existing hardcoded fallbacks so this is visually neutral;
   it centralizes them so components can share ONE accent/ring/overlay/status. */
:root {
  /* Accent (brand blue) */
  --accent: #378ADD;
  --accent-hover: #2f78c4;
  --accent-ring: rgba(55, 138, 221, 0.15);   /* focus ring */
  --accent-tint: rgba(55, 138, 221, 0.06);    /* row hover / subtle bg */
  --accent-tint-strong: rgba(55, 138, 221, 0.10);

  /* Aliases for the fallback names used across the codebase */
  --color-primary: var(--accent);
  --color-accent: var(--accent);
  --color-border: var(--border-primary, #E2E8F0);
  --color-hover: var(--accent-tint);
  --color-text: var(--text-secondary, #555);
  --color-bg-subtle: var(--bg-tertiary, #F1F5F9);

  /* Overlay / layering scale */
  --overlay-bg: rgba(0, 0, 0, 0.45);
  --z-dropdown: 100;
  --z-modal: 500;
  --z-drawer: 500;
  --z-toast: 900;

  /* Enrollment status palette (was inline in StatusBadge) */
  --status-green-bg: #EAF3DE;  --status-green-fg: #3B6D11;
  --status-amber-bg: #FAEEDA;  --status-amber-fg: #854F0B;
  --status-blue-bg:  #E6F1FB;  --status-blue-fg:  #185FA5;
  --status-rose-bg:  #FBEAF0;  --status-rose-fg:  #993556;
  --status-gray-bg:  #EDF2F7;  --status-gray-fg:  #4A5568;
}
```

- [ ] **Step 2: Import it first**

In `admindash/frontend/src/index.css`, add right AFTER the existing `@import '@neoapex/ui-tokens/tokens.css';` line:
```css
@import './styles/theme.css';
```

- [ ] **Step 3: Verify neutral**

Run: `cd admindash/frontend && npm run build && npm run lint && npm run test`
Expected: build passes; no NEW lint; 25/25. No visual change (tokens equal the previous fallbacks).

- [ ] **Step 4: Commit**

```bash
git add admindash/frontend/src/styles/theme.css admindash/frontend/src/index.css
git commit -m "feat(admindash): canonical design-token layer (accent/ring/overlay/status/z-index)"
```

---

### Task 2: Shared `StatusBadge` (tokenized) + `StudentNameCell`

**Files:**
- Modify: `admindash/frontend/src/components/StatusBadge.tsx`
- Create: `admindash/frontend/src/components/StatusBadge.css`
- Create: `admindash/frontend/src/components/StudentNameCell.tsx`
- Create: `admindash/frontend/src/components/StudentNameCell.css`
- Modify: `admindash/frontend/src/pages/StudentsPage.tsx` (use `StudentNameCell` in the name column)

**Interfaces:**
- `StatusBadge` unchanged props (`{ status: string }`), now renders `<span className="status-badge status-badge--<tone>">` with colors from Task-1 tokens (same colors as today).
- `StudentNameCell` props `{ row: Record<string, unknown> }` — renders the avatar + display name + preferred name (the exact markup StudentsPage uses today).

- [ ] **Step 1: Tokenize StatusBadge**

Replace the inline-style map in `StatusBadge.tsx` with tone classes. New `StatusBadge.tsx`:
```tsx
import './StatusBadge.css';

// Map each status value to a tone class (colors live in CSS/tokens).
const TONE: Record<string, string> = {
  active: 'green', enrolled: 'green',
  on_leave: 'amber', waitlisted: 'amber',
  suspended: 'blue', graduated: 'blue',
  dropped: 'rose', withdrawn: 'rose', inactive: 'rose', transferred: 'rose',
};

export default function StatusBadge({ status }: { status: string }) {
  const key = String(status ?? '').trim().toLowerCase().replace(/\s+/g, '_');
  if (!status || status === '-') return <>-</>;
  const tone = TONE[key] ?? 'gray';
  return <span className={`status-badge status-badge--${tone}`}>{status}</span>;
}
```
(Preserve the current behavior of returning `-` when empty — check the real StatusBadge for its empty handling and keep it.)

- [ ] **Step 2: StatusBadge styles**

Create `admindash/frontend/src/components/StatusBadge.css`:
```css
.status-badge {
  display: inline-block; padding: 0.2rem 0.6rem; border-radius: 20px;
  font-size: 12px; font-weight: 600; white-space: nowrap;
}
.status-badge--green { background: var(--status-green-bg); color: var(--status-green-fg); }
.status-badge--amber { background: var(--status-amber-bg); color: var(--status-amber-fg); }
.status-badge--blue  { background: var(--status-blue-bg);  color: var(--status-blue-fg); }
.status-badge--rose  { background: var(--status-rose-bg);  color: var(--status-rose-fg); }
.status-badge--gray  { background: var(--status-gray-bg);  color: var(--status-gray-fg); }
```

- [ ] **Step 3: Extract StudentNameCell**

READ the composite name-cell markup in `StudentsPage.tsx` (`buildColumnsFromModel`, the `first_name` branch) and its CSS (`.student-name-cell`, `.student-avatar`, `.student-name-info`, `.student-display-name`, `.student-preferred-name` in `StudentsPage.css`). Create `admindash/frontend/src/components/StudentNameCell.tsx` with the SAME markup:
```tsx
import './StudentNameCell.css';

export default function StudentNameCell({ row }: { row: Record<string, unknown> }) {
  const fullName = `${row.first_name ?? ''} ${row.last_name ?? ''}`.trim() || '-';
  const lastName = String(row.last_name ?? '');
  const avatarChar = (lastName.charAt(0) || fullName.charAt(0)).toUpperCase();
  return (
    <div className="student-name-cell">
      <div className="student-avatar">{avatarChar}</div>
      <div className="student-name-info">
        <span className="student-display-name">{fullName}</span>
        {row.preferred_name ? (
          <span className="student-preferred-name">{String(row.preferred_name)}</span>
        ) : null}
      </div>
    </div>
  );
}
```
Move the `.student-name-cell`/`.student-avatar`/`.student-name-info`/`.student-display-name`/`.student-preferred-name` rules from `StudentsPage.css` into `StudentNameCell.css` (cut/paste verbatim). StudentsPage still gets them because it will import the component (which imports the CSS) — but to be safe, ALSO keep `StudentsPage.css` importing nothing broken; verify the classes render.

- [ ] **Step 4: Use StudentNameCell in StudentsPage**

In `StudentsPage.tsx`, replace the inline composite-name JSX in the `first_name` column render with `<StudentNameCell row={row} />` (import the component). Behavior/markup identical.

- [ ] **Step 5: Verify**

Run: `cd admindash/frontend && npm run build && npm run lint && npm run test`
Expected: build passes; no NEW lint; 25/25. StudentsPage name column + status badges look identical to before.

- [ ] **Step 6: Commit**

```bash
git add admindash/frontend/src/components/StatusBadge.tsx admindash/frontend/src/components/StatusBadge.css admindash/frontend/src/components/StudentNameCell.tsx admindash/frontend/src/components/StudentNameCell.css admindash/frontend/src/pages/StudentsPage.tsx admindash/frontend/src/pages/StudentsPage.css
git commit -m "refactor(admindash): shared StatusBadge (tokenized) + StudentNameCell primitives"
```

---

### Task 3: Make the family student-list consistent with the student table (CORE ASK)

**Files:**
- Modify: `admindash/frontend/src/pages/FamiliesPage.tsx`
- Modify: `admindash/frontend/src/pages/FamiliesPage.css`

**Interfaces:** the expanded student list renders the SAME columns/cells as StudentsPage: **Student ID** (clickable, `students-id-btn` style), **Name** (`StudentNameCell`), **Grade**, **Status** (`StatusBadge`); and the table adopts DataTable's visual language (header, padding, borders, row hover).

- [ ] **Step 1: Reuse the shared cell primitives + DataTable look**

In `FamiliesPage.tsx` `renderExpanded`, import and use `StudentNameCell` and `StatusBadge`. Replace the hand-rolled cells:
- Name cell: `<td><StudentNameCell row={s} /></td>` (was plain `first_name last_name`).
- Status cell: `<td><StatusBadge status={String(s.status ?? '-')} /></td>` (was raw text).
- Keep the Student ID button (already `.families-student-id`, styled like `.students-id-btn`) and Grade.
Give the wrapping table the class `families-students-table data-table` so it inherits DataTable cell styling, OR update `.families-students-table` CSS (Step 2) to match DataTable exactly.

- [ ] **Step 2: Match DataTable cell styling**

In `FamiliesPage.css`, update `.families-students-table` so header/cell/hover match `DataTable.css`:
```css
.families-students-table { width: 100%; border-collapse: collapse; background: var(--bg-card, #fff); border-radius: var(--radius-sm, 6px); overflow: hidden; }
.families-students-table thead th {
  background: var(--bg-tertiary); padding: 0.7rem 1rem; font-size: 12px; font-weight: 600;
  text-transform: uppercase; color: var(--text-secondary); text-align: left;
  border-bottom: 2px solid var(--border-primary);
}
.families-students-table td { padding: 0.7rem 1rem; border-bottom: 1px solid var(--border-subtle); font-size: 0.9rem; vertical-align: middle; }
.families-students-table tbody tr:hover td { background: var(--accent-tint); }
```

- [ ] **Step 3: Verify + Manual QA**

Run: `cd admindash/frontend && npm run build && npm run lint && npm run test`
Expected: build passes; no NEW lint; 25/25.
Manual: expand a family → its student list now shows the avatar name cell, a colored status badge, and the same padding/hover/header as the main Students table. Student id single-click still opens the detail.

- [ ] **Step 4: Commit**

```bash
git add admindash/frontend/src/pages/FamiliesPage.tsx admindash/frontend/src/pages/FamiliesPage.css
git commit -m "feat(admindash): family student-list matches the students table (name cell, status badge, cell styling)"
```

---

### Task 4: Clickable-cell affordance consistency

**Files:**
- Modify: `admindash/frontend/src/pages/FamiliesPage.css`
- Modify: `admindash/frontend/src/components/StudentsPage.css` (or wherever `.students-id-btn` lives) + `FamiliesPage.css` for `.families-student-id`

**Interfaces:** all clickable id/name cells share ONE affordance: accent color, pointer cursor, underline-on-hover.

- [ ] **Step 1: Unify the clickable-cell look**

Ensure these classes all read the accent token and gain a hover underline (they currently vary — Family ID renders as muted `<code>` with no hover). Update in the relevant CSS:
```css
.families-id-btn { background: none; border: none; padding: 0; cursor: pointer; }
.families-id-btn .families-id { color: var(--accent); font-family: var(--font-mono, monospace); font-size: 12px; }
.families-id-btn:hover .families-id { text-decoration: underline; }
.families-student-id, .students-id-btn { background: none; border: none; padding: 0; cursor: pointer; color: var(--accent); font-family: var(--font-mono, monospace); }
.families-student-id:hover, .students-id-btn:hover { text-decoration: underline; }
.families-name-btn { color: var(--accent); }
.families-name-btn:hover { text-decoration: underline; }
```
(The Family ID cell now clearly reads as a clickable accent-colored id instead of muted gray `#555`.)

- [ ] **Step 2: Verify + Manual QA**

Run: `cd admindash/frontend && npm run build && npm run lint && npm run test`
Expected: build passes; no NEW lint; 25/25.
Manual: the Family ID, family name, and student ids all look clickable (accent color, underline on hover, pointer).

- [ ] **Step 3: Commit**

```bash
git add admindash/frontend/src/pages/FamiliesPage.css admindash/frontend/src/pages/StudentsPage.css
git commit -m "feat(admindash): consistent clickable-cell affordance (accent + hover underline)"
```

---

### Task 5: Shared button classes + tokenize hardcoded accent (app-wide, behavior-neutral)

**Files:**
- Create: `admindash/frontend/src/styles/buttons.css`
- Modify: `admindash/frontend/src/index.css` (import buttons.css)
- Modify: CSS files with hardcoded `#378ADD` (find-replace to `var(--accent)`)

**Interfaces:** shared `.btn`, `.btn-primary`, `.btn-secondary`, `.btn-danger`, `.btn-ghost` (matching today's primary/secondary look) available app-wide; hardcoded accent centralized.

- [ ] **Step 1: Add shared button classes**

Create `admindash/frontend/src/styles/buttons.css` (match the existing primary/secondary look — accent bg, inverse text, translateY(-2px)+shadow hover; secondary = tertiary bg):
```css
.btn { display: inline-flex; align-items: center; justify-content: center; gap: 0.4rem;
  font: inherit; font-weight: 600; padding: 0.5rem 0.9rem; border-radius: var(--radius-sm, 8px);
  border: 1px solid transparent; cursor: pointer; transition: transform .12s ease, box-shadow .12s ease, background .12s ease; }
.btn:focus-visible { outline: none; box-shadow: 0 0 0 3px var(--accent-ring); }
.btn-primary { background: var(--accent); color: var(--text-inverse, #fff); }
.btn-primary:hover { transform: translateY(-2px); box-shadow: 0 8px 24px var(--accent-tint-strong); }
.btn-secondary { background: var(--bg-tertiary); color: var(--text-secondary); border-color: var(--border-primary); }
.btn-secondary:hover { background: var(--bg-secondary); }
.btn-danger { background: var(--danger, #C53030); color: #fff; }
.btn-ghost { background: none; border: none; color: var(--accent); }
.btn-ghost:hover { text-decoration: underline; }
```
Import in `index.css` after theme.css: `@import './styles/buttons.css';`

- [ ] **Step 2: Centralize hardcoded accent**

Find hardcoded accent in CSS: `cd admindash/frontend && grep -rln "#378ADD" src/`. In each CSS file, replace bare `#378ADD` with `var(--accent)` and `rgba(55, 138, 221, 0.15)`→`var(--accent-ring)`, `rgba(55,138,221,0.06)`→`var(--accent-tint)` (match the actual values present). This is VALUE-IDENTICAL — purely centralization. Do NOT change `.tsx` inline hex in StatusBadge (already tokenized in Task 2). Leave non-accent hardcoded colors alone (out of scope).

- [ ] **Step 3: Verify neutral**

Run: `cd admindash/frontend && npm run build && npm run lint && npm run test`
Expected: build passes; no NEW lint; 25/25. No visual change (same computed colors). The new `.btn-*` classes exist for use but existing buttons still render as before.

- [ ] **Step 4: Commit**

```bash
git add admindash/frontend/src/styles/buttons.css admindash/frontend/src/index.css admindash/frontend/src/
git commit -m "refactor(admindash): shared .btn-* classes + centralize hardcoded accent to var(--accent)"
```

---

### Task 6: Shared modal shell + migrate student/family modals

**Files:**
- Create: `admindash/frontend/src/styles/modal.css`
- Modify: `admindash/frontend/src/index.css` (import modal.css)
- Modify: `StudentDetailModal`, `EditStudentModal`, `EditFamilyModal`, `AddStudentModal`, `AddFamilyModal` (adopt shared overlay class + tokenized overlay bg / z-index) — CSS-level only; keep each modal's inner layout.

**Interfaces:** `.modal-overlay` (fixed inset, `var(--overlay-bg)`, `z-index: var(--z-modal)`, flex-centered) + `.modal` base; the student/family modals use these for the overlay while keeping their existing inner classes.

- [ ] **Step 1: Add the shared shell**

Create `admindash/frontend/src/styles/modal.css`:
```css
.modal-overlay { position: fixed; inset: 0; background: var(--overlay-bg); display: flex;
  align-items: center; justify-content: center; z-index: var(--z-modal); padding: 1rem;
  animation: modal-fade .15s ease; }
@keyframes modal-fade { from { opacity: 0; } to { opacity: 1; } }
.modal { background: var(--bg-card); border-radius: var(--radius-md); max-height: 85vh;
  overflow-y: auto; box-shadow: var(--shadow-elevated); }
```
Import in `index.css` after buttons.css: `@import './styles/modal.css';`

- [ ] **Step 2: Point the existing overlay classes at the shared tokens**

Rather than rename every modal's markup (risky), make the existing overlay classes consistent by aligning them to the shared tokens. In `StudentsPage.css` `.students-confirm-overlay` and any sibling overlay used by these modals, set `background: var(--overlay-bg);` and `z-index: var(--z-modal);` and add the `animation: modal-fade .15s ease;` (so the students/families confirm + edit + detail + add modals all share the same backdrop + fade). Do the same for `AddStudentModal.css` `.add-modal`'s overlay usage if it has its own. Keep inner modal layout classes unchanged.

- [ ] **Step 3: Verify + Manual QA**

Run: `cd admindash/frontend && npm run build && npm run lint && npm run test`
Expected: build passes; no NEW lint; 25/25.
Manual: opening Add/Edit/Detail modals on Students and Families shows a consistent backdrop + subtle fade; no z-index surprises within these flows.

- [ ] **Step 4: Commit**

```bash
git add admindash/frontend/src/styles/modal.css admindash/frontend/src/index.css admindash/frontend/src/pages/StudentsPage.css admindash/frontend/src/components/AddStudentModal.css
git commit -m "feat(admindash): shared modal shell (tokenized overlay + fade) for student/family modals"
```

---

## Self-Review

**Goal coverage:**
- Student/family/family-student-list consistent columns/rows/cells → Task 2 (shared StatusBadge + StudentNameCell) + Task 3 (family list uses them + DataTable styling). ✓ (the explicit core ask)
- Reviewed ALL admindash UI components → two full surveys catalogued every page/component; this plan updates the highest-impact consistency + ease-of-use gaps. ✓
- Ease of use → Task 4 (clear clickable affordances), Task 6 (consistent modal backdrop/fade), Task 2 (color-coded status everywhere). ✓
- App-wide consistency → Task 1 (one token source), Task 5 (shared buttons + centralized accent), Task 6 (shared modal shell). ✓

**Placeholder scan:** none — every step has concrete CSS/TSX or an exact grep/replace instruction. "READ the real file" notes are integration guidance for editing large existing files.

**Behavior-preservation:** Tasks 1 & 5 are value-identical (tokens equal prior fallbacks). Task 2 keeps StudentsPage markup identical. Task 6 aligns backdrop/z-index without changing inner modal layout. The intended visual changes are confined to Task 3 (family list), Task 4 (affordances), and the shared fade (Task 6).

## Deferred (higher-risk, documented — NOT in this plan)
- Unify z-index across ALL drawers (lead 900/901, bulk 50/51/60, chat 55/60, program-detail 1000) into the `--z-*` scale — needs careful cross-flow testing.
- Convert `BulkReviewTable` (hand-rolled) to `DataTable`.
- Merge `FilterForm.css` ≈ `DynamicForm.css` duplication into shared form-field classes.
- Migrate every remaining page's local `.*-btn-primary/secondary` to the shared `.btn-*` classes (this plan adds the classes + tokenizes color; wholesale button-markup migration is a follow-up).
- Move `LanguageSwitcher`/`StatusBadge`-style inline styles fully to CSS (StatusBadge done here; others deferred).
These are safe to do later as a focused Phase 2 once the foundation here is merged and visually confirmed.
