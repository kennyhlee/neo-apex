## Purpose

Integrate the shared `@neoapex/ui-tokens` package into Papermite's frontend so CSS design tokens are sourced from a single canonical location rather than duplicated in `index.css`.

### Requirement: ui-tokens package declared as dependency
`papermite/frontend/package.json` SHALL list `"@neoapex/ui-tokens": "file:../../ui-tokens"` in its `dependencies` field.

#### Scenario: Package is resolvable after install
- **WHEN** `npm install` is run in `papermite/frontend/`
- **THEN** `node_modules/@neoapex/ui-tokens/tokens.css` exists and is readable

### Requirement: index.css imports ui-tokens instead of duplicating tokens
`papermite/frontend/src/index.css` SHALL begin with `@import '@neoapex/ui-tokens/tokens.css';` as its first rule, and SHALL NOT contain a `:root { ... }` block that re-declares any of the 54 properties already defined in ui-tokens (backgrounds, borders, text, accent, status, tint, font-sans, radii, shadows).

#### Scenario: Token import is the first CSS rule
- **WHEN** `index.css` is parsed by a browser or bundler
- **THEN** the `@import` statement for ui-tokens appears before any selector or at-rule other than `@charset`

#### Scenario: No duplicate token declarations remain
- **WHEN** `index.css` is inspected after migration
- **THEN** it does not define `--bg-primary`, `--accent`, `--text-primary`, or any other property already exported by `@neoapex/ui-tokens/tokens.css`

### Requirement: Papermite-specific styles are preserved in index.css
`index.css` SHALL retain the CSS reset (`*, *::before, *::after`), `html` and `body` base styles, `#root` style, the `--font-mono` custom property, and all keyframe animation definitions (`@keyframes fadeIn`, `slideUp`, `pulse`, `spin`, `borderGlow`, `shimmer`).

#### Scenario: App renders with correct global styles after migration
- **WHEN** the Papermite frontend dev server starts after migration
- **THEN** the app renders visually identically to before migration — same background color, font, spacing, and component appearance

### Requirement: No component or page CSS files are modified
All files under `papermite/frontend/src/` other than `index.css` and `package.json` SHALL remain unchanged. They continue referencing the same CSS custom property names (e.g., `var(--accent)`, `var(--bg-card)`) which are now sourced from ui-tokens.

#### Scenario: Component variables resolve correctly
- **WHEN** any component CSS file references `var(--accent)` or other ui-token properties
- **THEN** the value resolves to the correct token value from `@neoapex/ui-tokens/tokens.css`
