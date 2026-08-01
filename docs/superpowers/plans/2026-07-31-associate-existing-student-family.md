# Associate Existing Student ↔ Existing Family Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax. Builds on the family↔student linking feature already on branch `feat/family-student-linking` (FamilyPicker, family API helpers, Families tab all exist).

**Goal:** Let a user associate an EXISTING student with an EXISTING family from both directions — (A) editing a student's family in the student edit modal, and (B) linking existing students into a family from the family detail view — including re-linking (move) and unlinking.

**Architecture:** Extract the inline student edit modal from `StudentsPage` into a reusable `EditStudentModal` that renders a `FamilyPicker` + `DynamicForm` and saves via `updateEntity` with the FULL base_data (family_id injected). `StudentsPage` (A) and a new family-side `LinkExistingStudentModal` (B) both drive writes through this one safe modal. B adds a student search and a confirm-then-move step; the actual write always goes through `EditStudentModal`.

**Tech Stack:** React 19 + TS + Vite, native fetch, custom i18n, Vitest (pure logic only).

## Global Constraints

- **`put_entity` REPLACES base_data** (`datacore/src/datacore/store.py:307`): every student update MUST send the complete base_data (all base fields), never a partial `{ family_id }` patch — a partial write wipes other fields. This is why B routes writes through the full-form `EditStudentModal`, not a headless update.
- **`family_id` is a scalar string.** Setting a family → `family_id = <entity_id>`. Unlinking → `family_id = ''` (empty string; `getStudentsByFamily` filters `family_id = '<id>'`, so `''` reads as unlinked).
- **Re-link behavior = confirm-then-move:** when linking a student who already has a *different* non-empty `family_id`, show a confirmation before moving; then re-point `family_id`.
- **Reuse, don't reinvent:** use existing `FamilyPicker`, `createFamily`, `getFamilyById`, `getStudentsByFamily`, `updateEntity`, `escapeSql`, `useModel().getModel`, and `DynamicForm`. No new backend endpoints.
- **i18n** in both `en-US` and `zh-CN` (`src/i18n/translations.ts`).
- Frontend commands from `admindash/frontend`: `npm run build`, `npm run lint` (baseline = 5 pre-existing react-refresh errors; gate = no NEW errors), `npm run test` (currently 24 vitest tests). Branch `feat/family-student-linking`.

---

### Task 1: `searchStudents` API helper (TDD)

**Files:**
- Modify: `admindash/frontend/src/api/client.ts`
- Modify: `admindash/frontend/src/api/__tests__/familyApi.test.ts` (add a describe block)

**Interfaces:**
- Consumes: `postQuery`, `escapeSql` (existing).
- Produces: `searchStudents(tenantId: string, query: string, limit = 20): Promise<Record<string, unknown>[]>` — active students whose `first_name`, `last_name`, or `student_id` matches the (escaped, lowercased) query. Returns raw rows (each has `entity_id`, `first_name`, `last_name`, `student_id`, `family_id`).

- [ ] **Step 1: Write the failing test**

In `admindash/frontend/src/api/__tests__/familyApi.test.ts`, add (import `searchStudents` in the existing import line from `../client.ts`):
```ts
describe('searchStudents', () => {
  it('queries active students, escapes the term, matches name/id, respects limit', async () => {
    fetchMock.mockReturnValue(ok({ data: [{ entity_id: 's1', first_name: "O'Ryan" }], total: 1 }));
    const res = await searchStudents('t1', "O'Ryan", 50);
    expect(res).toHaveLength(1);
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.table).toBe('entities');
    expect(body.sql).toContain("entity_type = 'student'");
    expect(body.sql).toContain("_status = 'active'");
    expect(body.sql).toContain("o''ryan");      // escaped + lowercased
    expect(body.sql).toContain('LIMIT 50');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test`
Expected: FAIL — `searchStudents` is not exported.

- [ ] **Step 3: Implement**

Append to `admindash/frontend/src/api/client.ts`:
```ts
export async function searchStudents(
  tenantId: string,
  query: string,
  limit = 20,
): Promise<Record<string, unknown>[]> {
  const q = escapeSql(query.trim().toLowerCase());
  const safeLimit = Math.max(1, Math.floor(limit));
  const where = q
    ? ` AND (LOWER(first_name) LIKE '%${q}%' OR LOWER(last_name) LIKE '%${q}%' OR LOWER(student_id) LIKE '%${q}%')`
    : '';
  const sql =
    `SELECT * FROM data WHERE entity_type = 'student' AND _status = 'active'${where} LIMIT ${safeLimit}`;
  const res = await postQuery(tenantId, 'entities', sql);
  return res.data;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test`
Expected: all pass (25 tests now).

- [ ] **Step 5: Commit**

```bash
git add admindash/frontend/src/api/client.ts admindash/frontend/src/api/__tests__/familyApi.test.ts
git commit -m "feat(admindash): add searchStudents API helper with test"
```

---

### Task 2: Extract reusable `EditStudentModal` with editable family (direction A)

**Files:**
- Create: `admindash/frontend/src/components/EditStudentModal.tsx`
- Modify: `admindash/frontend/src/pages/StudentsPage.tsx`
- Modify: `admindash/frontend/src/i18n/translations.ts`

**Interfaces:**
- Consumes: `FamilyPicker`, `DynamicForm`, `createFamily`, `getFamilyById`, `updateEntity`, `FamilySelection`, `ModelDefinition`.
- Produces: default export `EditStudentModal` with props:
  ```ts
  interface EditStudentModalProps {
    tenant: string;
    entity: Record<string, unknown>;       // the student row being edited (flattened)
    model: ModelDefinition;
    presetFamily?: { familyId: string; label: string }; // pre-seed the picker (used by direction B)
    onClose: () => void;
    onSaved: () => void;
  }
  ```

- [ ] **Step 1: Add i18n strings**

In `admindash/frontend/src/i18n/translations.ts`, add to BOTH locales. en-US:
```ts
    'editStudent.title': 'Edit Student',
    'editStudent.saveError': 'Failed to update student',
```
zh-CN:
```ts
    'editStudent.title': '编辑学生',
    'editStudent.saveError': '更新学生失败',
```

- [ ] **Step 2: Create `EditStudentModal`**

Create `admindash/frontend/src/components/EditStudentModal.tsx`:
```tsx
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from '../hooks/useTranslation.ts';
import { updateEntity, createFamily, getFamilyById } from '../api/client.ts';
import DynamicForm from './DynamicForm.tsx';
import FamilyPicker from './FamilyPicker.tsx';
import type { ModelDefinition, FamilySelection } from '../types/models.ts';
import '../pages/StudentsPage.css';

interface EditStudentModalProps {
  tenant: string;
  entity: Record<string, unknown>;
  model: ModelDefinition;
  presetFamily?: { familyId: string; label: string };
  onClose: () => void;
  onSaved: () => void;
}

export default function EditStudentModal({
  tenant, entity, model, presetFamily, onClose, onSaved,
}: EditStudentModalProps) {
  const { t } = useTranslation();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [familySelection, setFamilySelection] = useState<FamilySelection | null>(
    presetFamily
      ? { mode: 'existing', familyId: presetFamily.familyId, label: presetFamily.label }
      : null,
  );

  // Seed the picker from the student's existing family_id (fetch its name for the label).
  useEffect(() => {
    if (presetFamily) return; // caller already set the family
    const fid = entity.family_id ? String(entity.family_id) : '';
    if (!fid) return;
    let cancelled = false;
    getFamilyById(tenant, fid)
      .then((fam) => {
        if (cancelled) return;
        setFamilySelection({ mode: 'existing', familyId: fid, label: fam?.family_name ?? fid });
      })
      .catch(() => {
        if (!cancelled) setFamilySelection({ mode: 'existing', familyId: fid, label: fid });
      });
    return () => { cancelled = true; };
  }, [tenant, entity, presetFamily]);

  // The picker owns family_id — strip it from the rendered form.
  const formModel = useMemo<ModelDefinition>(() => ({
    ...model,
    base_fields: model.base_fields.filter((f) => f.name !== 'family_id'),
  }), [model]);

  async function handleSubmit(baseData: Record<string, unknown>, customFields: Record<string, unknown>) {
    setSubmitting(true);
    setError(null);
    try {
      // Resolve family into a scalar family_id (create first if new; '' clears the link).
      if (familySelection?.mode === 'existing') {
        baseData.family_id = familySelection.familyId;
      } else if (familySelection?.mode === 'new') {
        const fam = await createFamily(tenant, familySelection.data);
        baseData.family_id = fam.entity_id;
      } else {
        baseData.family_id = '';
      }
      await updateEntity(tenant, 'student', String(entity.entity_id), baseData, customFields);
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : t('editStudent.saveError'));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="students-confirm-overlay">
      <div className="students-edit-modal">
        <div className="students-edit-modal-header">
          <h3>{t('editStudent.title')}</h3>
          <span className="students-edit-modal-subtitle">
            {String(entity.first_name ?? '')} {String(entity.last_name ?? '')}
          </span>
        </div>
        <div className="students-edit-modal-body">
          <FamilyPicker tenant={tenant} value={familySelection} onChange={setFamilySelection} />
          <DynamicForm
            modelDefinition={formModel}
            initialValues={entity}
            readOnlyFields={['student_id', 'first_name', 'last_name', 'middle_name']}
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

- [ ] **Step 3: Rewire `StudentsPage` to use `EditStudentModal`**

In `admindash/frontend/src/pages/StudentsPage.tsx`:
1. Add the import near the other component imports:
```ts
import EditStudentModal from '../components/EditStudentModal.tsx';
```
2. Replace the entire inline edit-modal JSX block (the `{editingEntity && model && ( ... )}` block at ~lines 614-637) with:
```tsx
      {/* Edit student modal */}
      {editingEntity && model && (
        <EditStudentModal
          tenant={tenant}
          entity={editingEntity as Record<string, unknown>}
          model={model}
          onClose={() => { setEditingEntity(null); setEditError(null); }}
          onSaved={() => { setEditingEntity(null); setSelectedIds(new Set()); loadData(page, filters); }}
        />
      )}
```
3. The old `handleEditSave` function (~lines 438-455) and the `editSubmitting`/`editError` state are now unused IF nothing else references them. Check: `grep -n "handleEditSave\|editSubmitting\|editError" src/pages/StudentsPage.tsx`. Remove `handleEditSave` and any now-unused `editSubmitting`/`editError` state declarations/setters that are ONLY used by the removed modal. If any is still referenced elsewhere, leave it. (Lint will flag unused vars as part of the gate — resolve to zero NEW lint errors.)

- [ ] **Step 4: Type-check + lint + test**

Run: `npm run build && npm run lint && npm run test`
Expected: build passes; no NEW lint errors; 25/25 tests.

- [ ] **Step 5: Manual QA**

Students → edit a student → the Family field is now an editable `FamilyPicker` seeded with the current family (name shown). Change to another existing family → save → row reflects new family. Clear the family → save → student unlinked. Create a new family inline → save → student linked to the new family. Confirm other student fields are unchanged after save (no data loss — validates the full-base_data write).

- [ ] **Step 6: Commit**

```bash
git add admindash/frontend/src/components/EditStudentModal.tsx admindash/frontend/src/pages/StudentsPage.tsx admindash/frontend/src/i18n/translations.ts
git commit -m "feat(admindash): editable family in student edit (reusable EditStudentModal)"
```

---

### Task 3: Family-side "Link existing student" (direction B)

**Files:**
- Create: `admindash/frontend/src/components/LinkExistingStudentModal.tsx` (+ `.css`)
- Modify: `admindash/frontend/src/pages/FamiliesPage.tsx`
- Modify: `admindash/frontend/src/i18n/translations.ts`

**Interfaces:**
- Consumes: `searchStudents` (Task 1), `EditStudentModal` (Task 2), `useModel().getModel`, `Family`.
- Produces: default export `LinkExistingStudentModal` with props:
  ```ts
  interface LinkExistingStudentModalProps {
    tenant: string;
    family: Family;               // the family to link students into
    onClose: () => void;
    onLinked: () => void;         // called after a successful link (refresh detail)
  }
  ```
  It searches students, on pick shows a confirm-then-move step if the student is already in a DIFFERENT family, then opens `EditStudentModal` (preset to `family`) for the actual save.

- [ ] **Step 1: Add i18n strings**

In `admindash/frontend/src/i18n/translations.ts`, add to BOTH locales. en-US:
```ts
    'linkStudent.title': 'Link existing student',
    'linkStudent.search': 'Search students by name or ID…',
    'linkStudent.noResults': 'No matching students',
    'linkStudent.alreadyInFamily': 'In another family',
    'linkStudent.unlinked': 'No family',
    'linkStudent.moveTitle': 'Move student?',
    'linkStudent.moveBody': 'This student is already in another family. Move them to {family}?',
    'linkStudent.moveConfirm': 'Move',
    'linkStudent.cancel': 'Cancel',
```
zh-CN:
```ts
    'linkStudent.title': '关联现有学生',
    'linkStudent.search': '按姓名或学号搜索学生…',
    'linkStudent.noResults': '没有匹配的学生',
    'linkStudent.alreadyInFamily': '已在其他家庭',
    'linkStudent.unlinked': '无家庭',
    'linkStudent.moveTitle': '移动学生？',
    'linkStudent.moveBody': '该学生已在其他家庭。将其移动到 {family}？',
    'linkStudent.moveConfirm': '移动',
    'linkStudent.cancel': '取消',
```

- [ ] **Step 2: Create `LinkExistingStudentModal`**

Create `admindash/frontend/src/components/LinkExistingStudentModal.tsx`:
```tsx
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from '../hooks/useTranslation.ts';
import { useModel } from '../contexts/ModelContext.tsx';
import { searchStudents } from '../api/client.ts';
import EditStudentModal from './EditStudentModal.tsx';
import type { Family, ModelDefinition } from '../types/models.ts';
import './LinkExistingStudentModal.css';

interface LinkExistingStudentModalProps {
  tenant: string;
  family: Family;
  onClose: () => void;
  onLinked: () => void;
}

type Row = Record<string, unknown>;

export default function LinkExistingStudentModal({
  tenant, family, onClose, onLinked,
}: LinkExistingStudentModalProps) {
  const { t } = useTranslation();
  const { getModel } = useModel();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Row[]>([]);
  const [model, setModel] = useState<ModelDefinition | null>(null);
  const [confirmMove, setConfirmMove] = useState<Row | null>(null);
  const [editing, setEditing] = useState<Row | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => { getModel(tenant, 'student').then(setModel).catch(() => setModel(null)); }, [tenant, getModel]);

  useEffect(() => {
    if (!query.trim()) { setResults([]); return; }
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      searchStudents(tenant, query).then(setResults).catch(() => setResults([]));
    }, 250);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [query, tenant]);

  // Pick a student: if already in a DIFFERENT family, confirm the move first; else edit directly.
  function pick(student: Row) {
    const fid = student.family_id ? String(student.family_id) : '';
    if (fid && fid !== family.entity_id) setConfirmMove(student);
    else setEditing(student);
  }

  function studentFamilyLabel(student: Row): string {
    const fid = student.family_id ? String(student.family_id) : '';
    if (!fid) return t('linkStudent.unlinked');
    if (fid === family.entity_id) return family.family_name;
    return t('linkStudent.alreadyInFamily');
  }

  // When EditStudentModal is open, defer to it (preset to this family).
  if (editing && model) {
    return (
      <EditStudentModal
        tenant={tenant}
        entity={editing}
        model={model}
        presetFamily={{ familyId: family.entity_id, label: family.family_name }}
        onClose={() => setEditing(null)}
        onSaved={() => { setEditing(null); onLinked(); }}
      />
    );
  }

  return (
    <div className="students-confirm-overlay" onClick={onClose}>
      <div className="link-student-modal" onClick={(e) => e.stopPropagation()}>
        <div className="link-student-header">
          <h3>{t('linkStudent.title')}</h3>
          <button onClick={onClose}>{t('linkStudent.cancel')}</button>
        </div>
        <input
          className="link-student-search"
          placeholder={t('linkStudent.search')}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          autoFocus
        />
        <ul className="link-student-results">
          {results.map((s) => (
            <li key={String(s.entity_id)}>
              <button type="button" onClick={() => pick(s)}>
                <span>{String(s.first_name ?? '')} {String(s.last_name ?? '')}</span>
                <span className="link-student-meta">
                  {String(s.student_id ?? '')} · {studentFamilyLabel(s)}
                </span>
              </button>
            </li>
          ))}
          {query.trim() && results.length === 0 && (
            <li className="link-student-empty">{t('linkStudent.noResults')}</li>
          )}
        </ul>

        {confirmMove && (
          <div className="students-confirm-overlay" onClick={() => setConfirmMove(null)}>
            <div className="students-confirm-dialog" onClick={(e) => e.stopPropagation()}>
              <h4>{t('linkStudent.moveTitle')}</h4>
              <p>{t('linkStudent.moveBody').replace('{family}', family.family_name)}</p>
              <div className="students-confirm-actions">
                <button onClick={() => setConfirmMove(null)}>{t('linkStudent.cancel')}</button>
                <button
                  className="students-confirm-danger"
                  onClick={() => { const s = confirmMove; setConfirmMove(null); setEditing(s); }}
                >
                  {t('linkStudent.moveConfirm')}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Add styles**

Create `admindash/frontend/src/components/LinkExistingStudentModal.css`:
```css
.link-student-modal { background: #fff; border-radius: 10px; padding: 20px; width: min(520px, 92vw); max-height: 82vh; display: flex; flex-direction: column; }
.link-student-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; }
.link-student-header button { background: none; border: none; color: var(--color-primary, #378ADD); cursor: pointer; }
.link-student-search { padding: 8px 10px; border: 1px solid var(--color-border, #ccc); border-radius: 6px; margin-bottom: 8px; }
.link-student-results { list-style: none; padding: 0; margin: 0; overflow-y: auto; }
.link-student-results li button { width: 100%; text-align: left; background: none; border: none; padding: 10px 8px; cursor: pointer; border-radius: 6px; display: flex; justify-content: space-between; align-items: center; gap: 12px; }
.link-student-results li button:hover { background: var(--color-hover, #f2f7fc); }
.link-student-meta { color: #888; font-size: 12px; white-space: nowrap; }
.link-student-empty { padding: 10px 8px; color: #888; }
```

- [ ] **Step 4: Wire into `FamiliesPage` detail**

In `admindash/frontend/src/pages/FamiliesPage.tsx`:
1. Import:
```ts
import LinkExistingStudentModal from '../components/LinkExistingStudentModal.tsx';
```
2. Add state near the other detail state (`const [addStudentTo, setAddStudentTo] = ...`):
```ts
  const [linkTo, setLinkTo] = useState<Family | null>(null);
```
3. In the family detail JSX, next to the existing "Add student to this family" button (the one calling `setAddStudentTo(detail)`), add a sibling button:
```tsx
            <button
              className="families-add-btn"
              onClick={() => { setLinkTo(detail); setDetail(null); }}
            >
              {t('families.linkExistingStudent')}
            </button>
```
4. Render the modal near where `AddStudentModal` is rendered (after the `{addStudentTo && ...}` block):
```tsx
      {linkTo && (
        <LinkExistingStudentModal
          tenant={tenant}
          family={linkTo}
          onClose={() => setLinkTo(null)}
          onLinked={() => { setLinkTo(null); handleReload(); }}
        />
      )}
```
5. Add the button i18n string in `translations.ts` (BOTH locales):
```ts
    // en-US
    'families.linkExistingStudent': 'Link existing student',
```
```ts
    // zh-CN
    'families.linkExistingStudent': '关联现有学生',
```

- [ ] **Step 5: Type-check + lint + test**

Run: `npm run build && npm run lint && npm run test`
Expected: build passes; no NEW lint errors; 25/25 tests.

- [ ] **Step 6: Manual QA**

Families → open a family → **Link existing student** → search a student:
- Pick an UNLINKED student → EditStudentModal opens preset to this family → save → student appears under this family's detail.
- Pick a student already in ANOTHER family → confirm dialog ("Move them to <family>?") → confirm → EditStudentModal (preset) → save → student moved (gone from old family, present here).
- Cancel on the confirm → no change.
Verify the moved student's other fields are intact (full-base_data write).

- [ ] **Step 7: Commit**

```bash
git add admindash/frontend/src/components/LinkExistingStudentModal.tsx admindash/frontend/src/components/LinkExistingStudentModal.css admindash/frontend/src/pages/FamiliesPage.tsx admindash/frontend/src/i18n/translations.ts
git commit -m "feat(admindash): link existing students into a family (with confirm-then-move)"
```

---

## Self-Review

**Requirement coverage:**
- Associate existing student → existing family: Task 2 (student edit picker) + Task 3 (family-side link). ✓
- Both directions ("student to family" and "family to student"): Task 2 (A) + Task 3 (B). ✓
- Re-link with confirm-then-move: Task 3 Step 2 (confirmMove gate) → EditStudentModal write. ✓
- Unlink: Task 2 (clear picker → `family_id = ''`). ✓
- Create-new-family inline during association: reused via FamilyPicker in EditStudentModal. ✓
- No data loss on update (full base_data): guaranteed by routing all writes through `EditStudentModal`'s DynamicForm submit (global constraint). ✓

**Placeholder scan:** none — every step has full code or an exact command. Task 2 Step 3 item 3 (remove now-unused `handleEditSave`/state) is a real, verifiable cleanup with a grep to confirm, not a placeholder.

**Type consistency:** `EditStudentModalProps` (Task 2) matches its usage in `LinkExistingStudentModal` (Task 3, `presetFamily`/`entity`/`model`/`onSaved`). `searchStudents` return type (Task 1) consumed as `Record<string,unknown>[]` in Task 3. `FamilySelection` handling mirrors `AddStudentModal`. `family_id` scalar throughout.
