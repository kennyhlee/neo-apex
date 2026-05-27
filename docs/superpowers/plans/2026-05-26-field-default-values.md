# Field Default Values Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let Papermite tenant admins set a per-field default value in the form builder, persist it in the stored model definition, and prefill it into AdminDash's Add Entity form (still editable).

**Architecture:**
1. Papermite backend adds `default: Optional[Any] = None` to `FieldMapping`; `_build_model_definition` writes the key only when non-`None` (never `null`).
2. Papermite frontend adds `default?: unknown` to `FieldMapping`/`FieldDefinition`, renders a new "Default" cell in `FieldRow` between Value and Data Type, wires `handleDefaultChange` in `EntityCard`, clears `default` on type or `multiple` change, adds an optional Default input to `AddFieldForm`, and rehydrates `default` in `modelToExtraction` on edit.
3. AdminDash frontend adds `default?: unknown` to `ModelFieldDefinition` and prefills it in `DynamicForm.buildValues` (`overrides ?? default ?? empty`); the `number` type runs the prefill through `Number(...)` to avoid submitting strings.
4. DataCore is unchanged — model definitions are opaque JSON; `normalize`-then-compare round-trips defaults; omitting `default` for fields with no default keeps byte-equality with pre-feature models.

**Tech Stack:** Python 3.13 + FastAPI + Pydantic + pytest (papermite/admindash backends); React 19 + TypeScript + Vite + vitest + @testing-library/react (papermite frontend); React 19 + TypeScript + Vite, no test framework (admindash frontend).

**Spec source:** `openspec/changes/field-default-values/{proposal,design,tasks}.md` + `specs/field-default-values/spec.md`.

---

## Branch setup

- [ ] **Step 0.1: Create feature branch off main**

```bash
cd /Users/kennylee/Development/NeoApex
git checkout main
git pull origin main
git checkout -b feat/field-default-values
```

---

## Task 1: Papermite backend — `FieldMapping.default` Pydantic field

**Files:**
- Modify: `papermite/backend/app/models/extraction.py:20-27`

- [ ] **Step 1.1: Add `default` to `FieldMapping`**

Edit `papermite/backend/app/models/extraction.py`. The current `FieldMapping` class (lines 20–27) is:

```python
class FieldMapping(BaseModel):
    field_name: str
    value: Any
    source: Literal["base_model", "custom_field"]
    required: bool = True
    field_type: Literal["str", "number", "bool", "date", "datetime", "email", "phone", "selection"] = "str"
    options: Optional[list[str]] = None
    multiple: Optional[bool] = None
```

Change to:

```python
class FieldMapping(BaseModel):
    field_name: str
    value: Any
    source: Literal["base_model", "custom_field"]
    required: bool = True
    field_type: Literal["str", "number", "bool", "date", "datetime", "email", "phone", "selection"] = "str"
    options: Optional[list[str]] = None
    multiple: Optional[bool] = None
    default: Optional[Any] = None
```

- [ ] **Step 1.2: Verify Pydantic still parses existing payloads**

```bash
cd /Users/kennylee/Development/NeoApex
uv run --project papermite python -c "
from app.models.extraction import FieldMapping
m1 = FieldMapping(field_name='age', value=10, source='base_model', required=True, field_type='number')
assert m1.default is None
m2 = FieldMapping(field_name='age', value=10, source='base_model', required=True, field_type='number', default=9)
assert m2.default == 9
print('ok')
" 2>&1 | tail -5
```

Run from `papermite/backend/`:

```bash
cd /Users/kennylee/Development/NeoApex/papermite/backend
uv run python -c "
from app.models.extraction import FieldMapping
m1 = FieldMapping(field_name='age', value=10, source='base_model', required=True, field_type='number')
assert m1.default is None
m2 = FieldMapping(field_name='age', value=10, source='base_model', required=True, field_type='number', default=9)
assert m2.default == 9
print('ok')
"
```

Expected: `ok`.

- [ ] **Step 1.3: Commit**

```bash
cd /Users/kennylee/Development/NeoApex
git add papermite/backend/app/models/extraction.py
git commit -m "feat(papermite): add optional default to FieldMapping"
```

---

## Task 2: Papermite backend — `_build_model_definition` writes `default`

**Files:**
- Modify: `papermite/backend/app/api/finalize.py:178-224` (`_build_model_definition`)
- Test: `papermite/backend/tests/test_finalize_helpers.py` (append)

- [ ] **Step 2.1: Add failing tests to `test_finalize_helpers.py`**

Append these tests to the end of `papermite/backend/tests/test_finalize_helpers.py`:

```python
def test_build_model_definition_omits_default_when_none():
    """A field with default=None must NOT emit 'default' (not even as null)."""
    from app.api.finalize import _build_model_definition
    from app.models.extraction import EntityResult, FieldMapping

    entity = EntityResult(
        entity_type="student",
        entity={"first_name": "Sam"},
        field_mappings=[
            FieldMapping(
                field_name="first_name", value="Sam",
                source="base_model", required=True, field_type="str",
            ),
        ],
    )
    md = _build_model_definition([entity])
    field = md["student"]["base_fields"][0]
    assert "default" not in field
    assert field == {"name": "first_name", "type": "str", "required": True}


def test_build_model_definition_includes_default_when_set():
    """A field with a non-None default emits 'default'."""
    from app.api.finalize import _build_model_definition
    from app.models.extraction import EntityResult, FieldMapping

    entity = EntityResult(
        entity_type="student",
        entity={"school_year": "2026-2027"},
        field_mappings=[
            FieldMapping(
                field_name="school_year", value="2026-2027",
                source="custom_field", required=False, field_type="str",
                default="2026-2027",
            ),
        ],
    )
    md = _build_model_definition([entity])
    field = md["student"]["custom_fields"][0]
    assert field == {
        "name": "school_year",
        "type": "str",
        "required": False,
        "default": "2026-2027",
    }


def test_build_model_definition_preserves_bool_false_default():
    """default=False is a meaningful value and MUST be persisted."""
    from app.api.finalize import _build_model_definition
    from app.models.extraction import EntityResult, FieldMapping

    entity = EntityResult(
        entity_type="student",
        entity={"is_active": False},
        field_mappings=[
            FieldMapping(
                field_name="is_active", value=True,
                source="custom_field", required=False, field_type="bool",
                default=False,
            ),
        ],
    )
    md = _build_model_definition([entity])
    field = md["student"]["custom_fields"][0]
    assert field["default"] is False


def test_build_model_definition_preserves_selection_multi_default():
    """Selection (multi) default preserved verbatim alongside options/multiple."""
    from app.api.finalize import _build_model_definition
    from app.models.extraction import EntityResult, FieldMapping

    entity = EntityResult(
        entity_type="student",
        entity={"subjects": ["math"]},
        field_mappings=[
            FieldMapping(
                field_name="subjects", value=["math"],
                source="custom_field", required=False, field_type="selection",
                options=["math", "science", "history"], multiple=True,
                default=["math"],
            ),
        ],
    )
    md = _build_model_definition([entity])
    field = md["student"]["custom_fields"][0]
    assert field == {
        "name": "subjects",
        "type": "selection",
        "required": False,
        "options": ["math", "science", "history"],
        "multiple": True,
        "default": ["math"],
    }
```

- [ ] **Step 2.2: Run tests, confirm they fail**

```bash
cd /Users/kennylee/Development/NeoApex/papermite/backend
uv run pytest tests/test_finalize_helpers.py::test_build_model_definition_omits_default_when_none tests/test_finalize_helpers.py::test_build_model_definition_includes_default_when_set tests/test_finalize_helpers.py::test_build_model_definition_preserves_bool_false_default tests/test_finalize_helpers.py::test_build_model_definition_preserves_selection_multi_default -v
```

Expected: 4 FAILED — fields are missing the `default` key.

- [ ] **Step 2.3: Update `_build_model_definition`**

Edit `papermite/backend/app/api/finalize.py`. Locate the `field_def` block inside the per-mapping loop (around lines 193–202):

```python
        for mapping in entity_result.field_mappings:
            field_type = mapping.field_type if mapping.field_type != "str" else _infer_type(mapping.value)
            field_def: dict = {
                "name": mapping.field_name,
                "type": field_type,
                "required": mapping.required,
            }
            if field_type == "selection":
                field_def["options"] = mapping.options or []
                field_def["multiple"] = mapping.multiple or False
```

Add a `default` clause **after** the selection block, **before** the source-based append:

```python
        for mapping in entity_result.field_mappings:
            field_type = mapping.field_type if mapping.field_type != "str" else _infer_type(mapping.value)
            field_def: dict = {
                "name": mapping.field_name,
                "type": field_type,
                "required": mapping.required,
            }
            if field_type == "selection":
                field_def["options"] = mapping.options or []
                field_def["multiple"] = mapping.multiple or False
            if mapping.default is not None:
                field_def["default"] = mapping.default
```

- [ ] **Step 2.4: Run tests, confirm pass**

```bash
cd /Users/kennylee/Development/NeoApex/papermite/backend
uv run pytest tests/test_finalize_helpers.py -v
```

Expected: All tests pass (existing tests stay green, 4 new tests pass).

- [ ] **Step 2.5: Commit**

```bash
cd /Users/kennylee/Development/NeoApex
git add papermite/backend/app/api/finalize.py papermite/backend/tests/test_finalize_helpers.py
git commit -m "feat(papermite): persist field default in model definition"
```

---

## Task 3: Papermite backend — integration test that default flows to DataCore PUT

**Files:**
- Test: `papermite/backend/tests/test_finalize_api.py` (append)

- [ ] **Step 3.1: Add failing integration test**

Append to `papermite/backend/tests/test_finalize_api.py`:

```python
def test_finalize_commit_sends_default_in_datacore_put():
    """Defaults on FieldMappings flow into the PUT payload to DataCore /api/models."""
    payload = {
        "extraction": {
            "extraction_id": "e2",
            "tenant_id": "t1",
            "filename": "app.pdf",
            "entities": [
                {
                    "entity_type": "student",
                    "entity": {"first_name": "Sam", "school_year": "2026-2027"},
                    "field_mappings": [
                        {
                            "field_name": "first_name",
                            "value": "Sam",
                            "source": "base_model",
                            "required": True,
                            "field_type": "str",
                        },
                        {
                            "field_name": "school_year",
                            "value": "",
                            "source": "custom_field",
                            "required": False,
                            "field_type": "str",
                            "default": "2026-2027",
                        },
                        {
                            "field_name": "is_active",
                            "value": "",
                            "source": "custom_field",
                            "required": False,
                            "field_type": "bool",
                            "default": False,
                        },
                    ],
                }
            ],
            "status": "pending_review",
        }
    }

    captured = {}

    def fake_put(url, json=None, timeout=None):
        captured["url"] = url
        captured["json"] = json
        return MagicMock(
            status_code=200,
            json=MagicMock(return_value=_datacore_response_payload(json["model_definition"])),
        )

    with patch("app.api.finalize.httpx.put", side_effect=fake_put):
        resp = client.post("/api/tenants/t1/finalize/commit", json=payload)

    assert resp.status_code == 200, resp.text
    md = captured["json"]["model_definition"]
    student_custom = md["student"]["custom_fields"]
    school_year = next(f for f in student_custom if f["name"] == "school_year")
    assert school_year["default"] == "2026-2027"
    is_active = next(f for f in student_custom if f["name"] == "is_active")
    assert is_active["default"] is False
    first_name = next(f for f in md["student"]["base_fields"] if f["name"] == "first_name")
    assert "default" not in first_name
```

- [ ] **Step 3.2: Run test, confirm pass**

```bash
cd /Users/kennylee/Development/NeoApex/papermite/backend
uv run pytest tests/test_finalize_api.py::test_finalize_commit_sends_default_in_datacore_put -v
```

Expected: PASS (the change from Task 2 already implements this).

- [ ] **Step 3.3: Run the full backend test suite to check nothing regressed**

```bash
cd /Users/kennylee/Development/NeoApex/papermite/backend
uv run pytest -v
```

Expected: All tests pass.

- [ ] **Step 3.4: Commit**

```bash
cd /Users/kennylee/Development/NeoApex
git add papermite/backend/tests/test_finalize_api.py
git commit -m "test(papermite): assert default flows to datacore PUT payload"
```

---

## Task 4: Papermite frontend — extend types

**Files:**
- Modify: `papermite/frontend/src/types/models.ts:13-21` (`FieldMapping`), `:51-57` (`FieldDefinition`)

- [ ] **Step 4.1: Add `default?: unknown` to both interfaces**

Edit `papermite/frontend/src/types/models.ts`. Current `FieldMapping` (lines 13–21):

```typescript
export interface FieldMapping {
  field_name: string;
  value: unknown;
  source: "base_model" | "custom_field";
  required: boolean;
  field_type: FieldType;
  options?: string[];
  multiple?: boolean;
}
```

Change to:

```typescript
export interface FieldMapping {
  field_name: string;
  value: unknown;
  source: "base_model" | "custom_field";
  required: boolean;
  field_type: FieldType;
  options?: string[];
  multiple?: boolean;
  default?: unknown;
}
```

Current `FieldDefinition` (lines 51–57):

```typescript
export interface FieldDefinition {
  name: string;
  type: FieldType;
  required: boolean;
  options?: string[];
  multiple?: boolean;
}
```

Change to:

```typescript
export interface FieldDefinition {
  name: string;
  type: FieldType;
  required: boolean;
  options?: string[];
  multiple?: boolean;
  default?: unknown;
}
```

- [ ] **Step 4.2: Type-check**

```bash
cd /Users/kennylee/Development/NeoApex/papermite/frontend
npx tsc -b
```

Expected: no errors.

- [ ] **Step 4.3: Commit**

```bash
cd /Users/kennylee/Development/NeoApex
git add papermite/frontend/src/types/models.ts
git commit -m "feat(papermite): add optional default to FieldMapping/FieldDefinition types"
```

---

## Task 5: Papermite frontend — `FieldRow` Default cell

**Files:**
- Modify: `papermite/frontend/src/components/FieldRow.tsx` (props, state, render)
- Modify: `papermite/frontend/src/components/FieldRow.test.tsx` (test helper + new cases)

- [ ] **Step 5.1: Extend the test helper and add failing tests**

Edit `papermite/frontend/src/components/FieldRow.test.tsx`. First, extend `FieldRowTestProps` to include the new props (around line 6):

```typescript
interface FieldRowTestProps {
  fieldName?: string;
  value?: unknown;
  source?: "base_model" | "custom_field";
  required?: boolean;
  fieldType?: FieldType;
  options?: string[];
  multiple?: boolean;
  defaultVal?: unknown;
  onUpdate?: (fieldName: string, value: unknown) => void;
  onRequiredToggle?: (fieldName: string, required: boolean) => void;
  onTypeChange?: (fieldName: string, fieldType: FieldType) => void;
  onOptionsChange?: (
    fieldName: string,
    options: string[],
    multiple: boolean
  ) => void;
  onDefaultChange?: (fieldName: string, value: unknown) => void;
  onDelete?: () => void;
}
```

Update `renderRow` to wire the new prop and stub (extend the block around lines 25–53):

```typescript
function renderRow(overrides: FieldRowTestProps = {}) {
  const onUpdate = overrides.onUpdate ?? vi.fn();
  const onRequiredToggle = overrides.onRequiredToggle ?? vi.fn();
  const onTypeChange = overrides.onTypeChange ?? vi.fn();
  const onOptionsChange = overrides.onOptionsChange ?? vi.fn();
  const onDefaultChange = overrides.onDefaultChange ?? vi.fn();

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
          defaultVal={overrides.defaultVal}
          onUpdate={onUpdate}
          onRequiredToggle={onRequiredToggle}
          onTypeChange={onTypeChange}
          onOptionsChange={onOptionsChange}
          onDefaultChange={onDefaultChange}
          onDelete={overrides.onDelete}
        />
      </tbody>
    </table>
  );

  return { ...utils, onUpdate, onRequiredToggle, onTypeChange, onOptionsChange, onDefaultChange };
}
```

Append these new tests inside the existing `describe("FieldRow", ...)` block:

```typescript
  it("renders an empty Default cell click-to-edit input", () => {
    const { onDefaultChange } = renderRow({ fieldType: "str" });
    const cell = screen.getByTestId("field-row-default");
    const display = cell.querySelector(".field-row__default-display") as HTMLElement;
    expect(display).toBeInTheDocument();
    fireEvent.click(display);
    const input = cell.querySelector("input") as HTMLInputElement;
    expect(input).toBeInTheDocument();
    expect(input.value).toBe("");
    fireEvent.change(input, { target: { value: "9" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onDefaultChange).toHaveBeenCalledWith("grade_level", "9");
  });

  it("Escape in the Default input cancels without firing onDefaultChange", () => {
    const { onDefaultChange } = renderRow({ fieldType: "str", defaultVal: "9" });
    const cell = screen.getByTestId("field-row-default");
    const display = cell.querySelector(".field-row__default-display") as HTMLElement;
    fireEvent.click(display);
    const input = cell.querySelector("input") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "11" } });
    fireEvent.keyDown(input, { key: "Escape" });
    expect(onDefaultChange).not.toHaveBeenCalled();
  });

  it("clearing the Default input commits undefined (not the empty string)", () => {
    const { onDefaultChange } = renderRow({ fieldType: "str", defaultVal: "9" });
    const cell = screen.getByTestId("field-row-default");
    const display = cell.querySelector(".field-row__default-display") as HTMLElement;
    fireEvent.click(display);
    const input = cell.querySelector("input") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onDefaultChange).toHaveBeenCalledWith("grade_level", undefined);
  });

  it("bool Default cell renders a checkbox bound to defaultVal", () => {
    const { onDefaultChange } = renderRow({ fieldType: "bool", defaultVal: false });
    const cell = screen.getByTestId("field-row-default");
    const checkbox = cell.querySelector("input[type='checkbox']") as HTMLInputElement;
    expect(checkbox.checked).toBe(false);
    fireEvent.click(checkbox);
    expect(onDefaultChange).toHaveBeenCalledWith("grade_level", true);
  });

  it("selection-single Default cell renders a <select> with — none — option", () => {
    const { onDefaultChange } = renderRow({
      fieldType: "selection",
      options: ["9", "10", "11"],
      multiple: false,
      defaultVal: "10",
    });
    const cell = screen.getByTestId("field-row-default");
    const select = cell.querySelector("select") as HTMLSelectElement;
    expect(select.value).toBe("10");
    const optionValues = Array.from(select.options).map((o) => o.value);
    expect(optionValues).toEqual(["", "9", "10", "11"]);
    fireEvent.change(select, { target: { value: "" } });
    expect(onDefaultChange).toHaveBeenCalledWith("grade_level", undefined);
  });

  it("selection-multi Default cell renders checkboxes and commits arrays", () => {
    const { onDefaultChange } = renderRow({
      fieldType: "selection",
      options: ["math", "science", "history"],
      multiple: true,
      defaultVal: ["math"],
    });
    const cell = screen.getByTestId("field-row-default");
    const checkboxes = cell.querySelectorAll<HTMLInputElement>("input[type='checkbox']");
    expect(checkboxes).toHaveLength(3);
    expect(checkboxes[0].checked).toBe(true);
    expect(checkboxes[1].checked).toBe(false);
    fireEvent.click(checkboxes[1]);
    expect(onDefaultChange).toHaveBeenCalledWith("grade_level", ["math", "science"]);
  });

  it("selection-multi clearing the last checked option commits undefined", () => {
    const { onDefaultChange } = renderRow({
      fieldType: "selection",
      options: ["math", "science"],
      multiple: true,
      defaultVal: ["math"],
    });
    const cell = screen.getByTestId("field-row-default");
    const checkboxes = cell.querySelectorAll<HTMLInputElement>("input[type='checkbox']");
    fireEvent.click(checkboxes[0]);
    expect(onDefaultChange).toHaveBeenCalledWith("grade_level", undefined);
  });
```

- [ ] **Step 5.2: Run tests, confirm they fail**

```bash
cd /Users/kennylee/Development/NeoApex/papermite/frontend
npx vitest run src/components/FieldRow.test.tsx
```

Expected: 7 new tests FAIL — `defaultVal`/`onDefaultChange` props don't exist on `FieldRow`, the `field-row-default` cell isn't rendered.

- [ ] **Step 5.3: Add `defaultVal`/`onDefaultChange` to FieldRow Props and render the cell**

Edit `papermite/frontend/src/components/FieldRow.tsx`.

**(a)** Update the `Props` interface (lines 5–22) to include the new props:

```typescript
interface Props {
  fieldName: string;
  value: unknown;
  source: "base_model" | "custom_field";
  required: boolean;
  fieldType: FieldType;
  options?: string[];
  multiple?: boolean;
  defaultVal?: unknown;
  onUpdate: (fieldName: string, value: unknown) => void;
  onRequiredToggle: (fieldName: string, required: boolean) => void;
  onTypeChange: (fieldName: string, fieldType: FieldType) => void;
  onOptionsChange: (fieldName: string, options: string[], multiple: boolean) => void;
  onDefaultChange?: (fieldName: string, value: unknown) => void;
  onFieldNameChange?: (
    oldName: string,
    newName: string
  ) => { ok: true } | { ok: false; error: string };
  onDelete?: () => void;
}
```

**(b)** Destructure the new props in the component signature (currently lines 103–117):

```typescript
export default function FieldRow({
  fieldName,
  value,
  source,
  required,
  fieldType,
  options,
  multiple,
  defaultVal,
  onUpdate,
  onRequiredToggle,
  onTypeChange,
  onOptionsChange,
  onDefaultChange,
  onFieldNameChange,
  onDelete,
}: Props) {
```

**(c)** Add the new state hooks below the existing `useState` calls (after the `nameError` state, around line 123):

```typescript
  const [editingDefault, setEditingDefault] = useState(false);
  const [editDefault, setEditDefault] = useState(toEditString(defaultVal));
```

**(d)** Add the handlers below `handleNameKeyDown` (around line 172):

```typescript
  const handleDefaultSave = () => {
    if (!onDefaultChange) {
      setEditingDefault(false);
      setEditDefault(toEditString(defaultVal));
      return;
    }
    const trimmed = editDefault.trim();
    const next = trimmed === "" ? undefined : editDefault;
    onDefaultChange(fieldName, next);
    setEditingDefault(false);
  };

  const handleDefaultKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleDefaultSave();
    }
    if (e.key === "Escape") {
      setEditingDefault(false);
      setEditDefault(toEditString(defaultVal));
    }
  };

  const handleDefaultSelectionSingle = (newValue: string) => {
    if (!onDefaultChange) return;
    onDefaultChange(fieldName, newValue === "" ? undefined : newValue);
  };

  const handleDefaultSelectionMulti = (option: string, checked: boolean) => {
    if (!onDefaultChange) return;
    const current = Array.isArray(defaultVal)
      ? defaultVal.filter((s): s is string => typeof s === "string")
      : [];
    const next = checked
      ? [...current, option]
      : current.filter((s) => s !== option);
    onDefaultChange(fieldName, next.length === 0 ? undefined : next);
  };

  const handleDefaultBool = (checked: boolean) => {
    if (!onDefaultChange) return;
    onDefaultChange(fieldName, checked);
  };
```

**(e)** Insert the new `<td>` immediately AFTER the `<td className="field-row__value">…</td>` block (the value `<td>` closes at the line that reads `</td>` right before `<td className="field-row__data-type">` — currently around line 282). Insert this between them:

```tsx
        <td className="field-row__default" data-testid="field-row-default">
          {fieldType === "selection" && (options?.length ?? 0) > 0 ? (
            multiple ? (
              (options ?? []).map((opt) => {
                const selected = Array.isArray(defaultVal)
                  ? defaultVal.filter((s): s is string => typeof s === "string")
                  : [];
                return (
                  <label key={opt} className="field-row__default-multi-label">
                    <input
                      type="checkbox"
                      checked={selected.includes(opt)}
                      onChange={(e) => handleDefaultSelectionMulti(opt, e.target.checked)}
                    />
                    {opt}
                  </label>
                );
              })
            ) : (
              <select
                className="input field-row__input"
                value={typeof defaultVal === "string" ? defaultVal : ""}
                onChange={(e) => handleDefaultSelectionSingle(e.target.value)}
              >
                <option value="">— none —</option>
                {(options ?? []).map((opt) => (
                  <option key={opt} value={opt}>{opt}</option>
                ))}
              </select>
            )
          ) : fieldType === "bool" ? (
            <input
              type="checkbox"
              checked={Boolean(defaultVal)}
              onChange={(e) => handleDefaultBool(e.target.checked)}
            />
          ) : editingDefault ? (
            <input
              className="input field-row__input"
              value={editDefault}
              onChange={(e) => setEditDefault(e.target.value)}
              onBlur={handleDefaultSave}
              onKeyDown={handleDefaultKeyDown}
              autoFocus
            />
          ) : (
            <span
              className="field-row__default-display"
              onClick={() => {
                setEditDefault(toEditString(defaultVal));
                setEditingDefault(true);
              }}
              title="Click to edit default"
            >
              {toEditString(defaultVal) || "—"}
            </span>
          )}
        </td>
```

- [ ] **Step 5.4: Run tests, confirm pass**

```bash
cd /Users/kennylee/Development/NeoApex/papermite/frontend
npx vitest run src/components/FieldRow.test.tsx
```

Expected: All FieldRow tests pass (existing 5 + new 7).

- [ ] **Step 5.5: Commit**

```bash
cd /Users/kennylee/Development/NeoApex
git add papermite/frontend/src/components/FieldRow.tsx papermite/frontend/src/components/FieldRow.test.tsx
git commit -m "feat(papermite): render Default cell in FieldRow with click-to-edit and per-type inputs"
```

---

## Task 6: Papermite frontend — `EntityCard` wires Default + type/multi clearing

**Files:**
- Modify: `papermite/frontend/src/components/EntityCard.tsx` (`handleTypeChange`, `handleOptionsChange`, add `handleDefaultChange`, header `<th>`, pass props)
- Create: `papermite/frontend/src/components/EntityCard.test.tsx`

- [ ] **Step 6.1: Add failing tests for type-change and multi-toggle clearing**

Create `papermite/frontend/src/components/EntityCard.test.tsx`:

```typescript
import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import EntityCard from "./EntityCard";
import type { EntityResult } from "../types/models";

function makeEntity(): EntityResult {
  return {
    entity_type: "STUDENT",
    entity: { grade_level: "9", subjects: ["math"] },
    field_mappings: [
      {
        field_name: "grade_level",
        value: "9",
        source: "custom_field",
        required: false,
        field_type: "str",
        default: "9",
      },
      {
        field_name: "subjects",
        value: ["math"],
        source: "custom_field",
        required: false,
        field_type: "selection",
        options: ["math", "science"],
        multiple: true,
        default: ["math"],
      },
    ],
  };
}

describe("EntityCard", () => {
  it("renders a Default column header between Value and Data Type", () => {
    const entity = makeEntity();
    render(<EntityCard entity={entity} index={0} onUpdate={() => {}} />);
    const headers = screen.getAllByRole("columnheader").map((h) => h.textContent?.trim() ?? "");
    const valueIdx = headers.indexOf("Value");
    const defaultIdx = headers.indexOf("Default");
    const dataTypeIdx = headers.indexOf("Data Type");
    expect(valueIdx).toBeGreaterThanOrEqual(0);
    expect(defaultIdx).toBe(valueIdx + 1);
    expect(dataTypeIdx).toBe(defaultIdx + 1);
  });

  it("clears default when a field's type changes", () => {
    const entity = makeEntity();
    let latest: EntityResult | null = null;
    render(
      <EntityCard
        entity={entity}
        index={0}
        onUpdate={(_, updated) => {
          latest = updated;
        }}
      />
    );
    const typeSelects = screen.getAllByRole("combobox").filter(
      (el) => el.classList.contains("field-row__type-select")
    );
    const gradeLevelType = typeSelects[0];
    fireEvent.change(gradeLevelType, { target: { value: "number" } });
    expect(latest).not.toBeNull();
    const grade = latest!.field_mappings.find((m) => m.field_name === "grade_level")!;
    expect(grade.field_type).toBe("number");
    expect(grade.default).toBeUndefined();
  });

  it("clears default when multiple toggles on a selection field", () => {
    const entity = makeEntity();
    let latest: EntityResult | null = null;
    const { container } = render(
      <EntityCard
        entity={entity}
        index={0}
        onUpdate={(_, updated) => {
          latest = updated;
        }}
      />
    );
    const optionsButtons = container.querySelectorAll(".field-row__options-btn");
    fireEvent.click(optionsButtons[0]);
    const multipleCheckbox = container.querySelector(
      ".options-editor__multiple input[type='checkbox']"
    ) as HTMLInputElement;
    fireEvent.click(multipleCheckbox);
    expect(latest).not.toBeNull();
    const subjects = latest!.field_mappings.find((m) => m.field_name === "subjects")!;
    expect(subjects.multiple).toBe(false);
    expect(subjects.default).toBeUndefined();
  });

  it("does NOT clear default when only options change (no multi toggle)", () => {
    const entity = makeEntity();
    let latest: EntityResult | null = null;
    const { container } = render(
      <EntityCard
        entity={entity}
        index={0}
        onUpdate={(_, updated) => {
          latest = updated;
        }}
      />
    );
    const optionsButtons = container.querySelectorAll(".field-row__options-btn");
    fireEvent.click(optionsButtons[0]);
    const addInput = container.querySelector(
      ".options-editor__input"
    ) as HTMLInputElement;
    fireEvent.change(addInput, { target: { value: "history" } });
    const addBtn = container.querySelector(
      ".options-editor__add .btn"
    ) as HTMLButtonElement;
    fireEvent.click(addBtn);
    expect(latest).not.toBeNull();
    const subjects = latest!.field_mappings.find((m) => m.field_name === "subjects")!;
    expect(subjects.options).toEqual(["math", "science", "history"]);
    expect(subjects.multiple).toBe(true);
    expect(subjects.default).toEqual(["math"]);
  });
});
```

- [ ] **Step 6.2: Run tests, confirm they fail**

```bash
cd /Users/kennylee/Development/NeoApex/papermite/frontend
npx vitest run src/components/EntityCard.test.tsx
```

Expected: 4 FAILED — no Default header, type change doesn't clear default, etc.

- [ ] **Step 6.3: Update `EntityCard` — header, handlers, prop wiring**

Edit `papermite/frontend/src/components/EntityCard.tsx`.

**(a)** Replace `handleTypeChange` (currently lines 43–58):

```typescript
  const handleTypeChange = (fieldName: string, field_type: FieldType) => {
    const updated = { ...entity };
    updated.field_mappings = updated.field_mappings.map((m) =>
      m.field_name === fieldName
        ? {
            ...m,
            field_type,
            default: undefined,
            // Reset selection-specific fields when switching away
            ...(field_type !== "selection" ? { options: undefined, multiple: undefined } : {}),
            // Init selection defaults when switching to selection
            ...(field_type === "selection" && !m.options ? { options: [], multiple: false } : {}),
          }
        : m
    );
    onUpdate(index, updated);
  };
```

**(b)** Replace `handleOptionsChange` (currently lines 60–66) — clear `default` only when `multiple` differs from prior:

```typescript
  const handleOptionsChange = (fieldName: string, options: string[], multiple: boolean) => {
    const updated = { ...entity };
    updated.field_mappings = updated.field_mappings.map((m) => {
      if (m.field_name !== fieldName) return m;
      const multipleChanged = m.multiple !== multiple;
      return {
        ...m,
        options,
        multiple,
        ...(multipleChanged ? { default: undefined } : {}),
      };
    });
    onUpdate(index, updated);
  };
```

**(c)** Add a new `handleDefaultChange` handler beneath `handleOptionsChange`:

```typescript
  const handleDefaultChange = (fieldName: string, value: unknown) => {
    const updated = { ...entity };
    updated.field_mappings = updated.field_mappings.map((m) =>
      m.field_name === fieldName ? { ...m, default: value } : m
    );
    onUpdate(index, updated);
  };
```

**(d)** Update the table header (currently lines 173–182). Change:

```tsx
          <thead>
            <tr>
              <th>Field</th>
              <th>Value</th>
              <th>Data Type</th>
              <th>Source</th>
              <th>Required</th>
              <th></th>
            </tr>
          </thead>
```

to:

```tsx
          <thead>
            <tr>
              <th>Field</th>
              <th>Value</th>
              <th>Default</th>
              <th>Data Type</th>
              <th>Source</th>
              <th>Required</th>
              <th></th>
            </tr>
          </thead>
```

**(e)** Update the `<FieldRow … />` call (currently around lines 188–211) to pass `defaultVal` and `onDefaultChange`:

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
                defaultVal={mapping.default}
                onUpdate={handleFieldUpdate}
                onRequiredToggle={handleRequiredToggle}
                onTypeChange={handleTypeChange}
                onOptionsChange={handleOptionsChange}
                onDefaultChange={handleDefaultChange}
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

**(f)** Update the `<tr>` colspan in `FieldRow.tsx` for the options-row. Edit `papermite/frontend/src/components/FieldRow.tsx`, near the bottom (currently line 341):

```tsx
      {showOptions && fieldType === "selection" && (
        <tr className="field-row__options-row">
          <td colSpan={6}>
```

Change `colSpan={6}` to `colSpan={7}` to account for the new Default column.

- [ ] **Step 6.4: Run EntityCard tests, confirm pass**

```bash
cd /Users/kennylee/Development/NeoApex/papermite/frontend
npx vitest run src/components/EntityCard.test.tsx src/components/FieldRow.test.tsx
```

Expected: All EntityCard tests (4) and FieldRow tests (12) pass.

- [ ] **Step 6.5: Commit**

```bash
cd /Users/kennylee/Development/NeoApex
git add papermite/frontend/src/components/EntityCard.tsx papermite/frontend/src/components/EntityCard.test.tsx papermite/frontend/src/components/FieldRow.tsx
git commit -m "feat(papermite): wire Default column in EntityCard; clear default on type/multi change"
```

---

## Task 7: Papermite frontend — `AddFieldForm` optional Default input

**Files:**
- Modify: `papermite/frontend/src/components/AddFieldForm.tsx`
- Modify: `papermite/frontend/src/components/EntityCard.tsx` (`handleAddField`)

- [ ] **Step 7.1: Extend `AddFieldForm` to accept and emit `default`**

Edit `papermite/frontend/src/components/AddFieldForm.tsx`. Replace the entire file with:

```typescript
import { useState } from "react";

interface Props {
  onAdd: (fieldName: string, value: string, defaultVal?: string) => void;
}

export default function AddFieldForm({ onAdd }: Props) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [value, setValue] = useState("");
  const [defaultVal, setDefaultVal] = useState("");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    const trimmedDefault = defaultVal.trim();
    onAdd(name.trim(), value, trimmedDefault === "" ? undefined : defaultVal);
    setName("");
    setValue("");
    setDefaultVal("");
    setOpen(false);
  };

  if (!open) {
    return (
      <button
        className="btn btn--sm add-field-btn"
        onClick={() => setOpen(true)}
      >
        + Add custom field
      </button>
    );
  }

  return (
    <form className="add-field-form" onSubmit={handleSubmit}>
      <input
        className="input"
        placeholder="field_name"
        value={name}
        onChange={(e) => setName(e.target.value)}
        autoFocus
        style={{ fontFamily: "var(--font-sans)", fontSize: "14px" }}
      />
      <input
        className="input"
        placeholder="value"
        value={value}
        onChange={(e) => setValue(e.target.value)}
      />
      <input
        className="input"
        placeholder="default (optional)"
        value={defaultVal}
        onChange={(e) => setDefaultVal(e.target.value)}
      />
      <button className="btn btn--primary btn--sm" type="submit">
        Add
      </button>
      <button
        className="btn btn--sm"
        type="button"
        onClick={() => setOpen(false)}
      >
        Cancel
      </button>
    </form>
  );
}
```

(Why no type-conditional rendering here: `AddFieldForm` only creates `field_type: "str"` mappings — the type cell becomes editable after the field exists. So a plain text Default input is always correct.)

- [ ] **Step 7.2: Update `handleAddField` in `EntityCard` to accept and persist the default**

Edit `papermite/frontend/src/components/EntityCard.tsx`. Replace the `handleAddField` block (currently lines 138–151) with:

```typescript
  const handleAddField = (fieldName: string, value: string, defaultVal?: string) => {
    const updated = { ...entity };
    updated.entity = { ...updated.entity, [fieldName]: value };
    const cf = {
      ...((updated.entity.custom_fields as Record<string, unknown>) || {}),
      [fieldName]: value,
    };
    updated.entity.custom_fields = cf;
    updated.field_mappings = [
      ...updated.field_mappings,
      {
        field_name: fieldName,
        value,
        source: "custom_field" as const,
        required: false,
        field_type: "str" as const,
        ...(defaultVal !== undefined ? { default: defaultVal } : {}),
      },
    ];
    onUpdate(index, updated);
  };
```

- [ ] **Step 7.3: Type-check and run all Papermite frontend tests**

```bash
cd /Users/kennylee/Development/NeoApex/papermite/frontend
npx tsc -b
npx vitest run
```

Expected: typecheck succeeds; all tests pass.

- [ ] **Step 7.4: Commit**

```bash
cd /Users/kennylee/Development/NeoApex
git add papermite/frontend/src/components/AddFieldForm.tsx papermite/frontend/src/components/EntityCard.tsx
git commit -m "feat(papermite): optional Default input in AddFieldForm; persist on new custom fields"
```

---

## Task 8: Papermite frontend — `modelToExtraction` restores stored default

**Files:**
- Modify: `papermite/frontend/src/api/client.ts:128-182` (`modelToExtraction`)
- (No new test — covered by manual E2E in Task 11)

- [ ] **Step 8.1: Conditionally propagate `default` in base and custom loops**

Edit `papermite/frontend/src/api/client.ts`.

Replace the base-fields loop (currently lines 138–150):

```typescript
    for (const field of def.base_fields) {
      const value = field.name === "tenant_id" ? model.tenant_id : "";
      entity[field.name] = value;
      fieldMappings.push({
        field_name: field.name,
        value,
        source: "base_model",
        required: field.required,
        field_type: field.type,
        ...(field.options && { options: field.options }),
        ...(field.multiple !== undefined && { multiple: field.multiple }),
      });
    }
```

with:

```typescript
    for (const field of def.base_fields) {
      const value = field.name === "tenant_id" ? model.tenant_id : "";
      entity[field.name] = value;
      fieldMappings.push({
        field_name: field.name,
        value,
        source: "base_model",
        required: field.required,
        field_type: field.type,
        ...(field.options && { options: field.options }),
        ...(field.multiple !== undefined && { multiple: field.multiple }),
        ...(field.default !== undefined && { default: field.default }),
      });
    }
```

Replace the custom-fields loop (currently lines 152–164):

```typescript
    for (const field of def.custom_fields) {
      entity[field.name] = "";
      customFields[field.name] = "";
      fieldMappings.push({
        field_name: field.name,
        value: "",
        source: "custom_field",
        required: field.required,
        field_type: field.type,
        ...(field.options && { options: field.options }),
        ...(field.multiple !== undefined && { multiple: field.multiple }),
      });
    }
```

with:

```typescript
    for (const field of def.custom_fields) {
      entity[field.name] = "";
      customFields[field.name] = "";
      fieldMappings.push({
        field_name: field.name,
        value: "",
        source: "custom_field",
        required: field.required,
        field_type: field.type,
        ...(field.options && { options: field.options }),
        ...(field.multiple !== undefined && { multiple: field.multiple }),
        ...(field.default !== undefined && { default: field.default }),
      });
    }
```

- [ ] **Step 8.2: Type-check, build**

```bash
cd /Users/kennylee/Development/NeoApex/papermite/frontend
npm run build
```

Expected: TypeScript check passes; Vite build succeeds.

- [ ] **Step 8.3: Commit**

```bash
cd /Users/kennylee/Development/NeoApex
git add papermite/frontend/src/api/client.ts
git commit -m "feat(papermite): restore stored default in modelToExtraction"
```

---

## Task 9: AdminDash frontend — types + `DynamicForm` prefill + number coerce

**Files:**
- Modify: `admindash/frontend/src/types/models.ts:44-50` (`ModelFieldDefinition`)
- Modify: `admindash/frontend/src/components/DynamicForm.tsx:192-198` (`buildValues`), `:204-214` (`useEffect`)

- [ ] **Step 9.1: Add `default?: unknown` to `ModelFieldDefinition`**

Edit `admindash/frontend/src/types/models.ts`. Current (lines 44–50):

```typescript
export interface ModelFieldDefinition {
  name: string;
  type: 'str' | 'number' | 'bool' | 'date' | 'datetime' | 'email' | 'phone' | 'selection';
  required: boolean;
  options?: string[];
  multiple?: boolean;
}
```

Change to:

```typescript
export interface ModelFieldDefinition {
  name: string;
  type: 'str' | 'number' | 'bool' | 'date' | 'datetime' | 'email' | 'phone' | 'selection';
  required: boolean;
  options?: string[];
  multiple?: boolean;
  default?: unknown;
}
```

- [ ] **Step 9.2: Update `buildValues` in `DynamicForm.tsx` to prefill from default + coerce numbers**

Edit `admindash/frontend/src/components/DynamicForm.tsx`. Current `buildValues` (lines 192–198):

```typescript
  const buildValues = (overrides?: Record<string, unknown>) => {
    const result: Record<string, unknown> = {};
    for (const field of allFields) {
      result[field.name] = overrides?.[field.name] ?? (field.type === 'bool' ? false : '');
    }
    return result;
  };
```

Replace with:

```typescript
  const buildValues = (overrides?: Record<string, unknown>) => {
    const result: Record<string, unknown> = {};
    for (const field of allFields) {
      const override = overrides?.[field.name];
      const fallback = field.type === 'bool' ? false : '';
      let resolved: unknown;
      if (override !== undefined) {
        resolved = override;
      } else if (field.default !== undefined) {
        resolved = field.default;
      } else {
        resolved = fallback;
      }
      if (field.type === 'number' && resolved !== '' && resolved !== null && resolved !== undefined) {
        const coerced = Number(resolved);
        resolved = Number.isNaN(coerced) ? '' : coerced;
      }
      result[field.name] = resolved;
    }
    return result;
  };
```

- [ ] **Step 9.3: Run AdminDash frontend lint and build**

```bash
cd /Users/kennylee/Development/NeoApex/admindash/frontend
npm run lint
npm run build
```

Expected: both succeed.

- [ ] **Step 9.4: Commit**

```bash
cd /Users/kennylee/Development/NeoApex
git add admindash/frontend/src/types/models.ts admindash/frontend/src/components/DynamicForm.tsx
git commit -m "feat(admindash): prefill DynamicForm from field.default; coerce number prefills"
```

---

## Task 10: Local end-to-end verification

**No code changes.** Confirm the feature end-to-end with the running stack.

- [ ] **Step 10.1: Restart all services**

```bash
cd /Users/kennylee/Development/NeoApex
./start-services.sh
```

Wait for the status table to show all 7 services `running`.

- [ ] **Step 10.2: Papermite — set defaults via the Review page**

1. Open `http://localhost:5700` in a browser (Papermite frontend).
2. Log in with a test admin user (use whatever account exists; see `papermite/backend/app/config.py` for fixture users).
3. Upload any existing document from `papermite/backend/uploads/<tenant>/` OR if a model already exists, click Edit Model.
4. On the Review page, confirm the table header now reads: `Field | Value | Default | Data Type | Source | Required | (actions)`.
5. For a `str` base field (e.g., `grade_level` on Student), click the Default cell, type `9`, press Enter. The cell should display `9`.
6. For a `bool` custom field (add one via "+ Add custom field" if none exists; rename later), toggle the Default checkbox and confirm it persists across page interactions.
7. Click Finalize → Confirm & Save.

- [ ] **Step 10.3: DataCore — verify stored default**

Replace `<tenant_id>` with the actual tenant id you used (e.g., `acme`):

```bash
curl -s -X POST http://localhost:5800/api/query \
  -H "Content-Type: application/json" \
  -d '{"tenant_id":"<tenant_id>","table":"tenant_models","sql":"SELECT entity_type, model_definition FROM data WHERE _status = '"'"'active'"'"' LIMIT 10"}' \
  | python3 -m json.tool | head -200
```

Expected: the JSON includes `"default": "9"` on the field you set. Fields without defaults have NO `"default"` key (not `"default": null`).

- [ ] **Step 10.4: Papermite — confirm rehydration on reopen**

1. Reload `http://localhost:5700`.
2. From LandingPage, click Edit Model.
3. Verify the Default cells render the values you saved in Step 10.2.
4. Change a field's type (e.g., `grade_level` from `str` to `number`) — confirm the Default cell immediately blanks out.
5. Click Cancel (do NOT re-finalize; you want to preserve the saved defaults for the AdminDash step).

- [ ] **Step 10.5: AdminDash — confirm prefill on Add Entity**

1. Open `http://localhost:5600` in a browser (AdminDash frontend).
2. Log in.
3. Open Add Student.
4. Confirm fields with defaults are prefilled.
5. Submit WITHOUT touching a prefilled `number` field (if any). Then query DataCore:

```bash
curl -s -X POST http://localhost:5800/api/query \
  -H "Content-Type: application/json" \
  -d '{"tenant_id":"<tenant_id>","table":"entities","sql":"SELECT * FROM data WHERE entity_type = '"'"'student'"'"' ORDER BY _created_at DESC LIMIT 1"}' \
  | python3 -m json.tool
```

Expected: any `number`-typed default appears as a JSON number (e.g., `9`), not a string (`"9"`).

- [ ] **Step 10.6: AdminDash — confirm Edit precedence**

1. Open the student you just created and click Edit.
2. Verify the form shows the saved value (which equals the default for untouched fields, and the user-entered value for touched ones). This confirms `initialValues` precedence is preserved.

- [ ] **Step 10.7: Re-finalize without changes — confirm no spurious version bump**

1. In Papermite, click Edit Model again.
2. Change nothing.
3. Click Finalize → Confirm.
4. The response payload should have `status: "unchanged"` and the same `version` as before. (Network tab in DevTools, or watch papermite-backend log via `tail -f .logs/papermite-backend.log`.)

- [ ] **Step 10.8: Run all test suites**

```bash
cd /Users/kennylee/Development/NeoApex/papermite/backend
uv run pytest -v

cd /Users/kennylee/Development/NeoApex/papermite/frontend
npm run lint
npm run build
npx vitest run

cd /Users/kennylee/Development/NeoApex/admindash/frontend
npm run lint
npm run build
```

Expected: all suites pass with no errors.

- [ ] **Step 10.9: No commit needed — this task is verification only.**

---

## Task 11: Wrap-up

- [ ] **Step 11.1: Push the branch**

```bash
cd /Users/kennylee/Development/NeoApex
git push -u origin feat/field-default-values
```

- [ ] **Step 11.2: Open a PR**

```bash
gh pr create --title "feat: per-field default values (Papermite → AdminDash prefill) — closes #70" --body "$(cat <<'EOF'
## Summary

Implements OpenSpec change `field-default-values`. Tenant admins can now set a per-field default in Papermite's form builder; AdminDash's Add Entity form prefills those defaults (still editable).

- Papermite Review page gains a Default column between Value and Data Type
- `FieldMapping` and stored `FieldDefinition` carry an optional `default`
- AdminDash `DynamicForm.buildValues` prefills from `field.default` (overrides still win) and coerces number defaults to Number
- Changing a field's type or toggling `multiple` clears the default to avoid stale shapes

Closes #70.

## Spec

See `openspec/changes/field-default-values/` for proposal, design, specs (24 scenarios), and tasks.

## Test plan

- [x] `uv run pytest -v` in `papermite/backend/`
- [x] `npx vitest run` in `papermite/frontend/`
- [x] `npm run build` in `papermite/frontend/` and `admindash/frontend/`
- [x] Manual end-to-end: set default in Papermite → confirm `default` key in stored model → reopen for edit (default shown) → AdminDash Add Entity prefilled → submit untouched number → number persisted as number
- [x] Re-finalize without changes → response `status: "unchanged"` (no spurious version bump)

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

Return the PR URL.

---

## Self-Review Notes (for the executor)

Cross-check against `openspec/changes/field-default-values/specs/field-default-values/spec.md`:

| Spec requirement | Implementing task |
|---|---|
| Papermite Review page renders a Default cell per field row | Task 5 + Task 6 (header) |
| AddFieldForm accepts an optional default value | Task 7 |
| FieldMapping and FieldDefinition carry optional `default` | Task 1 (backend), Task 4 (frontend) |
| `_build_model_definition` includes/omits `default` correctly | Task 2 + Task 3 |
| `modelToExtraction` restores `default` | Task 8 |
| DynamicForm prefills from `field.default` (overrides win) | Task 9 |
| Type change clears default | Task 6 (`handleTypeChange`) |
| Multiple toggle clears default | Task 6 (`handleOptionsChange`) |
| DynamicForm coerces number prefills via Number(...) | Task 9 |

No gaps detected. Number coercion edge case (NaN fallback) is in Task 9 `buildValues` change.

Type/name consistency check:
- `FieldRow` prop is `defaultVal` (not `default` or `defaultValue`) — consistent across Task 5, Task 6.
- `onDefaultChange` is the handler name — consistent.
- `EntityCard.handleDefaultChange` — consistent.
- `AddFieldForm.onAdd(name, value, defaultVal?)` — third param consistent with `EntityCard.handleAddField` in Task 7.
- Backend `FieldMapping.default` is `Optional[Any]` (Pydantic) and `default?: unknown` (TS) — consistent.

Commit cadence: 9 feature commits + branch push. Each commit corresponds to one task group and leaves the codebase in a buildable + testable state.
