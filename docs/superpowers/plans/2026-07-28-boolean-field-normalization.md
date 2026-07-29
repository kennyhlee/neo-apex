# Boolean Field Normalization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make boolean model fields display and round-trip correctly by emitting lowercase booleans from DataCore's query flatten, normalizing booleans in the AdminDash UI (display + submit), and dropping extractor placeholder strings.

**Architecture:** Four small, independent fixes across three modules. Storage is already correct (real booleans); the bug is read-time stringification (`str(False)`→`"False"`) plus truthy-string rendering. No change to how DataCore stores data.

**Tech Stack:** Python/DuckDB/PyArrow (DataCore), Python/pydantic-ai (Papermite), React/TypeScript/Vite (AdminDash). Tests: pytest (DataCore, Papermite); AdminDash has no test runner (verify via build/lint + browser).

## Global Constraints

- DataCore flatten must keep producing **string** columns (custom fields are heterogeneous); only the boolean representation changes: `True`→`"true"`, `False`→`"false"`. Non-bool scalars unchanged (ints still `str(v)`; dict/list still `json.dumps`).
- `toBool` truthy set (case-insensitive, trimmed): `"true"`, `"yes"`, `"1"`, boolean `true`, nonzero number. Everything else (`""`, `"false"`, `"no"`, `"0"`, `"<unknown>"`, `null`, `undefined`) → `false`.
- Extractor placeholder filter drops only angle-bracket strings: stripped value matching `^<.*>$` (e.g. `"<UNKNOWN>"`). Real values and `False`/`0` are preserved.
- DynamicForm is the single web-submit chokepoint; coerce bool fields for display AND on submit.
- Run dirs/tests: DataCore `cd datacore && uv run python -m pytest tests/<f> -v`; Papermite `cd papermite && uv run pytest backend/tests/<f> -v`; AdminDash frontend `cd admindash/frontend && npm run build && npm run lint` (lint gate: no NEW errors beyond the pre-existing baseline).
- Commit after each task. Branch off main; do not push/PR unless asked.
- Deploy order after merge: `datacore-v*`, `papermite-v*`, `admindash-v*`.

## File Structure

- `datacore/src/datacore/query.py` — *modify*: shared `_scalar_to_str` used by both flatten helpers.
- `datacore/tests/test_query_bool_flatten.py` — *create*.
- `papermite/backend/app/services/extractor.py` — *modify*: placeholder filter in `_filter_extracted_fields`.
- `papermite/backend/tests/test_extractor.py` — *modify*: add placeholder test.
- `admindash/frontend/src/utils/boolValue.ts` — *create*: `toBool`.
- `admindash/frontend/src/components/DynamicForm.tsx` — *modify*: bool coercion (buildValues, re-populate effect, handleSubmit).
- `admindash/frontend/src/pages/StudentsPage.tsx`, `ProgramPage.tsx` — *modify*: bool render uses `toBool`.

---

### Task 1: DataCore — flatten emits lowercase booleans

**Files:**
- Modify: `datacore/src/datacore/query.py`
- Test: `datacore/tests/test_query_bool_flatten.py`

**Interfaces:**
- Produces: query results where a stored boolean custom/base field reads back as the string `"true"`/`"false"`.

- [ ] **Step 1: Write the failing test**

Create `datacore/tests/test_query_bool_flatten.py`:

```python
"""Boolean field values flatten to lowercase strings on read."""
from datacore import QueryEngine


def test_bool_custom_and_base_fields_flatten_lowercase(seeded_store):
    seeded_store.put_entity(
        tenant_id="t1", entity_type="student", entity_id="B1",
        base_data={"first_name": "Bool", "active": True},
        custom_fields={"needs_bus": False, "opted_in": True},
    )
    r = QueryEngine(seeded_store).query(
        tenant_id="t1", table_type="entities",
        sql="SELECT needs_bus, opted_in, active FROM data WHERE entity_id = 'B1'",
    )
    row = r["rows"][0]
    assert row["needs_bus"] == "false"   # custom bool False -> "false" (not "False")
    assert row["opted_in"] == "true"     # custom bool True  -> "true"
    assert row["active"] == "true"       # base bool True    -> "true"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd datacore && uv run python -m pytest tests/test_query_bool_flatten.py -v`
Expected: FAIL — values come back `"False"`/`"True"` (capitalized).

- [ ] **Step 3: Add the shared helper and use it in both flatten paths**

In `datacore/src/datacore/query.py`, add a module-level helper near the top (after imports):

```python
def _scalar_to_str(v):
    """Encode a decoded field value as the string stored in a flattened column.
    Booleans use lowercase JSON form so consumers see 'true'/'false', not
    Python's 'True'/'False'. Order matters: bool is a subclass of int, so it
    must be checked before any numeric handling."""
    if isinstance(v, bool):
        return "true" if v else "false"
    if isinstance(v, (dict, list)):
        return json.dumps(v)
    return str(v)
```

In `_flatten_custom_fields`, replace the value-building branch:
```python
                v = row.get(key)
                if v is None:
                    values.append(None)
                elif isinstance(v, (dict, list)):
                    values.append(json.dumps(v))
                else:
                    values.append(str(v))
```
with:
```python
                v = row.get(key)
                values.append(None if v is None else _scalar_to_str(v))
```

In `_flatten_encoded_column`, replace the identical branch:
```python
                v = row.get(key)
                if v is None:
                    values.append(None)
                elif isinstance(v, (dict, list)):
                    values.append(json.dumps(v))
                else:
                    values.append(str(v))
```
with:
```python
                v = row.get(key)
                values.append(None if v is None else _scalar_to_str(v))
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd datacore && uv run python -m pytest tests/test_query_bool_flatten.py -v`
Expected: PASS (1 passed). Then `uv run python -m pytest tests/ -q` — full DataCore suite stays green (no existing test asserts `"True"/"False"`).

- [ ] **Step 5: Commit**

```bash
git add datacore/src/datacore/query.py datacore/tests/test_query_bool_flatten.py
git commit -m "fix(datacore): flatten emits lowercase true/false for boolean fields"
```

---

### Task 2: Papermite — drop bracketed placeholder strings

**Files:**
- Modify: `papermite/backend/app/services/extractor.py`
- Test: `papermite/backend/tests/test_extractor.py`

**Interfaces:**
- Produces: `_filter_extracted_fields` additionally drops string values matching `^<.*>$`.

- [ ] **Step 1: Write the failing test**

Add to `papermite/backend/tests/test_extractor.py`:

```python
def test_filter_drops_angle_bracket_placeholders():
    from app.services.extractor import _filter_extracted_fields
    fields = [{"name": "a"}, {"name": "b"}, {"name": "c"}, {"name": "d"}]
    raw = {"a": "<UNKNOWN>", "b": False, "c": "real value", "d": 0}
    out = _filter_extracted_fields(raw, fields)
    assert "a" not in out           # bracketed placeholder dropped
    assert out["b"] is False        # real False preserved
    assert out["c"] == "real value"
    assert out["d"] == 0            # 0 preserved
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd papermite && uv run pytest backend/tests/test_extractor.py::test_filter_drops_angle_bracket_placeholders -v`
Expected: FAIL — `"a"` (`"<UNKNOWN>"`) is still present.

- [ ] **Step 3: Implement the filter**

In `papermite/backend/app/services/extractor.py`, add `import re` at the top (with the other stdlib imports, e.g. after `from pathlib import Path`) and a module-level constant near the top:

```python
_PLACEHOLDER_RE = re.compile(r"^<.*>$")
```

Then change `_filter_extracted_fields`'s return to also drop bracketed placeholders:

```python
    known_fields = {f["name"] for f in all_fields}
    return {
        k: v
        for k, v in raw.items()
        if v is not None
        and v != ""
        and k in known_fields
        and not (isinstance(v, str) and _PLACEHOLDER_RE.match(v.strip()))
    }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd papermite && uv run pytest backend/tests/test_extractor.py -v`
Expected: PASS (new test + existing extractor tests).

- [ ] **Step 5: Commit**

```bash
git add papermite/backend/app/services/extractor.py papermite/backend/tests/test_extractor.py
git commit -m "fix(papermite): drop <UNKNOWN>-style placeholder strings during extraction"
```

---

### Task 3: AdminDash — `toBool` util + DynamicForm normalization

**Files:**
- Create: `admindash/frontend/src/utils/boolValue.ts`
- Modify: `admindash/frontend/src/components/DynamicForm.tsx`

**Interfaces:**
- Produces: `toBool(value: unknown): boolean`. DynamicForm stores/submits real booleans for `bool` fields.

- [ ] **Step 1: Create the util**

Create `admindash/frontend/src/utils/boolValue.ts`:

```ts
/**
 * Coerce a possibly-stringified value (e.g. "false"/"True"/"0"/"<unknown>" from
 * DataCore's query flattening) into a real boolean. Only explicit truthy tokens
 * are true; everything else — including "" / "false" / "no" / "0" / null — is
 * false, matching a bool field's default.
 */
export function toBool(value: unknown): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  if (typeof value === 'string') {
    const s = value.trim().toLowerCase();
    return s === 'true' || s === 'yes' || s === '1';
  }
  return false;
}
```

- [ ] **Step 2: Import it in DynamicForm**

In `admindash/frontend/src/components/DynamicForm.tsx`, add near the other imports:

```ts
import { toBool } from '../utils/boolValue.ts';
```

- [ ] **Step 3: Coerce bool on value build (display)**

In `buildValues`, after the existing `number` coercion block and before `result[field.name] = resolved;`, add:

```ts
      if (field.type === 'bool') {
        resolved = toBool(resolved);
      }
      result[field.name] = resolved;
```

- [ ] **Step 4: Coerce bool in the initialValues re-populate effect**

Replace the effect body:

```ts
  useEffect(() => {
    if (initialValues && Object.keys(initialValues).length > 0) {
      setValues((prev) => {
        const next = { ...prev };
        for (const [key, val] of Object.entries(initialValues)) {
          if (val != null && val !== '') next[key] = val;
        }
        return next;
      });
    }
  }, [initialValues]);
```

with:

```ts
  useEffect(() => {
    if (initialValues && Object.keys(initialValues).length > 0) {
      setValues((prev) => {
        const next = { ...prev };
        for (const [key, val] of Object.entries(initialValues)) {
          if (val != null && val !== '') {
            const field = allFields.find((f) => f.name === key);
            next[key] = field?.type === 'bool' ? toBool(val) : val;
          }
        }
        return next;
      });
    }
  }, [initialValues, allFields]);
```

- [ ] **Step 5: Coerce bool on submit**

In `handleSubmit`, replace the payload-building loop:

```ts
    for (const field of allFields) {
      const val = values[field.name];
      if (field.group === 'base') {
        baseData[field.name] = val;
      } else {
        customFields[field.name] = val;
      }
    }
```

with:

```ts
    for (const field of allFields) {
      const val = field.type === 'bool' ? toBool(values[field.name]) : values[field.name];
      if (field.group === 'base') {
        baseData[field.name] = val;
      } else {
        customFields[field.name] = val;
      }
    }
```

- [ ] **Step 6: Build + lint**

Run: `cd admindash/frontend && npm run build && npm run lint`
Expected: build passes; lint shows no NEW errors beyond the pre-existing baseline.

- [ ] **Step 7: Commit**

```bash
git add admindash/frontend/src/utils/boolValue.ts admindash/frontend/src/components/DynamicForm.tsx
git commit -m "fix(admindash): normalize boolean fields for display and submit in DynamicForm"
```

---

### Task 4: AdminDash — bool rendering in Students & Program tables

**Files:**
- Modify: `admindash/frontend/src/pages/StudentsPage.tsx`
- Modify: `admindash/frontend/src/pages/ProgramPage.tsx`

**Interfaces:**
- Consumes: `toBool` from Task 3.

- [ ] **Step 1: StudentsPage — use toBool at both bool-render sites**

In `admindash/frontend/src/pages/StudentsPage.tsx`, add the import near the top:

```ts
import { toBool } from '../utils/boolValue.ts';
```

There are two identical bool render lines (approx line 120 and line 152):

```ts
        const val = field.type === 'bool' ? (raw ? 'Yes' : 'No') : formatSelectionValue(raw);
```

Replace BOTH with:

```ts
        const val = field.type === 'bool' ? (toBool(raw) ? 'Yes' : 'No') : formatSelectionValue(raw);
```

(Use replace-all — the two occurrences are identical.)

- [ ] **Step 2: ProgramPage — use toBool at both bool-render sites**

In `admindash/frontend/src/pages/ProgramPage.tsx`, add the import near the top:

```ts
import { toBool } from '../utils/boolValue.ts';
```

There are two identical bool render lines (approx line 88 and line 117):

```ts
        const val = field.type === 'bool' ? (raw ? 'Yes' : 'No') : formatSelectionValue(raw);
```

Replace BOTH with:

```ts
        const val = field.type === 'bool' ? (toBool(raw) ? 'Yes' : 'No') : formatSelectionValue(raw);
```

- [ ] **Step 3: Build + lint**

Run: `cd admindash/frontend && npm run build && npm run lint`
Expected: build passes; no NEW lint errors.

- [ ] **Step 4: Manual verification (local stack running)**

With DataCore restarted on the Task-1 code, in the browser (localhost:5600), tenant `acme-afterschool`:
- Students table: `ACM-ST260024` (Kenny Lee) `transportation_needed` now shows **No**.
- Open/edit that student: the `transportation_needed` checkbox is **unchecked**.
- Save; re-query `SELECT transportation_needed FROM data WHERE student_id='ACM-ST260024'` → still `"false"` (not corrupted to a truthy string).

- [ ] **Step 5: Commit**

```bash
git add admindash/frontend/src/pages/StudentsPage.tsx admindash/frontend/src/pages/ProgramPage.tsx
git commit -m "fix(admindash): render boolean columns via toBool (false no longer shows Yes)"
```

---

## Deployment (after all tasks reviewed & merged)

Three modules changed → three releases:
1. `datacore-v<next>` — lowercase flatten. Approve gate; verify healthy.
2. `papermite-v<next>` — placeholder filter. Approve gate; verify healthy.
3. `admindash-v<next>` — frontend. Approve gate; verify a bool column renders correctly.

`toBool` accepts both `"True"/"False"` and `"true"/"false"`, so the frontend works whether or not DataCore has deployed yet — order is not strict for correctness.

## Self-Review Notes

- **Spec coverage:** lowercase flatten both helpers (Task 1); extractor placeholder filter (Task 2); toBool + DynamicForm display/submit coercion (Task 3); table rendering StudentsPage + ProgramPage (Task 4); deploy order (Deployment §). Papermite `finalize._merge_fields`/`_is_empty` verified unaffected (treats `"False"`/`"false"` identically as non-empty) — no change needed.
- **No frontend unit tests** (no runner) — Task 3/4 verified via build+lint+browser; `toBool` is a pure function exercised through the UI.
- **Deferred (YAGNI):** backfilling existing string-corrupted values (manual, now safe); non-bracket placeholder handling; DataCore storage representation (already correct).
