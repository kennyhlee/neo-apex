# papermite-ui-tokens Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Papermite's duplicate `:root { ... }` CSS token block with an `@import` from the shared `@neoapex/ui-tokens` package so all NeoApex modules use one source of design tokens.

**Architecture:** Add `@neoapex/ui-tokens` as a local npm dependency (same `file:` reference LaunchPad uses), then replace lines 1–59 of `index.css` with `@import '@neoapex/ui-tokens/tokens.css';` plus a minimal `:root` override for `--font-mono` (the one token not in ui-tokens). No component or page CSS files change — they already reference the correct variable names.

**Tech Stack:** Node/npm, Vite, plain CSS, `@neoapex/ui-tokens` local package

---

### Task 1: Add @neoapex/ui-tokens as an npm dependency

**Files:**
- Modify: `papermite/frontend/package.json`

- [ ] **Step 1: Add the dependency to package.json**

Open `papermite/frontend/package.json` and add `"@neoapex/ui-tokens": "file:../../ui-tokens"` to the `dependencies` object:

```json
{
  "name": "frontend",
  "private": true,
  "version": "0.0.0",
  "type": "module",
  "dependencies": {
    "@neoapex/ui-tokens": "file:../../ui-tokens",
    "idb": "^8.0.3",
    "react": "^19.2.4",
    "react-dom": "^19.2.4",
    "react-router-dom": "^7.13.1"
  },
  "devDependencies": {
    "@eslint/js": "^9.29.0",
    "@types/react": "^19.1.5",
    "@types/react-dom": "^19.1.5",
    "@vitejs/plugin-react": "^4.5.2",
    "eslint": "^9.29.0",
    "eslint-plugin-react-hooks": "^5.2.0",
    "eslint-plugin-react-refresh": "^0.4.20",
    "globals": "^16.1.0",
    "typescript": "~5.8.3",
    "vite": "^6.3.5"
  },
  "scripts": {
    "dev": "vite",
    "build": "tsc -b && vite build",
    "lint": "eslint .",
    "preview": "vite preview"
  }
}
```

(Only the `@neoapex/ui-tokens` line is new — copy the rest of the file exactly as-is.)

- [ ] **Step 2: Install the dependency**

Run from `papermite/frontend/`:
```bash
npm install
```
Expected: `added N packages` or `up to date` — no errors. The `file:../../ui-tokens` symlink resolves from the monorepo root.

- [ ] **Step 3: Verify the package is linked**

```bash
ls node_modules/@neoapex/ui-tokens/
```
Expected: `tokens.css` and `package.json` are visible

- [ ] **Step 4: Commit**

```bash
git add papermite/frontend/package.json papermite/frontend/package-lock.json
git commit -m "chore(papermite): add @neoapex/ui-tokens dependency"
```

---

### Task 2: Replace duplicate token block with @import

**Files:**
- Modify: `papermite/frontend/src/index.css`

- [ ] **Step 1: Replace lines 1–59 of `index.css`**

The current file opens with a Google Fonts `@import` on line 1 and a `:root { ... }` block on lines 3–59. Both are replaced by a single `@import` from ui-tokens (which already includes the Google Fonts URL internally) plus a minimal `:root` that keeps only `--font-mono`.

Replace the entire file with:

```css
@import '@neoapex/ui-tokens/tokens.css';

:root {
  --font-mono: 'Inter', system-ui, sans-serif;
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

- [ ] **Step 2: Start the dev server and verify visually**

Run from `papermite/frontend/`:
```bash
npm run dev
```
Expected: Vite starts on `http://localhost:5173` with no CSS errors in the terminal. Open the app in a browser — the login page, landing page, and review page should look visually identical to before (same colors, fonts, spacing).

- [ ] **Step 3: Run a production build to confirm Vite resolves the import**

```bash
npm run build
```
Expected: build succeeds with no warnings about unresolved CSS imports

- [ ] **Step 4: Commit**

```bash
git add papermite/frontend/src/index.css
git commit -m "feat(papermite): replace duplicate token block with @import from @neoapex/ui-tokens"
```
