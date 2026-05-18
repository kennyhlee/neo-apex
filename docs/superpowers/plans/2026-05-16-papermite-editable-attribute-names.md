# Papermite Editable Attribute Names Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Resolve [Papermite issue #67](https://github.com/kennyhlee/neo-apex/issues/67) — let users rename LLM-detected attribute (field) names on the Papermite review screen. The rename is scoped to **custom_field** rows; base-model field names remain locked, matching the existing lock pattern for base-field types and required flags.

**Architecture:** Pure frontend gap-fill in three files (`FieldRow.tsx`, `EntityCard.tsx`, `EntityCard.css`) plus one backend regression test. `FieldRow` gains an inline edit toggle on the name cell — identical UX to the existing value-cell toggle — but only renders the editable control when `source === "custom_field"`. The rename callback flows up to `EntityCard.handleFieldNameChange`, which validates non-emptiness and per-entity uniqueness (across **both** base and custom sources) and updates the three in-memory locations the existing `handleFieldDelete` already maintains: `entity.field_mappings`, `entity.entity`, and `entity.entity.custom_fields`. The handler returns `{ ok: true } | { ok: false, error: string }` rather than throwing, so the row can render the error inline without try/catch in event handlers. The backend already accepts whatever `field_name` value the client sends — `_build_model_definition` reads it verbatim — so no backend code changes; only a regression test that pins this behavior in place.

**Tech Stack:** React 19 + TypeScript 5.9 (`verbatimModuleSyntax: true`, strict mode) + Vite 8 on the frontend; FastAPI + pydantic + httpx on the backend; pytest with `unittest.mock.patch` and `fastapi.testclient.TestClient` for tests; `uv` as the Python package manager.

**Source artifacts:** `openspec/changes/papermite-editable-attribute-names/{proposal.md, design.md, specs/papermite-attribute-rename/spec.md, tasks.md}`.

**Port reference (root `CLAUDE.md` + `services.json` are authoritative):** Papermite backend runs on **5710** for local dev, frontend on **5700**. The `papermite/CLAUDE.md` file mentions port 8000 and a `/finalize/preview` endpoint — both are stale, ignore them.

---

## File Map

| Action | File | Responsibility |
|---|---|---|
| Modify | `papermite/frontend/src/components/FieldRow.tsx` | Add `onFieldNameChange` prop, name-edit state (`editingName`, `editName`, `nameError`), and a custom-field-only branch in the name `<td>` that toggles between a display `<span>` and `<input>`. Base-field rows keep the existing `<code>`. |
| Modify | `papermite/frontend/src/components/EntityCard.tsx` | Add `handleFieldNameChange` (validation + 3-way state sync), pass it as `onFieldNameChange` to `<FieldRow />`. |
| Modify | `papermite/frontend/src/components/EntityCard.css` | Add `.field-row__name-display` (hover/cursor affordance) and `.field-row__name-error` (inline red message). Leave the existing `.field-row__name code` selector untouched. |
| Create | `papermite/backend/tests/test_finalize_api.py` | Regression test: POST a `FinalizeRequest` with a renamed custom field, mock `httpx.put`, assert the captured payload carries the new name in `custom_fields` and no trace of the old name. |

No other files require changes. `ReviewPage.tsx`'s existing `hasChanges()` already compares `om.field_name !== cm.field_name` (line 19), so dirty tracking is ready. Backend `finalize.py` and the `FieldMapping` Pydantic model accept arbitrary string `field_name` values today.

---

## Task 1: Add the `onFieldNameChange` prop and name-edit state to `FieldRow`

**Files:**
- Modify: `papermite/frontend/src/components/FieldRow.tsx`

- [ ] **Step 1: Read the current `Props` interface and component signature**

Run: `sed -n '1,30p' papermite/frontend/src/components/FieldRow.tsx`

Confirm the file starts:
```tsx
import { useState } from "react";
import { FIELD_TYPES } from "../types/models";
import type { FieldType } from "../types/models";

interface Props {
  fieldName: string;
  value: unknown;
  source: "base_model" | "custom_field";
  required: boolean;
  fieldType: FieldType;
  options?: string[];
  multiple?: boolean;
  onUpdate: (fieldName: string, value: unknown) => void;
  onRequiredToggle: (fieldName: string, required: boolean) => void;
  onTypeChange: (fieldName: string, fieldType: FieldType) => void;
  onOptionsChange: (fieldName: string, options: string[], multiple: boolean) => void;
  onDelete?: () => void;
}
```

If the file has drifted, re-read it fully and adapt the line anchors in subsequent steps accordingly — but the symbol names below are stable.

- [ ] **Step 2: Add `useEffect` to the React import**

Replace the exact line at the top of the file:

```tsx
import { useState } from "react";
```

with:

```tsx
import { useEffect, useState } from "react";
```

`useEffect` is used by the auto-clear timer for `nameError` in Step 6.

- [ ] **Step 3: Add `onFieldNameChange` to the `Props` interface**

Inside the `Props` interface, immediately after the `onOptionsChange` line and before `onDelete?: () => void;`, insert:

```tsx
  onFieldNameChange?: (
    oldName: string,
    newName: string
  ) => { ok: true } | { ok: false; error: string };
```

The full `Props` block should now read:

```tsx
interface Props {
  fieldName: string;
  value: unknown;
  source: "base_model" | "custom_field";
  required: boolean;
  fieldType: FieldType;
  options?: string[];
  multiple?: boolean;
  onUpdate: (fieldName: string, value: unknown) => void;
  onRequiredToggle: (fieldName: string, required: boolean) => void;
  onTypeChange: (fieldName: string, fieldType: FieldType) => void;
  onOptionsChange: (fieldName: string, options: string[], multiple: boolean) => void;
  onFieldNameChange?: (
    oldName: string,
    newName: string
  ) => { ok: true } | { ok: false; error: string };
  onDelete?: () => void;
}
```

- [ ] **Step 4: Destructure `onFieldNameChange` in the component signature**

Find the `export default function FieldRow({ ... }: Props)` destructuring block (around line 99-112). Add `onFieldNameChange,` immediately after `onOptionsChange,` and before `onDelete,`. The block should read:

```tsx
export default function FieldRow({
  fieldName,
  value,
  source,
  required,
  fieldType,
  options,
  multiple,
  onUpdate,
  onRequiredToggle,
  onTypeChange,
  onOptionsChange,
  onFieldNameChange,
  onDelete,
}: Props) {
```

- [ ] **Step 5: Add name-edit state inside the component**

Find the three existing `useState` calls inside the component body (around lines 113-115):

```tsx
  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState(toEditString(value));
  const [showOptions, setShowOptions] = useState(false);
```

Insert three new state declarations immediately after the `setShowOptions` line:

```tsx
  const [editingName, setEditingName] = useState(false);
  const [editName, setEditName] = useState(fieldName);
  const [nameError, setNameError] = useState<string | null>(null);
```

- [ ] **Step 6: Add the `nameError` auto-clear effect**

Immediately after the new state declarations from Step 5 (so still above `handleSave`), insert:

```tsx
  useEffect(() => {
    if (nameError === null) return;
    const t = setTimeout(() => setNameError(null), 3000);
    return () => clearTimeout(t);
  }, [nameError]);
```

- [ ] **Step 7: Add `handleNameSave` and `handleNameKeyDown` handlers**

Immediately after the existing `handleKeyDown` function (which lives directly after `handleSave`, around lines 122-125), insert:

```tsx
  const handleNameSave = () => {
    const trimmed = editName.trim();
    if (trimmed === fieldName) {
      setEditingName(false);
      setEditName(fieldName);
      return;
    }
    if (!onFieldNameChange) {
      setEditingName(false);
      setEditName(fieldName);
      return;
    }
    const result = onFieldNameChange(fieldName, trimmed);
    if (result.ok) {
      setEditingName(false);
    } else {
      setNameError(result.error);
      setEditingName(false);
      setEditName(fieldName);
    }
  };

  const handleNameKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleNameSave();
    }
    if (e.key === "Escape") {
      setEditingName(false);
      setEditName(fieldName);
    }
  };
```

Note: on success, we deliberately do NOT reset `editName` to `fieldName`, because the `FieldRow` will remount immediately (its `key={mapping.field_name}` prop in the parent changes), and a fresh component will initialize `editName` to the new `fieldName` from props. On rejection or no-op we reset locally so the next click into edit mode starts clean.

- [ ] **Step 8: Save and run the typecheck**

Run: `cd papermite/frontend && npm run build`

Expected: TypeScript compiles successfully and Vite produces a build. If it fails with errors referencing the new symbols, fix the introduced typos before continuing. (We haven't wired the new state into the JSX yet, so React's unused-variable warning may surface — that is fine, Task 2 wires it up.)

- [ ] **Step 9: Commit**

```bash
git add papermite/frontend/src/components/FieldRow.tsx
git commit -m "feat(papermite): scaffold name-edit state on FieldRow (no UI yet)"
```

---

## Task 2: Render the editable name cell for custom fields

**Files:**
- Modify: `papermite/frontend/src/components/FieldRow.tsx` (the name `<td>` only)

- [ ] **Step 1: Locate the current name cell**

Run: `sed -n '130,140p' papermite/frontend/src/components/FieldRow.tsx`

Confirm you see:

```tsx
  return (
    <>
      <tr className="field-row">
        <td className="field-row__name">
          <code>{fieldName}</code>
        </td>
```

- [ ] **Step 2: Replace the name `<td>` with the conditional renderer**

Replace this exact block:

```tsx
        <td className="field-row__name">
          <code>{fieldName}</code>
        </td>
```

with:

```tsx
        <td className="field-row__name">
          {isBase ? (
            <code>{fieldName}</code>
          ) : editingName ? (
            <input
              className="input field-row__input"
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              onBlur={handleNameSave}
              onKeyDown={handleNameKeyDown}
              autoFocus
            />
          ) : (
            <span
              className="field-row__name-display"
              onClick={() => {
                setEditName(fieldName);
                setEditingName(true);
              }}
              title="Click to edit"
            >
              {fieldName}
            </span>
          )}
          {nameError && (
            <div className="field-row__name-error" role="alert">
              {nameError}
            </div>
          )}
        </td>
```

Note: `isBase` is already defined a few lines below (line 129 in the original: `const isBase = source === "base_model";`). The JSX references it before its declaration in source order, which works because `const` declarations are hoisted to the top of their scope when used inside JSX inside the same function body. (If TypeScript complains about temporal dead zone, move `const isBase = source === "base_model";` to just before the `return (` — see Step 4.)

- [ ] **Step 3: Hoist `isBase` declaration above `return` for safety**

Find the line (originally line 129, may have shifted slightly):

```tsx
  const isBase = source === "base_model";
```

Confirm it sits between `const displayValue = ...` and `return (`. If it has somehow drifted below `return`, move it back above `return (`. This keeps the JSX reference in the name cell working with no temporal dead zone risk.

- [ ] **Step 4: Run typecheck**

Run: `cd papermite/frontend && npm run build`

Expected: clean build, no TypeScript errors.

If you see an error like `Cannot find name 'editName'` or similar, you missed a step in Task 1 — go back and complete it before proceeding.

- [ ] **Step 5: Commit**

```bash
git add papermite/frontend/src/components/FieldRow.tsx
git commit -m "feat(papermite): render editable name cell for custom fields"
```

---

## Task 3: Wire `handleFieldNameChange` in `EntityCard`

**Files:**
- Modify: `papermite/frontend/src/components/EntityCard.tsx`

- [ ] **Step 1: Read the current handlers**

Run: `sed -n '60,90p' papermite/frontend/src/components/EntityCard.tsx`

Confirm you see `handleOptionsChange`, `handleFieldDelete`, and `handleAddField` defined. The delete handler cleans up `entity.entity[fieldName]` AND `entity.entity.custom_fields[fieldName]` — your new handler mirrors that cleanup pattern for renames.

- [ ] **Step 2: Add `handleFieldNameChange` immediately after `handleOptionsChange`**

Find the closing `};` of `handleOptionsChange` (around line 66 in the current file). Immediately after it (before the blank line that precedes `handleFieldDelete`), insert:

```tsx
  const handleFieldNameChange = (
    oldName: string,
    newName: string
  ): { ok: true } | { ok: false; error: string } => {
    const trimmed = newName.trim();
    if (trimmed.length === 0) {
      return { ok: false, error: "Name cannot be empty" };
    }
    if (trimmed === oldName) {
      return { ok: true };
    }
    const collision = entity.field_mappings.some(
      (m) => m.field_name !== oldName && m.field_name === trimmed
    );
    if (collision) {
      return {
        ok: false,
        error: `"${trimmed}" is already used by another field`,
      };
    }

    const newMappings = entity.field_mappings.map((m) =>
      m.field_name === oldName ? { ...m, field_name: trimmed } : m
    );

    const newEntity: Record<string, unknown> = { ...entity.entity };
    if (Object.prototype.hasOwnProperty.call(newEntity, oldName)) {
      newEntity[trimmed] = newEntity[oldName];
      delete newEntity[oldName];
    }

    const cf = newEntity.custom_fields;
    if (
      cf &&
      typeof cf === "object" &&
      Object.prototype.hasOwnProperty.call(cf, oldName)
    ) {
      const cfClone = { ...(cf as Record<string, unknown>) };
      cfClone[trimmed] = cfClone[oldName];
      delete cfClone[oldName];
      newEntity.custom_fields = cfClone;
    }

    onUpdate(index, {
      ...entity,
      entity: newEntity,
      field_mappings: newMappings,
    });
    return { ok: true };
  };
```

- [ ] **Step 3: Pass `onFieldNameChange` to `FieldRow`**

Find the `<FieldRow ... />` element (around lines 137-155). Immediately after `onOptionsChange={handleOptionsChange}` and before the `onDelete={...}` line, insert:

```tsx
                onFieldNameChange={
                  mapping.source === "custom_field"
                    ? handleFieldNameChange
                    : undefined
                }
```

The full FieldRow invocation should now read:

```tsx
              <FieldRow
                key={mapping.field_name}
                fieldName={mapping.field_name}
                value={mapping.value}
                source={mapping.source}
                required={mapping.required}
                fieldType={mapping.field_type}
                options={mapping.options}
                multiple={mapping.multiple}
                onUpdate={handleFieldUpdate}
                onRequiredToggle={handleRequiredToggle}
                onTypeChange={handleTypeChange}
                onOptionsChange={handleOptionsChange}
                onFieldNameChange={
                  mapping.source === "custom_field"
                    ? handleFieldNameChange
                    : undefined
                }
                onDelete={
                  mapping.source === "custom_field"
                    ? () => handleFieldDelete(mapping.field_name)
                    : undefined
                }
              />
```

Even though `FieldRow` itself already gates on `isBase` (Task 2 Step 2), passing `undefined` for base rows is belt-and-suspenders — if the props ever diverge the gate still holds.

- [ ] **Step 4: Run typecheck**

Run: `cd papermite/frontend && npm run build`

Expected: clean build.

- [ ] **Step 5: Run the linter**

Run: `cd papermite/frontend && npm run lint`

Expected: no new errors or warnings introduced by `FieldRow.tsx` or `EntityCard.tsx`. Pre-existing lint output (if any) in unrelated files is OK.

- [ ] **Step 6: Commit**

```bash
git add papermite/frontend/src/components/EntityCard.tsx
git commit -m "feat(papermite): rename handler validates and syncs three state locations"
```

---

## Task 4: Styling — affordance and inline error

**Files:**
- Modify: `papermite/frontend/src/components/EntityCard.css`

- [ ] **Step 1: Locate the existing name-cell rule**

Run: `sed -n '81,90p' papermite/frontend/src/components/EntityCard.css`

Confirm you see:

```css
.field-row__name code {
  font-family: var(--font-sans);
  font-size: 13px;
  color: var(--text-secondary);
  background: none;
  padding: 0;
}
```

This rule MUST remain unchanged so base-field rendering stays visually inert.

- [ ] **Step 2: Append new rules after `.field-row__name code`**

Use Edit to insert the following block immediately after the closing `}` of `.field-row__name code` and the blank line that follows it, and before `.field-row__value {`:

```css
.field-row__name-display {
  font-family: var(--font-sans);
  font-size: 13px;
  color: var(--text-secondary);
  cursor: pointer;
  padding: 4px 0;
  border-bottom: 1px dashed transparent;
  transition: border-color 0.2s;
  display: inline-block;
}

.field-row__name-display:hover {
  border-bottom-color: var(--text-tertiary);
}

.field-row__name-error {
  margin-top: 4px;
  font-family: var(--font-sans);
  font-size: 12px;
  color: var(--accent-danger, #d4537e);
  line-height: 1.3;
}
```

Rationale for the colors and spacing:
- `font-family`/`font-size`/`color` on `.field-row__name-display` match the existing `.field-row__name code` so swapping between display and the existing static base render is visually consistent.
- The hover underline mirrors `.field-row__display:hover` (the value cell pattern at line 105-107 of the same file) so the affordance feels familiar.
- `--accent-danger` falls back to `#d4537e` (the existing FAMILY entity color, which is already in the magenta/red range) if the CSS variable isn't defined.

- [ ] **Step 3: Verify no other selectors regressed**

Run: `cd papermite/frontend && npm run build`

Expected: clean build (CSS is processed by Vite without explicit type-checking, but the build will surface any malformed CSS).

- [ ] **Step 4: Commit**

```bash
git add papermite/frontend/src/components/EntityCard.css
git commit -m "style(papermite): hover affordance for name cell and inline error style"
```

---

## Task 5: Backend regression test for rename pass-through

**Files:**
- Create: `papermite/backend/tests/test_finalize_api.py`

- [ ] **Step 1: Read the existing test conventions**

Run: `sed -n '1,40p' papermite/backend/tests/test_extract_api.py`

Confirm: `from app.main import app`, `from app.models.registry import UserRecord`, the `mock_auth` fixture pattern, and use of `TestClient(app)`. Replicate this style.

Also confirm `papermite/backend/tests/conftest.py` autouses `_bypass_cloudflare_middleware` (sets `TRUST_ALL_IPS=1`) — so your test doesn't need to do that.

- [ ] **Step 2: Write the failing test**

Create the file `papermite/backend/tests/test_finalize_api.py` with this exact content:

```python
"""Regression tests for POST /api/tenants/{tenant_id}/finalize/commit.

Pins the contract that custom-field renames flow from the request payload
straight into the model definition sent to DataCore.
"""
from unittest.mock import MagicMock, patch

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.models.registry import UserRecord

client = TestClient(app)

FAKE_USER = UserRecord(
    user_id="u1",
    name="Test Admin",
    email="admin@test.com",
    password_hash="",
    tenant_id="t1",
    tenant_name="Test Tenant",
    role="admin",
    created_at="",
)


@pytest.fixture(autouse=True)
def mock_auth():
    """Bypass auth for all tests using FastAPI dependency override."""
    from app.api.auth import require_admin

    app.dependency_overrides[require_admin] = lambda: FAKE_USER
    yield
    app.dependency_overrides.pop(require_admin, None)


def _payload_with_renamed_custom_field() -> dict:
    """A finalize payload with one custom field renamed away from any LLM default."""
    return {
        "extraction": {
            "extraction_id": "e1",
            "tenant_id": "t1",
            "filename": "app.pdf",
            "entities": [
                {
                    "entity_type": "student",
                    "entity": {
                        "first_name": "Sam",
                        "date_of_birth": "2010-01-01",
                        "custom_fields": {"date_of_birth": "2010-01-01"},
                    },
                    "field_mappings": [
                        {
                            "field_name": "first_name",
                            "value": "Sam",
                            "source": "base_model",
                            "required": True,
                            "field_type": "str",
                        },
                        {
                            "field_name": "date_of_birth",
                            "value": "2010-01-01",
                            "source": "custom_field",
                            "required": False,
                            "field_type": "date",
                        },
                    ],
                }
            ],
            "status": "pending_review",
        }
    }


def _datacore_response_payload(model_definition: dict) -> dict:
    """Shape that `finalize_commit` expects back from DataCore."""
    return {
        "status": "ok",
        "version": 1,
        "model_definition": model_definition,
        "source_filename": "app.pdf",
        "created_by": "Test Admin",
        "created_at": "2026-05-16T00:00:00Z",
    }


def test_renamed_custom_field_is_passed_through_to_datacore():
    """Frontend rename must reach DataCore's model_definition payload verbatim."""
    captured: dict = {}

    def fake_put(url, *, json, timeout):  # noqa: ARG001 - signature matches httpx.put
        captured["url"] = url
        captured["json"] = json
        mock_resp = MagicMock()
        mock_resp.status_code = 200
        mock_resp.json.return_value = _datacore_response_payload(
            json["model_definition"]
        )
        return mock_resp

    with patch("app.api.finalize.httpx.put", side_effect=fake_put):
        resp = client.post(
            "/api/tenants/t1/finalize/commit",
            json=_payload_with_renamed_custom_field(),
        )

    assert resp.status_code == 200, resp.text

    # The renamed custom field reached DataCore under its new name.
    sent_model = captured["json"]["model_definition"]
    assert "student" in sent_model, sent_model
    student = sent_model["student"]

    custom_names = [f["name"] for f in student["custom_fields"]]
    base_names = [f["name"] for f in student["base_fields"]]

    assert "date_of_birth" in custom_names, custom_names
    # Critically: no trace of the LLM-default name anywhere.
    assert "dob" not in custom_names, custom_names
    assert "dob" not in base_names, base_names

    # And the renamed field's other properties were preserved.
    renamed = next(f for f in student["custom_fields"] if f["name"] == "date_of_birth")
    assert renamed["type"] == "date"
    assert renamed["required"] is False


def test_finalize_rejects_tenant_mismatch():
    """Sanity: the existing tenant guard still works with the test setup."""
    bad = _payload_with_renamed_custom_field()
    bad["extraction"]["tenant_id"] = "other_tenant"
    resp = client.post("/api/tenants/t1/finalize/commit", json=bad)
    assert resp.status_code == 400, resp.text
```

- [ ] **Step 3: Run the test and confirm it passes**

Run: `cd papermite/backend && uv run python -m pytest tests/test_finalize_api.py -v`

Expected output (both tests pass):

```
tests/test_finalize_api.py::test_renamed_custom_field_is_passed_through_to_datacore PASSED
tests/test_finalize_api.py::test_finalize_rejects_tenant_mismatch PASSED
```

If `test_renamed_custom_field_is_passed_through_to_datacore` fails because the assertion can't find `student["custom_fields"]`, re-read `_build_model_definition` in `papermite/backend/app/api/finalize.py` — your payload's `entity_type` must lowercase to `"student"`, which matches the lookup `entity_type.lower()` on line 38. The fixture above already uses `"student"`, so this should pass on first run.

If it fails because `httpx.put` is called with positional arguments instead of keyword `json=`, change `fake_put`'s signature to `def fake_put(url, *args, **kwargs):` and read `kwargs["json"]`. The current `finalize.py:96-104` uses `json=...` as a keyword, so the keyword form should work.

- [ ] **Step 4: Run the full backend test suite to confirm no regressions**

Run: `cd papermite/backend && uv run python -m pytest tests/ -v`

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add papermite/backend/tests/test_finalize_api.py
git commit -m "test(papermite): pin custom-field rename pass-through to DataCore"
```

---

## Task 6: Manual verification

**Files:** none.

This task is intentionally execution-only. Do NOT skip — there is no Vitest harness on Papermite yet (only a single bug-fix added one for FieldRow), so the most reliable verification of the new UX is to click through it.

- [ ] **Step 1: Start the services**

From the repo root:

```bash
./start-services.sh
```

If the script asks any questions, choose to start papermite frontend + backend + datacore. Wait until you see all three reporting healthy (papermite-frontend on 5700, papermite-backend on 5710, datacore on 5800).

- [ ] **Step 2: Reach the review screen with at least one custom field**

In a browser:
1. Open `http://localhost:5700/`.
2. If a model already exists for your test tenant, click "Edit Model" to land on the review screen with the existing model loaded. Otherwise click "Upload New Document" and upload any sample PDF the LLM will produce custom fields from (any of the sample docs in `~/Development/NeoApex/sampledoc/`, or any application form).

You should now be on `/review/<id>` with one or more `EntityCard` panels.

- [ ] **Step 3: Verify custom-field rename works (happy path)**

- Locate a row with the `custom` badge (the source column shows `custom`).
- Hover the field name in the leftmost column — the cursor should change to a pointer and a dashed underline should appear.
- Click it. An input should appear, prefilled with the current name and focused.
- Type a new name, press **Enter**. The row should re-render showing the new name, no error message should appear.

Pass criteria: name visibly changes, no console errors in the browser devtools, no error message under the cell.

- [ ] **Step 4: Verify base-field name is NOT editable**

- Locate a row with the `base` badge.
- Hover the field name. The cursor should NOT change to pointer; no underline appears.
- Click it. Nothing should happen — no input, no focus indicator beyond default.

Pass criteria: base-field name remains static.

- [ ] **Step 5: Verify duplicate-name collision (custom vs custom)**

- Click a custom field name. Enter the name of another custom field in the same entity card. Press Enter.
- The input should disappear, the name should revert to the original, and a small red error message should appear under the cell saying something like `"<name>" is already used by another field`.
- Wait ~3 seconds. The error should auto-clear.

- [ ] **Step 6: Verify duplicate-name collision (custom vs base)**

- Click a custom field name. Enter a base-field name from the same entity (e.g. on a Student card, `first_name`). Press Enter.
- The input should revert and the same inline error pattern should appear.

- [ ] **Step 7: Verify empty / whitespace rejection**

- Click a custom field name. Clear the input completely. Press Enter.
- The input should revert and an inline error reading `Name cannot be empty` should appear.
- Repeat with only spaces in the input. Same behavior.

- [ ] **Step 8: Verify Escape cancels**

- Click a custom field name. Type something different. Press **Escape**.
- The input should disappear and the original name should display. No error.

- [ ] **Step 9: Verify finalize round-trips the rename**

- Make a single rename that you'll recognize later (e.g. rename a custom field to `manual_test_renamed`).
- Click **Finalize Model →**. On the next page, click **Confirm & Save** (or whatever the confirm button is labeled — see `FinalizePage.tsx`).
- Return to the landing page. Click **Edit Model**.
- On the review screen, confirm the renamed field appears under `manual_test_renamed` and is still renameable. Optionally rename it again to confirm.

- [ ] **Step 10: Stop the services and commit nothing**

Manual verification produces no code changes. If anything failed, return to the failing task above, fix the implementation, re-run the relevant build/lint/test steps, then re-run only the failing manual step.

---

## Self-Review Notes

The plan above covers every requirement in `openspec/changes/papermite-editable-attribute-names/specs/papermite-attribute-rename/spec.md`:

- **"Custom-field name cells SHALL be inline-editable; base-field name cells SHALL NOT"** → Task 1 (props/state), Task 2 (`isBase` gate in JSX), Task 6 Steps 3-4 (manual verification of both branches).
- **"Validated for non-emptiness and per-entity uniqueness against ALL mappings"** → Task 3 Step 2 (validation logic checks `field_mappings.some(...)` regardless of `source`), Task 6 Steps 5-7 (manual verification of all three rejection paths).
- **"Successful rename SHALL update field_mappings, entity.entity, and entity.entity.custom_fields in lockstep"** → Task 3 Step 2 (the three `newMappings` / `newEntity[trimmed] = ...` / `cfClone[trimmed] = ...` blocks).
- **"Renames SHALL propagate through finalize to the saved model definition"** → Task 5 (backend regression test asserts exact payload to DataCore), Task 6 Step 9 (manual round-trip).
- **"Reopening a saved model SHALL allow further custom-field renames"** → Task 6 Step 9 (`Edit Model` → confirm renamed field is still renameable).

The handler contract `{ ok: true } | { ok: false, error: string }` is consistent across Task 1 (Props type), Task 1 Step 7 (`handleNameSave` consumes it), and Task 3 Step 2 (`handleFieldNameChange` returns it).

No placeholders. No "TBD". All file paths absolute-from-repo-root. All bash commands exact.
