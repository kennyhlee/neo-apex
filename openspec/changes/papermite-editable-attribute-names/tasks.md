## 1. Frontend — FieldRow editable name cell (custom fields only)

- [ ] 1.1 Add `onFieldNameChange?: (oldName: string, newName: string) => { ok: true } | { ok: false; error: string }` to the `Props` interface in `papermite/frontend/src/components/FieldRow.tsx`.
- [ ] 1.2 Add local state for name editing inside `FieldRow`: `editingName: boolean`, `editName: string` (initialized to `fieldName` when entering edit mode), and `nameError: string | null` for transient inline validation feedback. Use `useEffect` to auto-clear `nameError` ~3 seconds after it's set.
- [ ] 1.3 In the name cell (currently the `<td className="field-row__name">` at lines 134–136), branch on `isBase`:
  - If `isBase` is true (or `onFieldNameChange` is not provided): keep the existing `<code>{fieldName}</code>` rendering exactly as it is — no click handler, no `title`.
  - If `isBase` is false and `onFieldNameChange` is provided: render the value-cell pattern — a clickable `<span className="field-row__display field-row__name-display" title="Click to edit" onClick={() => setEditingName(true)}>{fieldName}</span>` when not editing, and an `<input autoFocus className="input field-row__input" value={editName} onChange={...} onBlur={handleNameSave} onKeyDown={handleNameKeyDown} />` when editing.
- [ ] 1.4 Implement `handleNameSave`: trim `editName`; if the trimmed value equals `fieldName` exit edit mode silently (no-op); otherwise call `onFieldNameChange!(fieldName, trimmed)`. If the result is `{ ok: true }` exit edit mode. If `{ ok: false, error }` set `nameError = error`, leave display showing the original `fieldName`, exit edit mode.
- [ ] 1.5 Implement `handleNameKeyDown`: on `Enter` call `handleNameSave()` and `e.preventDefault()`; on `Escape` set `editingName=false` without committing.
- [ ] 1.6 Render `nameError` as a small inline message immediately under the name cell (`<div className="field-row__name-error">{nameError}</div>`) when non-null. Place it inside the same `<td>` so it does not break table layout.

## 2. Frontend — EntityCard rename plumbing

- [ ] 2.1 Add `handleFieldNameChange(oldName: string, newName: string): { ok: true } | { ok: false; error: string }` to `papermite/frontend/src/components/EntityCard.tsx`. It must NOT throw.
- [ ] 2.2 Validation inside `handleFieldNameChange` (executed in this order):
  - Trim `newName`. If empty, return `{ ok: false, error: "Name cannot be empty" }`.
  - If trimmed equals `oldName`, return `{ ok: true }` without mutating state (no-op).
  - If any other mapping in `entity.field_mappings` (any source — both base and custom) has `field_name === trimmed`, return `{ ok: false, error: \`"\${trimmed}" is already used by another field\` }`.
- [ ] 2.3 On success, build a new `EntityResult` by applying ALL of:
  - `updated.field_mappings = entity.field_mappings.map(m => m.field_name === oldName ? { ...m, field_name: trimmed } : m)` — preserves array order and other properties.
  - `updated.entity = { ...entity.entity }`, then `updated.entity[trimmed] = updated.entity[oldName]; delete updated.entity[oldName];`.
  - If `updated.entity.custom_fields` exists and is an object containing key `oldName`: clone it (`{ ...(updated.entity.custom_fields as Record<string, unknown>) }`), copy the value to `trimmed`, delete `oldName`, assign back.
  - Then call `onUpdate(index, updated)` and return `{ ok: true }`.
- [ ] 2.4 Pass `onFieldNameChange={handleFieldNameChange}` to the `<FieldRow />` element (next to `onUpdate`, `onRequiredToggle`, etc.) at `EntityCard.tsx:137`.

## 3. Frontend — styling affordance

- [ ] 3.1 In `papermite/frontend/src/components/EntityCard.css`, add a hover/focus state on `.field-row__name-display` (or whichever class name task 1.3 picked) — `cursor: pointer`, a subtle background change on hover, mirroring how `.field-row__display` looks today. Do NOT add the hover state to plain `.field-row__name code` (base-field rendering must stay visually inert).
- [ ] 3.2 Add a style for `.field-row__name-error`: small font-size (~12px), `color: var(--danger-text)` or equivalent red, `margin-top: 4px`. Must not push the table row height noticeably.

## 4. Frontend — TypeScript and lint

- [ ] 4.1 Run `npm run build` in `papermite/frontend/` and resolve any TypeScript errors.
- [ ] 4.2 Run `npm run lint` in `papermite/frontend/` and resolve any new warnings/errors.

## 5. Backend — regression test for custom-field rename pass-through

- [ ] 5.1 Add `papermite/backend/tests/test_finalize_api.py` modeled on `test_extract_api.py`:
  - Use `TestClient(app)` and override `require_admin` with a fake admin `UserRecord` (tenant_id `"t1"`).
  - Build an `ExtractionResult` with one entity (e.g., `entity_type="student"`) whose `field_mappings` includes a custom field named `"date_of_birth"` (with `source="custom_field"`, `field_type="date"`, `required=False`) — note this name is *not* the conventional LLM default `"dob"`, so a regression that pinned `field_name` to a fixed list would fail.
  - Mock `httpx.put` at `app.api.finalize.httpx.put` to return a `MagicMock` with `status_code=200` and `.json()` returning a dict with the required keys (`status`, `version`, `model_definition`, `source_filename`, `created_by`, `created_at`).
  - POST the payload to `/api/tenants/t1/finalize/commit`.
  - Assert `httpx.put` was called once; inspect the captured `json=` kwarg; assert `payload["model_definition"]["student"]["custom_fields"]` contains an object with `name == "date_of_birth"`; assert no object in either `custom_fields` or `base_fields` has `name == "dob"`.
- [ ] 5.2 Run `cd papermite/backend && uv run python -m pytest tests/test_finalize_api.py -v` (or the project's standard test invocation) and confirm the new test passes alongside existing tests.

## 6. Manual verification

- [ ] 6.1 Start papermite backend + frontend (via `./start-services.sh` from repo root, or per service `CLAUDE.md`). Upload a sample document so an extraction with at least one custom field is generated.
- [ ] 6.2 On the review page, click a **custom-field** name — confirm an input appears, prefilled and focused.
- [ ] 6.3 Type a new name and press Enter — confirm the row updates, the displayed name is the new one, and no error appears.
- [ ] 6.4 Click a **base-field** name — confirm nothing happens (no input, no cursor change beyond default).
- [ ] 6.5 Try renaming a custom field to an existing custom-field name; confirm the input reverts and the inline error appears, then auto-clears within ~3 seconds.
- [ ] 6.6 Try renaming a custom field to an existing base-field name (e.g. `first_name` on a student); confirm rejection and error.
- [ ] 6.7 Try committing an empty / whitespace-only name; confirm rejection with the empty-name error.
- [ ] 6.8 Press Escape mid-edit; confirm the value reverts and no error fires.
- [ ] 6.9 Click Finalize; confirm no errors. Then via LandingPage → Edit, reopen the saved model and verify the renamed custom field shows up under the new name and is still renameable.
