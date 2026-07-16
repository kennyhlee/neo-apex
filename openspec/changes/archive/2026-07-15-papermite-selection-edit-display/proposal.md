## Why

In Papermite's Review page, clicking a selection-type field's value to edit reveals a corrupted string like `"[object Object],[object Object]"` whenever the underlying value is an array or object (issue #68). The bug exists because `FieldRow.tsx` initializes `editValue` with `String(value ?? "")` while the read-only display path uses `JSON.stringify` for objects — the two serializers disagree, and the edit path silently round-trips garbage back into the model definition draft if the user saves.

Beyond the serialization mismatch, the underlying UX is wrong for selection fields: even with valid string options, the editor is a free-text input. Users can type arbitrary text that violates the declared option set, defeating the purpose of having `options`/`multiple` on the field.

## What Changes

- Fix the immediate display bug: `editValue` initialization SHALL use the same serializer as the read-only display so object/array values do not collapse into `"[object Object]"` on first click.
- Render a selection-aware control **inline and always-visible** in the Value cell when a `selection`-type field has at least one option defined — no click-to-edit toggle for selection fields with options:
  - `multiple: false` → `<select>` dropdown bound to the option list, with an empty/placeholder choice for the unset state. Choosing an option saves immediately.
  - `multiple: true` → inline checkbox group, one per option, persisting an array of selected option strings. Each toggle saves immediately.
- Preserve the existing click-to-edit text input **only** when the field is `selection`-type but has no options defined yet (so users can still seed values from a fresh extraction before opening the options editor), or for any non-selection field.
- Add/remove options remains handled by the existing `OptionsEditor` panel (toggled by the `[N opts]` button in the Data Type column); this change does not touch that flow.
- Sanitize legacy values when binding to the inline control:
  - Array of strings → bind to multi-select state (`multiple: true`) or first element (`multiple: false`).
  - Array of objects / generic object → leave no option pre-selected and let the user choose afresh, but never coerce to `"[object Object]"`.
- Out of scope: AdminDash `DynamicForm` and Launchpad `FieldInput` — they already render radio/checkbox controls via the `selection-cardinality` capability and are not affected by this bug.

## Capabilities

### New Capabilities
- `papermite-field-row-editor`: Defines how Papermite's Review-page FieldRow renders and edits values per field type, focusing on selection-aware editing and safe serialization of object/array values.

### Modified Capabilities
<!-- selection-cardinality covers AdminDash/Launchpad rendering and the model-level multiple property. Papermite's editor was deliberately out of that scope, so we are NOT modifying that capability — we are adding a sibling. -->

## Impact

- Code: `papermite/frontend/src/components/FieldRow.tsx` (edit-value initialization + new selection editor branches), `papermite/frontend/src/components/FieldRow.css` (or `EntityCard.css`) for the new dropdown/checkbox group styles.
- Tests: New unit tests for FieldRow selection edit behavior — likely the first React component tests in the papermite frontend, so we will add Vitest + React Testing Library setup if not already present.
- No backend changes. No changes to `FieldMapping` schema, mapper, or LanceDB storage. No changes to other frontends.
- No breaking changes to persisted model definitions; the fix is purely render/editor behavior.
