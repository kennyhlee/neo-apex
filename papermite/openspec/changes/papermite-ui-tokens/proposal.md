## Why

Papermite's `frontend/src/index.css` contains a hand-copied `:root { ... }` block with 54 CSS custom properties that are identical to the shared `@neoapex/ui-tokens` package. This duplication means any design token update (color tweak, spacing change, new token) must be applied in two places and will silently drift over time. The `@neoapex/ui-tokens` package was created specifically to eliminate this problem across all NeoApex modules; Papermite should consume it like LaunchPad already does.

## What Changes

- Add `@neoapex/ui-tokens` as an npm dependency in `papermite/frontend/package.json`
- Replace the duplicate `:root { ... }` token block in `frontend/src/index.css` with `@import '@neoapex/ui-tokens/tokens.css';`
- Retain all Papermite-specific CSS in `index.css` that is not covered by ui-tokens: CSS reset, global body styles, `--font-mono` local token, and keyframe animations

## Capabilities

### New Capabilities
- `ui-tokens-integration`: Papermite frontend consumes design tokens from `@neoapex/ui-tokens` instead of maintaining its own duplicate token definitions.

### Modified Capabilities

## Impact

- `papermite/frontend/package.json` — add `@neoapex/ui-tokens` dependency
- `papermite/frontend/src/index.css` — remove `:root` token block, add `@import` at top
- No changes to any component or page CSS files (they already reference the correct variable names)
- No changes to inline styles in TSX files
