# Floatify Style Refresh Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace papermite's dark cyberpunk theme with Floatify's clean light aesthetic — new color palette, Inter font at 16px base, no glassmorphism.

**Architecture:** Variable-first approach. Update `:root` CSS custom properties in `index.css` first (covers ~60% of the visual change), then update each CSS file to fix component-specific overrides and font references. Finally patch 3 TSX files with hardcoded values. No layout restructuring — purely visual.

**Tech Stack:** CSS custom properties, Google Fonts (Inter), React/TypeScript (inline style fixes only)

**Reference artifacts:** `openspec/changes/floatify-style-refresh/` — design.md has the full variable mapping table, specs/theme/spec.md has testable requirements.

---

## File Map

| File | Action | What changes |
|---|---|---|
| `frontend/index.html` | Modify | Add Google Fonts preconnect + Inter import |
| `frontend/src/index.css` | Modify | All `:root` variables, remove body texture, add shimmer keyframe |
| `frontend/src/App.css` | Modify | Header, buttons, inputs, badges, card base |
| `frontend/src/components/EntityCard.css` | Modify | Card header, table, toggles, options tags |
| `frontend/src/components/EntityCard.tsx` | Modify | `TYPE_COLORS` constant (9 hex values) |
| `frontend/src/components/TenantInfo.css` | Modify | Labels, marker, detail values |
| `frontend/src/components/FileUploader.css` | Modify | Upload area, remove corner decorations |
| `frontend/src/components/ModelSelector.css` | Modify | Label font |
| `frontend/src/components/AddFieldForm.tsx` | Modify | 1 inline `var(--font-mono)` |
| `frontend/src/App.tsx` | Modify | 2 inline `var(--font-mono)` |
| `frontend/src/pages/LoginPage.css` | Modify | Full light rewrite (glows, card, inputs, button) |
| `frontend/src/pages/LandingPage.css` | Modify | Model card, action cards, meta footer |
| `frontend/src/pages/UploadPage.css` | Modify | Error banner, progress bar, modal overlay |
| `frontend/src/pages/ReviewPage.css` | Modify | Stats bar, source panel |
| `frontend/src/pages/FinalizedPage.css` | Modify | Banners, meta bar, entity tables, JSON preview |

---

### Task 1: Foundation — Google Fonts and `:root` Variables

**Files:**
- Modify: `frontend/index.html:3-8`
- Modify: `frontend/src/index.css:1-104`

This task replaces the entire design token foundation. After this, the page will have correct backgrounds and colors but component-level styles will still look broken — that's expected.

- [ ] **Step 1: Add Inter font links to `index.html`**

Replace lines 3-9 of `frontend/index.html` with:

```html
  <head>
    <meta charset="UTF-8" />
    <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet" />
    <title>Papermite — Model Setup</title>
  </head>
```

- [ ] **Step 2: Replace entire `index.css`**

Replace all of `frontend/src/index.css` with:

```css
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap');

:root {
  /* Backgrounds */
  --bg-primary: #F8FAFC;
  --bg-secondary: #FFFFFF;
  --bg-tertiary: #F1F5F9;
  --bg-card: #FFFFFF;
  --bg-elevated: #FFFFFF;
  --bg-input: #FFFFFF;

  /* Borders */
  --border-primary: #E2E8F0;
  --border-subtle: #EDF2F7;
  --border-accent: rgba(55, 138, 221, 0.4);

  /* Text */
  --text-primary: #1A202C;
  --text-secondary: #4A5568;
  --text-tertiary: #A0AEC0;
  --text-inverse: #FFFFFF;

  /* Accent */
  --accent: #378ADD;
  --accent-hover: #2B6FB5;
  --accent-muted: rgba(55, 138, 221, 0.1);
  --accent-glow: rgba(55, 138, 221, 0.06);

  /* Status */
  --success: #639922;
  --success-muted: rgba(99, 153, 34, 0.1);
  --danger: #D4537E;
  --danger-muted: rgba(212, 83, 126, 0.08);
  --info: #378ADD;
  --info-muted: rgba(55, 138, 221, 0.08);

  /* Tinted pairs (for badges, status indicators) */
  --tint-blue-bg: #E6F1FB;
  --tint-blue-text: #185FA5;
  --tint-pink-bg: #FBEAF0;
  --tint-pink-text: #993556;
  --tint-green-bg: #EAF3DE;
  --tint-green-text: #3B6D11;
  --tint-amber-bg: #FAEEDA;
  --tint-amber-text: #854F0B;

  /* Typography */
  --font-mono: 'Inter', system-ui, sans-serif;
  --font-sans: 'Inter', system-ui, sans-serif;

  /* Sizing */
  --radius-sm: 8px;
  --radius-md: 12px;
  --radius-lg: 16px;

  /* Shadows */
  --shadow-card: 0 4px 16px rgba(0, 0, 0, 0.06);
  --shadow-elevated: 0 8px 24px rgba(0, 0, 0, 0.08);
}

*, *::before, *::after {
  box-sizing: border-box;
  margin: 0;
  padding: 0;
}

html {
  font-size: 16px;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}

body {
  font-family: var(--font-sans);
  background: var(--bg-primary);
  color: var(--text-primary);
  line-height: 1.6;
  min-height: 100vh;
}

#root {
  min-height: 100vh;
}

@keyframes fadeIn {
  from { opacity: 0; transform: translateY(8px); }
  to { opacity: 1; transform: translateY(0); }
}

@keyframes slideUp {
  from { opacity: 0; transform: translateY(20px); }
  to { opacity: 1; transform: translateY(0); }
}

@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.4; }
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

@keyframes borderGlow {
  0%, 100% { border-color: var(--border-primary); }
  50% { border-color: var(--accent); }
}

@keyframes shimmer {
  0% { background-position: 200% 0; }
  100% { background-position: -200% 0; }
}
```

Changes vs current: removed DM Mono/DM Sans import, all color variables remapped per design.md table, added tinted pairs, `--font-mono` now points to Inter, `font-size: 16px`, removed `body::before` fractal noise texture, removed custom scrollbar rules, added missing `shimmer` keyframe.

- [ ] **Step 3: Verify foundation**

Open http://localhost:5173 — page should have light #F8FAFC background with dark text. Cards and components will look partially broken (expected — component overrides come in later tasks).

- [ ] **Step 4: Commit**

```bash
git add frontend/index.html frontend/src/index.css
git commit -m "style: replace dark theme foundation with Floatify light palette and Inter font"
```

---

### Task 2: Global Components — App.css

**Files:**
- Modify: `frontend/src/App.css:1-279`

- [ ] **Step 1: Replace entire `App.css`**

```css
/* App shell layout */
.app-shell {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
}

.app-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 32px;
  height: 60px;
  background: var(--bg-secondary);
  border-bottom: 1px solid var(--border-primary);
  position: sticky;
  top: 0;
  z-index: 100;
}

.app-header__brand {
  display: flex;
  align-items: center;
  gap: 10px;
}

.app-header__logo {
  font-family: var(--font-sans);
  font-size: 16px;
  font-weight: 700;
  letter-spacing: -0.02em;
  text-decoration: none;
  color: var(--accent);
}

.app-header__divider {
  width: 1px;
  height: 20px;
  background: var(--border-primary);
}

.app-header__subtitle {
  font-family: var(--font-sans);
  font-size: 13px;
  color: var(--text-tertiary);
}

.app-header__user {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 14px;
  color: var(--text-secondary);
}

.app-header__avatar {
  width: 32px;
  height: 32px;
  border-radius: 50%;
  background: var(--tint-blue-bg);
  border: 1px solid var(--border-primary);
  display: flex;
  align-items: center;
  justify-content: center;
  font-family: var(--font-sans);
  font-size: 13px;
  font-weight: 700;
  color: var(--tint-blue-text);
}

.app-header__logout {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border: none;
  border-radius: 50%;
  background: transparent;
  color: var(--text-tertiary);
  cursor: pointer;
  transition: color 0.2s, background 0.2s;
}

.app-header__logout:hover {
  color: var(--danger);
  background: var(--danger-muted);
}

.app-main {
  flex: 1;
  padding: 32px;
  max-width: 1200px;
  width: 100%;
  margin: 0 auto;
}

/* Page shared styles */
.page-header {
  margin-bottom: 32px;
  animation: fadeIn 0.4s ease-out;
}

.page-header__eyebrow {
  font-family: var(--font-sans);
  font-size: 13px;
  font-weight: 600;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  color: var(--accent);
  margin-bottom: 8px;
}

.page-header__title {
  font-family: var(--font-sans);
  font-size: 28px;
  font-weight: 800;
  color: var(--text-primary);
  letter-spacing: -0.02em;
  line-height: 1.2;
}

.page-header__desc {
  font-size: 16px;
  color: var(--text-secondary);
  margin-top: 6px;
  max-width: 540px;
  line-height: 1.6;
}

/* Buttons */
.btn {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 10px 20px;
  font-family: var(--font-sans);
  font-size: 14px;
  font-weight: 500;
  border: 1px solid var(--border-primary);
  border-radius: var(--radius-md);
  cursor: pointer;
  transition: all 0.2s;
  text-decoration: none;
  background: var(--bg-secondary);
  color: var(--text-primary);
}

.btn:hover {
  border-color: var(--text-tertiary);
  background: var(--bg-tertiary);
}

.btn--primary {
  background: var(--accent);
  color: #FFFFFF;
  border: none;
}

.btn--primary:hover {
  transform: translateY(-2px);
  box-shadow: 0 8px 32px rgba(55, 138, 221, 0.3);
  background: var(--accent-hover);
}

.btn--danger {
  color: var(--danger);
  border-color: rgba(212, 83, 126, 0.3);
}

.btn--danger:hover {
  background: var(--danger-muted);
  border-color: var(--danger);
}

.btn--sm {
  padding: 6px 14px;
  font-size: 13px;
}

.btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

/* Inputs */
.input {
  font-family: var(--font-sans);
  font-size: 15px;
  padding: 10px 14px;
  background: var(--bg-input);
  border: 1px solid var(--border-primary);
  border-radius: var(--radius-sm);
  color: var(--text-primary);
  outline: none;
  transition: border-color 0.2s, box-shadow 0.2s;
  width: 100%;
}

.input:focus {
  border-color: var(--accent);
  box-shadow: 0 0 0 3px rgba(55, 138, 221, 0.15);
}

.select {
  font-family: var(--font-sans);
  font-size: 14px;
  padding: 10px 14px;
  background: var(--bg-input);
  border: 1px solid var(--border-primary);
  border-radius: var(--radius-sm);
  color: var(--text-primary);
  outline: none;
  cursor: pointer;
  appearance: none;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%23378ADD' stroke-width='2'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E");
  background-repeat: no-repeat;
  background-position: right 12px center;
  padding-right: 36px;
}

.select:focus {
  border-color: var(--accent);
  box-shadow: 0 0 0 3px rgba(55, 138, 221, 0.15);
}

/* Badge */
.badge {
  display: inline-flex;
  align-items: center;
  padding: 2px 10px;
  font-family: var(--font-sans);
  font-size: 12px;
  font-weight: 600;
  border-radius: 20px;
}

.badge--base {
  background: var(--tint-blue-bg);
  color: var(--tint-blue-text);
}

.badge--custom {
  background: var(--tint-green-bg);
  color: var(--tint-green-text);
}

/* Spinner */
.spinner {
  width: 20px;
  height: 20px;
  border: 2px solid var(--border-primary);
  border-top-color: var(--accent);
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

.spinner--lg {
  width: 36px;
  height: 36px;
  border-width: 3px;
}

/* Card */
.card {
  background: var(--bg-card);
  border: 1px solid var(--border-primary);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-card);
}
```

Changes: removed gradient logo (now solid blue text), removed glassmorphism `.card` (now white + border + shadow), all `--font-mono` → `--font-sans`, badges use tinted pairs with pill shape, buttons use solid blue, increased font sizes, select chevron stroke color updated to `#378ADD`.

- [ ] **Step 2: Verify header and buttons**

Open http://localhost:5173 — header should be white with blue "PAPERMITE" text. Primary buttons should be solid blue with hover lift.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/App.css
git commit -m "style: update header, buttons, inputs, badges, cards to Floatify light theme"
```

---

### Task 3: Component Styles

**Files:**
- Modify: `frontend/src/components/EntityCard.css:1-305`
- Modify: `frontend/src/components/EntityCard.tsx:12-22`
- Modify: `frontend/src/components/TenantInfo.css:1-83`
- Modify: `frontend/src/components/FileUploader.css:1-129`
- Modify: `frontend/src/components/ModelSelector.css:1-18`
- Modify: `frontend/src/components/AddFieldForm.tsx:40`
- Modify: `frontend/src/App.tsx:43,63`

- [ ] **Step 1: Replace `EntityCard.css`**

Replace all of `frontend/src/components/EntityCard.css` with:

```css
.entity-card {
  animation: slideUp 0.4s ease-out both;
  overflow: hidden;
}

.entity-card__header {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 16px 20px;
  border-bottom: 1px solid var(--border-subtle);
  background: var(--bg-tertiary);
}

.entity-card__type-bar {
  width: 4px;
  height: 20px;
  border-radius: 2px;
  flex-shrink: 0;
}

.entity-card__type {
  font-family: var(--font-sans);
  font-size: 14px;
  font-weight: 600;
  color: var(--text-primary);
}

.entity-card__count {
  font-family: var(--font-sans);
  font-size: 13px;
  color: var(--text-tertiary);
  margin-left: auto;
}

.entity-card__body {
  padding: 0;
}

.entity-card__table {
  width: 100%;
  border-collapse: collapse;
}

.entity-card__table thead th {
  font-family: var(--font-sans);
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  color: var(--text-tertiary);
  text-align: left;
  padding: 10px 20px;
  border-bottom: 1px solid var(--border-subtle);
  background: var(--bg-tertiary);
}

.entity-card__table thead th:last-child {
  width: 48px;
}

.field-row td {
  padding: 10px 20px;
  border-bottom: 1px solid var(--border-subtle);
  vertical-align: middle;
}

.field-row:last-child td {
  border-bottom: none;
}

.field-row:hover {
  background: var(--accent-glow);
}

.field-row__name code {
  font-family: var(--font-sans);
  font-size: 13px;
  color: var(--text-secondary);
  background: none;
  padding: 0;
}

.field-row__display {
  font-size: 14px;
  color: var(--text-primary);
  cursor: pointer;
  padding: 4px 0;
  border-bottom: 1px dashed transparent;
  transition: border-color 0.2s;
}

.field-row__display:hover {
  border-bottom-color: var(--text-tertiary);
}

.field-row__input {
  padding: 4px 8px;
  font-size: 14px;
}

.field-row__required {
  width: 64px;
}

.field-row__toggle {
  display: inline-flex;
  align-items: center;
  cursor: pointer;
}

.field-row__toggle input {
  position: absolute;
  opacity: 0;
  width: 0;
  height: 0;
}

.field-row__toggle-track {
  position: relative;
  width: 32px;
  height: 18px;
  background: var(--border-primary);
  border-radius: 9px;
  transition: background 0.2s;
}

.field-row__toggle input:checked + .field-row__toggle-track {
  background: var(--accent);
}

.field-row__toggle-thumb {
  position: absolute;
  top: 2px;
  left: 2px;
  width: 14px;
  height: 14px;
  background: #FFFFFF;
  border-radius: 50%;
  transition: transform 0.2s;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.15);
}

.field-row__toggle input:checked + .field-row__toggle-track .field-row__toggle-thumb {
  transform: translateX(14px);
}

.field-row__data-type {
  width: 130px;
}

.field-row__type-wrapper {
  display: flex;
  align-items: center;
  gap: 4px;
}

.field-row__type-select {
  font-family: var(--font-sans);
  font-size: 13px;
  padding: 4px 8px;
  border: 1px solid var(--border-primary);
  border-radius: var(--radius-sm);
  background: var(--bg-card);
  color: var(--text-secondary);
  cursor: pointer;
}

.field-row__type-select:focus {
  outline: none;
  border-color: var(--accent);
}

.field-row__options-btn {
  font-family: var(--font-sans);
  font-size: 12px;
  padding: 2px 8px;
  white-space: nowrap;
}

.field-row__type-locked {
  font-family: var(--font-sans);
  font-size: 13px;
  color: var(--text-tertiary);
  padding: 4px 8px;
}

.field-row__toggle--locked {
  cursor: not-allowed;
  opacity: 0.5;
}

.field-row__toggle--locked .field-row__toggle-track {
  pointer-events: none;
}

.field-row__options-row td {
  padding: 0 20px 12px 20px;
  border-bottom: 1px solid var(--border-subtle);
  background: var(--bg-tertiary);
}

.options-editor {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.options-editor__header {
  display: flex;
  align-items: center;
}

.options-editor__multiple {
  display: flex;
  align-items: center;
  gap: 6px;
  font-family: var(--font-sans);
  font-size: 13px;
  color: var(--text-secondary);
  cursor: pointer;
}

.options-editor__multiple input {
  accent-color: var(--accent);
}

.options-editor__list {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}

.options-editor__tag {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-family: var(--font-sans);
  font-size: 13px;
  padding: 3px 10px;
  background: var(--tint-blue-bg);
  color: var(--tint-blue-text);
  border-radius: var(--radius-sm);
  border: 1px solid rgba(55, 138, 221, 0.2);
}

.options-editor__tag-remove {
  background: none;
  border: none;
  color: var(--tint-blue-text);
  cursor: pointer;
  font-size: 14px;
  line-height: 1;
  padding: 0 2px;
  opacity: 0.6;
}

.options-editor__tag-remove:hover {
  opacity: 1;
}

.options-editor__add {
  display: flex;
  gap: 4px;
  align-items: center;
}

.options-editor__input {
  font-size: 13px;
  padding: 4px 10px;
  width: 180px;
}

.entity-card__footer {
  padding: 12px 20px;
  border-top: 1px solid var(--border-subtle);
}

.add-field-btn {
  width: 100%;
  justify-content: center;
  border-style: dashed;
  color: var(--text-tertiary);
}

.add-field-btn:hover {
  color: var(--accent);
  border-color: var(--accent);
}

.add-field-form {
  display: flex;
  gap: 8px;
  align-items: center;
}

.add-field-form .input {
  flex: 1;
}
```

- [ ] **Step 2: Update `TYPE_COLORS` in `EntityCard.tsx`**

In `frontend/src/components/EntityCard.tsx`, replace lines 12-22:

```typescript
const TYPE_COLORS: Record<string, string> = {
  TENANT: "#378ADD",
  PROGRAM: "#639922",
  STUDENT: "#EF9F27",
  GUARDIAN: "#D4537E",
  ENROLLMENT: "#993556",
  REGAPP: "#854F0B",
  EMERGENCY_CONTACT: "#3B6D11",
  MEDICAL_CONTACT: "#185FA5",
  ATTENDANCE: "#639922",
};
```

- [ ] **Step 3: Replace `TenantInfo.css`**

Replace all of `frontend/src/components/TenantInfo.css` with:

```css
.tenant-info__marker {
  width: 10px;
  height: 10px;
  background: var(--accent);
  border-radius: 2px;
  flex-shrink: 0;
}

.tenant-info__marker--lg {
  width: 14px;
  height: 14px;
  border-radius: 3px;
}

.tenant-info--compact {
  display: flex;
  align-items: center;
  gap: 10px;
}

.tenant-info--compact .tenant-info__name {
  font-family: var(--font-sans);
  font-size: 14px;
  font-weight: 600;
  color: var(--text-primary);
  margin-right: 8px;
}

.tenant-info--compact .tenant-info__id {
  font-family: var(--font-sans);
  font-size: 13px;
  color: var(--text-tertiary);
}

.tenant-info__header {
  display: flex;
  align-items: center;
  gap: 14px;
  margin-bottom: 24px;
}

.tenant-info__label {
  font-family: var(--font-sans);
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  color: var(--text-tertiary);
  margin-bottom: 2px;
}

.tenant-info__name--lg {
  font-family: var(--font-sans);
  font-size: 22px;
  font-weight: 700;
  color: var(--text-primary);
  letter-spacing: -0.02em;
}

.tenant-info__details {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 16px;
  padding-top: 20px;
  border-top: 1px solid var(--border-subtle);
}

.tenant-info__detail {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.tenant-info__detail-label {
  font-family: var(--font-sans);
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  color: var(--text-tertiary);
}

.tenant-info__detail-value {
  font-size: 15px;
  color: var(--text-secondary);
}
```

- [ ] **Step 4: Replace `FileUploader.css`**

Replace all of `frontend/src/components/FileUploader.css` with:

```css
.file-uploader {
  position: relative;
  border: 1px dashed var(--border-primary);
  border-radius: var(--radius-lg);
  padding: 48px 32px;
  text-align: center;
  transition: all 0.3s;
  background: var(--bg-secondary);
  cursor: pointer;
}

.file-uploader:hover {
  border-color: var(--text-tertiary);
  background: var(--bg-tertiary);
}

.file-uploader--active {
  border-color: var(--accent) !important;
  background: var(--accent-glow) !important;
  animation: borderGlow 1.5s ease-in-out infinite;
}

.file-uploader--disabled {
  opacity: 0.5;
  pointer-events: none;
}

.file-uploader__inner {
  position: relative;
  z-index: 1;
}

.file-uploader__icon {
  color: var(--text-tertiary);
  margin-bottom: 16px;
}

.file-uploader--active .file-uploader__icon {
  color: var(--accent);
}

.file-uploader__text {
  font-size: 15px;
  color: var(--text-secondary);
}

.file-uploader__browse {
  color: var(--accent);
  cursor: pointer;
  text-decoration: underline;
  text-underline-offset: 3px;
}

.file-uploader__browse:hover {
  color: var(--accent-hover);
}

.file-uploader__hint {
  font-family: var(--font-sans);
  font-size: 13px;
  color: var(--text-tertiary);
  margin-top: 8px;
}

.file-uploader__selected {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.file-uploader__filename {
  font-family: var(--font-sans);
  font-size: 15px;
  color: var(--accent);
  font-weight: 600;
}

.file-uploader__size {
  font-family: var(--font-sans);
  font-size: 13px;
  color: var(--text-tertiary);
}
```

Note: the `.file-uploader__corners` rules are removed entirely. The TSX markup still renders the `<span>` elements but they'll be invisible without styles — harmless. Removing the TSX markup is optional cleanup.

- [ ] **Step 5: Replace `ModelSelector.css`**

Replace all of `frontend/src/components/ModelSelector.css` with:

```css
.model-selector {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.model-selector__label {
  font-family: var(--font-sans);
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  color: var(--text-tertiary);
}

.model-selector .select {
  min-width: 240px;
}
```

- [ ] **Step 6: Fix inline `var(--font-mono)` in TSX files**

In `frontend/src/components/AddFieldForm.tsx` line 40, replace:
```typescript
style={{ fontFamily: "var(--font-mono)", fontSize: "13px" }}
```
with:
```typescript
style={{ fontFamily: "var(--font-sans)", fontSize: "14px" }}
```

In `frontend/src/App.tsx` line 43, replace:
```typescript
fontFamily: "var(--font-mono)",
```
with:
```typescript
fontFamily: "var(--font-sans)",
```

In `frontend/src/App.tsx` line 63, replace:
```typescript
fontFamily: "var(--font-mono)",
```
with:
```typescript
fontFamily: "var(--font-sans)",
```

- [ ] **Step 7: Verify components**

Navigate to Upload and Review pages. Entity cards should have white backgrounds, light borders, colored type bars. Upload area should be clean dashed border without corner decorations.

- [ ] **Step 8: Commit**

```bash
git add frontend/src/components/EntityCard.css frontend/src/components/EntityCard.tsx frontend/src/components/TenantInfo.css frontend/src/components/FileUploader.css frontend/src/components/ModelSelector.css frontend/src/components/AddFieldForm.tsx frontend/src/App.tsx
git commit -m "style: update all component styles and TYPE_COLORS to Floatify light theme"
```

---

### Task 4: Login Page

**Files:**
- Modify: `frontend/src/pages/LoginPage.css:1-214`

- [ ] **Step 1: Replace entire `LoginPage.css`**

```css
.login {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--bg-primary);
  position: relative;
  overflow: hidden;
  font-family: var(--font-sans);
}

.login__glow {
  position: absolute;
  border-radius: 50%;
  pointer-events: none;
  filter: blur(80px);
}

.login__glow--1 {
  width: 500px;
  height: 500px;
  top: -120px;
  right: -100px;
  background: radial-gradient(circle, rgba(55, 138, 221, 0.08) 0%, transparent 70%);
}

.login__glow--2 {
  width: 400px;
  height: 400px;
  bottom: -80px;
  left: -60px;
  background: radial-gradient(circle, rgba(212, 83, 126, 0.06) 0%, transparent 70%);
}

.login__card {
  position: relative;
  width: 100%;
  max-width: 400px;
  padding: 48px 40px 36px;
  background: var(--bg-secondary);
  border: 1px solid var(--border-primary);
  border-radius: 20px;
  box-shadow: 0 24px 48px rgba(0, 0, 0, 0.06);
  animation: loginCardIn 0.5s ease-out;
}

@keyframes loginCardIn {
  from { opacity: 0; transform: translateY(20px) scale(0.98); }
  to { opacity: 1; transform: translateY(0) scale(1); }
}

.login__header {
  text-align: center;
  margin-bottom: 36px;
}

.login__brand {
  font-family: var(--font-sans);
  font-size: 28px;
  font-weight: 800;
  letter-spacing: -0.02em;
  color: var(--accent);
  margin-bottom: 6px;
}

.login__subtitle {
  font-size: 15px;
  color: var(--text-tertiary);
}

.login__form {
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.login__field {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.login__label {
  font-family: var(--font-sans);
  font-size: 13px;
  font-weight: 600;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  color: var(--text-tertiary);
}

.login__input {
  font-family: var(--font-sans);
  font-size: 15px;
  padding: 12px 16px;
  background: var(--bg-input);
  border: 1px solid var(--border-primary);
  border-radius: var(--radius-md);
  color: var(--text-primary);
  outline: none;
  transition: border-color 0.2s, box-shadow 0.2s;
}

.login__input::placeholder {
  color: var(--text-tertiary);
}

.login__input:focus {
  border-color: var(--accent);
  box-shadow: 0 0 0 3px rgba(55, 138, 221, 0.15);
}

.login__input--error {
  border-color: var(--danger);
}

.login__field-error {
  font-size: 13px;
  color: var(--danger);
}

.login__error {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 14px;
  color: var(--tint-pink-text);
  padding: 10px 14px;
  background: var(--tint-pink-bg);
  border: 1px solid rgba(212, 83, 126, 0.2);
  border-radius: var(--radius-sm);
}

.login__submit {
  margin-top: 4px;
  padding: 14px 28px;
  font-family: var(--font-sans);
  font-size: 15px;
  font-weight: 600;
  color: #FFFFFF;
  background: var(--accent);
  border: none;
  border-radius: var(--radius-md);
  cursor: pointer;
  transition: transform 0.2s, box-shadow 0.2s, background 0.2s;
}

.login__submit:hover:not(:disabled) {
  transform: translateY(-2px);
  box-shadow: 0 8px 32px rgba(55, 138, 221, 0.3);
  background: var(--accent-hover);
}

.login__submit:active:not(:disabled) {
  transform: translateY(0);
}

.login__submit:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.login__spinner {
  display: inline-block;
  width: 18px;
  height: 18px;
  border: 2px solid rgba(255, 255, 255, 0.3);
  border-top-color: #FFFFFF;
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

.login__footer {
  text-align: center;
  margin-top: 32px;
  padding-top: 20px;
  border-top: 1px solid var(--border-subtle);
}

.login__footer span {
  font-family: var(--font-sans);
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  color: var(--text-tertiary);
}
```

Changes: removed hardcoded `#0F0A1A` background, removed dark DM Mono/DM Sans font-family references, card is now white with subtle shadow (no glassmorphism), glows use blue/pink at very low opacity, submit is solid blue, error uses tinted pink pair.

- [ ] **Step 2: Verify login page**

Open http://localhost:5173 in incognito — white card on light background, blue accent button, no dark colors.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/pages/LoginPage.css
git commit -m "style: rewrite login page for Floatify light theme"
```

---

### Task 5: Remaining Page Styles

**Files:**
- Modify: `frontend/src/pages/LandingPage.css:1-202`
- Modify: `frontend/src/pages/UploadPage.css:1-186`
- Modify: `frontend/src/pages/ReviewPage.css:1-134`
- Modify: `frontend/src/pages/FinalizedPage.css:1-327`

- [ ] **Step 1: Replace `LandingPage.css`**

```css
.landing {
  max-width: 640px;
}

.landing .tenant-info {
  margin-bottom: 32px;
  animation: fadeIn 0.4s ease-out 0.1s both;
}

.landing__model {
  margin-bottom: 24px;
  overflow: hidden;
  animation: fadeIn 0.4s ease-out 0.15s both;
}

.landing__model-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 20px;
  border-bottom: 1px solid var(--border-subtle);
  background: var(--bg-tertiary);
}

.landing__model-status {
  display: flex;
  align-items: center;
  gap: 8px;
  font-family: var(--font-sans);
  font-size: 13px;
  font-weight: 600;
  color: var(--tint-green-text);
}

.landing__model-dot {
  width: 8px;
  height: 8px;
  background: var(--success);
  border-radius: 50%;
  animation: pulse 2.5s ease-in-out infinite;
}

.landing__model-version {
  font-family: var(--font-sans);
  font-size: 12px;
  font-weight: 600;
  color: var(--tint-blue-text);
  background: var(--tint-blue-bg);
  padding: 2px 10px;
  border-radius: 20px;
}

.landing__model-date {
  font-family: var(--font-sans);
  font-size: 13px;
  color: var(--text-tertiary);
}

.landing__model-body {
  padding: 16px 20px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.landing__model-detail {
  display: flex;
  align-items: baseline;
  gap: 12px;
}

.landing__model-label {
  font-family: var(--font-sans);
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  color: var(--text-tertiary);
  min-width: 80px;
  flex-shrink: 0;
}

.landing__model-detail code {
  font-family: var(--font-sans);
  font-size: 13px;
  color: var(--text-secondary);
}

.landing__model-detail span {
  font-size: 14px;
  color: var(--text-secondary);
}

.landing__model-entities {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}

.landing__actions {
  display: flex;
  flex-direction: column;
  gap: 12px;
  margin-bottom: 32px;
  animation: fadeIn 0.4s ease-out 0.2s both;
}

.landing__action-card {
  display: flex;
  align-items: center;
  gap: 20px;
  padding: 24px;
  cursor: pointer;
  transition: all 0.25s;
  border: 1px solid var(--border-primary);
}

.landing__action-card:hover {
  border-color: var(--accent);
  background: var(--accent-glow);
  transform: translateY(-1px);
  box-shadow: var(--shadow-elevated);
}

.landing__action-card:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}

.landing__action-icon {
  width: 48px;
  height: 48px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 1px solid var(--border-primary);
  border-radius: var(--radius-md);
  color: var(--accent);
  background: var(--tint-blue-bg);
  flex-shrink: 0;
}

.landing__action-content {
  flex: 1;
}

.landing__action-title {
  font-family: var(--font-sans);
  font-size: 16px;
  font-weight: 600;
  color: var(--text-primary);
  margin-bottom: 4px;
}

.landing__action-desc {
  font-size: 14px;
  color: var(--text-secondary);
  line-height: 1.5;
}

.landing__action-arrow {
  font-size: 20px;
  color: var(--text-tertiary);
  transition: transform 0.2s, color 0.2s;
}

.landing__action-card:hover .landing__action-arrow {
  transform: translateX(4px);
  color: var(--accent);
}

.landing__meta {
  display: flex;
  gap: 32px;
  padding-top: 24px;
  border-top: 1px solid var(--border-subtle);
  animation: fadeIn 0.4s ease-out 0.3s both;
}

.landing__meta-item {
  display: flex;
  align-items: center;
  gap: 8px;
}

.landing__meta-label {
  font-family: var(--font-sans);
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  color: var(--text-tertiary);
}

.landing__meta-value {
  font-size: 14px;
  color: var(--text-secondary);
}
```

- [ ] **Step 2: Replace `UploadPage.css`**

```css
.upload-page {
  max-width: 640px;
}

.upload-page .tenant-info {
  margin-bottom: 24px;
  animation: fadeIn 0.3s ease-out;
}

.upload-page__form {
  display: flex;
  flex-direction: column;
  gap: 24px;
  animation: fadeIn 0.4s ease-out 0.1s both;
}

.upload-page__options {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 16px;
}

.upload-page__buttons {
  display: flex;
  gap: 8px;
}

.upload-page__error {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px 16px;
  background: var(--tint-pink-bg);
  border: 1px solid rgba(212, 83, 126, 0.2);
  border-radius: var(--radius-md);
  color: var(--tint-pink-text);
  font-size: 14px;
}

.upload-page__error-icon {
  width: 20px;
  height: 20px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  background: var(--danger);
  color: #FFFFFF;
  font-size: 12px;
  font-weight: 700;
  flex-shrink: 0;
}

.upload-page__progress {
  margin-top: 24px;
  animation: fadeIn 0.3s ease-out;
}

.upload-page__progress-bar {
  height: 3px;
  background: var(--border-primary);
  border-radius: 2px;
  overflow: hidden;
}

.upload-page__progress-fill {
  height: 100%;
  width: 60%;
  background: linear-gradient(90deg, var(--accent), var(--accent-hover));
  border-radius: 2px;
  animation: shimmer 2s ease-in-out infinite;
  background-size: 200% 100%;
}

.upload-page__progress-text {
  font-family: var(--font-sans);
  font-size: 13px;
  color: var(--text-tertiary);
  margin-top: 8px;
  animation: pulse 2s ease-in-out infinite;
}

.upload-page__existing-model {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 12px 16px;
  background: var(--tint-blue-bg);
  border: 1px solid rgba(55, 138, 221, 0.15);
  border-radius: var(--radius-md);
  margin-bottom: 24px;
  animation: fadeIn 0.3s ease-out;
}

.upload-page__existing-model-icon {
  color: var(--info);
  flex-shrink: 0;
  margin-top: 2px;
}

.upload-page__existing-model-text {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.upload-page__existing-model-label {
  font-family: var(--font-sans);
  font-size: 13px;
  font-weight: 600;
  color: var(--tint-blue-text);
}

.upload-page__existing-model-detail {
  font-size: 13px;
  color: var(--text-secondary);
}

.upload-page__existing-model-detail code {
  font-family: var(--font-sans);
  font-size: 12px;
  background: rgba(55, 138, 221, 0.08);
  padding: 1px 5px;
  border-radius: 3px;
}

.upload-page__overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.3);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 200;
  animation: fadeIn 0.2s ease-out;
}

.upload-page__confirm {
  max-width: 420px;
  width: 90%;
  padding: 24px;
  animation: slideUp 0.3s ease-out;
}

.upload-page__confirm-title {
  font-family: var(--font-sans);
  font-size: 18px;
  font-weight: 700;
  margin-bottom: 8px;
}

.upload-page__confirm-text {
  font-size: 14px;
  color: var(--text-secondary);
  margin-bottom: 16px;
  line-height: 1.5;
}

.upload-page__confirm-detail {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 10px 12px;
  background: var(--bg-tertiary);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-sm);
  font-size: 13px;
  color: var(--text-secondary);
  margin-bottom: 20px;
}

.upload-page__confirm-detail code {
  font-family: var(--font-sans);
  font-size: 12px;
}

.upload-page__confirm-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}
```

- [ ] **Step 3: Replace `ReviewPage.css`**

```css
.review {
  display: flex;
  gap: 24px;
}

.review__main {
  flex: 1;
  min-width: 0;
}

.review--with-source .review__main {
  max-width: 65%;
}

.review-loading {
  display: flex;
  justify-content: center;
  padding: 64px;
}

.review__stats {
  display: flex;
  gap: 24px;
  align-items: center;
  margin-bottom: 24px;
  padding: 16px 20px;
  background: var(--bg-secondary);
  border: 1px solid var(--border-primary);
  border-radius: var(--radius-md);
  animation: fadeIn 0.4s ease-out 0.1s both;
}

.review__stat {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.review__stat-value {
  font-family: var(--font-sans);
  font-size: 24px;
  font-weight: 700;
  color: var(--accent);
}

.review__stat-label {
  font-family: var(--font-sans);
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  color: var(--text-tertiary);
}

.review__stat-label-mono {
  font-family: var(--font-sans);
  font-size: 13px;
  color: var(--text-tertiary);
  margin-left: auto;
}

.review__toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 24px;
  animation: fadeIn 0.4s ease-out 0.15s both;
}

.review__toolbar-right {
  display: flex;
  gap: 8px;
}

.review__no-changes {
  font-family: var(--font-sans);
  font-size: 13px;
  color: var(--text-tertiary);
  font-style: italic;
  padding: 10px 16px;
  background: var(--bg-tertiary);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  margin-bottom: 16px;
}

.review__entities {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.review__source {
  width: 35%;
  min-width: 300px;
  position: sticky;
  top: 80px;
  max-height: calc(100vh - 120px);
  display: flex;
  flex-direction: column;
  background: var(--bg-card);
  border: 1px solid var(--border-primary);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-card);
  animation: fadeIn 0.3s ease-out;
  overflow: hidden;
}

.review__source-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 16px;
  font-family: var(--font-sans);
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  color: var(--text-tertiary);
  border-bottom: 1px solid var(--border-subtle);
  background: var(--bg-tertiary);
  flex-shrink: 0;
}

.review__source-text {
  font-family: var(--font-sans);
  font-size: 13px;
  line-height: 1.7;
  color: var(--text-secondary);
  padding: 16px;
  overflow-y: auto;
  white-space: pre-wrap;
  word-break: break-word;
  flex: 1;
}
```

- [ ] **Step 4: Replace `FinalizedPage.css`**

```css
.finalized {
  max-width: 900px;
}

.finalized__confirm-banner {
  display: flex;
  align-items: flex-start;
  gap: 20px;
  margin-bottom: 32px;
  animation: slideUp 0.5s ease-out;
}

.finalized__confirm-icon {
  width: 52px;
  height: 52px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--tint-blue-bg);
  border: 1px solid rgba(55, 138, 221, 0.3);
  border-radius: 50%;
  color: var(--accent);
  flex-shrink: 0;
  margin-top: 4px;
}

.finalized__confirm-banner .page-header {
  margin-bottom: 0;
}

.finalized__confirm-banner code {
  font-family: var(--font-sans);
  font-size: 14px;
  background: var(--tint-blue-bg);
  color: var(--tint-blue-text);
  padding: 2px 8px;
  border-radius: 4px;
}

.finalized__unchanged {
  display: flex;
  align-items: flex-start;
  gap: 20px;
  margin-bottom: 32px;
  animation: slideUp 0.5s ease-out;
}

.finalized__unchanged-icon {
  width: 52px;
  height: 52px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--tint-blue-bg);
  border: 1px solid rgba(55, 138, 221, 0.2);
  border-radius: 50%;
  color: var(--info);
  flex-shrink: 0;
  margin-top: 4px;
}

.finalized__unchanged .page-header {
  margin-bottom: 0;
}

.finalized__loading {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 16px;
  padding: 64px 0;
}

.finalized__loading-text {
  font-family: var(--font-sans);
  font-size: 14px;
  color: var(--text-tertiary);
  animation: pulse 2s ease-in-out infinite;
}

.finalized__meta {
  display: flex;
  flex-wrap: wrap;
  gap: 24px;
  margin-bottom: 24px;
  padding: 16px 20px;
  background: var(--bg-secondary);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  animation: fadeIn 0.4s ease-out 0.15s both;
}

.finalized__meta-item {
  display: flex;
  flex-direction: column;
  gap: 2px;
  font-size: 14px;
}

.finalized__meta-label {
  font-family: var(--font-sans);
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  color: var(--text-tertiary);
}

.finalized__meta-version {
  font-family: var(--font-sans);
  font-size: 15px;
  font-weight: 700;
  color: var(--accent);
}

.finalized__meta-item code {
  font-family: var(--font-sans);
  font-size: 13px;
  color: var(--text-secondary);
}

.finalized__tables {
  margin-bottom: 24px;
  animation: fadeIn 0.5s ease-out 0.2s both;
}

.finalized__tables-header {
  font-family: var(--font-sans);
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  color: var(--text-tertiary);
  margin-bottom: 12px;
}

.finalized__tables-note {
  font-size: 13px;
  color: var(--text-tertiary);
  font-style: italic;
  margin-bottom: 12px;
}

.finalized__entity-table {
  margin-bottom: 12px;
  overflow: hidden;
}

.finalized__entity-table-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 16px;
  border-bottom: 1px solid var(--border-subtle);
  background: var(--bg-tertiary);
}

.finalized__entity-table-name {
  font-family: var(--font-sans);
  font-size: 14px;
  font-weight: 600;
  color: var(--text-primary);
}

.finalized__entity-table-count {
  font-family: var(--font-sans);
  font-size: 13px;
  color: var(--text-tertiary);
}

.finalized__entity-table-scroll {
  overflow-x: auto;
}

.finalized__entity-table table {
  width: 100%;
  border-collapse: collapse;
  min-width: max-content;
}

.finalized__entity-table th {
  text-align: left;
  padding: 8px 12px;
  border-bottom: 1px solid var(--border-subtle);
  background: var(--bg-tertiary);
  vertical-align: top;
  min-width: 100px;
}

.finalized__col-header {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.finalized__col-header code {
  font-family: var(--font-sans);
  font-size: 12px;
  font-weight: 600;
  color: var(--text-primary);
}

.finalized__col-meta {
  display: flex;
  align-items: center;
  gap: 4px;
}

.finalized__col-type {
  font-family: var(--font-sans);
  font-size: 10px;
  font-weight: 500;
  color: var(--text-tertiary);
  background: var(--bg-primary);
  padding: 1px 6px;
  border-radius: 4px;
  border: 1px solid var(--border-subtle);
}

.finalized__col-req {
  font-family: var(--font-sans);
  font-size: 10px;
  font-weight: 600;
  text-transform: uppercase;
  color: var(--tint-blue-text);
}

.finalized__entity-table td {
  padding: 8px 12px;
  border-bottom: 1px solid var(--border-subtle);
}

.finalized__sample-value {
  font-family: var(--font-sans);
  font-size: 13px;
  color: var(--text-tertiary);
  font-style: italic;
}

.finalized__preview {
  margin-bottom: 24px;
  overflow: hidden;
  animation: fadeIn 0.5s ease-out 0.25s both;
}

.finalized__preview-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 16px;
  font-family: var(--font-sans);
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  color: var(--text-tertiary);
  border-bottom: 1px solid var(--border-subtle);
  background: var(--bg-tertiary);
}

.finalized__preview-actions {
  display: flex;
  gap: 6px;
}

.finalized__preview-body {
  position: relative;
}

.finalized__preview-code {
  font-family: var(--font-sans);
  font-size: 13px;
  line-height: 1.6;
  color: var(--text-secondary);
  padding: 16px;
  overflow: auto;
  white-space: pre-wrap;
  word-break: break-word;
}

.finalized__preview-fade {
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  height: 48px;
  background: linear-gradient(transparent, var(--bg-card));
  display: flex;
  align-items: flex-end;
  justify-content: center;
  padding-bottom: 8px;
}

.finalized__preview-more {
  font-family: var(--font-sans);
  font-size: 13px;
  color: var(--accent);
  background: var(--bg-card);
  border: 1px solid var(--border-primary);
  border-radius: var(--radius-sm);
  padding: 4px 12px;
  cursor: pointer;
  transition: all 0.2s;
}

.finalized__preview-more:hover {
  border-color: var(--accent);
  background: var(--tint-blue-bg);
}

.finalized__actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  animation: fadeIn 0.5s ease-out 0.3s both;
}

.finalized__actions-left {
  display: flex;
  gap: 8px;
}
```

- [ ] **Step 5: Walk through full flow**

Login → Landing → Upload → Review → Finalize. Every page should be light themed, no dark remnants.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/pages/LandingPage.css frontend/src/pages/UploadPage.css frontend/src/pages/ReviewPage.css frontend/src/pages/FinalizedPage.css
git commit -m "style: update all page styles to Floatify light theme"
```

---

### Task 6: Verification

**Files:** None (verification only)

- [ ] **Step 1: Check for dark remnants**

```bash
grep -rn 'backdrop-filter' frontend/src/
grep -rn '#0F0A1A\|#1A1230\|#15102A' frontend/src/
grep -rn '#667EEA\|#7C3AED\|#A78BFA' frontend/src/
```

All three should return zero results.

- [ ] **Step 2: Check minimum font sizes**

```bash
grep -rn 'font-size: [0-9]px\|font-size: 10px\|font-size: 11px' frontend/src/ --include='*.css'
```

Only `.finalized__col-type` and `.finalized__col-req` at `10px` should remain (these are tiny type/required badges in table headers — acceptable). No `9px` should exist.

- [ ] **Step 3: Verify WCAG contrast in browser**

Open DevTools on any page. Spot-check:
- `--text-primary` (#1A202C) on `--bg-primary` (#F8FAFC) → contrast ratio 14.7:1 (AAA)
- `--text-secondary` (#4A5568) on white → contrast ratio 7.0:1 (AAA)
- `--text-tertiary` (#A0AEC0) on white → contrast ratio 2.7:1 (below AA for body text, acceptable for labels/metadata per spec)

- [ ] **Step 4: Verify line-height**

Inspect `.page-header__desc` — should show `line-height: 1.6`. Inspect body — should inherit `1.6` from body rule.
