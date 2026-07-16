## 1. Safe serialization helper

- [x] 1.1 In `papermite/frontend/src/components/FieldRow.tsx`, add a module-scope helper `toEditString(v: unknown): string` returning `""` for null/undefined/empty-string, `JSON.stringify(v)` for objects/arrays (`typeof v === "object" && v !== null`), and `String(v)` otherwise.
- [x] 1.2 Replace the inline `displayValue` ternary (lines 121-126) with `const displayValue = toEditString(value) || "—"`.
- [x] 1.3 Replace `useState(String(value ?? ""))` (line 108) with `useState(toEditString(value))`.
- [x] 1.4 Confirm `cd papermite/frontend && npm run build` passes.

## 2. Inline selection controls (always-visible, no edit-mode toggle)

- [x] 2.1 In `FieldRow.tsx`, inside the Value `<td>` (currently the `editing ? <input> : <span>` ternary), add a top-level conditional BEFORE the existing ternary: if `fieldType === "selection"` and `(options?.length ?? 0) > 0`, render the inline selection control; otherwise fall through to the existing click-to-edit logic.
- [x] 2.2 Implement the single-select branch (`!multiple`): compute `currentValue = typeof value === "string" ? value : (Array.isArray(value) && typeof value[0] === "string" ? value[0] : "")`. Render `<select className="input field-row__input" value={currentValue} onChange={(e) => onUpdate(fieldName, e.target.value)}>` with `<option value="">— none —</option>` followed by `(options ?? []).map(opt => <option key={opt} value={opt}>{opt}</option>)`.
- [x] 2.3 Implement the multi-select branch (`multiple === true`): compute `selected = Array.isArray(value) ? value.filter((s): s is string => typeof s === "string") : (typeof value === "string" ? [value] : [])`. Render `<div className="field-row__multi-edit">{(options ?? []).map(opt => <label key={opt} className="field-row__multi-edit-label"><input type="checkbox" checked={selected.includes(opt)} onChange={(e) => { const next = e.target.checked ? [...selected, opt] : selected.filter(s => s !== opt); onUpdate(fieldName, next); }} />{opt}</label>)}</div>`.
- [x] 2.4 Verify the existing `editing` state and click-to-edit code remain untouched for the fallback path (non-selection fields, or selection fields with `options.length === 0`).
- [x] 2.5 `cd papermite/frontend && npm run lint && npm run build` — both pass.

## 3. Styles for multi-select inline control

- [x] 3.1 In `papermite/frontend/src/components/EntityCard.css` (which already houses all `.field-row*` styles, confirmed by grep), append rules near the existing `.field-row__input` block: `.field-row__multi-edit { display: flex; flex-wrap: wrap; gap: 0.4rem; }` and `.field-row__multi-edit-label { display: inline-flex; align-items: center; gap: 0.25rem; font-size: 0.85rem; color: var(--text-primary); cursor: pointer; }`.
- [x] 3.2 Confirm the dropdown reuses existing `.input` / `.field-row__input` styling without further CSS additions.

## 4. Vitest + React Testing Library harness

- [x] 4.1 Add dev dependencies to `papermite/frontend/package.json`: `vitest@^3.0.0`, `@testing-library/react@^16.0.0`, `@testing-library/jest-dom@^6.0.0`, `@testing-library/user-event@^14.0.0`, `happy-dom@^16.0.0` (pin majors only). Run `npm install` to update the lockfile.
- [x] 4.2 Update `papermite/frontend/vite.config.ts`: change `import { defineConfig } from "vite"` to `import { defineConfig } from "vitest/config"`, and add a `test` block: `test: { environment: "happy-dom", setupFiles: ["./src/test/setup.ts"], globals: true }`. (Alternative: keep `vite.config.ts` as-is and create a separate `vitest.config.ts` importing from `vitest/config` — choose whichever the codebase reviewer prefers during implementation.)
- [x] 4.3 Create `papermite/frontend/src/test/setup.ts` with `import "@testing-library/jest-dom/vitest";`.
- [x] 4.4 Update `papermite/frontend/tsconfig.app.json`: change `"types": ["vite/client"]` to `"types": ["vite/client", "vitest/globals", "@testing-library/jest-dom"]`.
- [x] 4.5 Add scripts to `papermite/frontend/package.json`: `"test": "vitest"` and `"test:run": "vitest run"`.
- [x] 4.6 Smoke-test: create `papermite/frontend/src/test/smoke.test.ts` with a one-line `it("boots", () => { expect(1 + 1).toBe(2); });`. Run `npm run test:run` — passes.
- [x] 4.7 Verify ESLint still passes (`npm run lint`); if it complains about test files, add a matching ignore or override in the ESLint config. Delete the smoke test once the harness is confirmed working.

## 5. FieldRow component tests

- [x] 5.1 Create `papermite/frontend/src/components/FieldRow.test.tsx`. Add a `renderRow(propsOverride?: Partial<FieldRowProps>)` helper inside the file that supplies all required props with sensible defaults and merges overrides. Use `import type { FieldType } from "../types/models"` for type-only imports (the project has `verbatimModuleSyntax: true`).
- [x] 5.2 Test: object value renders as JSON in display. Render with `value={{ a: 1 }}`, `fieldType="str"`. Assert the rendered text includes `{"a":1}` and does NOT include `[object Object]`.
- [x] 5.3 Test: non-selection field with array-of-objects entering text-edit mode. Render with `value={[{ x: 1 }]}`, `fieldType="str"`. Click the value span. Assert the input's `value` attribute is `[{"x":1}]`, not `[object Object]`.
- [x] 5.4 Test: selection field with `multiple: false` + options renders a `<select>` inline (no click required). Render with `value="Active"`, `fieldType="selection"`, `options=["Active","Inactive"]`, `multiple=false`. Assert a `<select>` is present, with options for `""`, `"Active"`, `"Inactive"`. Fire `change` to `"Inactive"`. Assert `onUpdate` was called with `("fieldName", "Inactive")`.
- [x] 5.5 Test: selection field with `multiple: true` + options renders three checkboxes inline. Render with `value=["Mon"]`, `fieldType="selection"`, `options=["Mon","Tue","Wed"]`, `multiple=true`. Assert three checkboxes present; `"Mon"` is checked, others unchecked. Click the `"Tue"` checkbox. Assert `onUpdate` was called with `("fieldName", ["Mon","Tue"])`.
- [x] 5.6 Run `cd papermite/frontend && npm run test:run` — all five tests pass.

## 6. Verification

- [x] 6.1 `cd papermite/frontend && npm run lint` passes.
- [x] 6.2 `cd papermite/frontend && npm run build` passes (TypeScript project references + Vite build).
- [x] 6.3 `cd papermite/frontend && npm run test:run` passes.
- [x] 6.4 Run `./start-services.sh`. Open Papermite at `http://localhost:5700`, upload a sample doc, navigate to the Review page. On a selection field whose extracted value is an array of objects or dicts, confirm the cell shows readable text (JSON) and NOT `"[object Object]"`.
- [x] 6.5 On a single-select selection field with options defined, confirm the dropdown is always visible inline. Change selection — verify the row state updates and persists via IndexedDB across a page reload.
- [x] 6.6 On a multi-select selection field with options defined, confirm the checkbox group is always visible inline. Toggle multiple options — verify the value persists as an array and survives a page reload.
- [x] 6.7 On a non-selection field (e.g., `str` type) or a selection field with empty options, confirm the original click-to-edit text input still works (regression check).
- [x] 6.8 On any selection field, confirm the `[N opts]` button still opens the existing `OptionsEditor` panel and that adding/removing options + toggling `Allow multiple` still works (regression check for the unrelated flow).
