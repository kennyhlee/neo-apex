## Why

Today, when a school admin opens the "Add Student" (or any add-entity) form in AdminDash, every field starts empty. For fields whose value is the same on almost every record (e.g., `grade_level = "9"`, `enrollment_status = "active"`, `school_year = "2026-2027"`), staff retype the same value over and over.

Issue [#70](https://github.com/kennyhlee/neo-apex/issues/70) asks Papermite's form builder to let the tenant admin set a per-field **default value** as part of the model definition. AdminDash then prefills that default on the Add Entity form. The user can still edit before saving — the default is a starting point, not a constraint.

## What Changes

- Papermite Review page: each field row gets a new **Default** input (a third inline-edit cell, after Name and Sample Value), wired with the same edit pattern as the existing Sample Value cell.
- Papermite extraction model (`FieldMapping`) gains an optional `default` field that flows through `_build_model_definition` into the stored model definition under each field's `default` key.
- Stored model definition `FieldDefinition` shape extends to include `default?: unknown` (omitted when unset).
- AdminDash `DynamicForm` reads `field.default` and uses it as the initial value when no `initialValues` override is supplied for that field. Document-extract prefill (`initialValues`) continues to win over `default`.
- Reopening a saved model in Papermite (LandingPage → Edit) restores existing defaults into the editor (`modelToExtraction`).

Out of scope (explicitly):

- No new field type. Defaults are stored and prefilled as strings/booleans matching the field's existing `type`; validation rules are unchanged.
- No server-side enforcement of defaults. If `default` is missing on save, AdminDash submits empty as it does today.
- No bulk-add prefill changes. `BulkAddStudentsPage` and the bulk-add orchestrator are out of scope; this proposal targets the single-entity Add Entity form only.
- No "lock default" / read-only feature. Default values are always editable in the Add form.
- No changes to `_infer_type` in `_build_model_definition`. The existing override behavior (which can change the stored `type` based on the Sample Value) is left alone; submit-time validation in AdminDash continues to catch shape mismatches the same way it does today.

Targeted edge-case behavior (in scope):

- Changing a field's `type` clears its `default` (parallel to the existing clearing of `options`/`multiple`).
- Toggling `multiple` on a selection field clears its `default` (string ↔ array shapes are not coerced).
- AdminDash's `DynamicForm` coerces prefilled `number` defaults via `Number(...)` so untouched submissions still POST a number, not a string.

## Capabilities

### New Capabilities
- `field-default-values`: a per-field default value is captured in Papermite's form builder, persisted in the model definition, and prefilled into AdminDash's Add Entity form (still editable).

### Modified Capabilities
- None. `papermite-attribute-rename` covers field-name editing only; the new Default cell is a parallel, independent cell. `admindash-backend-api` is a transparent proxy and needs no change.

## Impact

**Papermite frontend** (`papermite/frontend/`):
- `src/types/models.ts`: add `default?: unknown` to `FieldMapping` and `FieldDefinition`.
- `src/components/FieldRow.tsx`: render a Default cell (inline-edit, same pattern as the existing value cell); add `onDefaultChange` prop.
- `src/components/EntityCard.tsx`: add a "Default" `<th>` and wire `onDefaultChange` through to update `field_mappings[i].default`.
- `src/components/AddFieldForm.tsx`: gains an optional Default input so newly added custom fields can have one too.
- `src/api/client.ts`: `modelToExtraction()` copies `default` from stored model fields back into `FieldMapping.default`.

**Papermite backend** (`papermite/backend/`):
- `app/models/extraction.py`: add `default: Optional[Any] = None` to `FieldMapping`.
- `app/api/finalize.py`: `_build_model_definition()` includes `"default": mapping.default` in the field dict when not None.
- New tests: `tests/test_finalize_helpers.py` covers default round-tripping in `_build_model_definition`.

**AdminDash frontend** (`admindash/frontend/`):
- `src/types/models.ts`: add `default?: unknown` to `ModelFieldDefinition`.
- `src/components/DynamicForm.tsx`: `buildValues()` falls back to `field.default` (when defined) before the type-based empty default (`false` for bool, `''` otherwise). `initialValues` overrides still win.

**DataCore** (no code change):
- Model definitions are stored as opaque JSON by `papermite`'s LanceDB layer. The new `default` key travels through unchanged. No DataCore endpoints to modify.

**Backwards compatibility**:
- Existing model definitions without `default` keys continue to work; `default` is read with optional chaining and treated as "no default" when absent.
- Reopening an existing model in Papermite shows blank Default cells until the user fills them in.
