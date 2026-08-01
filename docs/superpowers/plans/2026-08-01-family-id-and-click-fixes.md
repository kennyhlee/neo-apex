# Family ID Standard + Click Behavior Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax. Fixes three issues on branch `feat/family-student-linking` after the Part-4 UI refinements.

**Goal:** (1) Clicking a family name/id opens an edit dialog; (2) families get a system-standard human id (`ACM-FA26####`, same generator as `student_id`); (3) student ids and family ids open on a SINGLE click (not double).

**Architecture:** Add `"family": "FA"` to DataCore's auto-ID abbreviation map so the existing `create_entity` auto-assign path mints `family_id` on create (backend already auto-assigns `{entity_type}_id` when it's absent). `AddFamilyModal` stops sending `family_id` (mirrors how `AddStudentModal` strips `student_id`) so the backend assigns it, and previews it read-only. Add an `EditFamilyModal` (full-form save) opened by a single click on the family name or id. Change student-id open affordances from double-click to single-click.

**Tech Stack:** DataCore (Python/FastAPI + LanceDB) for Task 1; admindash React frontend for Tasks 2-4.

## Global Constraints

- **Auto-ID format** (unchanged generator): `{tenant_abbrev}-{ENTITY_ABBREV}{YY}{seq:04d}` — e.g. `ACM-ST260001`. Family uses abbrev **`FA`** → `ACM-FA260001`.
- **The backend `create_entity` auto-assigns `{entity_type}_id`** iff `entity_type in DEFAULT_ABBREVS` AND `base_data[{entity_type}_id]` is empty/absent (`datacore/src/datacore/api/routes.py:302`). So the frontend must NOT send a `family_id` for a new family.
- **Linking is unchanged:** `student.family_id` = the family's **`entity_id`** (internal). The family's own `family_id` base field (`ACM-FA…`) is a human-readable identifier for DISPLAY only. Do NOT change linking to use the human id.
- **`put_entity` REPLACES base_data** — family edits send the full base_data via `DynamicForm` submit (like `EditStudentModal`). `family_id` stays read-only in edit.
- **Single click** opens: student id → `StudentDetailModal`; family name or family id → `EditFamilyModal`.
- i18n both locales. admindash lint baseline = 5 pre-existing errors (gate = no NEW). admindash vitest currently 25. Branch `feat/family-student-linking`.
- DataCore tests: `cd datacore && uv run python -m pytest tests/ -q`. admindash: `cd admindash/frontend && npm run build && npm run lint && npm run test`.

---

### Task 1: DataCore — add `family` to the auto-ID abbreviation map (TDD)

**Files:**
- Modify: `datacore/src/datacore/api/routes.py`
- Modify/Create: a DataCore test for entity auto-ID (find the existing one first)

**Interfaces:** `DEFAULT_ABBREVS` gains `"family": "FA"`. `next_entity_id` and `create_entity` then support family (they already branch on `DEFAULT_ABBREVS`).

- [ ] **Step 1: Locate the existing auto-ID test**

Run: `cd datacore && grep -rln "next-id\|next_id\|DEFAULT_ABBREVS\|ACM-ST\|-ST\|auto.*id\|_id.*ST" tests/`
Identify the test module covering next-id / create auto-id for `student` (e.g. `tests/test_entity_auto_id.py` or in an API test). Read its student test to mirror the pattern (tenant setup with `_abbrev`, create a student, assert `student_id` matches `^<ABBREV>-ST\d{2}\d{4}$`).

- [ ] **Step 2: Write the failing test**

In that test module, add a family analogue mirroring the student test. Create a family (POST `/api/entities/{tenant}/family` with base_data lacking `family_id`) and assert the returned `base_data["family_id"]` matches the family pattern. Example (adapt names/fixtures to the real test's helpers):
```python
def test_family_gets_auto_family_id(client, tenant_id):
    # tenant already set up with _abbrev in the fixture used by the student test
    resp = client.post(
        f"/api/entities/{tenant_id}/family",
        json={"base_data": {"family_name": "Nguyen"}},
    )
    assert resp.status_code == 201
    fam_id = resp.json()["base_data"]["family_id"]
    import re
    assert re.match(r"^[A-Z]+-FA\d{2}\d{4}$", fam_id), fam_id
```
Also add a next-id preview assertion if the student test has one:
```python
def test_family_next_id_supported(client, tenant_id):
    resp = client.get(f"/api/entities/{tenant_id}/family/next-id")
    assert resp.status_code == 200
    assert "-FA" in resp.json()["next_id"]
```

- [ ] **Step 3: Run to verify it fails**

Run: `cd datacore && uv run python -m pytest tests/ -q -k family_auto or -k family_next` (use the real test names)
Expected: FAIL — family next-id returns 400 ("Auto-ID not supported for 'family'") and/or the created family has no `family_id`.

- [ ] **Step 4: Add family to the abbrev map**

In `datacore/src/datacore/api/routes.py`, update `DEFAULT_ABBREVS`:
```python
DEFAULT_ABBREVS = {
    "student": "ST",
    "program": "PR",
    "lead": "LD",
    "family": "FA",
}
```

- [ ] **Step 5: Run to verify it passes**

Run: `cd datacore && uv run python -m pytest tests/ -q`
Expected: the new family tests pass; the full suite stays green (no regressions).

- [ ] **Step 6: Commit**

```bash
git add datacore/src/datacore/api/routes.py datacore/tests/
git commit -m "feat(datacore): auto-assign family_id (FA prefix) like student_id"
```

---

### Task 2: admindash — `AddFamilyModal` mints the family_id via the backend

**Files:**
- Modify: `admindash/frontend/src/components/AddFamilyModal.tsx`

**Interfaces:** `AddFamilyModal` fetches next-id for `family`, shows `family_id` read-only (preview), and strips it on submit so the backend auto-assigns the real one (mirrors `AddStudentModal`'s `student_id` handling).

- [ ] **Step 1: Fetch the family next-id + preview, strip on submit**

READ the current `AddFamilyModal.tsx` (it loads the `family` model or `FALLBACK_FAMILY_MODEL`, renders `DynamicForm`, and calls `createEntity(tenant, 'family', baseData, customFields)`). Make these changes, mirroring `AddStudentModal`:
1. Import `fetchNextEntityId`:
```ts
import { createEntity, fetchNextEntityId } from '../api/client.ts';
```
2. Add state + fetch the preview in the mount effect (alongside the model load):
```ts
  const [generatedId, setGeneratedId] = useState<string | null>(null);
```
In the effect that loads the model, also do `fetchNextEntityId(tenant, 'family').then((r) => setGeneratedId(r.next_id)).catch(() => setGeneratedId(null));` (do not fail the modal if it errors).
3. Compute read-only + initial values:
```ts
  const readOnlyFields = generatedId ? ['family_id'] : [];
  const initialValues = generatedId ? { family_id: generatedId } : undefined;
```
4. Pass `readOnlyFields={readOnlyFields}` and `initialValues={initialValues}` to `DynamicForm`.
5. In the submit handler, STRIP `family_id` before create so the backend assigns it:
```ts
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { family_id, ...submitData } = baseData;
    const result = await createEntity(tenant, 'family', submitData, customFields);
```
   (The `FALLBACK_FAMILY_MODEL` has no `family_id` field, so `initialValues`/`readOnlyFields` are simply ignored there and `family_id` is absent → backend still auto-assigns.)

- [ ] **Step 2: Type-check + lint + test**

Run: `cd admindash/frontend && npm run build && npm run lint && npm run test`
Expected: build passes; no NEW lint; 25/25.

- [ ] **Step 3: Manual QA**

Families → Add Family → the Family ID field shows a read-only preview like `ACM-FA260001`; on save, the created family has a `family_id` in that format (requires the Task-1 datacore change running).

- [ ] **Step 4: Commit**

```bash
git add admindash/frontend/src/components/AddFamilyModal.tsx
git commit -m "feat(admindash): AddFamilyModal previews + backend-assigns standard family_id"
```

---

### Task 3: admindash — `EditFamilyModal` + single-click family name/id to edit; show human family_id

**Files:**
- Create: `admindash/frontend/src/components/EditFamilyModal.tsx`
- Modify: `admindash/frontend/src/pages/FamiliesPage.tsx`
- Modify: `admindash/frontend/src/i18n/translations.ts`

**Interfaces:**
- `EditFamilyModal` props: `{ tenant: string; family: Record<string, unknown>; model: ModelDefinition; onClose: () => void; onSaved: () => void }` — renders the family model via `DynamicForm` (with `family_id` read-only), saves via `updateEntity(tenant, 'family', entity_id, baseData, customFields)`.
- FamiliesPage: family name + family id columns are single-click → open `EditFamilyModal`; the Family ID column shows `family_id || entity_id`.

- [ ] **Step 1: Add i18n strings**

In `translations.ts` add to BOTH locales. en-US:
```ts
    'editFamily.title': 'Edit Family',
    'editFamily.saveError': 'Failed to update family',
```
zh-CN:
```ts
    'editFamily.title': '编辑家庭',
    'editFamily.saveError': '更新家庭失败',
```

- [ ] **Step 2: Create `EditFamilyModal`**

Create `admindash/frontend/src/components/EditFamilyModal.tsx`:
```tsx
import { useState } from 'react';
import { useTranslation } from '../hooks/useTranslation.ts';
import { updateEntity } from '../api/client.ts';
import DynamicForm from './DynamicForm.tsx';
import type { ModelDefinition } from '../types/models.ts';
import '../pages/StudentsPage.css';

interface EditFamilyModalProps {
  tenant: string;
  family: Record<string, unknown>;
  model: ModelDefinition;
  onClose: () => void;
  onSaved: () => void;
}

export default function EditFamilyModal({ tenant, family, model, onClose, onSaved }: EditFamilyModalProps) {
  const { t } = useTranslation();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(baseData: Record<string, unknown>, customFields: Record<string, unknown>) {
    setSubmitting(true);
    setError(null);
    try {
      await updateEntity(tenant, 'family', String(family.entity_id), baseData, customFields);
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : t('editFamily.saveError'));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="students-confirm-overlay">
      <div className="students-edit-modal">
        <div className="students-edit-modal-header">
          <h3>{t('editFamily.title')}</h3>
          <span className="students-edit-modal-subtitle">{String(family.family_name ?? '')}</span>
        </div>
        <div className="students-edit-modal-body">
          <DynamicForm
            modelDefinition={model}
            initialValues={family}
            readOnlyFields={['family_id']}
            onSubmit={handleSubmit}
            onCancel={onClose}
            submitting={submitting}
            error={error}
          />
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Wire into `FamiliesPage`**

In `admindash/frontend/src/pages/FamiliesPage.tsx`:
1. Load the family model (add alongside the student-model load):
```ts
import EditFamilyModal from '../components/EditFamilyModal.tsx';
```
```ts
  const [familyModel, setFamilyModel] = useState<ModelDefinition | null>(null);
  const [editFamily, setEditFamily] = useState<Row | null>(null);
```
In an effect: `getModel(tenant, 'family').then(setFamilyModel).catch(() => setFamilyModel(null));`
2. Make the Family ID column show the human id (fallback entity_id) and be single-click → edit:
```tsx
    { key: 'entity_id', label: t('families.colId'), render: (r) => (
      <button className="families-id-btn" onClick={() => setEditFamily(r)}>
        <code className="families-id">{String(r.family_id || r.entity_id || '-')}</code>
      </button>
    ) },
```
3. Make the family name column single-click → edit:
```tsx
    { key: 'family_name', label: t('families.colName'), render: (r) => (
      <button className="families-name-btn" onClick={() => setEditFamily(r)}>
        {String(r.family_name ?? '-')}
      </button>
    ) },
```
4. Include `family_id` in the client-side search filter:
```ts
      String(f.family_id ?? '').toLowerCase().includes(q) ||
```
(add to the existing `filtered` predicate.)
5. Render the edit modal (near the other modals):
```tsx
      {editFamily && familyModel && (
        <EditFamilyModal
          tenant={tenant}
          family={editFamily}
          model={familyModel}
          onClose={() => setEditFamily(null)}
          onSaved={() => { setEditFamily(null); handleReload(); }}
        />
      )}
```
6. Add a style for `.families-id-btn` (append to `FamiliesPage.css`):
```css
.families-id-btn { background: none; border: none; padding: 0; cursor: pointer; }
.families-name-btn { background: none; border: none; padding: 0; cursor: pointer; color: var(--color-primary, #378ADD); }
```
(If `.families-name-btn` still exists from earlier, keep one definition — dedupe.)

- [ ] **Step 4: Type-check + lint + test**

Run: `cd admindash/frontend && npm run build && npm run lint && npm run test`
Expected: build passes; no NEW lint; 25/25.

- [ ] **Step 5: Manual QA**

Families: the Family ID column shows `ACM-FA…` (or entity_id for legacy families). **Single-click** the family name OR the family id → EditFamilyModal opens; changing a field (e.g. primary_phone) and saving updates the family (other fields intact — full base_data write). `family_id` is read-only in the edit form.

- [ ] **Step 6: Commit**

```bash
git add admindash/frontend/src/components/EditFamilyModal.tsx admindash/frontend/src/pages/FamiliesPage.tsx admindash/frontend/src/pages/FamiliesPage.css admindash/frontend/src/i18n/translations.ts
git commit -m "feat(admindash): edit family via single-click on name/id; show standard family_id"
```

---

### Task 4: admindash — single-click (not double) to open student detail

**Files:**
- Modify: `admindash/frontend/src/pages/StudentsPage.tsx`
- Modify: `admindash/frontend/src/pages/FamiliesPage.tsx`

**Interfaces:** the student-id open affordance changes from `onDoubleClick` to `onClick` in both places.

- [ ] **Step 1: StudentsPage**

In `admindash/frontend/src/pages/StudentsPage.tsx`, in the `student_id` column render (inside `buildColumnsFromModel`), change `onDoubleClick={() => onStudentIdDblClick(row)}` to `onClick={() => onStudentIdDblClick(row)}`. (Leave the parameter/callback name as-is to avoid churn, or rename to `onStudentIdClick` consistently if trivial.)

- [ ] **Step 2: FamiliesPage expanded student list**

In `admindash/frontend/src/pages/FamiliesPage.tsx`, in `renderExpanded`'s student-id button, change `onDoubleClick={() => setDetailStudent(s)}` to `onClick={() => setDetailStudent(s)}`.

- [ ] **Step 3: Type-check + lint + test**

Run: `cd admindash/frontend && npm run build && npm run lint && npm run test`
Expected: build passes; no NEW lint; 25/25.

- [ ] **Step 4: Manual QA**

A SINGLE click on a student id (students list AND a family's expanded student list) opens `StudentDetailModal`. A single click on a family name/id opens `EditFamilyModal` (from Task 3). No double-click needed anywhere.

- [ ] **Step 5: Commit**

```bash
git add admindash/frontend/src/pages/StudentsPage.tsx admindash/frontend/src/pages/FamiliesPage.tsx
git commit -m "fix(admindash): open student detail on single click (not double)"
```

---

## Self-Review

**Issue coverage:**
- #1 clicking family name opens an edit dialog → Task 3 (EditFamilyModal + single-click name). ✓
- #2 family id follows the system standard (same generator as student_id) → Task 1 (datacore `FA` abbrev, reuses the identical `create_entity` auto-assign path) + Task 2 (AddFamilyModal stops sending family_id so backend mints it) + Task 3 (display the human `family_id`). ✓
- #3 student id and family id are single-click → Task 4 (student id) + Task 3 (family name/id). ✓

**Placeholder scan:** none — full code or exact edits. Task 1 Step 1 (locate the real test) and the frontend "READ the current file" notes are integration guidance, not placeholders.

**Type consistency:** `EditFamilyModal` props match its FamiliesPage usage. `family_id || entity_id` display keeps linking on `entity_id` (unchanged) while showing the human id. `readOnlyFields=['family_id']` in both AddFamilyModal (via preview) and EditFamilyModal (immutable id). All family writes send full base_data through `DynamicForm`.

**Deploy note:** Task 1 is a DataCore change; family auto-ID only works once DataCore is deployed. Frontend Tasks 2-4 are independently safe (a family created before the datacore deploy simply has no `family_id` and the column falls back to `entity_id`).
