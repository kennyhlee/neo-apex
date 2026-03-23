# Floatify Dark Theme Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restyle the admin dashboard to match Floatify's dark glassmorphism aesthetic while adapting data-dense areas for extended readability.

**Architecture:** CSS-variable-driven theme overhaul. Global tokens in `index.css` change the entire palette. Component CSS files get targeted updates for glassmorphism chrome vs opaque data areas. Minor TSX changes add `.gradient-text` to headings.

**Tech Stack:** Plain CSS with CSS custom properties, React 19 + TypeScript, Vite

**Spec:** `openspec/changes/floatify-dark-theme-redesign/`

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `frontend/src/index.css` | Modify | CSS variables, body styles, gradient-text utility, scrollbar, global resets |
| `frontend/src/App.css` | Modify | Dark app shell background |
| `frontend/src/components/Navbar.css` | Modify | Glassmorphism navbar, dark nav links, glass selects |
| `frontend/src/components/Navbar.tsx:59` | Modify | Add `gradient-text` class to brand text |
| `frontend/src/components/Footer.css` | Modify | Dark footer |
| `frontend/src/components/DataTable.css` | Modify | Glass wrapper, opaque cells, dark header, gradient pagination |
| `frontend/src/components/FilterForm.css` | Modify | Dark inputs, purple focus, gradient primary button |
| `frontend/src/pages/LoginPage.css` | Modify | Glassmorphism card, gradient submit, dark inputs |
| `frontend/src/pages/HomePage.css` | Modify | Dark stat cards, glass home cards, dark schedule |
| `frontend/src/pages/HomePage.tsx:45` | Modify | Add `gradient-text` class to H1 |
| `frontend/src/pages/StudentsPage.css` | Modify | Dark page styles, gradient toolbar buttons |
| `frontend/src/pages/StudentsPage.tsx:179` | Modify | Add `gradient-text` class to H1 |
| `frontend/src/pages/LeadPage.css` | Modify | Dark placeholder page |
| `frontend/src/pages/LeadPage.tsx:9` | Modify | Add `gradient-text` class to H1 |
| `frontend/src/pages/ProgramPage.css` | Modify | Dark placeholder page |
| `frontend/src/pages/ProgramPage.tsx:9` | Modify | Add `gradient-text` class to H1 |

---

### Task 1: CSS Variables — Dark Palette

**Files:**
- Modify: `frontend/src/index.css:1-43` (`:root` block)

- [ ] **Step 1: Replace the `:root` CSS variables**

Replace the entire `:root` block in `frontend/src/index.css` (lines 3-43) with the dark Floatify palette. Keep the Google Fonts import (line 1) and `--font-sans`/`--font-mono` unchanged.

```css
:root {
  /* Backgrounds */
  --bg-primary: #0F0A1A;
  --bg-secondary: #151025;
  --bg-tertiary: rgba(255, 255, 255, 0.05);
  --bg-card: #1A1230;
  --bg-elevated: #201840;
  --bg-input: #1E1535;

  /* Glass */
  --bg-glass: rgba(255, 255, 255, 0.1);
  --border-glass: rgba(255, 255, 255, 0.2);

  /* Borders */
  --border-primary: rgba(255, 255, 255, 0.15);
  --border-subtle: rgba(255, 255, 255, 0.08);
  --border-accent: #667EEA;

  /* Text */
  --text-primary: #FFFFFF;
  --text-secondary: rgba(255, 255, 255, 0.7);
  --text-tertiary: rgba(255, 255, 255, 0.4);
  --text-inverse: #FFFFFF;

  /* Accent (gradient endpoints) */
  --accent: #667EEA;
  --accent-hover: #764BA2;
  --accent-muted: rgba(102, 126, 234, 0.15);
  --accent-glow: rgba(102, 126, 234, 0.08);

  /* Semantic */
  --success: #34D399;
  --success-muted: rgba(52, 211, 153, 0.2);
  --danger: #F87171;
  --danger-muted: rgba(248, 113, 113, 0.15);
  --info: #60A5FA;
  --info-muted: rgba(96, 165, 250, 0.15);
  --warning: #FBBF24;
  --warning-muted: rgba(251, 191, 36, 0.15);

  /* Fonts (unchanged) */
  --font-mono: 'DM Mono', 'Menlo', monospace;
  --font-sans: 'DM Sans', -apple-system, sans-serif;

  /* Radius */
  --radius-sm: 8px;
  --radius-md: 12px;
  --radius-lg: 16px;

  /* Shadows (glow-based) */
  --shadow-card: 0 2px 8px rgba(102, 126, 234, 0.15), 0 0 0 1px rgba(255, 255, 255, 0.08);
  --shadow-elevated: 0 8px 32px rgba(102, 126, 234, 0.35), 0 0 0 1px rgba(255, 255, 255, 0.1);
}
```

- [ ] **Step 2: Verify the app loads with dark palette**

Run: `cd frontend && npm run dev`

Open the browser. The entire app should now have dark backgrounds and light text. Components will look rough — that's expected. The variables propagate everywhere.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/index.css
git commit -m "feat: replace CSS variables with dark Floatify palette"
```

---

### Task 2: Body Styles, Background Gradients & Gradient-Text Utility

**Files:**
- Modify: `frontend/src/index.css:56-103` (body, body::before, scrollbar, keyframes)

- [ ] **Step 1: Replace body and body::before styles**

Replace the `body` block (lines 56-62) with dark background + radial gradient decorations. Replace `body::before` (lines 64-72) — remove the noise texture SVG and use radial gradient blobs instead.

```css
body {
  font-family: var(--font-sans);
  background: var(--bg-primary);
  color: var(--text-primary);
  line-height: 1.6;
  min-height: 100vh;
}

body::before {
  content: '';
  position: fixed;
  inset: 0;
  pointer-events: none;
  z-index: -1;
  background:
    radial-gradient(800px circle at 20% 20%, rgba(102, 126, 234, 0.08), transparent 50%),
    radial-gradient(600px circle at 80% 50%, rgba(118, 75, 162, 0.06), transparent 50%),
    radial-gradient(400px circle at 40% 80%, rgba(244, 114, 182, 0.04), transparent 50%);
}
```

Note: Remove `z-index: 9999` and `opacity: 0.018` from the old `body::before`. The new version uses `z-index: -1` so it sits behind content.

- [ ] **Step 2: Update scrollbar styles**

Replace the scrollbar rules (lines 80-83):

```css
::-webkit-scrollbar { width: 6px; height: 6px; }
::-webkit-scrollbar-track { background: transparent; }
::-webkit-scrollbar-thumb { background: rgba(255, 255, 255, 0.15); border-radius: 3px; }
::-webkit-scrollbar-thumb:hover { background: rgba(255, 255, 255, 0.25); }
```

- [ ] **Step 3: Add `.gradient-text` utility class**

Add this block after the scrollbar rules, before the `@keyframes`:

```css
.gradient-text {
  background: linear-gradient(135deg, #A78BFA, #F472B6, #34D399);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
}
```

- [ ] **Step 4: Verify background gradients visible**

Run dev server. The page should show a dark background with subtle purple/pink radial gradient blobs. The noise texture should be gone.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/index.css
git commit -m "feat: add dark body styles, radial gradient bg, gradient-text utility"
```

---

### Task 3: App Shell

**Files:**
- Modify: `frontend/src/App.css` (entire file)

- [ ] **Step 1: Update App.css**

The existing `App.css` uses no color properties, so it mostly works as-is. Add a background color to ensure the shell is dark:

```css
.app-shell {
  display: flex;
  flex-direction: column;
  min-height: 100vh;
  background: var(--bg-primary);
}

.app-main {
  flex: 1;
  padding: 1.5rem;
  max-width: 1400px;
  margin: 0 auto;
  width: 100%;
}

@media (max-width: 768px) {
  .app-main {
    padding: 1rem;
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/App.css
git commit -m "feat: dark background on app shell"
```

---

### Task 4: Glassmorphism Navbar

**Files:**
- Modify: `frontend/src/components/Navbar.css` (entire file)
- Modify: `frontend/src/components/Navbar.tsx:59`

- [ ] **Step 1: Replace Navbar.css**

Replace the entire file with glassmorphism navbar styles. Key changes: semi-transparent bg with backdrop blur, gradient brand text via class, glass-styled nav links and selects.

```css
.navbar {
  background: rgba(15, 10, 26, 0.8);
  backdrop-filter: blur(20px);
  -webkit-backdrop-filter: blur(20px);
  border-bottom: 1px solid var(--border-glass);
  padding: 0 1.5rem;
  height: 56px;
  display: flex;
  align-items: center;
  position: sticky;
  top: 0;
  z-index: 100;
}

.navbar-inner {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  max-width: 1400px;
  margin: 0 auto;
}

.navbar-brand {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  text-decoration: none;
}

.navbar-brand img {
  height: 32px;
  width: auto;
  object-fit: contain;
}

.navbar-brand-text {
  font-weight: 700;
  font-size: 1rem;
}

.navbar-nav {
  display: flex;
  align-items: center;
  gap: 0.25rem;
  list-style: none;
  margin: 0;
  padding: 0;
}

.navbar-nav a {
  text-decoration: none;
  color: var(--text-secondary);
  padding: 0.4rem 0.85rem;
  border-radius: var(--radius-sm);
  font-size: 0.9rem;
  font-weight: 500;
  transition: all 0.15s;
}

.navbar-nav a:hover {
  background: var(--bg-glass);
  color: var(--text-primary);
}

.navbar-nav a.active {
  background: var(--accent-muted);
  color: var(--accent);
  font-weight: 600;
}

.navbar-right {
  display: flex;
  align-items: center;
  gap: 1rem;
}

.navbar-site-label {
  font-size: 0.8rem;
  color: var(--text-tertiary);
}

.navbar-site-select,
.navbar-lang-select {
  font-family: var(--font-sans);
  font-size: 0.85rem;
  padding: 0.3rem 0.5rem;
  border: 1px solid var(--border-primary);
  border-radius: var(--radius-sm);
  background: var(--bg-input);
  color: var(--text-primary);
  cursor: pointer;
}

.navbar-site-select:focus,
.navbar-lang-select:focus {
  outline: none;
  border-color: var(--accent);
}

.navbar-user {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  cursor: pointer;
}

.navbar-avatar {
  width: 32px;
  height: 32px;
  border-radius: 50%;
  background: linear-gradient(135deg, #667EEA, #764BA2);
  color: var(--text-inverse);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 0.85rem;
  font-weight: 600;
}

.navbar-username {
  font-size: 0.9rem;
  font-weight: 500;
  color: var(--text-primary);
}

@media (max-width: 768px) {
  .navbar {
    padding: 0 1rem;
  }

  .navbar-nav {
    display: none;
  }

  .navbar-site-label {
    display: none;
  }
}
```

- [ ] **Step 2: Add gradient-text class to brand text in Navbar.tsx**

In `frontend/src/components/Navbar.tsx`, line 59, change:

```tsx
<span className="navbar-brand-text">{t('nav.systemName')}</span>
```

to:

```tsx
<span className="navbar-brand-text gradient-text">{t('nav.systemName')}</span>
```

- [ ] **Step 3: Verify navbar in browser**

Run dev server. The navbar should have a dark translucent background with blur, the brand text should show a purple→pink→green gradient, and nav links should have glass hover effects.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/Navbar.css frontend/src/components/Navbar.tsx
git commit -m "feat: glassmorphism navbar with gradient brand text"
```

---

### Task 5: Dark Footer

**Files:**
- Modify: `frontend/src/components/Footer.css` (entire file)

- [ ] **Step 1: Replace Footer.css**

```css
.app-footer {
  margin-top: auto;
  padding: 0.75rem 1.5rem;
  text-align: center;
  font-size: 0.8rem;
  color: var(--text-tertiary);
  border-top: 1px solid var(--border-subtle);
  background: var(--bg-secondary);
}

@media (max-width: 768px) {
  .app-footer {
    padding: 0.5rem 1rem;
    font-size: 0.75rem;
  }
}
```

This is minimal change — the CSS variables handle the color swap. The structure stays the same.

- [ ] **Step 2: Commit**

```bash
git add frontend/src/components/Footer.css
git commit -m "feat: dark footer styling"
```

---

### Task 6: Dark Data Table

**Files:**
- Modify: `frontend/src/components/DataTable.css` (entire file)

- [ ] **Step 1: Replace DataTable.css**

Key changes: glass card wrapper with `--bg-glass` + backdrop blur, opaque `--bg-card` for table cells (two-tier strategy), gradient active pagination button.

```css
.data-table-card {
  background: var(--bg-glass);
  backdrop-filter: blur(20px);
  -webkit-backdrop-filter: blur(20px);
  border: 1px solid var(--border-glass);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-card);
  overflow: hidden;
}

.data-table-wrapper {
  overflow-x: auto;
}

.data-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.9rem;
}

.data-table thead {
  background: var(--bg-elevated);
}

.data-table th {
  padding: 0.7rem 1rem;
  text-align: left;
  font-size: 0.75rem;
  font-weight: 600;
  color: var(--text-tertiary);
  text-transform: uppercase;
  letter-spacing: 0.03em;
  white-space: nowrap;
  border-bottom: 1px solid var(--border-subtle);
}

.data-table td {
  padding: 0.7rem 1rem;
  border-bottom: 1px solid var(--border-subtle);
  color: var(--text-primary);
  vertical-align: middle;
  background: var(--bg-card);
}

.data-table tbody tr:hover td {
  background: var(--accent-glow);
}

.data-table tbody tr:last-child td {
  border-bottom: none;
}

.data-table-checkbox {
  width: 40px;
}

.data-table-checkbox input {
  cursor: pointer;
}

.data-table-empty {
  text-align: center;
  padding: 2rem 1rem;
  color: var(--text-tertiary);
}

.data-table-pagination {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0.75rem 1rem;
  font-size: 0.85rem;
  color: var(--text-secondary);
}

.data-table-pagination-info {
  font-size: 0.8rem;
}

.data-table-pagination-controls {
  display: flex;
  align-items: center;
  gap: 0.35rem;
}

.data-table-pagination-controls button {
  font-family: var(--font-sans);
  font-size: 0.8rem;
  padding: 0.3rem 0.6rem;
  border: 1px solid var(--border-primary);
  border-radius: var(--radius-sm);
  background: var(--bg-card);
  color: var(--text-secondary);
  cursor: pointer;
  transition: all 0.15s;
}

.data-table-pagination-controls button:hover:not(:disabled) {
  border-color: var(--accent);
  color: var(--accent);
}

.data-table-pagination-controls button.active {
  background: linear-gradient(135deg, #667EEA, #764BA2);
  color: var(--text-inverse);
  border-color: transparent;
}

.data-table-pagination-controls button:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
```

- [ ] **Step 2: Verify table in browser**

Navigate to Students page. The table wrapper should have a glass effect, but individual cells should be opaque dark for readability. Header should be a darker elevated color. Row hover should show a subtle purple glow. Active pagination button should be gradient.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/DataTable.css
git commit -m "feat: dark data table with glass wrapper and opaque cells"
```

---

### Task 7: Dark Filter Form

**Files:**
- Modify: `frontend/src/components/FilterForm.css` (entire file)

- [ ] **Step 1: Replace FilterForm.css**

Key changes: opaque dark input backgrounds, purple focus borders, gradient primary button.

```css
.filter-card {
  background: var(--bg-glass);
  backdrop-filter: blur(20px);
  -webkit-backdrop-filter: blur(20px);
  border: 1px solid var(--border-glass);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-card);
  padding: 1.25rem;
  margin-bottom: 1rem;
}

.filter-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
  gap: 1rem;
}

.filter-field label {
  display: block;
  font-size: 0.8rem;
  font-weight: 600;
  color: var(--text-secondary);
  margin-bottom: 0.35rem;
}

.filter-field input,
.filter-field select {
  width: 100%;
  font-family: var(--font-sans);
  font-size: 0.85rem;
  padding: 0.45rem 0.6rem;
  border: 1px solid var(--border-primary);
  border-radius: var(--radius-sm);
  background: var(--bg-input);
  color: var(--text-primary);
  transition: border-color 0.15s;
}

.filter-field input:focus,
.filter-field select:focus {
  outline: none;
  border-color: #667EEA;
  box-shadow: 0 0 0 2px rgba(102, 126, 234, 0.2);
}

.filter-actions {
  display: flex;
  justify-content: flex-end;
  gap: 0.5rem;
  margin-top: 1rem;
  padding-top: 0.75rem;
  border-top: 1px solid var(--border-subtle);
}

.filter-btn {
  font-family: var(--font-sans);
  font-size: 0.85rem;
  font-weight: 500;
  padding: 0.45rem 1rem;
  border-radius: var(--radius-sm);
  cursor: pointer;
  transition: all 0.15s;
  border: none;
}

.filter-btn-primary {
  background: linear-gradient(135deg, #667EEA, #764BA2);
  color: var(--text-inverse);
}

.filter-btn-primary:hover {
  transform: translateY(-1px);
  box-shadow: 0 4px 16px rgba(102, 126, 234, 0.35);
}

.filter-btn-secondary {
  background: var(--bg-tertiary);
  color: var(--text-secondary);
}

.filter-btn-secondary:hover {
  background: rgba(255, 255, 255, 0.1);
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/components/FilterForm.css
git commit -m "feat: dark filter form with opaque inputs and gradient button"
```

---

### Task 8: Dark Login Page

**Files:**
- Modify: `frontend/src/pages/LoginPage.css` (entire file)

- [ ] **Step 1: Replace LoginPage.css**

Key changes: glassmorphism login card, gradient submit button, dark inputs, purple focus states.

```css
.login-page {
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  min-height: 100vh;
  padding: 2rem;
}

.login-card {
  background: var(--bg-glass);
  backdrop-filter: blur(20px);
  -webkit-backdrop-filter: blur(20px);
  border: 1px solid var(--border-glass);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-elevated);
  max-width: 520px;
  width: 100%;
  overflow: hidden;
  animation: fadeIn 0.4s ease;
}

.login-card-body {
  padding: 2.5rem;
}

.login-logo {
  display: flex;
  justify-content: center;
  margin-bottom: 1.5rem;
}

.login-logo img {
  height: 40px;
}

.login-title {
  text-align: center;
  font-size: 1.5rem;
  font-weight: 700;
  color: var(--text-primary);
  margin-bottom: 2rem;
}

.login-columns {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 2rem;
}

.login-divider {
  border-left: 1px solid var(--border-subtle);
}

.login-field {
  margin-bottom: 1.25rem;
}

.login-field label {
  display: block;
  font-size: 0.85rem;
  font-weight: 500;
  color: var(--text-secondary);
  margin-bottom: 0.4rem;
}

.login-field input {
  width: 100%;
  font-family: var(--font-sans);
  font-size: 0.95rem;
  padding: 0.6rem 0.75rem;
  border: 1px solid var(--border-primary);
  border-radius: var(--radius-sm);
  background: var(--bg-input);
  color: var(--text-primary);
  transition: border-color 0.15s;
}

.login-field input:focus {
  outline: none;
  border-color: #667EEA;
  box-shadow: 0 0 0 2px rgba(102, 126, 234, 0.2);
}

.login-submit {
  width: 100%;
  font-family: var(--font-sans);
  font-size: 1rem;
  font-weight: 600;
  padding: 0.7rem;
  border: none;
  border-radius: var(--radius-sm);
  background: linear-gradient(135deg, #667EEA, #764BA2);
  color: var(--text-inverse);
  cursor: pointer;
  transition: all 0.2s;
}

.login-submit:hover {
  transform: translateY(-2px);
  box-shadow: 0 8px 32px rgba(102, 126, 234, 0.35);
}

.login-alt {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding-left: 1rem;
}

.login-alt-label {
  font-size: 0.85rem;
  color: var(--text-tertiary);
  margin-bottom: 1rem;
}

.login-google-btn {
  width: 100%;
  font-family: var(--font-sans);
  font-size: 0.9rem;
  font-weight: 500;
  padding: 0.65rem 1rem;
  border: 1px solid var(--border-primary);
  border-radius: var(--radius-sm);
  background: var(--bg-card);
  color: var(--text-primary);
  cursor: pointer;
  transition: all 0.15s;
}

.login-google-btn:hover {
  border-color: var(--accent);
  box-shadow: var(--shadow-card);
}

.login-footer {
  padding: 0.75rem 2.5rem;
  background: var(--bg-elevated);
  text-align: center;
  font-size: 0.85rem;
  color: var(--text-tertiary);
  border-top: 1px solid var(--border-subtle);
}

.login-footer a {
  color: var(--accent);
  font-weight: 500;
  text-decoration: none;
}

.login-footer a:hover {
  text-decoration: underline;
}

@media (max-width: 520px) {
  .login-columns {
    grid-template-columns: 1fr;
  }

  .login-divider {
    border-left: none;
    padding-left: 0;
  }
}
```

- [ ] **Step 2: Verify login page in browser**

Navigate to `/login`. The card should have a glass effect with blur, the submit button should be a purple gradient, inputs should be opaque dark with purple focus glow.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/pages/LoginPage.css
git commit -m "feat: glassmorphism login page with gradient submit button"
```

---

### Task 9: Dark Home Page

**Files:**
- Modify: `frontend/src/pages/HomePage.css` (entire file)
- Modify: `frontend/src/pages/HomePage.tsx:45`

- [ ] **Step 1: Replace HomePage.css**

Key changes: gradient stat value pills stay the same (already use bright colors on dark), home cards get glass effect, schedule events get dark backgrounds with colored borders.

```css
.home-page {
  animation: fadeIn 0.3s ease;
}

.home-page h1 {
  font-size: 1.4rem;
  font-weight: 700;
  margin-bottom: 1.25rem;
}

.home-stats {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 1rem;
  margin-bottom: 1.5rem;
}

.stat-card {
  background: var(--bg-glass);
  backdrop-filter: blur(20px);
  -webkit-backdrop-filter: blur(20px);
  border: 1px solid var(--border-glass);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-card);
  padding: 1.5rem;
  text-align: center;
}

.stat-label {
  font-size: 0.85rem;
  color: var(--text-tertiary);
  margin-bottom: 0.75rem;
}

.stat-value {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 80px;
  height: 44px;
  font-size: 1.6rem;
  font-weight: 700;
  color: var(--text-inverse);
  border-radius: var(--radius-sm);
}

.stat-value.purple { background: linear-gradient(135deg, #667EEA, #764BA2); }
.stat-value.blue { background: linear-gradient(135deg, #60A5FA, #3B82F6); }
.stat-value.green { background: linear-gradient(135deg, #34D399, #10B981); }

.home-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 1rem;
  margin-bottom: 1.5rem;
}

.home-card {
  background: var(--bg-glass);
  backdrop-filter: blur(20px);
  -webkit-backdrop-filter: blur(20px);
  border: 1px solid var(--border-glass);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-card);
}

.home-card-header {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.75rem 1rem;
  border-bottom: 1px solid var(--border-subtle);
  font-weight: 600;
  font-size: 0.9rem;
  color: var(--text-primary);
}

.home-card-body {
  padding: 1rem;
}

.shortcut-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 0.75rem;
}

.shortcut-item {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 0.75rem;
  border-radius: var(--radius-sm);
  cursor: pointer;
  transition: all 0.15s;
  text-align: center;
}

.shortcut-item:hover {
  background: var(--bg-tertiary);
}

.shortcut-icon {
  font-size: 1.8rem;
  margin-bottom: 0.4rem;
}

.shortcut-label {
  font-size: 0.8rem;
  color: var(--text-secondary);
}

.todo-item {
  margin-bottom: 1rem;
}

.todo-bar {
  height: 6px;
  border-radius: 3px;
  background: rgba(255, 255, 255, 0.1);
  margin-bottom: 0.4rem;
  overflow: hidden;
}

.todo-bar-fill {
  height: 100%;
  border-radius: 3px;
}

.todo-text {
  font-size: 0.85rem;
  font-weight: 500;
}

.todo-date {
  font-size: 0.75rem;
  color: var(--text-tertiary);
}

.announce-item {
  padding-bottom: 0.75rem;
  margin-bottom: 0.75rem;
  border-bottom: 1px solid var(--border-subtle);
}

.announce-item:last-child {
  border-bottom: none;
  margin-bottom: 0;
}

.announce-date {
  font-size: 0.75rem;
  color: var(--text-tertiary);
  margin-bottom: 0.25rem;
}

.announce-text {
  font-size: 0.85rem;
  color: var(--text-secondary);
}

.schedule-card {
  background: var(--bg-glass);
  backdrop-filter: blur(20px);
  -webkit-backdrop-filter: blur(20px);
  border: 1px solid var(--border-glass);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-card);
}

.schedule-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0.75rem 1rem;
  border-bottom: 1px solid var(--border-subtle);
}

.schedule-title {
  font-weight: 600;
  font-size: 0.9rem;
}

.schedule-body {
  padding: 1rem;
}

.schedule-days {
  display: grid;
  grid-template-columns: repeat(7, 1fr);
  gap: 0.5rem;
}

.schedule-day-header {
  text-align: center;
  font-weight: 600;
  font-size: 0.75rem;
  color: var(--text-secondary);
  padding: 0.4rem;
  background: var(--bg-elevated);
  border-radius: var(--radius-sm);
}

.schedule-day-cell {
  min-height: 80px;
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-sm);
  padding: 0.35rem;
}

.schedule-event {
  padding: 0.35rem 0.5rem;
  border-radius: var(--radius-sm);
  margin-bottom: 0.3rem;
  cursor: pointer;
  border-left: 3px solid;
}

.schedule-event.course {
  background: rgba(96, 165, 250, 0.15);
  border-color: #60A5FA;
}

.schedule-event.meeting {
  background: rgba(251, 191, 36, 0.15);
  border-color: #FBBF24;
}

.schedule-event.activity {
  background: rgba(52, 211, 153, 0.15);
  border-color: #34D399;
}

.schedule-event-time {
  font-size: 0.7rem;
  font-weight: 500;
}

.schedule-event-title {
  font-size: 0.75rem;
  font-weight: 600;
}

.schedule-event-location {
  font-size: 0.65rem;
  color: var(--text-tertiary);
}

.schedule-legend {
  display: flex;
  justify-content: center;
  gap: 1.5rem;
  padding: 0.75rem 1rem;
}

.legend-item {
  display: flex;
  align-items: center;
  gap: 0.35rem;
  font-size: 0.75rem;
  color: var(--text-secondary);
}

.legend-color {
  width: 10px;
  height: 10px;
  border-radius: 2px;
}

@media (max-width: 992px) {
  .home-grid {
    grid-template-columns: 1fr;
  }

  .schedule-days {
    overflow-x: auto;
  }
}
```

- [ ] **Step 2: Add gradient-text to HomePage H1**

In `frontend/src/pages/HomePage.tsx`, line 45, change:

```tsx
<h1>{t('homepage.title')}</h1>
```

to:

```tsx
<h1 className="gradient-text">{t('homepage.title')}</h1>
```

- [ ] **Step 3: Verify home page in browser**

Stat cards should have glass effect with gradient value pills. Home cards should have glass wrappers. Schedule events should have colored borders on dark backgrounds. The H1 should show gradient text.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/pages/HomePage.css frontend/src/pages/HomePage.tsx
git commit -m "feat: dark home page with glass cards and gradient stat pills"
```

---

### Task 10: Dark Students Page

**Files:**
- Modify: `frontend/src/pages/StudentsPage.css` (entire file)
- Modify: `frontend/src/pages/StudentsPage.tsx:179`

- [ ] **Step 1: Replace StudentsPage.css**

Key changes: gradient toolbar buttons, dark avatar backgrounds, dark error box.

```css
.students-page {
  animation: fadeIn 0.3s ease;
}

.students-page h1 {
  font-size: 1.4rem;
  font-weight: 700;
  margin-bottom: 1rem;
}

.students-toolbar {
  display: flex;
  gap: 0.5rem;
  margin-bottom: 1rem;
}

.students-toolbar button {
  font-family: var(--font-sans);
  font-size: 0.85rem;
  font-weight: 500;
  padding: 0.45rem 0.85rem;
  border: none;
  border-radius: var(--radius-sm);
  background: linear-gradient(135deg, #667EEA, #764BA2);
  color: var(--text-inverse);
  cursor: pointer;
  transition: all 0.2s;
}

.students-toolbar button:hover {
  transform: translateY(-1px);
  box-shadow: 0 4px 16px rgba(102, 126, 234, 0.35);
}

.student-name-cell {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.student-avatar {
  width: 32px;
  height: 32px;
  border-radius: 50%;
  background: var(--info-muted);
  color: var(--info);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 0.8rem;
  font-weight: 600;
  flex-shrink: 0;
}

.student-name-info {
  display: flex;
  flex-direction: column;
}

.student-display-name {
  font-weight: 600;
  font-size: 0.9rem;
}

.student-preferred-name {
  font-size: 0.75rem;
  color: var(--text-tertiary);
}

.student-error {
  text-align: center;
  padding: 2rem;
  color: var(--danger);
  background: var(--danger-muted);
  border-radius: var(--radius-md);
  margin-top: 1rem;
}
```

- [ ] **Step 2: Add gradient-text to StudentsPage H1**

In `frontend/src/pages/StudentsPage.tsx`, line 179, change:

```tsx
<h1>{t('students.title')}</h1>
```

to:

```tsx
<h1 className="gradient-text">{t('students.title')}</h1>
```

- [ ] **Step 3: Commit**

```bash
git add frontend/src/pages/StudentsPage.css frontend/src/pages/StudentsPage.tsx
git commit -m "feat: dark students page with gradient toolbar buttons"
```

---

### Task 11: Dark Lead & Program Pages + Gradient Headings

**Files:**
- Modify: `frontend/src/pages/LeadPage.css` (entire file)
- Modify: `frontend/src/pages/ProgramPage.css` (entire file)
- Modify: `frontend/src/pages/LeadPage.tsx:9`
- Modify: `frontend/src/pages/ProgramPage.tsx:9`

- [ ] **Step 1: Replace LeadPage.css**

Both Lead and Program pages share the `.placeholder-page` class. The CSS needs no structural changes — the variable swap handles colors. But we keep it explicit:

```css
.placeholder-page {
  animation: fadeIn 0.3s ease;
}

.placeholder-page h1 {
  font-size: 1.4rem;
  font-weight: 700;
  margin-bottom: 0.75rem;
}

.placeholder-page p {
  color: var(--text-tertiary);
}
```

- [ ] **Step 2: Replace ProgramPage.css**

Same content as LeadPage.css (they share the same class):

```css
.placeholder-page {
  animation: fadeIn 0.3s ease;
}

.placeholder-page h1 {
  font-size: 1.4rem;
  font-weight: 700;
  margin-bottom: 0.75rem;
}

.placeholder-page p {
  color: var(--text-tertiary);
}
```

- [ ] **Step 3: Add gradient-text to LeadPage H1**

In `frontend/src/pages/LeadPage.tsx`, line 9, change:

```tsx
<h1>{t('lead.title')}</h1>
```

to:

```tsx
<h1 className="gradient-text">{t('lead.title')}</h1>
```

- [ ] **Step 4: Add gradient-text to ProgramPage H1**

In `frontend/src/pages/ProgramPage.tsx`, line 9, change:

```tsx
<h1>{t('program.title')}</h1>
```

to:

```tsx
<h1 className="gradient-text">{t('program.title')}</h1>
```

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/LeadPage.css frontend/src/pages/LeadPage.tsx frontend/src/pages/ProgramPage.css frontend/src/pages/ProgramPage.tsx
git commit -m "feat: dark lead/program pages with gradient headings"
```

---

### Task 12: Verify StatusBadge Colors

**Files:**
- Read: `frontend/src/components/StatusBadge.tsx`

- [ ] **Step 1: Verify badge colors work on dark theme**

`StatusBadge.tsx` uses CSS variables (`--success-muted`, `--success`, `--danger-muted`, etc.) for its inline styles. Since Task 1 updated these variables to bright values on dark semi-transparent backgrounds, the badges should already look correct.

Open the Students page in the browser and verify:
- Active/Enrolled badges: green text on dark green tint
- On Leave badges: yellow text on dark yellow tint
- Suspended badges: blue text on dark blue tint
- Graduated badges: purple text on dark purple tint
- Dropped/Withdrawn badges: red text on dark red tint

All text should be clearly readable against the dark table cell background.

- [ ] **Step 2: If any badge is unreadable, adjust CSS variables**

If any semantic color is too dim, increase the brightness in `index.css`. For example, if `--success: #34D399` is too dark against the badge background, try `#4ADE80`.

No commit needed unless changes were made.

---

### Task 13: Full Visual Verification

- [ ] **Step 1: Start dev server**

Run: `cd frontend && npm run dev`

- [ ] **Step 2: Check Login page**

Navigate to `/login`. Verify:
- Dark background with radial gradient blobs visible
- Glass card with blur effect
- Dark inputs with purple focus glow
- Gradient submit button with hover lift effect
- Google login button is readable

- [ ] **Step 3: Check Home page**

Log in and verify:
- Gradient text on H1 heading
- Glass stat cards with gradient value pills
- Glass home cards (shortcuts, todos, announcements)
- Schedule events with colored borders on dark backgrounds
- Footer is dark with muted text

- [ ] **Step 4: Check Students page**

Navigate to Students. Verify:
- Gradient H1 heading
- Glass filter form with opaque dark inputs
- Purple focus glow on inputs
- Gradient "Filter" button
- Glass table wrapper with opaque dark cells
- Readable text in table cells (white on dark)
- Status badges readable with colored tints
- Gradient active pagination button
- Toolbar buttons are gradient

- [ ] **Step 5: Check Leads and Programs pages**

Navigate to each. Verify gradient H1 headings and dark styling on placeholder text.

- [ ] **Step 6: Check navbar across all pages**

Verify:
- Dark translucent navbar with blur
- Gradient brand text
- Glass hover on nav links
- Active nav link shows purple tint
- Dark selects for tenant/language
- Gradient avatar circle

- [ ] **Step 7: Check responsive (narrow viewport)**

Resize browser to ~375px width. Verify:
- Navbar collapses correctly (nav links hidden)
- Login card goes single column
- Home grid stacks
- Table scrolls horizontally
- No broken layouts or unreadable text

- [ ] **Step 8: Final commit if any fixes were needed**

```bash
git add -A
git commit -m "fix: dark theme visual polish from verification pass"
```

Only commit if changes were made during verification.
