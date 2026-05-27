## Context

Papermite's Review page (`FieldRow.tsx`) currently exposes five cells per field row: **Name**, **Sample Value**, **Data Type**, **Base/Custom badge**, **Required toggle**, plus an actions cell. The Sample Value is what the AI extracted from the source document — useful for the user to verify the extraction, but it is **not** persisted as part of the model definition; only `name`, `type`, `required`, and (for `selection`) `options`/`multiple` are persisted via `_build_model_definition` in `app/api/finalize.py`.

AdminDash's `DynamicForm.tsx` (used by `AddStudentModal`, `ProgramPage` Add, etc.) builds the form's initial value map (`buildValues`) by walking the model definition's `base_fields` + `custom_fields` and defaulting each to `false` (bool) or `''` (everything else). If the caller passes `initialValues` (e.g., values extracted from a document via Papermite's `/api/extract`), those override the empty defaults.

Issue #70 asks for a third dimension: a tenant-configured **default value** per field, persisted in the model definition and prefilled into the Add Entity form. The user can still edit it before submitting.

Touched components: Papermite frontend `FieldRow`/`EntityCard`/`AddFieldForm`/`api/client.ts`/`types/models.ts`, Papermite backend `models/extraction.py` + `api/finalize.py`, AdminDash frontend `types/models.ts` + `components/DynamicForm.tsx`. DataCore is unchanged (model definitions are opaque JSON to it).

## Goals / Non-Goals

**Goals:**
- Allow the tenant admin to set a per-field default value in Papermite's Review page (and in `AddFieldForm` when creating a new custom field).
- Persist the default in the stored model definition under each field as `default: <value>`.
- Prefill the default into AdminDash's Add Entity form when the field has no `initialValues` override.
- Round-trip correctly: opening an existing model in Papermite (LandingPage → Edit) restores the saved default into the editor; saving again writes it back.
- Backwards-compatible with existing model definitions (no `default` key ⇒ no prefill, blank input).

**Non-Goals:**
- Per-tenant or per-role defaults beyond what the model definition already encodes.
- Required-on-save enforcement of defaults (defaults are purely UI prefill).
- Bulk-add prefill changes (`BulkAddStudentsPage` is out of scope).
- Locked/read-only defaults — users may always edit.
- Default-value validation at finalize time (Papermite continues to accept any value the user typed; AdminDash's existing `validateField` runs at submit time and flags mismatches the same way it does today for user-typed input).

## Decisions

### D1. Storage shape: `default` lives on each field definition

Store the default inline on the existing `FieldDefinition` shape:

```json
{ "name": "grade_level", "type": "str", "required": false, "default": "9" }
```

When unset, the key is **omitted entirely** (not stored as `null`). This keeps existing model definitions byte-identical when defaults are not used, which means `lance_store.py`'s normalized-comparison change detection continues to no-op on unchanged models.

**Alternative considered:** a separate `defaults: { field_name: value }` map per entity. Rejected because (a) it splits a field's properties across two structures, complicating reads and the React state model, and (b) it makes round-tripping in `modelToExtraction` more bookkeeping for no gain.

### D2. Type: `unknown` / `Any`, no per-type narrowing

Both TypeScript (`FieldMapping.default?: unknown`, `FieldDefinition.default?: unknown`, `ModelFieldDefinition.default?: unknown`) and Pydantic (`FieldMapping.default: Optional[Any] = None`) keep the default loosely typed.

Rationale: the value's shape already correlates with the field's `type` (string for `str`/`email`/`phone`/`date`/`datetime`, number for `number`, boolean for `bool`, string for single-select `selection`, `string[]` for multi-select `selection`). Adding a discriminated union for `default` would force a parallel codepath everywhere a `FieldDefinition` is touched, with little payoff: the same validation already happens at AdminDash submit time via `validateField`.

**Alternative considered:** strict per-type union. Rejected as premature; revisit if defaults become a source of bugs.

### D3. UI placement: a third inline-edit cell, between "Sample Value" and "Data Type"

Add a **Default** `<th>` to the `EntityCard` table header and a corresponding `<td>` in `FieldRow`. The cell uses the **same inline-edit pattern** that already powers the Sample Value cell (click to edit → input → Enter/blur commits, Escape cancels) and, for `selection` fields, the same radio/checkbox rendering used in the value cell.

Rationale: column-aligned consistency. The Sample Value cell already demonstrates the inline-edit + selection pattern, so users (and reviewers) get a free read on how Default behaves.

**Alternative considered:**
- A "⋯" overflow that opens a per-field popover with advanced options. Rejected for issue #70's scope — a single new column is the minimum and most discoverable change.
- Reusing the Sample Value cell as the default. Rejected because Sample Value reflects the extracted value of the source document and is useful diagnostic context; conflating it with the persisted default would lose information.

### D4. Defaults apply to both base and custom fields

The Default cell appears on every row (base and custom), and `_build_model_definition` writes `default` into both `base_fields[]` and `custom_fields[]`. The base/custom distinction governs identity and required-ness — defaults are orthogonal.

**Alternative considered:** defaults only on custom fields. Rejected because the issue describes the feature as "for each field" and base fields (e.g., `grade_level` on Student) are exactly the ones with repetitive values across records.

### D5. Prefill precedence in `DynamicForm.buildValues`

For each field, the initial form value is computed as:

```
overrides?.[field.name]   // existing initialValues (document extract, edit mode)
  ?? field.default          // NEW
  ?? (field.type === 'bool' ? false : '')   // current fallback
```

This means document-extracted values still win over the tenant default (extraction is more specific to this record). When editing an existing entity, `editingEntity` is passed as `initialValues`, which contains the actual saved values and so overrides the default — correct behavior.

**Alternative considered:** apply default unconditionally on Add mode. Rejected — the existing override semantics already do the right thing (document extract should win), so a separate Add/Edit branch is unnecessary.

### D6. Empty-string default ≡ no default

When the Default cell is left empty (or cleared), the value is omitted from the persisted JSON. This avoids storing `"default": ""` and then having to special-case it in AdminDash's prefill (`"" ?? fallback` returns `""`, not the fallback). Bool defaults are stored as `true`/`false` explicitly; the absence of the key means "no default" (UI shows the cell unchecked / blank).

The serialized contract is: `_build_model_definition` MUST omit the `"default"` key entirely when `mapping.default is None`. It MUST NOT emit `"default": null`. This preserves byte-equality with pre-feature models in DataCore's `normalize`-then-compare change detection (`datacore/src/datacore/api/routes.py:199`), so adding the feature does not spuriously bump versions for tenants who never touch defaults.

### D7. `AddFieldForm` includes an optional Default input

When the tenant admin creates a new custom field via `AddFieldForm`, the form gains an optional Default input alongside the existing Name and Type inputs. This is a quality-of-life decision: it avoids the "add field → immediately edit Default cell" two-step.

**Alternative considered:** skip this and require the admin to set the default in the Review row afterwards. Rejected as a small UX wart for almost no implementation cost.

### D8. Changing a field's `type` clears its `default`

When the tenant admin changes a field's data type (e.g., `str → number`, or `selection → str`), `handleTypeChange` in `EntityCard.tsx` SHALL clear `default` to `undefined` on the affected mapping. This mirrors the existing pattern in `handleTypeChange` (`papermite/frontend/src/components/EntityCard.tsx:43`) that already clears `options` and `multiple` when switching away from `selection`, and re-initializes them when switching to `selection`.

Rationale: a default value's shape is tightly coupled to the field type (string for `str`/`email`/`phone`/`date`/`datetime`, number for `number`, boolean for `bool`, string-or-string-array for `selection`). Carrying a stale default through a type change produces hard-to-debug downstream mismatches in AdminDash (a number input prefilled with `"abc"`, etc.). Clearing is the simplest, most predictable rule, and the admin can re-enter the default in the same Review session.

**Alternative considered:** keep raw, let AdminDash's `validateField` flag at submit. Rejected — surfacing the error at the wrong layer; tenants see broken prefill instead of a clean blank input.

### D9. Toggling `multiple` on a selection field clears its `default`

Same rationale and pattern as D8: when the admin toggles `multiple` (single ↔ multi) on a `selection` field via `OptionsEditor`, `handleOptionsChange` SHALL clear `default` to `undefined`. The default's shape is single-string vs string-array — these are not interchangeable and coercion choices are error-prone.

Rationale: avoids a single-string default rendering as a half-checked checkbox group, or a string-array default rendering as nothing-selected in a radio group.

### D10. Type-inference override in `_build_model_definition` — known quirk, deferred

`_build_model_definition` (`papermite/backend/app/api/finalize.py:194`) overrides `mapping.field_type` with `_infer_type(mapping.value)` when the user's chosen type is `"str"` and the extracted sample value looks like a number/bool/list. This means the **stored** `type` can differ from what the admin selected in the Review row, and the stored `default` (which is not re-inferred) can be shape-incompatible with the stored type.

This change does **not** alter that behavior. The same misalignment would show up today for the Sample Value cell if a user types `"abc"` for a numeric-looking field. AdminDash's `validateField` (which runs at submit time) catches it as it does today. Revisiting `_infer_type` is out of scope for issue #70 and would need its own change.

### D11. AdminDash `DynamicForm` coerces prefilled `number` defaults

There is a pre-existing asymmetry in `admindash/frontend/src/components/DynamicForm.tsx`: the `number` field's `onChange` runs `Number(e.target.value)`, but `buildValues` initializes from `initialValues`/`default` verbatim. If the user submits without touching a prefilled `number` field, the submitted value is a string — only edits convert to `Number`.

Defaults make this more visible (more fields are prefilled, more often). To prevent a regression in submitted shape, `buildValues` SHALL coerce the prefilled value to `Number` when `field.type === 'number'` (only when the resolved prefill is not `''` and not `null`/`undefined`). This is a targeted fix scoped to where the new default-prefill code already runs. Other types are left as-is (their existing fallback `''` is correct), and the broader "normalize all type prefills" rewrite is out of scope.

## Risks / Trade-offs

- **Type mismatch between default and field type.** A user could type `"abc"` as the default for a `number` field. → AdminDash's existing `validateField` runs at form submit and flags it the same way it would for a user-typed value. Acceptable for v1; a Papermite-side validation pass on the Default cell could come later.
- **Empty-string vs. omitted-key semantics for selection.** For multi-select, an empty default is `[]`; we treat both `[]` and missing as "no default" and omit the key on save. → Documented in spec scenarios.
- **Reopening an old model.** Existing stored models have no `default` keys; `modelToExtraction` simply produces `FieldMapping.default === undefined`. The Default cell renders blank. No migration script needed.
- **Selection options changing after default is set.** If the admin sets `default = "9"` then removes `"9"` from the options list, AdminDash will prefill an out-of-options value. → Same risk already exists with the live entity data and is handled the same way: the radio group simply shows nothing selected for that value (rendering `checked={radioValue === opt}` matches nothing). No additional mitigation in this change.
- **JSON shape divergence between papermite and admindash.** Both must agree on the `default` key name and that empty/null = omitted. → Spec scenarios pin this down; tests on both sides assert the shape.

## Migration Plan

- **No DB migration.** Model definitions are JSON-in-LanceDB; new `default` keys appear on next save. Old models continue to load and render with blank Default cells.
- **Forward compatibility.** Adding `default?: unknown` to TS interfaces and `Optional[Any] = None` to Pydantic is additive — old clients that ignore `default` continue to work.
- **Rollback.** If we revert the Papermite changes, AdminDash will simply stop seeing `default` keys in newly-saved models. Already-saved defaults in stored models remain in the JSON (harmless dead data). AdminDash code can also be reverted independently — without the prefill, the form just starts empty as today.

## Open Questions

None. Decisions D1–D11 cover the design surface; remaining choices are implementation detail captured in `tasks.md`.

## Implementation Notes

- **React prop name in `FieldRow`.** Since `default` is a reserved JS keyword (and `defaultValue` is a reserved DOM prop name on form elements), use `defaultVal` as the `FieldRow` prop. The corresponding `FieldMapping` object key remains `default` (object keys are fine).
- **Rename and delete already carry `default` through.** `EntityCard.tsx`'s `handleFieldNameChange` and `handleFieldDelete` use `{ ...m }` spreads on the mapping object, so adding `default` to `FieldMapping` is automatically respected with no extra code.
- **Table header label.** The existing header is `Value` (not "Sample Value"). The new column header is `Default`, inserted between `Value` and `Data Type`.
