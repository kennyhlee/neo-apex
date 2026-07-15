## Context

`papermite/frontend/src/components/FieldRow.tsx` is the per-field row in the Review page's `EntityCard`. It supports:

1. Editing a field's sample value (click value → text input → blur/Enter saves).
2. Changing the field's data type (custom fields only).
3. For selection fields: opening an inline `OptionsEditor` to add/remove allowed options and toggle `multiple`.

The current edit path uses a single text input regardless of `fieldType`. The bug is at line 108:

```tsx
const [editValue, setEditValue] = useState(String(value ?? ""));
```

`String(value)` on an array/object produces `"[object Object],[object Object]"`. Meanwhile, the read-only display path at lines 121-126 already handles objects with `JSON.stringify`, so the two are inconsistent.

Selection-type field values flow in from `services/mapper.py` and can be:
- `null` / missing
- A single string (`"Active"`)
- A list of strings (`["1st", "2nd"]`)
- A list of dicts in pathological extractions (`[{...}, {...}]`) — this is the bug-triggering shape.

`FieldMapping.options` is `string[] | undefined` and `multiple` is `boolean | undefined`. The Review page's value editor is meant to let the user fix a sample/example value, not bulk-edit data, so a richer control is acceptable.

## Goals / Non-Goals

**Goals:**
- Clicking a selection field with object/array `value` never shows `"[object Object]"` — neither in display nor in the edit input.
- When a selection field has `options.length > 0`, the editor uses a control that constrains input to those options.
- Multi-select fields (`multiple: true`) edit as an array of strings; single-select fields edit as a string.
- Saving never produces a value whose shape contradicts the field's declared `multiple` flag.

**Non-Goals:**
- Changing the storage shape of `FieldMapping.value` (still `unknown`).
- Touching AdminDash `DynamicForm` or Launchpad `FieldInput` (already covered by `selection-cardinality`).
- Adding generalized form validation across all field types — only the selection branch gets specialized handling.
- Building a full React Testing Library setup if one doesn't already exist; we'll keep tests lightweight and pragmatic (see Risks).

## Decisions

### Decision 1: Render selection controls always-inline in the Value cell (no click-to-edit toggle for selection-with-options)
**What:** When `fieldType === "selection"` and `(options?.length ?? 0) > 0`, the Value cell renders the appropriate control directly — bypassing the existing display-span + edit-input toggle pattern. For all other cases (non-selection fields, or selection fields with no options), the existing click-to-edit text input is preserved.

**Why:** Consistent with the `OptionsEditor` panel in the same component (also always-visible when its `[N opts]` button is toggled). Eliminates a transient edit state and the awkward "how do I exit multi-select edit mode" problem (no Done button needed, no click-outside handler). The control IS the display. Alternative considered: click-to-edit with a Done button — rejected because it adds a foreign affordance inside a table cell and complicates focus/state management.

### Decision 2: Use `<select>` for single-select with options
**What:** When `fieldType === "selection"`, `!multiple`, and `options.length > 0`, render `<select className="input field-row__input">` with `<option value="">— none —</option>` plus one `<option>` per allowed value. `onChange` calls `onUpdate(fieldName, e.target.value)` directly — no edit-mode entry/exit.

**Why:** Single-cell dropdown matches the data-type `<select>` already in this component (line 161-169) for visual consistency. Reuses existing `.input` and `.field-row__input` styles, so no new CSS is needed for the single-select case. Radio buttons would be over-tall and crowd the table row.

### Decision 3: Use inline checkboxes for multi-select with options
**What:** When `fieldType === "selection"`, `multiple === true`, and `options.length > 0`, render a `<div className="field-row__multi-edit">` with one `<label><input type="checkbox"/>{opt}</label>` per option. Each `onChange` computes the next array (add or remove `opt`) and calls `onUpdate(fieldName, next)` directly — no edit-mode entry/exit, no Done button.

**Why:** `<select multiple>` in a table cell is unwieldy. Inline checkboxes match the established Papermite tag/option visual pattern (see `options-editor__list`). With save-on-toggle and no edit mode, there's no need for a commit affordance.

### Decision 4: Single `toEditString(v)` helper for display + fallback edit input
**What:** Extract one helper used in both the display path (for non-selection fields, and selection fields without options) and the text-input fallback edit-init:

```tsx
const toEditString = (v: unknown): string =>
  v === null || v === undefined || v === ""
    ? ""
    : typeof v === "object"
      ? JSON.stringify(v)
      : String(v);
```

Display path uses `toEditString(value) || "—"` (em-dash for empty); edit-init uses `toEditString(value)` directly. This eliminates the `String(value)` path entirely so no `"[object Object]"` can be produced anywhere in the component.

**Why:** One helper, one place to test, no risk of the two serializers drifting again. The em-dash placeholder behavior is preserved by the `|| "—"` fallback for the display case only.

### Decision 5: Sanitize legacy/garbage values when binding to the inline control
**What:** Derive the control's bound state defensively from `value`:
- Single-select dropdown's `currentValue`: `typeof value === "string" ? value : (Array.isArray(value) && typeof value[0] === "string" ? value[0] : "")` — array with string head → use head; anything else → empty.
- Multi-select checkboxes' `selected` set: `Array.isArray(value) ? value.filter((s): s is string => typeof s === "string") : (typeof value === "string" ? [value] : [])` — array → keep only string entries; string → wrap; anything else → empty.

**Why:** Drafts persisted to IndexedDB before this fix may contain `"[object Object]"` strings or raw object arrays. The control recovers gracefully (no error, no spurious selection) so the user can pick a valid option and overwrite. No migration step is needed.

### Decision 6: Add Vitest 3 + React Testing Library + happy-dom; use `vitest/config` for the test block
**What:** Bootstrap Vitest with React Testing Library and `happy-dom` in `papermite/frontend`. Important: `vite.config.ts` currently uses `defineConfig` imported from `vite`, which has no `test` typing. Two acceptable shapes:
- **Recommended:** Switch the import in `vite.config.ts` to `import { defineConfig } from "vitest/config"` and add a `test` block.
- Alternative: keep `vite.config.ts` as-is and create a separate `vitest.config.ts` that imports from `vitest/config`.

Add `test`/`test:run` scripts, a `src/test/setup.ts` that imports `@testing-library/jest-dom/vitest`, and update `tsconfig.app.json`'s `compilerOptions.types` from `["vite/client"]` to `["vite/client", "vitest/globals", "@testing-library/jest-dom"]`.

Note: `tsconfig.app.json` has `verbatimModuleSyntax: true`, so test files MUST use `import type {...}` for type-only imports (e.g., `import type { FieldType } from "../types/models"`). Existing files in `src/` already follow this pattern.

Tests cover four focused cases for `FieldRow`:
1. Object value displays as JSON, never `"[object Object]"`.
2. Non-selection field with array-of-objects value entering edit mode initializes the text input via `JSON.stringify`, never `String(value)`.
3. Selection field with `multiple: false` + options renders a `<select>` inline (not click-to-edit) and `onUpdate` is called with the chosen string on change.
4. Selection field with `multiple: true` + options renders one checkbox per option inline; toggling `"Tue"` on a field whose current value is `["Mon"]` invokes `onUpdate(fieldName, ["Mon", "Tue"])`.

**Why:** User opted in over the deferred-harness alternative; locks in regression coverage and establishes the test pattern for future papermite frontend work. `happy-dom` over `jsdom` for faster startup; trivial to swap if quirks appear. Pinning to Vitest 3+ ensures compatibility with Vite 8 already in `package.json`.

## Risks / Trade-offs

- **Risk:** Adding Vitest as the first test harness in `papermite/frontend` introduces new dev deps, a config decision, and tsconfig changes. → Mitigation: scoped to `papermite/frontend` only; no impact on other services. Use Vitest 3+ for Vite 8 compatibility.
- **Risk:** Always-inline controls add visual weight to every Review-page row with a selection field. → Mitigation: dropdown reuses existing `.input` / `.field-row__input` styles so visual footprint matches the data-type select; checkbox group wraps via flex like `OptionsEditor` already does.
- **Trade-off:** Removing click-to-edit for selection-with-options means the cell is interactive on mount (no "click first" affordance). → Mitigation: this is consistent with the data-type `<select>` in the same row, which is also always-interactive; user mental model is preserved.
- **Risk:** Multi-select editor doesn't expose a "clear all" affordance. → Mitigation: deferred; user can uncheck each option, and the row's `value` becomes `[]` which serializes back cleanly.
- **Risk:** Drafts persisted to IndexedDB before this fix may contain corrupted `"[object Object]"` strings. → Mitigation: Decision 5's defensive binding leaves no selection in that state; user picks a real option and the next save overwrites the bad value.

## Open Questions

- (Resolved) Add Vitest harness to `papermite/frontend` as part of this change — see Decision 6.
