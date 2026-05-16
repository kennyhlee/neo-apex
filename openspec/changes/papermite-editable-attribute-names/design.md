## Context

Papermite's review screen (`ReviewPage` → `EntityCard` → `FieldRow`) is the last place a user can shape a model definition before it's committed to DataCore. The data type used throughout this flow is `ExtractionResult`, whose `entities[].field_mappings[]` are `FieldMapping` objects with a `field_name: string` property and a `source: "base_model" | "custom_field"` discriminator.

Today, on the review screen:

- **Custom fields** are fully editable except for their *name* — value, type, required, options, multiple, and delete all work; the name is rendered as static `<code>{fieldName}</code>`.
- **Base fields** are intentionally more constrained: type is locked (`field-row__type-locked` at `FieldRow.tsx:212`), required is locked (`disabled={isBase}` at line 245), no delete button (line 254). Only the value is editable. Names are locked, consistent with that pattern.

State shape and dataflow notes that shaped the design below:

- `FieldRow.tsx` exposes callbacks `onUpdate`, `onRequiredToggle`, `onTypeChange`, `onOptionsChange`, `onDelete` — no `onFieldNameChange`.
- `EntityCard.tsx` mirrors each field mapping into **three places**: `entity.field_mappings` (the list FieldRow renders from), `entity.entity[fieldName]` (the value bag), and for custom fields `entity.entity.custom_fields[fieldName]` (the custom-bag). `handleFieldDelete` (lines 68–85) cleans up all three; `handleFieldUpdate` writes the new value into `entity.entity[fieldName]` (line 28); `handleAddField` populates all three (lines 87–100). A rename must keep this discipline.
- `EntityCard.tsx:138` uses `<FieldRow key={mapping.field_name} />`. Changing `field_name` forces React to unmount/remount the row. Since commit happens on Enter or blur (not while typing), the user has already finished editing when the remount occurs — the lost input focus doesn't surface as a UX problem.
- `ReviewPage.hasChanges()` (lines 16–25) already compares `om.field_name !== cm.field_name` position-by-position — dirty tracking is ready.
- `backend/app/api/finalize.py::_build_model_definition` (lines 31–77) reads `mapping.field_name` straight into the persisted model definition with no server-side validation. `FieldMapping` Pydantic model (`backend/app/models/extraction.py:20–27`) declares `field_name: str` with no validator.
- The persisted model definition is built **only** from `field_mappings`, not from `entity.entity` — so a stale key in `entity.entity` after rename wouldn't corrupt what reaches DataCore. We still rename it because (a) consistency with the delete handler, (b) avoids subtle bugs in any future code that reads from `entity.entity`.

So this change is a frontend gap-fill scoped to custom fields: add the input on the custom-field name cell, lift the state, validate uniqueness, keep the three state locations in sync, and confirm the backend keeps working.

## Goals / Non-Goals

**Goals:**
- A user can click a **custom-field** name on the review screen, type a new name, and press Enter (or blur) to commit the rename — same interaction the value cell already uses.
- The frontend prevents committing empty names, or names that collide with any other field in the same entity (base or custom), with a brief inline message and an automatic revert.
- Renaming keeps `field_mappings`, `entity.entity`, and `entity.entity.custom_fields` mutually consistent (the same three locations that `handleFieldDelete` touches today).
- Existing dirty-tracking, finalize, and DataCore versioned-write paths continue to work unchanged.

**Non-Goals:**
- Renaming **base-field** names. Base fields keep the same lock pattern they already have for type, required, and delete. Their names come from the underlying domain Pydantic class field keys; allowing them to diverge would weaken the convention that `model_definition[entity]["base_fields"][n]["name"]` corresponds to `EntityClass.model_fields`. Issue #67's "attribute name detected by LLM" maps cleanly to custom fields.
- Cross-entity uniqueness. Two different entities may legitimately share a field name (e.g., `name` on both `student` and `parent`); this matches today's spec model.
- Renaming the `entity_type` itself.
- A separate "rename" mode (modal, menu item). The inline pattern is established and works for the analogous Value edit; introducing a second pattern just for names would be inconsistent.
- Server-side name validation beyond what the Pydantic model already enforces (`str`). The model definition consumer in DataCore is the authority on what names it accepts; we are not introducing parallel validation here.
- A migration for previously-saved model definitions. Existing names remain as-is; users can edit any custom-field names next time they open the model.

## Decisions

### Decision 1: Inline click-to-edit, mirroring the value cell

Use the same `editing: boolean` + controlled `<input>` pattern that `FieldRow` already uses for the value cell. On click, swap the displayed name for an `<input autoFocus />`; commit on Enter or blur; revert on Escape.

**Alternatives considered:**
- *Always-visible input* (like the type `<select>`). Rejected — names are long, wrapping them as inputs would visually dominate the table.
- *Pencil icon → modal*. Rejected — heavier than necessary and inconsistent with the value-cell pattern users already know.
- *Double-click to edit*. Rejected — discoverability is worse and there's no precedent for it in this UI.

### Decision 2: Validate uniqueness within an entity (against ALL mappings), on commit

When the user commits a rename, check every other mapping in `entity.field_mappings` — both base and custom — for the same trimmed name. If found, reject. Empty/whitespace-only names are rejected the same way. The error message appears inline below the cell for ~3 seconds, then auto-clears.

Uniqueness must span both source types: a custom field renamed to collide with a base name would silently lose its data to whichever mapping the backend writes second, because `_build_model_definition` splits by source into separate `base_fields`/`custom_fields` arrays but downstream consumers reading the merged form would see two `name` fields.

**Alternatives considered:**
- *Validate against custom fields only*. Rejected — a custom field colliding with a base field name is exactly the dangerous case.
- *Live validation as the user types*. Rejected — distracting, and transient duplicates are normal mid-typing.
- *Server-side rejection only*. Rejected — the user wouldn't see the error until "Finalize", which is too late.
- *Auto-suffix duplicates* (e.g., `name_2`). Rejected — silently changing the user's input is surprising.

### Decision 3: Rename in place — preserve mapping order and identity, sync all three state locations

In `handleFieldNameChange(oldName, newName)`:

1. Find the mapping in `field_mappings` by `oldName`, replace `field_name`, write the array back with the same index.
2. Rename the key in `entity.entity`: copy the value under `newName`, delete the `oldName` key.
3. Rename the key in `entity.entity.custom_fields` (which always exists for renameable rows since base fields aren't renameable, but defensively guard for the property's existence).

The downstream `_build_model_definition` is order-preserving and reads only `field_mappings`, so the resulting model definition is stable apart from the name. Step (2) and (3) keep the in-memory shape consistent with `handleFieldDelete`'s cleanup pattern and avoid stale keys.

**Alternatives considered:**
- *Remove + append with new name in `field_mappings`*. Rejected — silently reorders fields and would shift the displayed table.
- *Skip steps (2) and (3) because the backend doesn't read them*. Rejected — same reason `handleFieldDelete` cleans them up: future code that reads `entity.entity` would see stale keys.

### Decision 4: Rename handler returns a discriminated result, doesn't throw

`onFieldNameChange` returns `{ ok: true } | { ok: false, error: string }` rather than throwing. The FieldRow can then set `nameError` and revert without try/catch in an event handler (where thrown errors are awkward — React doesn't catch them and the surrounding code has to wrap every synchronous handler).

**Alternatives considered:**
- *Throw on validation failure*. Rejected — pushes try/catch into every call site and conflates "user typed a duplicate" with "something genuinely broke".
- *Validate inside FieldRow*. Rejected — FieldRow doesn't know about sibling mappings; the parent owns that information.

### Decision 5: Only custom-field name cells render the editable input

In `FieldRow.tsx`, gate the name-cell input on `source === "custom_field"`. Base-field rows keep the existing `<code>{fieldName}</code>` rendering with no click handler, no hover affordance, and no `title`. This mirrors how base-field types are already rendered as `<span className="field-row__type-locked">{fieldType}</span>` instead of a `<select>`.

**Alternatives considered:**
- *Allow base-field renames too*. Rejected — see Non-Goals. The backend doesn't enforce that base-field names equal the underlying class field keys, so it would technically work, but it breaks an implicit contract.
- *Show a disabled-looking input on base rows*. Rejected — the existing pattern uses a different element (`<code>`/`<span>`), not a styled-disabled input. Consistency with the existing lock pattern wins.

### Decision 6: No backend code changes; add a regression test instead

The backend already consumes whatever `field_name` the frontend sends. To prevent a future change from accidentally locking it down (e.g., adding a Pydantic validator), add a backend test that posts a `FinalizeRequest` with a renamed custom field, mocks `httpx.put` to DataCore, and asserts the captured payload's `model_definition[entity]["custom_fields"]` contains the new name and not the old.

The test mocks `httpx.put` directly (matching the pattern in `test_extract_api.py`), since that's the symbol `finalize_commit` calls.

**Alternatives considered:**
- *Add an explicit rename API endpoint*. Rejected — the rename is part of the same edit session that produces the finalize payload.

## Risks / Trade-offs

- **Risk:** A user renames a field to a name that DataCore's model-definition validator rejects (e.g., a reserved keyword). → **Mitigation:** The `POST /finalize/commit` call surfaces the DataCore HTTP error to the user via the existing error-handling path on `ReviewPage`; no UX change needed for this rare case. We don't pre-validate against DataCore rules here because that would couple Papermite to DataCore's internal name policy.
- **Risk:** Stale drafts in IndexedDB might still have old names if the user reloads mid-edit. → **Mitigation:** Renames go through the existing draft-save pipeline — `handleFieldNameChange` lifts state through `onEntityUpdate`, which `ReviewPage.handleEntityUpdate` (lines 58–65) immediately writes into IndexedDB. No special handling needed.
- **Risk:** Changing `field_name` invalidates the `<FieldRow key={mapping.field_name}>` React key (`EntityCard.tsx:138`), causing remount. → **Mitigation:** Commit happens on Enter or blur, so the user's focus is already leaving the input when the remount fires. Edge case: `showOptions` internal state on the row would reset, but custom selection fields would have to be mid-options-edit AND mid-rename simultaneously — vanishingly rare, not worth fixing here.
- **Risk:** A user renames a custom field to a base-field name (e.g., `first_name`), and the backend's `_build_model_definition` puts the two in separate arrays (`base_fields` vs `custom_fields`) — downstream consumers reading the merged form would see two `name` fields. → **Mitigation:** Decision 2's cross-source uniqueness check rejects this client-side before finalize.
- **Trade-off:** Per-entity uniqueness instead of global uniqueness. A duplicate across entities is allowed even though it could be confusing in a finalized form. Acceptable because (a) it matches the current spec model, and (b) form rendering qualifies fields by entity anyway.
- **Trade-off:** Inline error shown for ~3 seconds is informal compared to a persistent toast. Accepted because the user has immediate feedback (the input reverted) and the cell is right where their attention is.

## Migration Plan

No data migration. Ship the frontend changes; existing model definitions are unaffected. Existing custom-field names in saved models become editable next time the user opens the model via LandingPage → Edit. Rollback is a revert of the frontend files since the backend is unchanged.
