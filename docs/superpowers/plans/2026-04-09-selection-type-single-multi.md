# Selection Type Single/Multi Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add explicit single/multi selection cardinality to entity model definitions, render radio buttons for single-select and checkboxes for multi-select across all frontends.

**Architecture:** Domain model fields declare multi-select via `json_schema_extra={"multiple": True}`; single-select is the default. Mapper reads this metadata. AdminDash and Launchpad frontends render radio buttons (single) or checkboxes (multi). Papermite model editor already has a toggle for this.

**Tech Stack:** Python/Pydantic (backend), React/TypeScript (frontends), CSS

**OpenSpec change:** `openspec/changes/selection-type-single-multi/`

---

## File Map

| Action | File | Responsibility |
|--------|------|----------------|
| Modify | `papermite/backend/app/models/domain.py` | Add `json_schema_extra` to multi-select fields |
| Modify | `papermite/backend/app/services/mapper.py` | Read `json_schema_extra` for `multiple`, fix consolidator |
| Modify | `papermite/backend/tests/test_mapper.py` | Tests for cardinality behavior |
| Modify | `admindash/frontend/src/components/DynamicForm.tsx` | Radio buttons for single-select, legacy data handling |
| Modify | `admindash/frontend/src/components/DynamicForm.css` | Radio button group styles |
| Modify | `launchpad/frontend/src/components/FieldInput.tsx` | Radio buttons + checkboxes, legacy data handling |

---

### Task 1: Domain Model — Add `json_schema_extra` to Multi-Select Fields

**Files:**
- Modify: `papermite/backend/app/models/domain.py:101-110`

- [ ] **Step 1: Add `json_schema_extra={"multiple": True}` to Program `grade_levels`**

In `papermite/backend/app/models/domain.py`, change line 101-105 from:

```python
    grade_levels: List[str] = Field(
        default_factory=lambda: [
            "TK", "Kinder", "1st", "2nd", "3rd", "4th", "5th",
        ]
    )
```

to:

```python
    grade_levels: List[str] = Field(
        default_factory=lambda: [
            "TK", "Kinder", "1st", "2nd", "3rd", "4th", "5th",
        ],
        json_schema_extra={"multiple": True},
    )
```

- [ ] **Step 2: Add `json_schema_extra={"multiple": True}` to Program `days_of_week`**

Change line 106-110 from:

```python
    days_of_week: List[str] = Field(
        default_factory=lambda: [
            "Monday", "Tuesday", "Wednesday", "Thursday", "Friday",
        ]
    )
```

to:

```python
    days_of_week: List[str] = Field(
        default_factory=lambda: [
            "Monday", "Tuesday", "Wednesday", "Thursday", "Friday",
        ],
        json_schema_extra={"multiple": True},
    )
```

- [ ] **Step 3: Verify no annotation needed for single-select fields**

Confirm these fields have NO `json_schema_extra` (single-select by default):
- Student `grade_level` (line 55)
- Student `gender` (line 61)
- Student `status` (line 69)
- Program `status` (line 92)

No code change needed — just verify.

- [ ] **Step 4: Commit**

```bash
git add papermite/backend/app/models/domain.py
git commit -m "feat(papermite): add json_schema_extra multiple annotation to multi-select domain fields"
```

---

### Task 2: Mapper — Read `json_schema_extra` and Fix Consolidator

**Files:**
- Modify: `papermite/backend/app/services/mapper.py:121-173,249-261`
- Test: `papermite/backend/tests/test_mapper.py`

- [ ] **Step 1: Write failing test for single-select cardinality**

Add to `papermite/backend/tests/test_mapper.py`:

```python
def test_student_selection_fields_are_single_select():
    """Student grade_level, gender, status should be single-select (multiple=False)."""
    raw = RawExtraction(
        students=[{
            "first_name": "Alice",
            "last_name": "Smith",
            "grade_level": ["1st"],
            "gender": ["Female"],
            "status": ["Active"],
        }],
    )
    result = map_extraction(raw, "t1", "test.pdf", "raw text")
    student = [e for e in result.entities if e.entity_type == "STUDENT"][0]

    for field_name in ("grade_level", "gender", "status"):
        mapping = next(m for m in student.field_mappings if m.field_name == field_name)
        assert mapping.multiple is False, f"{field_name} should be single-select"
        assert mapping.options is not None and len(mapping.options) > 0
```

- [ ] **Step 2: Write failing test for multi-select cardinality**

Add to `papermite/backend/tests/test_mapper.py`:

```python
def test_program_multi_select_fields():
    """Program days_of_week and grade_levels should be multi-select (multiple=True)."""
    raw = RawExtraction(
        programs=[{
            "name": "After School",
            "days_of_week": ["Monday", "Wednesday"],
            "grade_levels": ["1st", "2nd"],
        }],
    )
    result = map_extraction(raw, "t1", "test.pdf", "raw text")
    program = [e for e in result.entities if e.entity_type == "PROGRAM"][0]

    for field_name in ("days_of_week", "grade_levels"):
        mapping = next(m for m in program.field_mappings if m.field_name == field_name)
        assert mapping.multiple is True, f"{field_name} should be multi-select"

    # Program status should still be single-select
    status_mapping = next(m for m in program.field_mappings if m.field_name == "status")
    assert status_mapping.multiple is False, "Program status should be single-select"
```

- [ ] **Step 3: Write failing test for consolidator preserving cardinality**

Add to `papermite/backend/tests/test_mapper.py`:

```python
def test_consolidator_preserves_single_select_cardinality():
    """Consolidating duplicate entities should not force multiple=True on single-select fields."""
    raw = RawExtraction(
        students=[
            {
                "first_name": "Alice",
                "last_name": "Smith",
                "gender": ["Female"],
            },
            {
                "first_name": "Bob",
                "last_name": "Jones",
                "gender": ["Male"],
            },
        ],
    )
    result = map_extraction(raw, "t1", "test.pdf", "raw text")
    student = [e for e in result.entities if e.entity_type == "STUDENT"][0]
    gender_mapping = next(m for m in student.field_mappings if m.field_name == "gender")
    # After consolidation, gender should still be single-select
    assert gender_mapping.multiple is False, "Consolidation should preserve single-select cardinality"
    # But options should be merged
    assert "Female" in gender_mapping.options
    assert "Male" in gender_mapping.options
```

- [ ] **Step 4: Run tests to verify they fail**

Run: `cd papermite/backend && uv run python -m pytest tests/test_mapper.py -v`

Expected: The student single-select test should pass (mapper already sets `multiple=False` for `List[str]` base fields). The program multi-select test should fail (mapper doesn't read `json_schema_extra`). The consolidator test should fail (line 260 forces `multiple=True`).

- [ ] **Step 5: Update mapper to read `json_schema_extra` for `multiple`**

In `papermite/backend/app/services/mapper.py`, change line 134 from:

```python
                    multiple = multiple if multiple is not None else False
```

to:

```python
                    # Read cardinality from domain model annotation, fall back to False
                    schema_multiple = (model_field.json_schema_extra or {}).get("multiple", False)
                    multiple = multiple if multiple is not None else schema_multiple
```

Then change line 173 from:

```python
                    options=list(default_opts), multiple=False,
```

to:

```python
                    options=list(default_opts), multiple=(model_field.json_schema_extra or {}).get("multiple", False),
```

- [ ] **Step 6: Fix consolidator to preserve cardinality**

In `papermite/backend/app/services/mapper.py`, change lines 259-261 from:

```python
                    merged.field_mappings[idx] = existing_mapping.model_copy(
                        update={"options": new_opts, "multiple": True}
                    )
```

to:

```python
                    merged.field_mappings[idx] = existing_mapping.model_copy(
                        update={"options": new_opts}
                    )
```

This preserves whatever `multiple` value was already on the existing mapping instead of forcing `True`.

- [ ] **Step 7: Run tests to verify they pass**

Run: `cd papermite/backend && uv run python -m pytest tests/test_mapper.py -v`

Expected: All tests pass.

- [ ] **Step 8: Commit**

```bash
git add papermite/backend/app/services/mapper.py papermite/backend/tests/test_mapper.py
git commit -m "feat(papermite): read json_schema_extra for selection cardinality, fix consolidator"
```

---

### Task 3: AdminDash DynamicForm — Radio Buttons for Single-Select

**Files:**
- Modify: `admindash/frontend/src/components/DynamicForm.tsx:136-174`
- Modify: `admindash/frontend/src/components/DynamicForm.css`

- [ ] **Step 1: Replace single-select `<select>` with radio buttons and add legacy data handling**

In `admindash/frontend/src/components/DynamicForm.tsx`, replace lines 136-174 (the entire `case 'selection':` block) with:

```tsx
    case 'selection':
      if (field.multiple) {
        // Multi-select: checkboxes
        // Legacy handling: string value → treat as single-element array
        const selected = Array.isArray(value)
          ? (value as string[])
          : (typeof value === 'string' && value ? [value] : []);
        return (
          <div className="dynamic-form-multi-select">
            {(field.options || []).map((opt) => (
              <label key={opt} className="dynamic-form-checkbox-label">
                <input
                  type="checkbox"
                  checked={selected.includes(opt)}
                  onChange={(e) => {
                    const next = e.target.checked
                      ? [...selected, opt]
                      : selected.filter((s) => s !== opt);
                    onChange(field.name, next);
                  }}
                  disabled={isReadOnly}
                />
                {opt}
              </label>
            ))}
          </div>
        );
      }
      {
        // Single-select: radio buttons
        // Legacy handling: array value → use first element
        const radioValue = Array.isArray(value)
          ? (value[0] != null ? String(value[0]) : '')
          : strValue;
        return (
          <div className="dynamic-form-radio-group">
            {(field.options || []).map((opt) => (
              <label key={opt} className="dynamic-form-radio-label">
                <input
                  type="radio"
                  name={field.name}
                  value={opt}
                  checked={radioValue === opt}
                  onChange={() => onChange(field.name, opt)}
                  disabled={isReadOnly}
                />
                {opt}
              </label>
            ))}
          </div>
        );
      }
```

- [ ] **Step 2: Add CSS styles for radio button group**

Add to the end of `admindash/frontend/src/components/DynamicForm.css`:

```css
.dynamic-form-radio-group {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
}

.dynamic-form-radio-label {
  display: flex;
  align-items: center;
  gap: 0.3rem;
  font-size: 0.85rem;
  color: var(--text-primary);
}
```

- [ ] **Step 3: Verify the build compiles**

Run: `cd admindash/frontend && npm run build`

Expected: Build succeeds with no TypeScript errors.

- [ ] **Step 4: Commit**

```bash
git add admindash/frontend/src/components/DynamicForm.tsx admindash/frontend/src/components/DynamicForm.css
git commit -m "feat(admindash): render radio buttons for single-select, checkboxes for multi-select"
```

---

### Task 4: Launchpad FieldInput — Radio Buttons and Checkboxes

**Files:**
- Modify: `launchpad/frontend/src/components/FieldInput.tsx:21-38`

- [ ] **Step 1: Replace selection rendering with radio buttons (single) and checkboxes (multi)**

In `launchpad/frontend/src/components/FieldInput.tsx`, replace lines 21-38 (the entire `case "selection":` block) with:

```tsx
    case "selection":
      if (field.multiple) {
        // Multi-select: checkboxes
        // Legacy handling: string value → treat as single-element array
        const selected = Array.isArray(value)
          ? value as string[]
          : (typeof value === "string" && value ? [value] : []);
        return (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {(field.options || []).map(opt => (
              <label key={opt} style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 14 }}>
                <input
                  type="checkbox"
                  checked={selected.includes(opt)}
                  onChange={e => {
                    const next = e.target.checked
                      ? [...selected, opt]
                      : selected.filter(s => s !== opt);
                    onChange(next);
                  }}
                  disabled={readOnly}
                />
                {opt}
              </label>
            ))}
          </div>
        );
      }
      {
        // Single-select: radio buttons
        // Legacy handling: array value → use first element
        const radioValue = Array.isArray(value)
          ? (value[0] != null ? String(value[0]) : "")
          : strVal;
        return (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {(field.options || []).map(opt => (
              <label key={opt} style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 14 }}>
                <input
                  type="radio"
                  name={field.name}
                  value={opt}
                  checked={radioValue === opt}
                  onChange={() => onChange(opt)}
                  disabled={readOnly}
                />
                {opt}
              </label>
            ))}
          </div>
        );
      }
```

- [ ] **Step 2: Verify the build compiles**

Run: `cd launchpad/frontend && npm run build`

Expected: Build succeeds with no TypeScript errors.

- [ ] **Step 3: Commit**

```bash
git add launchpad/frontend/src/components/FieldInput.tsx
git commit -m "feat(launchpad): render radio buttons for single-select, checkboxes for multi-select"
```

---

### Task 5: Validation — Single-Select Required Field Check

**Files:**
- Modify: `admindash/frontend/src/components/DynamicForm.tsx:20-47`

- [ ] **Step 1: Update validation for single-select required fields**

In `admindash/frontend/src/components/DynamicForm.tsx`, the `validateField` function (lines 20-47) already handles multi-select required validation (lines 25-29). Single-select fields fall through to the standard `isEmpty` check on line 31, which works correctly since radio buttons store a plain string.

Verify this by reading the existing code — no change needed. The required check `if (field.required && isEmpty) return 'Required'` on line 31 already handles single-select fields because `strValue` will be empty string when no radio is selected.

- [ ] **Step 2: Commit (skip if no changes)**

No commit needed for this task — it's a verification step.

---

### Task 6: Visual Verification

**Files:** None (manual testing)

- [ ] **Step 1: Verify all services are running**

Run: `./start-services.sh`

- [ ] **Step 2: Verify AdminDash single-select rendering**

Open AdminDash at `http://localhost:5600`. Navigate to Students page. Open the Add Student modal. Verify:
- `grade_level` renders as radio buttons (one selectable at a time)
- `gender` renders as radio buttons
- `status` renders as radio buttons

- [ ] **Step 3: Verify AdminDash multi-select rendering (if applicable)**

If there's a Program form or any multi-select field visible, verify it renders as checkboxes with multiple selections possible.

- [ ] **Step 4: Verify Launchpad rendering**

Open Launchpad at `http://localhost:5500`. If there's a form with selection fields, verify radio buttons for single-select and checkboxes for multi-select.

- [ ] **Step 5: Verify Papermite model editor**

Open Papermite at `http://localhost:5700`. Upload or edit a model. For selection fields, verify the "Allow multiple" toggle is present and functional (this already exists in `FieldRow.tsx` — no change was needed).

- [ ] **Step 6: Run all builds to confirm no regressions**

```bash
cd admindash/frontend && npm run build && cd ../..
cd launchpad/frontend && npm run build && cd ../..
cd papermite/frontend && npm run build && cd ../..
cd papermite/backend && uv run python -m pytest tests/ -v
```

Expected: All builds succeed, all tests pass.
