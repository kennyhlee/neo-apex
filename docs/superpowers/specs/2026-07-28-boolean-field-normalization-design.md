# Boolean Field Normalization — Design

**Date:** 2026-07-28
**Status:** Approved (ready for implementation plan)
**Scope:** DataCore (query flatten), Papermite (extractor), AdminDash frontend
(DynamicForm + table rendering).

## 1. Overview

Boolean model fields (`type: "bool"`) display wrong and can be corrupted on edit.
Investigation showed the **stored data is correct** — TOON holds a real boolean
(`transportation_needed: false`) — but `/api/query` **stringifies** custom/base
field values when flattening them into queryable columns (`str(False)` → `"False"`).
Both the Students table and the chat read through `/api/query`. The Students table
then renders `raw ? 'Yes' : 'No'`, and the non-empty string `"False"` is truthy → it
shows **"Yes"** (the chat read it correctly). Separately, the extractor sometimes
emits placeholder strings like `"<UNKNOWN>"` that get stored as real values.

This change makes boolean handling correct and consistent end to end:
1. DataCore flatten emits lowercase `"true"/"false"` (JSON-consistent) instead of
   Python `"True"/"False"`.
2. AdminDash normalizes booleans for display **and** on form submit (so edits don't
   re-save a string and corrupt the stored boolean).
3. Table rendering interprets the value as a real boolean.
4. The extractor drops angle-bracket placeholder strings (`"<UNKNOWN>"`).

Non-goal: changing how DataCore *stores* values (it's correct); the flatten must keep
producing string columns (custom fields are heterogeneous — a single Arrow column
needs one type), so booleans remain strings on read, just lowercase and consistent.

## 2. DataCore — flatten emits lowercase booleans

`datacore/src/datacore/query.py`. Both `_flatten_custom_fields` and
`_flatten_encoded_column` build string columns with the same scalar rule:
```python
elif isinstance(v, (dict, list)): values.append(json.dumps(v))
else:                             values.append(str(v))
```
Introduce one shared helper and use it in both:
```python
def _scalar_to_str(v):
    if isinstance(v, bool):        # BEFORE dict/list/str: bool is not dict/list
        return "true" if v else "false"
    if isinstance(v, (dict, list)):
        return json.dumps(v)
    return str(v)
```
(Order matters: check `bool` first; in Python `isinstance(True, int)` is True but the
existing code never special-cased int, so no change for ints.) After this, a stored
boolean `false` reads back as `"false"` on `/api/query` and `/api/query/readonly`.

**Consumers to re-check:** Papermite `finalize.py._merge_fields` compares
existing-vs-extracted field values (existing values come from `/api/query`, so they
shift from `"False"` to `"false"`). The merge keeps existing non-empty values; verify
no exact `"False"`/`"True"` literal comparison breaks (the file only *comments* about
such strings). Update any DataCore query tests that assert `"True"/"False"`.

## 3. AdminDash — shared `toBool` + DynamicForm normalization

### 3.1 Shared util
`admindash/frontend/src/utils/boolValue.ts`:
```ts
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
Everything not explicitly truthy (`""`, `"false"`, `"no"`, `"0"`, `"<unknown>"`,
`null`, `undefined`) → `false`, matching the field's default.

### 3.2 DynamicForm (`admindash/frontend/src/components/DynamicForm.tsx`)
- **Display:** when resolving a `bool` field's value in `buildValues` and in the
  `initialValues` re-populate effect, coerce with `toBool`, so the checkbox
  (`checked={Boolean(value)}`) reflects the real value (a loaded `"False"` shows
  unchecked, not checked).
- **Submit:** in `handleSubmit`, before `onSubmit(baseData, customFields)`, coerce
  every `bool` field in both dicts to a real boolean via `toBool`. This is the "UI
  normalizes before storing" guarantee: edits store `true`/`false`, never a string.

This one component is the chokepoint for every web write path (AddStudentModal,
AddLeadModal, ProgramPage add/edit, chat CreateEntityForm, AddLeadModal, bulk — all
submit through DynamicForm).

## 4. AdminDash — table rendering

`admindash/frontend/src/pages/StudentsPage.tsx` (bool render at the two sites, ~line
120 and ~152) and `admindash/frontend/src/pages/ProgramPage.tsx` (equivalent bool
render). Change:
```ts
const val = field.type === 'bool' ? (raw ? 'Yes' : 'No') : formatSelectionValue(raw);
```
to use the shared helper:
```ts
const val = field.type === 'bool' ? (toBool(raw) ? 'Yes' : 'No') : formatSelectionValue(raw);
```
Now `"false"`/`"False"`/`""` → **No**, `"true"`/`"1"` → **Yes**.

## 5. Papermite — drop placeholder strings

`papermite/backend/app/services/extractor.py`, `_filter_extracted_fields` (keeps
`None`/`""` filtering). Add: drop any string value that is an angle-bracket
placeholder — stripped value matching `^<.*>$` (case-insensitive), e.g. `"<UNKNOWN>"`,
`"<unknown>"`. Conservative and targeted (only bracketed placeholders), so real data
like `"N/A"` in a free-text field is untouched unless the team later opts in. This
prevents `"<UNKNOWN>"` from ever being stored.

## 6. Data flow (after fix)

```
extract (bool) → Papermite (native bool, no <UNKNOWN>) → store (real boolean in TOON)
/api/query flatten → "true"/"false"  →  toBool() → checkbox / Yes-No / chat
edit + save → DynamicForm coerces bool → stores real boolean (no corruption)
```

## 7. Error handling / edge cases
- `toBool` never throws; unknown/empty → `false` (the field default).
- Flatten helper unchanged for non-bool scalars (ints still `str(v)`; lists/dicts still
  `json.dumps`).
- Placeholder filter only removes bracketed strings; all other values pass through.

## 8. Testing
- **DataCore** (`datacore/tests/`): a seeded entity with a `bool` custom field `true`
  and one `false` → `/api/query` flatten column returns `"true"`/`"false"` (not
  `"True"/"False"`); a bool base field likewise. Update any existing assertions that
  expect `"True"/"False"`.
- **Papermite** (`papermite/backend/tests/`): `_filter_extracted_fields` drops
  `"<UNKNOWN>"` (and keeps `False`, `0`, `""`-vs-omit behavior unchanged).
- **AdminDash frontend**: no test runner — verify with `npm run build` + `npm run
  lint`, then the local browser: ACM-ST260024's `transportation_needed` shows **No** in
  the Students table, editing the student shows the checkbox **unchecked**, and saving
  stores a real boolean (re-query shows `"false"`).

## 9. Deployment
Three modules change → three releases. `toBool` accepts both `"True"/"False"` and
`"true"/"false"`, so deploy order is not strict for correctness, but cut:
1. `datacore-v*` (lowercase flatten), 2. `papermite-v*` (placeholder filter),
3. `admindash-v*` (frontend). Standard release-tag pipeline + production gate.

## 10. Out of scope (YAGNI)
- Backfilling/repairing existing string-corrupted values (user edits those manually;
  the DynamicForm fix makes that safe).
- Broader placeholder handling beyond bracketed `"<...>"`.
- Changing DataCore's storage representation (already correct).
