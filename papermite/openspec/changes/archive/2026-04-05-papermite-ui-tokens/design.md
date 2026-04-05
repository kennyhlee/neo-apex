## Context

Papermite's frontend uses plain CSS with CSS custom properties. Its `index.css` defines a `:root` block of 54 tokens that are byte-for-byte identical to those in `@neoapex/ui-tokens/tokens.css`. The `@neoapex/ui-tokens` package already exists at the repo root and is consumed by LaunchPad via the `file:../../ui-tokens` local npm reference. All 9 Papermite component/page CSS files reference these variables (`var(--accent)`, `var(--bg-primary)`, etc.) — the variable names will not change, so no component files need modification.

## Goals / Non-Goals

**Goals:**
- Papermite's frontend derives all shared design tokens from `@neoapex/ui-tokens` (single source of truth)
- Token values are always in sync with the rest of NeoApex without manual updates
- Visual output is unchanged — same values, now sourced from the package

**Non-Goals:**
- Changing any visual design (colors, spacing, typography)
- Touching any component or page CSS files
- Adding new tokens to `@neoapex/ui-tokens`
- Migrating animations or app-specific styles into `@neoapex/ui-tokens`

## Decisions

### 1. Use `file:` local npm reference (same as LaunchPad)

**Decision**: Reference ui-tokens as `"@neoapex/ui-tokens": "file:../../ui-tokens"` in `package.json`.

**Rationale**: This is exactly what LaunchPad does. Keeps the pattern consistent across modules. No publishing or registry setup needed since all NeoApex packages are local monorepo packages.

### 2. Keep `--font-mono` and animations in `index.css`

**Decision**: Do not remove `--font-mono: 'Inter', system-ui, sans-serif;` or the keyframe animations from `index.css`.

**Rationale**: `@neoapex/ui-tokens` does not define `--font-mono`. It also doesn't define Papermite-specific animations (`slideUp`, `pulse`, `borderGlow`, `shimmer`). These stay local to avoid over-expanding the shared package scope.

### 3. `@import` at the top of `index.css`, before the reset block

**Decision**: Place `@import '@neoapex/ui-tokens/tokens.css';` as the first line of `index.css`, before any `*` selectors or `:root` overrides.

**Rationale**: CSS `@import` rules must precede all other rules (except `@charset`). This matches LaunchPad's pattern.

## Risks / Trade-offs

- **`file:` packages require `npm install` after checkout** → Same requirement already exists for LaunchPad; devs are familiar with this.
- **ui-tokens token values could diverge from papermite's current values** → Highly unlikely; values were already identical. If they ever differ, papermite can override specific variables locally in `index.css` after the import.

## Migration Plan

1. Run `npm install` in `papermite/frontend/` after adding the dependency — this symlinks ui-tokens into `node_modules/@neoapex/ui-tokens/`.
2. Update `index.css`: remove `:root { ... }` block, add `@import` at top.
3. Verify app loads visually unchanged by running the dev server.
4. **Rollback**: Remove the `@import` and restore the `:root` block from git history.

## Open Questions

None. The migration is mechanical; token values are identical.
