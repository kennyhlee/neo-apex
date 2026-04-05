## 1. Add ui-tokens dependency

- [ ] 1.1 In `papermite/frontend/package.json`, add `"@neoapex/ui-tokens": "file:../../ui-tokens"` to the `dependencies` field
- [ ] 1.2 Run `npm install` in `papermite/frontend/` to link the package into `node_modules`

## 2. Update index.css to import from ui-tokens

- [ ] 2.1 In `papermite/frontend/src/index.css`, replace the opening `@import url('https://fonts.googleapis.com/...')` line and the entire `:root { ... }` block (lines 1–59) with:
  ```css
  @import '@neoapex/ui-tokens/tokens.css';

  :root {
    --font-mono: 'Inter', system-ui, sans-serif;
  }
  ```
  The Google Fonts import is already included in `tokens.css`; `--font-mono` is kept locally because ui-tokens does not define it.
- [ ] 2.2 Verify that the remaining contents of `index.css` (CSS reset, `html`/`body`/`#root` styles, and all six `@keyframes` definitions) are unchanged and still present after the edit
