# Papermite Selection Edit Display Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix Papermite issue #68 — selection-type fields in the Review page display `"[object Object]"` once clicked — and replace the click-to-edit input with an always-visible inline `<select>` (single-select) or checkbox group (multi-select) when options are defined. Establish a Vitest + React Testing Library harness in `papermite/frontend` and lock in the bug fix with component tests.

**Architecture:** Single component change in `papermite/frontend/src/components/FieldRow.tsx`. A new `toEditString()` helper unifies display and fallback edit-mode serialization so neither path can produce `"[object Object]"`. When `fieldType === "selection"` and at least one option is defined, the Value cell renders the inline control directly (no edit-mode toggle). Single-select binds to a `<select>`; multi-select binds to a horizontal checkbox group. All other fields keep the existing click-to-edit text input. The `OptionsEditor` panel that adds/removes options is untouched. CSS additions land in `EntityCard.css` next to the existing `.field-row*` rules. The new Vitest setup lives in `papermite/frontend` only; it does not affect other services. Vitest 3+ pairs with the existing Vite 8.

**Tech Stack:** React 19 + TypeScript 5.9 (`verbatimModuleSyntax: true`, strict mode) + Vite 8, Vitest 3 + `@testing-library/react` 16 + `@testing-library/jest-dom` 6 + `@testing-library/user-event` 14 + `happy-dom` 16.

**Source artifacts:** `openspec/changes/papermite-selection-edit-display/{proposal.md, design.md, specs/papermite-field-row-editor/spec.md, tasks.md}`.

---

## File Map

| Action | File | Responsibility |
|---|---|---|
| Modify | `papermite/frontend/src/components/FieldRow.tsx` | Add `toEditString` helper, swap display + editValue init to use it, add inline selection control branch before the existing edit-mode ternary. |
| Modify | `papermite/frontend/src/components/EntityCard.css` | Append `.field-row__multi-edit` and `.field-row__multi-edit-label` rules next to existing `.field-row__input`. |
| Modify | `papermite/frontend/package.json` | Add `vitest`, `@testing-library/*`, `happy-dom` devDeps; add `test` and `test:run` scripts. |
| Modify | `papermite/frontend/vite.config.ts` | Switch `defineConfig` import to `vitest/config`; add `test` block. |
| Modify | `papermite/frontend/tsconfig.app.json` | Extend `compilerOptions.types` with vitest globals + jest-dom types. |
| Create | `papermite/frontend/src/test/setup.ts` | Import `@testing-library/jest-dom/vitest` once for all tests. |
| Create | `papermite/frontend/src/components/FieldRow.test.tsx` | Five component tests covering safe display, safe text-edit init, single-select inline, multi-select inline. |

---

## Task 1: Safe serialization helper in FieldRow.tsx

**Files:**
- Modify: `papermite/frontend/src/components/FieldRow.tsx:107-126`

- [ ] **Step 1: Read current FieldRow.tsx**

Run: `cat papermite/frontend/src/components/FieldRow.tsx | head -130`

Confirm the file currently has at line 108: `const [editValue, setEditValue] = useState(String(value ?? ""));` and at lines 121-126:

```tsx
  const displayValue =
    value === null || value === undefined || value === ""
      ? "—"
      : typeof value === "object"
        ? JSON.stringify(value)
        : String(value);
```

- [ ] **Step 2: Add `toEditString` helper at module scope**

Use Edit to insert the helper **above the `OptionsEditor` function** (between line 18 and line 20 — i.e. immediately after the `Props` interface closing brace and the blank line that follows). Insert this exact block:

```tsx
function toEditString(v: unknown): string {
  if (v === null || v === undefined || v === "") return "";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

```

The function must be at module scope (not inside any component). Keep the trailing blank line after the closing brace so spacing matches the rest of the file.

- [ ] **Step 3: Replace `editValue` initialization**

In `papermite/frontend/src/components/FieldRow.tsx`, replace the exact line:

```tsx
  const [editValue, setEditValue] = useState(String(value ?? ""));
```

with:

```tsx
  const [editValue, setEditValue] = useState(toEditString(value));
```

- [ ] **Step 4: Replace `displayValue` ternary**

Replace the exact block (lines 121-126 in the original file):

```tsx
  const displayValue =
    value === null || value === undefined || value === ""
      ? "—"
      : typeof value === "object"
        ? JSON.stringify(value)
        : String(value);
```

with:

```tsx
  const displayValue = toEditString(value) || "—";
```

- [ ] **Step 5: Type-check passes**

Run: `cd papermite/frontend && npm run build`
Expected: build succeeds with no TypeScript errors. (The Vite build runs `tsc -b` first.)

- [ ] **Step 6: Commit**

```bash
git add papermite/frontend/src/components/FieldRow.tsx
git commit -m "fix(papermite): unify FieldRow display + edit serialization via toEditString helper

Prevents '[object Object]' from leaking into the display or edit input
when a selection field's value is an array or object. The two paths now
share a single serialization helper that uses JSON.stringify for
objects/arrays. Part of issue #68 fix."
```

---

## Task 2: Inline always-visible selection controls

**Files:**
- Modify: `papermite/frontend/src/components/FieldRow.tsx:136-155`

- [ ] **Step 1: Re-read the Value cell block**

Open `papermite/frontend/src/components/FieldRow.tsx`. After Task 1, the Value cell is a single `<td className="field-row__value">` containing:

```tsx
        <td className="field-row__value">
          {editing ? (
            <input
              className="input field-row__input"
              value={editValue}
              onChange={(e) => setEditValue(e.target.value)}
              onBlur={handleSave}
              onKeyDown={handleKeyDown}
              autoFocus
            />
          ) : (
            <span
              className="field-row__display"
              onClick={() => setEditing(true)}
              title="Click to edit"
            >
              {displayValue}
            </span>
          )}
        </td>
```

This is the block to wrap, not replace.

- [ ] **Step 2: Insert the inline selection branch**

Replace the exact block above with the following. The new `if (fieldType === "selection" && (options?.length ?? 0) > 0)` branch is checked FIRST; if it doesn't match, the existing click-to-edit ternary runs unchanged.

```tsx
        <td className="field-row__value">
          {fieldType === "selection" && (options?.length ?? 0) > 0 ? (
            multiple ? (
              (() => {
                const selected = Array.isArray(value)
                  ? value.filter((s): s is string => typeof s === "string")
                  : typeof value === "string" && value !== ""
                    ? [value]
                    : [];
                return (
                  <div className="field-row__multi-edit">
                    {(options ?? []).map((opt) => (
                      <label key={opt} className="field-row__multi-edit-label">
                        <input
                          type="checkbox"
                          checked={selected.includes(opt)}
                          onChange={(e) => {
                            const next = e.target.checked
                              ? [...selected, opt]
                              : selected.filter((s) => s !== opt);
                            onUpdate(fieldName, next);
                          }}
                        />
                        {opt}
                      </label>
                    ))}
                  </div>
                );
              })()
            ) : (
              (() => {
                const currentValue =
                  typeof value === "string"
                    ? value
                    : Array.isArray(value) && typeof value[0] === "string"
                      ? value[0]
                      : "";
                return (
                  <select
                    className="input field-row__input"
                    value={currentValue}
                    onChange={(e) => onUpdate(fieldName, e.target.value)}
                  >
                    <option value="">— none —</option>
                    {(options ?? []).map((opt) => (
                      <option key={opt} value={opt}>
                        {opt}
                      </option>
                    ))}
                  </select>
                );
              })()
            )
          ) : editing ? (
            <input
              className="input field-row__input"
              value={editValue}
              onChange={(e) => setEditValue(e.target.value)}
              onBlur={handleSave}
              onKeyDown={handleKeyDown}
              autoFocus
            />
          ) : (
            <span
              className="field-row__display"
              onClick={() => setEditing(true)}
              title="Click to edit"
            >
              {displayValue}
            </span>
          )}
        </td>
```

Notes for the implementer:
- `multiple` and `options` are already destructured from `Props` at the top of the component (lines 99-100 of the post-Task-1 file). No new prop destructuring needed.
- The IIFE pattern `(() => { ... })()` is used so the `selected` / `currentValue` locals stay scoped inside JSX without lifting them out of the render. This is intentional — keep them inline.
- `onUpdate` is already in scope and is the same callback the existing `handleSave` uses.

- [ ] **Step 3: Lint passes**

Run: `cd papermite/frontend && npm run lint`
Expected: exits 0 with no errors. ESLint may warn about `react-hooks/exhaustive-deps` or unused vars — fix any genuine issues; do not silence rules. If `noUnusedLocals` (TS) flags anything, fix the cause not the symptom.

- [ ] **Step 4: Type-check + build pass**

Run: `cd papermite/frontend && npm run build`
Expected: TypeScript project references build succeeds, Vite build produces `dist/`.

- [ ] **Step 5: Commit**

```bash
git add papermite/frontend/src/components/FieldRow.tsx
git commit -m "feat(papermite): render inline always-visible selection controls in FieldRow

When a selection field has at least one option defined, the Value cell
renders a <select> (single-select) or checkbox group (multi-select)
directly — no click-to-edit toggle. Bound state is derived defensively
from value so legacy/corrupted shapes recover gracefully. Non-selection
fields and selection fields with no options keep the existing
click-to-edit text input.

Fixes #68 user-visible behavior."
```

---

## Task 3: CSS for the multi-select checkbox group

**Files:**
- Modify: `papermite/frontend/src/components/EntityCard.css:109-119`

- [ ] **Step 1: Verify the insertion point**

Run: `grep -n "field-row__input\|field-row__required" papermite/frontend/src/components/EntityCard.css`

Expected output includes `.field-row__input` at line 109 and `.field-row__required` at line 116. We will insert two new rules **between** them.

- [ ] **Step 2: Insert the new rules**

In `papermite/frontend/src/components/EntityCard.css`, replace the exact block:

```css
.field-row__input {
  padding: 4px 8px;
  font-size: 14px;
  width: 100%;
  box-sizing: border-box;
}

.field-row__required {
```

with:

```css
.field-row__input {
  padding: 4px 8px;
  font-size: 14px;
  width: 100%;
  box-sizing: border-box;
}

.field-row__multi-edit {
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem;
}

.field-row__multi-edit-label {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
  font-size: 0.85rem;
  color: var(--text-primary);
  cursor: pointer;
}

.field-row__required {
```

- [ ] **Step 3: Build passes**

Run: `cd papermite/frontend && npm run build`
Expected: build succeeds (CSS is bundled with no validation, but this catches any accidental syntax error breaking the import chain).

- [ ] **Step 4: Commit**

```bash
git add papermite/frontend/src/components/EntityCard.css
git commit -m "style(papermite): add inline multi-select checkbox group styles to FieldRow"
```

---

## Task 4: Add Vitest + React Testing Library harness

**Files:**
- Modify: `papermite/frontend/package.json`
- Modify: `papermite/frontend/vite.config.ts`
- Modify: `papermite/frontend/tsconfig.app.json`
- Create: `papermite/frontend/src/test/setup.ts`

- [ ] **Step 1: Install dev dependencies**

Run from the repo root:

```bash
cd papermite/frontend && npm install --save-dev \
  vitest@^3.0.0 \
  @testing-library/react@^16.0.0 \
  @testing-library/jest-dom@^6.0.0 \
  @testing-library/user-event@^14.0.0 \
  happy-dom@^16.0.0
```

Expected: install succeeds. If npm resolves a peer-dep conflict on `react@19`, retry with `--legacy-peer-deps`. Do not downgrade React or testing-library; both support React 19.

- [ ] **Step 2: Update vite.config.ts**

Replace the entire contents of `papermite/frontend/vite.config.ts` (currently 9 lines) with:

```ts
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import services from '../../services.json'

export default defineConfig({
  plugins: [react()],
  server: { port: services.services["papermite-frontend"].port, host: '127.0.0.1' },
  test: {
    environment: 'happy-dom',
    setupFiles: ['./src/test/setup.ts'],
    globals: true,
  },
})
```

Only two changes from the original: the `defineConfig` import comes from `vitest/config` instead of `vite`, and the `test` block is added. The dev-server config is unchanged.

- [ ] **Step 3: Create the test setup file**

Create `papermite/frontend/src/test/setup.ts` with:

```ts
import "@testing-library/jest-dom/vitest";
```

That single line is the entire file.

- [ ] **Step 4: Update tsconfig.app.json**

In `papermite/frontend/tsconfig.app.json`, replace:

```json
    "types": ["vite/client"],
```

with:

```json
    "types": ["vite/client", "vitest/globals", "@testing-library/jest-dom"],
```

- [ ] **Step 5: Add test scripts to package.json**

In `papermite/frontend/package.json`, replace the existing `"scripts"` block:

```json
  "scripts": {
    "dev": "vite",
    "build": "tsc -b && vite build",
    "lint": "eslint .",
    "preview": "vite preview"
  },
```

with:

```json
  "scripts": {
    "dev": "vite",
    "build": "tsc -b && vite build",
    "lint": "eslint .",
    "preview": "vite preview",
    "test": "vitest",
    "test:run": "vitest run"
  },
```

- [ ] **Step 6: Write a smoke test**

Create `papermite/frontend/src/test/smoke.test.ts` with:

```ts
import { describe, it, expect } from "vitest";

describe("vitest harness", () => {
  it("boots", () => {
    expect(1 + 1).toBe(2);
  });
});
```

- [ ] **Step 7: Run the smoke test**

Run: `cd papermite/frontend && npm run test:run`
Expected: Vitest discovers `src/test/smoke.test.ts` and the single test passes. Output ends with something like `Test Files  1 passed (1) | Tests  1 passed (1)`. If `happy-dom` errors on import, verify `node_modules/happy-dom` is installed and that the `test.environment` value is the string `"happy-dom"`.

- [ ] **Step 8: Lint passes**

Run: `cd papermite/frontend && npm run lint`
Expected: exits 0. If ESLint reports `'describe'/'it'/'expect' is not defined` for the smoke test, that means tests need explicit imports (which is what we already do — confirm the file imports them from `"vitest"`).

- [ ] **Step 9: Build still passes**

Run: `cd papermite/frontend && npm run build`
Expected: `tsc -b && vite build` succeeds. The smoke test file is included in `tsc -b` because `tsconfig.app.json` has `"include": ["src"]`. If `tsc` errors on the missing types, double-check that the `types` array was updated in step 4.

- [ ] **Step 10: Delete the smoke test**

Run: `rm papermite/frontend/src/test/smoke.test.ts`

We delete the smoke test now that it has proven the harness boots; the real tests in Task 5 will replace it. Keep `src/test/setup.ts` — it's the setup file referenced by `vite.config.ts`.

- [ ] **Step 11: Commit**

```bash
git add papermite/frontend/package.json papermite/frontend/package-lock.json papermite/frontend/vite.config.ts papermite/frontend/tsconfig.app.json papermite/frontend/src/test/setup.ts
git commit -m "chore(papermite): bootstrap Vitest + React Testing Library + happy-dom

Adds the first test harness to papermite/frontend. Imports defineConfig
from vitest/config (vite's defineConfig has no test typing). Adds
test/test:run scripts and a single setup file pulling in jest-dom
matchers. Smoke-tested then removed; real component tests follow."
```

---

## Task 5: FieldRow component tests

**Files:**
- Create: `papermite/frontend/src/components/FieldRow.test.tsx`

- [ ] **Step 1: Re-confirm FieldRow's props**

Run: `sed -n '5,18p' papermite/frontend/src/components/FieldRow.tsx`

Expected: shows the `Props` interface with `fieldName`, `value`, `source`, `required`, `fieldType`, `options?`, `multiple?`, `onUpdate`, `onRequiredToggle`, `onTypeChange`, `onOptionsChange`, `onDelete?`.

`FieldRow` is the default export at the bottom of the file. It must be rendered inside a `<table><tbody>` because it returns `<tr>` rows. The tests below wrap renders accordingly.

- [ ] **Step 2: Create FieldRow.test.tsx**

Create `papermite/frontend/src/components/FieldRow.test.tsx` with the exact content below:

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import FieldRow from "./FieldRow";
import type { FieldType } from "../types/models";

interface FieldRowTestProps {
  fieldName?: string;
  value?: unknown;
  source?: "base_model" | "custom_field";
  required?: boolean;
  fieldType?: FieldType;
  options?: string[];
  multiple?: boolean;
  onUpdate?: (fieldName: string, value: unknown) => void;
  onRequiredToggle?: (fieldName: string, required: boolean) => void;
  onTypeChange?: (fieldName: string, fieldType: FieldType) => void;
  onOptionsChange?: (
    fieldName: string,
    options: string[],
    multiple: boolean
  ) => void;
  onDelete?: () => void;
}

function renderRow(overrides: FieldRowTestProps = {}) {
  const onUpdate = overrides.onUpdate ?? vi.fn();
  const onRequiredToggle = overrides.onRequiredToggle ?? vi.fn();
  const onTypeChange = overrides.onTypeChange ?? vi.fn();
  const onOptionsChange = overrides.onOptionsChange ?? vi.fn();

  const utils = render(
    <table>
      <tbody>
        <FieldRow
          fieldName={overrides.fieldName ?? "grade_level"}
          value={overrides.value}
          source={overrides.source ?? "custom_field"}
          required={overrides.required ?? false}
          fieldType={overrides.fieldType ?? "str"}
          options={overrides.options}
          multiple={overrides.multiple}
          onUpdate={onUpdate}
          onRequiredToggle={onRequiredToggle}
          onTypeChange={onTypeChange}
          onOptionsChange={onOptionsChange}
          onDelete={overrides.onDelete}
        />
      </tbody>
    </table>
  );

  return { ...utils, onUpdate, onRequiredToggle, onTypeChange, onOptionsChange };
}

describe("FieldRow", () => {
  it("renders an object value as JSON, never as [object Object]", () => {
    renderRow({ value: { a: 1 }, fieldType: "str" });
    expect(screen.getByText('{"a":1}')).toBeInTheDocument();
    expect(screen.queryByText(/\[object Object\]/)).not.toBeInTheDocument();
  });

  it("initializes the text-edit input via JSON.stringify for array-of-objects", () => {
    renderRow({ value: [{ x: 1 }], fieldType: "str" });
    fireEvent.click(screen.getByText('[{"x":1}]'));
    const input = screen.getByDisplayValue('[{"x":1}]') as HTMLInputElement;
    expect(input).toBeInTheDocument();
    expect(input.value).not.toBe("[object Object]");
  });

  it("renders a <select> inline for single-select with options (no click required)", () => {
    const { onUpdate } = renderRow({
      // base_model so the data-type column renders a locked <span>, not a <select>;
      // this keeps the Value cell's <select> the only combobox in the row.
      source: "base_model",
      required: true,
      value: "Active",
      fieldType: "selection",
      options: ["Active", "Inactive"],
      multiple: false,
    });

    const select = screen.getByRole("combobox") as HTMLSelectElement;
    expect(select).toBeInTheDocument();
    expect(select.value).toBe("Active");
    const optionValues = Array.from(select.options).map((o) => o.value);
    expect(optionValues).toEqual(["", "Active", "Inactive"]);

    fireEvent.change(select, { target: { value: "Inactive" } });
    expect(onUpdate).toHaveBeenCalledWith("grade_level", "Inactive");
  });

  it("renders one checkbox per option inline for multi-select with options", () => {
    const { onUpdate } = renderRow({
      source: "base_model",
      required: true,
      fieldName: "days_of_week",
      value: ["Mon"],
      fieldType: "selection",
      options: ["Mon", "Tue", "Wed"],
      multiple: true,
    });

    const checkboxes = screen.getAllByRole("checkbox");
    // The Required column also has a checkbox, so we filter by accessible name.
    const optionBoxes = checkboxes.filter((cb) =>
      ["Mon", "Tue", "Wed"].some((label) =>
        cb.closest("label")?.textContent?.includes(label)
      )
    );
    expect(optionBoxes).toHaveLength(3);
    expect((optionBoxes[0] as HTMLInputElement).checked).toBe(true);
    expect((optionBoxes[1] as HTMLInputElement).checked).toBe(false);
    expect((optionBoxes[2] as HTMLInputElement).checked).toBe(false);

    fireEvent.click(optionBoxes[1]);
    expect(onUpdate).toHaveBeenCalledWith("days_of_week", ["Mon", "Tue"]);
  });

  it("falls back to text input when selection has no options yet", () => {
    renderRow({
      value: "seed",
      fieldType: "selection",
      options: [],
    });

    expect(screen.queryByRole("combobox")).toBeNull();
    expect(screen.getByText("seed")).toBeInTheDocument();
    fireEvent.click(screen.getByText("seed"));
    expect(screen.getByDisplayValue("seed")).toBeInTheDocument();
  });
});
```

- [ ] **Step 3: Run the new tests**

Run: `cd papermite/frontend && npm run test:run`
Expected: Vitest discovers `src/components/FieldRow.test.tsx`, all 5 tests pass. Output ends with `Test Files  1 passed (1) | Tests  5 passed (5)`.

If a test fails:
- "Found multiple elements with role combobox" → there is more than one `<select>` rendered (e.g. the data-type selector). The single-select test renders with `source: "custom_field"` so the data-type `<select>` is also present. Switch `screen.getByRole("combobox")` to `screen.getAllByRole("combobox")` and pick the one whose `<option>` values match `options`.
- "Element ... not found" for `[object Object]` queries → that's good, the regex `queryByText(/\[object Object\]/)` returning null is the assertion's expectation.

Tests 3 and 4 render with `source: "base_model"` to keep the data-type column as a locked `<span>` so there's only one combobox in the row. If that's missed and you do hit a multiple-combobox failure, replace the test's `const select = screen.getByRole("combobox") as HTMLSelectElement;` with:

```tsx
    const selects = screen.getAllByRole("combobox") as HTMLSelectElement[];
    const select = selects.find((s) =>
      Array.from(s.options).some((o) => o.value === "Active")
    )!;
```

and continue the test as written. Re-run.

- [ ] **Step 4: Lint passes**

Run: `cd papermite/frontend && npm run lint`
Expected: exits 0. The test file uses explicit imports (`describe`, `it`, `expect`, `vi`, `fireEvent`, `render`, `screen`) so ESLint won't complain about undefined globals.

- [ ] **Step 5: Build passes**

Run: `cd papermite/frontend && npm run build`
Expected: `tsc -b && vite build` succeeds. The test file is in `src/` so `tsc` will type-check it; the `vitest/globals` and `@testing-library/jest-dom` types from Task 4 satisfy any global references.

- [ ] **Step 6: Commit**

```bash
git add papermite/frontend/src/components/FieldRow.test.tsx
git commit -m "test(papermite): cover FieldRow safe serialization + inline selection controls

Five component tests:
- object value displays as JSON, never [object Object]
- array-of-objects text-edit input initializes via JSON.stringify
- single-select with options renders <select> inline, change calls onUpdate
- multi-select with options renders checkbox group, toggle calls onUpdate with array
- selection with empty options falls back to click-to-edit text input

Regression coverage for issue #68."
```

---

## Task 6: Manual verification

**Files:** none (manual)

- [ ] **Step 1: Start services**

Run: `./start-services.sh`
Expected: launchpad, papermite, admindash, and datacore start. Output shows each service's port (papermite frontend at 5700).

- [ ] **Step 2: Verify lint, build, and tests are green**

```bash
cd papermite/frontend && npm run lint && npm run build && npm run test:run
```

Expected: all three exit 0, tests show `5 passed`.

- [ ] **Step 3: Reproduce the original bug pre-condition**

Open `http://localhost:5700` in a browser. Authenticate as the test tenant admin. From the Landing page choose **Upload New Document** and upload any sample document that has fields the AI extracts into list/dict shapes (e.g., a registration form with grade levels or days-of-week sections). On the Review page, locate a selection field whose extracted `value` is a list or dict.

Expected: the Value cell shows a JSON-encoded string (e.g. `["1st","2nd"]` or `{"Mon":true}`) — NOT `"[object Object]"` or `"[object Object],[object Object]"`. The bug is no longer reproducible regardless of clicking.

- [ ] **Step 4: Verify inline single-select dropdown**

On the same Review page, find a selection field with `multiple: false` and at least one defined option (e.g. Student `status` or Student `gender`).

Expected: the Value cell shows a dropdown (`<select>`) directly without any click required. Change selection — the row reflects the new value immediately. Refresh the page; the new value persists via IndexedDB.

- [ ] **Step 5: Verify inline multi-select checkbox group**

On the same Review page (or upload a doc that includes a Program), find a selection field with `multiple: true` (e.g. Program `grade_levels` or Program `days_of_week`).

Expected: the Value cell shows a row of checkboxes, one per option, without any click required. Toggling multiple options updates the value as an array. Refresh — array persists.

- [ ] **Step 6: Verify text-input fallback for non-selection fields**

Find a non-selection field (e.g. Student `first_name`).

Expected: existing behavior unchanged — click the value, a text input appears, edit, press Enter or blur to save.

- [ ] **Step 7: Verify text-input fallback for selection-with-no-options**

Add a custom field via the **+ Add field** form at the bottom of an entity, then change its data type to `selection` via the type dropdown.

Expected: because no options are defined yet, the Value cell uses the click-to-edit text input (not the inline `<select>`).

- [ ] **Step 8: Verify OptionsEditor panel still works (regression check)**

Click the `[N opts]` button in the Data Type column on any selection field.

Expected: the existing `OptionsEditor` panel opens below the row, with the `Allow multiple` toggle and add/remove option tags. Adding a new option and toggling `Allow multiple` both work. When `Allow multiple` is toggled, the Value cell flips between dropdown and checkbox group inline.

- [ ] **Step 9: Final commit if any cleanups**

Most likely there are no further changes. If anything was tweaked during manual testing:

```bash
git add papermite/frontend
git commit -m "chore(papermite): minor cleanup from manual verification"
```

Otherwise skip this step.

---

## Spec coverage summary

| Spec requirement | Plan tasks |
|---|---|
| `FieldRow display value safely serializes objects and arrays` (4 scenarios) | Task 1 (helper + display path), Task 5 test 1 |
| `Text-input edit mode initialization mirrors display serialization` (2 scenarios) | Task 1 (editValue path), Task 5 test 2 |
| `Selection field with options renders an inline always-visible control` (4 scenarios) | Task 2 (inline branch), Task 3 (CSS), Task 5 tests 3 & 4, Task 6 steps 4 & 5 |
| `Inline selection control binds defensively to legacy values` (4 scenarios) | Task 2 (`selected`/`currentValue` guards), Task 6 step 3 |
| `Selection field with no options falls back to text editor` (1 scenario) | Task 2 (untouched fallback branch), Task 5 test 5, Task 6 step 7 |

All five requirements and 15 scenarios are covered.
