# Dark Theme Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the light warm theme with a dark Floatify-inspired glassmorphism theme across all post-login pages, creating visual continuity with the login page.

**Architecture:** Retheme primarily via CSS custom properties in `:root`. Most components already use `var()` references, so swapping the palette cascades everywhere. Targeted fixes for hardcoded colors in 2 component files. Zero JSX changes.

**Tech Stack:** CSS custom properties, backdrop-filter (glassmorphism), CSS gradients

**Spec:** `openspec/changes/dark-theme-redesign/design.md`

---

## File Map

| File | Action | Responsibility |
|------|--------|---------------|
| `frontend/src/index.css` | Modify (lines 3-41, 62-79) | Global CSS variables, body, scrollbar |
| `frontend/src/App.css` | Modify (lines 27-34, 154-163, 195-222, 264-269) | Header logo, buttons, inputs, selects, cards |
| `frontend/src/components/EntityCard.css` | Modify (line 140) | Toggle thumb hardcoded `white` |
| `frontend/src/components/FileUploader.css` | Modify (lines 1-128) | Drop zone colors, corner accents |
| `frontend/src/pages/UploadPage.css` | Modify (line 49, 131-140) | Error icon `white`, overlay backdrop |
| `frontend/src/pages/LandingPage.css` | No change | Already uses `var()` throughout |
| `frontend/src/pages/ReviewPage.css` | No change | Already uses `var()` throughout |
| `frontend/src/pages/FinalizedPage.css` | No change | Already uses `var()` throughout |
| `frontend/src/components/TenantInfo.css` | No change | Already uses `var()` throughout |
| `frontend/src/components/ModelSelector.css` | No change | Already uses `var()` throughout |

---

### Task 1: Replace `:root` Color Palette

**Files:**
- Modify: `frontend/src/index.css:3-41`

- [ ] **Step 1: Replace `:root` variables with dark palette**

Replace lines 3-41 in `index.css` with:

```css
:root {
  --bg-primary: #0F0A1A;
  --bg-secondary: #1A1230;
  --bg-tertiary: #15102A;
  --bg-card: rgba(255, 255, 255, 0.04);
  --bg-elevated: rgba(255, 255, 255, 0.06);
  --bg-input: rgba(255, 255, 255, 0.06);

  --border-primary: rgba(255, 255, 255, 0.1);
  --border-subtle: rgba(255, 255, 255, 0.06);
  --border-accent: rgba(102, 126, 234, 0.4);

  --text-primary: #FFFFFF;
  --text-secondary: rgba(255, 255, 255, 0.6);
  --text-tertiary: rgba(255, 255, 255, 0.35);
  --text-inverse: #FFFFFF;

  --accent: #667EEA;
  --accent-hover: #7C3AED;
  --accent-muted: rgba(102, 126, 234, 0.12);
  --accent-glow: rgba(102, 126, 234, 0.06);

  --success: #34D399;
  --success-muted: rgba(52, 211, 153, 0.1);
  --danger: #F472B6;
  --danger-muted: rgba(244, 114, 182, 0.08);
  --info: #60A5FA;
  --info-muted: rgba(96, 165, 250, 0.08);

  --font-mono: 'DM Mono', 'Menlo', monospace;
  --font-sans: 'DM Sans', -apple-system, sans-serif;

  --radius-sm: 6px;
  --radius-md: 10px;
  --radius-lg: 14px;

  --shadow-card: 0 4px 16px rgba(0, 0, 0, 0.3), 0 0 0 1px rgba(255, 255, 255, 0.05);
  --shadow-elevated: 0 8px 32px rgba(0, 0, 0, 0.4), 0 0 0 1px rgba(255, 255, 255, 0.08);
}
```

- [ ] **Step 2: Reduce noise texture opacity for dark background**

Change line 68 `opacity: 0.018;` to `opacity: 0.03;` (noise is more subtle on dark, needs slight boost).

- [ ] **Step 3: Update scrollbar colors**

Lines 76-79 already use `var()` — no change needed. Verify visually after palette swap.

- [ ] **Step 4: Verify — open http://localhost:5173, log in, confirm dark background renders**

---

### Task 2: Update App Shell & Shared Styles

**Files:**
- Modify: `frontend/src/App.css:27-34, 154-163, 264-269`

- [ ] **Step 1: Add gradient logo treatment to header**

Replace `.app-header__logo` (lines 27-34):

```css
.app-header__logo {
  font-family: var(--font-mono);
  font-size: 14px;
  font-weight: 500;
  letter-spacing: 2px;
  text-transform: uppercase;
  text-decoration: none;
  background: linear-gradient(135deg, #667EEA, #A78BFA, #F472B6);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
}
```

- [ ] **Step 2: Update `.btn--primary` to gradient with hover lift**

Replace lines 154-163:

```css
.btn--primary {
  background: linear-gradient(135deg, #667EEA, #7C3AED);
  color: #FFFFFF;
  border: none;
}

.btn--primary:hover {
  transform: translateY(-1px);
  box-shadow: 0 8px 24px rgba(102, 126, 234, 0.35);
  background: linear-gradient(135deg, #7C8FEE, #8B4AED);
}
```

- [ ] **Step 3: Add focus ring to `.input` and `.select`**

After `.input:focus` (line 200-201), update to:

```css
.input:focus {
  border-color: var(--accent);
  box-shadow: 0 0 0 3px rgba(102, 126, 234, 0.15);
}
```

After `.select:focus` (lines 220-222), update to:

```css
.select:focus {
  border-color: var(--accent);
  box-shadow: 0 0 0 3px rgba(102, 126, 234, 0.15);
}
```

- [ ] **Step 4: Update `.select` chevron SVG stroke color for dark bg**

In `.select` (line 214), change the stroke color in the SVG data URL from `%239C958C` to `%23667EEA` (purple accent instead of grey).

- [ ] **Step 5: Update `.card` to glassmorphism**

Replace lines 264-269:

```css
.card {
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: var(--radius-lg);
  backdrop-filter: blur(24px);
  -webkit-backdrop-filter: blur(24px);
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
}
```

- [ ] **Step 6: Verify — check header gradient logo, buttons, inputs, cards render correctly**

---

### Task 3: Fix Hardcoded Colors in Components

**Files:**
- Modify: `frontend/src/components/EntityCard.css:140`
- Modify: `frontend/src/pages/UploadPage.css:49, 134`

- [ ] **Step 1: Fix toggle thumb in EntityCard.css**

Line 140: change `background: white;` to `background: #FFFFFF;`

(This is cosmetic consistency — `white` and `#FFFFFF` are identical. The thumb should stay white on a dark track, which it will since the track already uses `var(--border-primary)` which becomes the dark `rgba(255,255,255,0.1)`. No functional change needed.)

- [ ] **Step 2: Fix error icon in UploadPage.css**

Line 49: `color: white;` → `color: #FFFFFF;`

(Same — cosmetic consistency. White text on `var(--danger)` background works on both themes.)

- [ ] **Step 3: Fix overlay backdrop in UploadPage.css**

Line 134: change `background: rgba(45, 42, 38, 0.35);` to `background: rgba(0, 0, 0, 0.6);`

This is a hardcoded warm-grey overlay that won't look right on dark. Black with higher opacity works on dark backgrounds.

- [ ] **Step 4: Fix `.upload-page__confirm-detail` background**

Line 168-169: `background: var(--bg-secondary)` already uses the variable. No change needed — it will pick up `#1A1230` automatically.

- [ ] **Step 5: Verify — test the upload page confirmation dialog overlay, error state, and review page toggle switches**

---

### Task 4: Update FileUploader Drop Zone

**Files:**
- Modify: `frontend/src/components/FileUploader.css:1-128`

- [ ] **Step 1: Verify FileUploader uses `var()` throughout**

Review the file — it already uses `var(--border-primary)`, `var(--bg-secondary)`, `var(--accent)`, etc. The corner accents use `var(--accent)` which will become purple automatically.

The only potential issue: `background: var(--bg-secondary)` on `.file-uploader` (line 8) and `background: var(--bg-tertiary)` on hover (line 14). These will become `#1A1230` and `#15102A` respectively, which provides subtle hover feedback on dark. This is fine.

- [ ] **Step 2: No changes needed — all styles cascade via variables**

- [ ] **Step 3: Verify — test file upload drop zone, hover state, active state with file selected**

---

### Task 5: Visual Verification Pass

**Files:** None (verification only)

- [ ] **Step 1: Login page → Landing page transition**

Log in with `jane@acme.edu` / `admin123`. Confirm no color flash between login and landing page. Both should feel dark and cohesive.

- [ ] **Step 2: Landing page**

Verify: dark background, glass model card, purple version badge, green active dot, purple accent on action cards, gradient hover effect on action cards.

- [ ] **Step 3: Upload page**

Verify: dark file drop zone with purple corners, purple progress bar during extraction, dark confirmation overlay dialog, info notice for existing model.

- [ ] **Step 4: Review page**

Verify: dark stats bar with purple accent numbers, entity cards with glass treatment, field row table with dark backgrounds, toggle switches visible (white thumb on dark track), type dropdowns readable, source panel dark.

- [ ] **Step 5: Finalize page**

Verify: dark confirm banner, meta bar, entity summary tables with dark headers, JSON preview with dark code background, gradient Confirm button.

- [ ] **Step 6: Access Denied page**

Log in with `bob@acme.edu` / `viewer123`. Verify: dark background, pink danger icon, readable text, Sign Out button.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/index.css frontend/src/App.css frontend/src/components/EntityCard.css frontend/src/pages/UploadPage.css
git commit -m "feat: dark theme redesign — replace light palette with Floatify-inspired dark glassmorphism

Swap :root CSS variables to dark palette (deep purples, glassmorphism cards,
gradient buttons). Fixes hardcoded colors in overlay backdrop and component files.
Zero JSX changes — purely CSS."
```
