## Why

After Papermite's LLM processes an uploaded document, the detected attribute names (field names) appear in the review UI as read-only text. Users can edit values, types, required flags, and selection options — but not the name itself. Since these names become the actual field labels in the final model definition that drives end-user forms, locking them forces users to either accept whatever wording the LLM produced or discard the field entirely and recreate it. Resolves [#67](https://github.com/kennyhlee/neo-apex/issues/67).

## What Changes

- Make the field name cell on **custom-field rows** in the review screen editable, using the same click-to-edit inline pattern already established for the value cell. Base-model field names remain locked, matching how base-field *types* are already locked (`field-row__type-locked`).
- Add an `onFieldNameChange` callback path from `FieldRow` up through `EntityCard` so renames update the in-memory `ExtractionResult` consistently: rename the entry inside `field_mappings`, the key inside `entity.entity`, and the key inside `entity.entity.custom_fields` — preserving order and all other properties (mirrors how `handleFieldDelete` cleans up all three).
- Validate field names client-side: non-empty (after trim), unique within the entity (compared against **all** sibling mappings, base + custom, to prevent a custom field colliding with a base name). Reject the edit (revert and surface a brief inline error) on conflict.
- The rename handler returns a discriminated result (`{ ok: true } | { ok: false, error: string }`) rather than throwing, so the `FieldRow` can render the error inline without needing try/catch in event handlers.
- Backend `_build_model_definition` and the `FieldMapping` Pydantic model already pass `field_name` through verbatim, so no backend code changes are needed — only a regression test confirming custom-field renames reach the persisted model definition.

## Capabilities

### New Capabilities

- `papermite-attribute-rename`: Inline rename of extracted attribute (field) names in the Papermite review screen, with uniqueness validation and propagation through finalize.

### Modified Capabilities

<!-- None — no existing Papermite specs in openspec/specs/. -->

## Impact

- **Frontend** (`papermite/frontend/`):
  - `src/components/FieldRow.tsx` — for custom-field rows, replace the static `<code>{fieldName}</code>` with an editable input/display toggle; add the `onFieldNameChange` prop. Base-field rows continue to render `<code>{fieldName}</code>` with no click handler.
  - `src/components/EntityCard.tsx` — add `handleFieldNameChange` that enforces non-emptiness + uniqueness, renames the matching entry in `entity.field_mappings`, and also renames the corresponding keys in `entity.entity` and `entity.entity.custom_fields` so all three stay consistent (matching the existing pattern in `handleFieldDelete`).
  - `src/components/EntityCard.css` — hover/focus affordance + `title="Click to edit"` for the editable name cell so users discover it, plus a small inline error style.
- **Backend** (`papermite/backend/`): no code changes. Add a regression test that posts a `FinalizeRequest` with a custom field renamed from the LLM-default and asserts the model definition sent to DataCore contains the new name in `custom_fields` and not the old one. Mock `httpx.put` (matches the existing pattern in `test_extract_api.py`).
- **API contracts**: unchanged. `FieldMapping.field_name` is already a free-form `str`.
- **Data**: no schema migration. Each commit produces a new model definition version via the existing DataCore versioned write.
