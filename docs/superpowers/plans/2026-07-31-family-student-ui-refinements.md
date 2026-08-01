# Family/Student UI Refinements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax. Builds on branch `feat/family-student-linking` (FamilyPicker, EditStudentModal, AddStudentModal-with-family, Families tab, searchStudents all exist).

**Goal:** Refine the family/student UI: (1) expandable family rows listing their students with default fields; (2) double-click a student id → a read-only student detail modal (in the family list AND the student list); (3) consolidate "link existing student" into the Add Student modal as a search tab; (4) lock the family field when adding a student from a family; (5) show a Family ID column in the family list.

**Architecture:** Add a read-only `StudentDetailModal`. Extend the shared `DataTable` with opt-in expandable rows. Rework `FamiliesPage` to expand each family row (students with default fields + double-click→detail + an Add Student button). Fold the existing-student search (currently `LinkExistingStudentModal`) into `AddStudentModal` as a third tab, and lock the `FamilyPicker` when in family context. Add double-click→detail on the students list.

**Tech Stack:** React 19 + TS + Vite, custom i18n, Vitest (pure logic only).

## Global Constraints

- **`family_id` scalar string**; the family's identifier that students reference is the family entity's **`entity_id`** (that is the "Family ID" shown in the list).
- **`put_entity` REPLACES base_data** — all student writes go through the full-form save path (`EditStudentModal` / `AddStudentModal` `DynamicForm` submit). No headless partial `{family_id}` writes.
- **Student model fields** (for search / detail / default columns): `student_id, first_name, last_name, middle_name, preferred_name, dob, grade_level, email, gender, status, family_id, primary_address, mailing_address`. Students have **no phone field** — do NOT reference a phone column in student SQL.
- **Reuse** existing `FamilyPicker`, `EditStudentModal`, `DynamicForm`, `getStudentsByFamily`, `searchStudents`, `useModel().getModel`. No new backend endpoints.
- **i18n** in both `en-US` and `zh-CN`. Lint baseline = 5 pre-existing react-refresh errors (gate = no NEW). Vitest currently 25 tests. Branch `feat/family-student-linking`. Run `npm run test` (frontend), NOT pytest.

---

### Task 1: `searchStudents` also matches email (TDD)

**Files:**
- Modify: `admindash/frontend/src/api/client.ts`
- Modify: `admindash/frontend/src/api/__tests__/familyApi.test.ts`

**Interfaces:** `searchStudents` unchanged signature; WHERE now also matches `email`.

- [ ] **Step 1: Update the existing searchStudents test**

In `admindash/frontend/src/api/__tests__/familyApi.test.ts`, in the `describe('searchStudents', ...)` block, add an assertion after the existing ones:
```ts
    expect(body.sql).toContain('LOWER(email)');
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test`
Expected: FAIL — the SQL does not yet contain `LOWER(email)`.

- [ ] **Step 3: Add email to the WHERE**

In `admindash/frontend/src/api/client.ts`, in `searchStudents`, change the `where` fragment to include email:
```ts
  const where = q
    ? ` AND (LOWER(first_name) LIKE '%${q}%' OR LOWER(last_name) LIKE '%${q}%' OR LOWER(student_id) LIKE '%${q}%' OR LOWER(email) LIKE '%${q}%')`
    : '';
```
(Do NOT add a phone column — students have no phone field; referencing a missing column would error the query.)

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test`
Expected: 25/25 pass.

- [ ] **Step 5: Commit**

```bash
git add admindash/frontend/src/api/client.ts admindash/frontend/src/api/__tests__/familyApi.test.ts
git commit -m "feat(admindash): searchStudents also matches email"
```

---

### Task 2: `StudentDetailModal` (read-only detail view)

**Files:**
- Create: `admindash/frontend/src/components/StudentDetailModal.tsx`
- Create: `admindash/frontend/src/components/StudentDetailModal.css`
- Modify: `admindash/frontend/src/i18n/translations.ts`

**Interfaces:**
- Produces: default export `StudentDetailModal` with props:
  ```ts
  interface StudentDetailModalProps {
    student: Record<string, unknown>;
    model: ModelDefinition;
    onClose: () => void;
  }
  ```
  Renders the student's base + custom fields as read-only label/value pairs (title = student name). `family_id` shown as-is (it is the family entity_id).

- [ ] **Step 1: Add i18n strings**

In `admindash/frontend/src/i18n/translations.ts`, add to BOTH locales. en-US:
```ts
    'studentDetail.title': 'Student Detail',
    'studentDetail.close': 'Close',
```
zh-CN:
```ts
    'studentDetail.title': '学生详情',
    'studentDetail.close': '关闭',
```

- [ ] **Step 2: Create the component**

Create `admindash/frontend/src/components/StudentDetailModal.tsx`:
```tsx
import { useMemo } from 'react';
import { useTranslation } from '../hooks/useTranslation.ts';
import { toBool } from '../utils/boolValue.ts';
import type { ModelDefinition, ModelFieldDefinition } from '../types/models.ts';
import './StudentDetailModal.css';

interface StudentDetailModalProps {
  student: Record<string, unknown>;
  model: ModelDefinition;
  onClose: () => void;
}

function formatLabel(name: string): string {
  return name.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function displayValue(field: ModelFieldDefinition, raw: unknown): string {
  if (raw == null || raw === '') return '-';
  if (field.type === 'bool') return toBool(raw) ? 'Yes' : 'No';
  const s = String(raw);
  if (s.startsWith('[')) {
    try {
      const arr = JSON.parse(s);
      if (Array.isArray(arr)) return arr.join(', ') || '-';
    } catch { /* not JSON */ }
  }
  return s;
}

export default function StudentDetailModal({ student, model, onClose }: StudentDetailModalProps) {
  const { t } = useTranslation();
  const fields = useMemo(
    () => [...model.base_fields, ...model.custom_fields],
    [model],
  );
  const name = `${String(student.first_name ?? '')} ${String(student.last_name ?? '')}`.trim();

  return (
    <div className="students-confirm-overlay" onClick={onClose}>
      <div className="student-detail-modal" onClick={(e) => e.stopPropagation()}>
        <div className="student-detail-header">
          <div>
            <h3>{t('studentDetail.title')}</h3>
            {name && <span className="student-detail-subtitle">{name}</span>}
          </div>
          <button onClick={onClose}>{t('studentDetail.close')}</button>
        </div>
        <dl className="student-detail-fields">
          {fields.map((f) => (
            <div key={f.name} className="student-detail-row">
              <dt>{formatLabel(f.name)}</dt>
              <dd>{displayValue(f, student[f.name])}</dd>
            </div>
          ))}
        </dl>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Add styles**

Create `admindash/frontend/src/components/StudentDetailModal.css`:
```css
.student-detail-modal { background: #fff; border-radius: 10px; padding: 20px; width: min(560px, 92vw); max-height: 82vh; overflow-y: auto; }
.student-detail-header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 12px; }
.student-detail-subtitle { display: block; color: #888; font-size: 13px; }
.student-detail-header button { background: none; border: none; color: var(--color-primary, #378ADD); cursor: pointer; }
.student-detail-fields { display: flex; flex-direction: column; gap: 6px; margin: 0; }
.student-detail-row { display: grid; grid-template-columns: 40% 1fr; gap: 12px; padding: 6px 0; border-bottom: 1px solid var(--color-border, #eee); }
.student-detail-row dt { font-weight: 600; color: #555; }
.student-detail-row dd { margin: 0; }
```

- [ ] **Step 4: Type-check + lint + test**

Run: `npm run build && npm run lint && npm run test`
Expected: build passes; no NEW lint; 25/25.

- [ ] **Step 5: Commit**

```bash
git add admindash/frontend/src/components/StudentDetailModal.tsx admindash/frontend/src/components/StudentDetailModal.css admindash/frontend/src/i18n/translations.ts
git commit -m "feat(admindash): add read-only StudentDetailModal"
```

---

### Task 3: Expandable rows in `DataTable` (opt-in)

**Files:**
- Modify: `admindash/frontend/src/components/DataTable.tsx`
- Modify: `admindash/frontend/src/components/DataTable.css`

**Interfaces:**
- Produces (added optional props on `DataTableProps<T>`):
  ```ts
  renderExpanded?: (row: T) => ReactNode;
  expandedIds?: Set<string>;
  onToggleExpand?: (id: string) => void;
  ```
  When `renderExpanded` is provided, a leading expand-toggle cell appears; expanded rows render an extra full-width row beneath. Backward compatible — omitting these keeps current behavior (StudentsPage unaffected).

- [ ] **Step 1: Add the props**

In `admindash/frontend/src/components/DataTable.tsx`, add to `interface DataTableProps<T>` (after `onSelectionChange`):
```ts
  // Expandable rows (opt-in)
  renderExpanded?: (row: T) => ReactNode;
  expandedIds?: Set<string>;
  onToggleExpand?: (id: string) => void;
```
And destructure them in the component signature:
```ts
  renderExpanded,
  expandedIds,
  onToggleExpand,
```

- [ ] **Step 2: Render the expand toggle + expanded row**

Compute a flag near the top of the component body:
```ts
  const expandable = Boolean(renderExpanded);
  const expanded = expandedIds ?? new Set<string>();
```
In the header `<tr>`, add a leading `<th>` before the checkbox `<th>` when expandable:
```tsx
              {expandable && <th className="data-table-expand" aria-hidden />}
```
Update BOTH `colSpan` values used for the loading / empty rows from `visibleColumns.length + 1` to `visibleColumns.length + 1 + (expandable ? 1 : 0)`.
In the body `data.map((row) => { ... })`, replace the single `<tr>` return with a fragment that adds the toggle cell and an optional expanded row. Change the map body to:
```tsx
                const isExpanded = expanded.has(id);
                return (
                  <Fragment key={id}>
                    <tr className={extraClass || undefined}>
                      {expandable && (
                        <td className="data-table-expand">
                          <button
                            type="button"
                            className="data-table-expand-btn"
                            aria-expanded={isExpanded}
                            onClick={() => onToggleExpand?.(id)}
                          >
                            {isExpanded ? '▼' : '▶'}
                          </button>
                        </td>
                      )}
                      <td className="data-table-checkbox">
                        <input
                          type="checkbox"
                          checked={selectedIds.has(id)}
                          onChange={() => toggleRow(id)}
                        />
                      </td>
                      {visibleColumns.map((col) => (
                        <td key={col.key}>
                          {col.render ? col.render(row) : (String(row[col.key] ?? '-'))}
                        </td>
                      ))}
                    </tr>
                    {expandable && isExpanded && (
                      <tr className="data-table-expanded-row">
                        <td colSpan={visibleColumns.length + 2}>
                          {renderExpanded!(row)}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
```
Add `Fragment` to the React import at the top:
```ts
import { useState, Fragment, type ReactNode } from 'react';
```

- [ ] **Step 3: Add styles**

Append to `admindash/frontend/src/components/DataTable.css`:
```css
.data-table-expand { width: 32px; text-align: center; }
.data-table-expand-btn { background: none; border: none; cursor: pointer; color: var(--color-text, #555); font-size: 11px; padding: 4px; }
.data-table-expanded-row > td { background: var(--color-hover, #f7fafd); padding: 12px 16px; }
```

- [ ] **Step 4: Verify StudentsPage (which uses DataTable) is unaffected**

Run: `npm run build && npm run lint && npm run test`
Expected: build passes; no NEW lint; 25/25. StudentsPage does not pass the new props, so its table is unchanged (no expand column).

- [ ] **Step 5: Commit**

```bash
git add admindash/frontend/src/components/DataTable.tsx admindash/frontend/src/components/DataTable.css
git commit -m "feat(admindash): opt-in expandable rows in DataTable"
```

---

### Task 4: `AddStudentModal` family-context — lock family + "Existing student" tab

**Files:**
- Modify: `admindash/frontend/src/components/AddStudentModal.tsx`
- Modify: `admindash/frontend/src/components/FamilyPicker.tsx`
- Modify: `admindash/frontend/src/i18n/translations.ts`

**Interfaces:**
- `FamilyPicker` gains `locked?: boolean` — when true, renders a read-only family chip (no search / no change / no create), ignoring interaction.
- `AddStudentModal` gains `lockFamily?: boolean`. When a family is preset: the FamilyPicker is `locked`, and a third tab **"Existing student"** appears offering a student search (name/id/email) that links the chosen student to the preset family (reusing `EditStudentModal` preset+locked, with confirm-then-move). Existing "new student" + "upload" tabs still create with the preset family.

- [ ] **Step 1: Add `locked` to FamilyPicker**

In `admindash/frontend/src/components/FamilyPicker.tsx`, add `locked?: boolean` to `FamilyPickerProps` and destructure it. At the very start of the render (before the existing `value?.mode === 'existing'` branch), add:
```tsx
  if (locked) {
    return (
      <div className="family-picker">
        <label className="family-picker-label">{t('familyPicker.label')}</label>
        <div className="family-picker-chip">
          <span>{value?.mode === 'existing' ? value.label : '—'}</span>
        </div>
      </div>
    );
  }
```

- [ ] **Step 2: Add i18n string for the tab**

In `admindash/frontend/src/i18n/translations.ts` add to BOTH locales:
```ts
    // en-US
    'addStudent.existingStudent': 'Existing student',
```
```ts
    // zh-CN
    'addStudent.existingStudent': '现有学生',
```
(The existing-student tab reuses the existing `linkStudent.*` keys for search/move.)

- [ ] **Step 3: Extend `AddStudentModal`**

In `admindash/frontend/src/components/AddStudentModal.tsx`:
1. Add imports:
```ts
import { searchStudents } from '../api/client.ts';
import EditStudentModal from './EditStudentModal.tsx';
import { useRef } from 'react';
```
2. Extend props:
```ts
interface AddStudentModalProps {
  tenant: string;
  onClose: () => void;
  onSuccess: (entityId: string) => void;
  presetFamilyId?: string;
  presetFamilyLabel?: string;
  lockFamily?: boolean;
}
```
and destructure `lockFamily` in the signature.
3. Widen the tab type and add existing-student search state (near the other `useState`s):
```ts
  const [activeTab, setActiveTab] = useState<'form' | 'upload' | 'existing'>('form');
  const [linkQuery, setLinkQuery] = useState('');
  const [linkResults, setLinkResults] = useState<Record<string, unknown>[]>([]);
  const [linkConfirmMove, setLinkConfirmMove] = useState<Record<string, unknown> | null>(null);
  const [linkEditing, setLinkEditing] = useState<Record<string, unknown> | null>(null);
  const linkDebounce = useRef<ReturnType<typeof setTimeout> | null>(null);
```
4. Add a debounced search effect (after the existing mount effect):
```ts
  useEffect(() => {
    if (linkDebounce.current) clearTimeout(linkDebounce.current);
    linkDebounce.current = setTimeout(() => {
      if (!linkQuery.trim()) { setLinkResults([]); return; }
      searchStudents(tenant, linkQuery).then(setLinkResults).catch(() => setLinkResults([]));
    }, 250);
    return () => { if (linkDebounce.current) clearTimeout(linkDebounce.current); };
  }, [linkQuery, tenant]);
```
5. Add helpers (near other handlers):
```ts
  const familyLabel = presetFamilyLabel ?? presetFamilyId ?? '';
  function pickExisting(student: Record<string, unknown>) {
    const fid = student.family_id ? String(student.family_id) : '';
    if (fid && fid !== presetFamilyId) setLinkConfirmMove(student);
    else setLinkEditing(student);
  }
```
6. When `linkEditing` is set and the student model is loaded, defer to `EditStudentModal` (preset+lock to the family). Add this early-return INSIDE the component's return, or better, right before the main `return (`:
```tsx
  if (linkEditing && modelDef) {
    return (
      <EditStudentModal
        tenant={tenant}
        entity={linkEditing}
        model={modelDef}
        presetFamily={{ familyId: presetFamilyId!, label: familyLabel }}
        onClose={() => setLinkEditing(null)}
        onSaved={() => onSuccess(String(linkEditing.entity_id ?? ''))}
      />
    );
  }
```
7. In the tabs bar, add the "Existing student" tab button — ONLY when `presetFamilyId` is set — after the upload tab:
```tsx
              {presetFamilyId && (
                <button
                  className={`add-modal-tab ${activeTab === 'existing' ? 'active' : ''}`}
                  onClick={() => setActiveTab('existing')}
                >
                  {t('addStudent.existingStudent')}
                </button>
              )}
```
8. Pass `locked={lockFamily}` to the `<FamilyPicker>` in the form tab:
```tsx
                  <FamilyPicker tenant={tenant} value={familySelection} onChange={setFamilySelection} locked={lockFamily} />
```
9. Render the existing-student tab body (after the `activeTab === 'upload'` block, inside `add-modal-body`):
```tsx
              {activeTab === 'existing' && (
                <div className="add-modal-existing">
                  <input
                    className="link-student-search"
                    placeholder={t('linkStudent.search')}
                    value={linkQuery}
                    onChange={(e) => setLinkQuery(e.target.value)}
                    autoFocus
                  />
                  <ul className="link-student-results">
                    {linkResults.map((s) => {
                      const fid = s.family_id ? String(s.family_id) : '';
                      const label = !fid ? t('linkStudent.unlinked')
                        : fid === presetFamilyId ? familyLabel : t('linkStudent.alreadyInFamily');
                      return (
                        <li key={String(s.entity_id)}>
                          <button type="button" onClick={() => pickExisting(s)}>
                            <span>{String(s.first_name ?? '')} {String(s.last_name ?? '')}</span>
                            <span className="link-student-meta">{String(s.student_id ?? '')} · {label}</span>
                          </button>
                        </li>
                      );
                    })}
                    {linkQuery.trim() && linkResults.length === 0 && (
                      <li className="link-student-empty">{t('linkStudent.noResults')}</li>
                    )}
                  </ul>
                  {linkConfirmMove && (
                    <div className="students-confirm-overlay" onClick={() => setLinkConfirmMove(null)}>
                      <div className="students-confirm-dialog" onClick={(e) => e.stopPropagation()}>
                        <h4>{t('linkStudent.moveTitle')}</h4>
                        <p>{t('linkStudent.moveBody').replace('{family}', familyLabel)}</p>
                        <div className="students-confirm-actions">
                          <button onClick={() => setLinkConfirmMove(null)}>{t('linkStudent.cancel')}</button>
                          <button
                            className="students-confirm-danger"
                            onClick={() => { const s = linkConfirmMove; setLinkConfirmMove(null); setLinkEditing(s); }}
                          >
                            {t('linkStudent.moveConfirm')}
                          </button>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )}
```
10. Add `import './LinkExistingStudentModal.css';` at the top of AddStudentModal (reuses `.link-student-*` styles), OR copy those rules into `AddStudentModal.css`. Prefer importing the existing CSS to avoid duplication.

- [ ] **Step 4: Type-check + lint + test**

Run: `npm run build && npm run lint && npm run test`
Expected: build passes; no NEW lint; 25/25.

- [ ] **Step 5: Commit**

```bash
git add admindash/frontend/src/components/AddStudentModal.tsx admindash/frontend/src/components/FamilyPicker.tsx admindash/frontend/src/i18n/translations.ts
git commit -m "feat(admindash): AddStudentModal existing-student tab + locked family in family context"
```

---

### Task 5: `FamiliesPage` — Family ID column, expandable student rows, unified Add Student

**Files:**
- Modify: `admindash/frontend/src/pages/FamiliesPage.tsx`
- Modify: `admindash/frontend/src/pages/FamiliesPage.css`
- Modify: `admindash/frontend/src/i18n/translations.ts`
- Delete: `admindash/frontend/src/components/LinkExistingStudentModal.tsx` and `LinkExistingStudentModal.css`

**Interfaces:** Consumes `DataTable` expansion (Task 3), `StudentDetailModal` (Task 2), `AddStudentModal` with `lockFamily` (Task 4), `getStudentsByFamily`, `useModel().getModel`.

- [ ] **Step 1: Add i18n strings**

In `translations.ts` add to BOTH locales. en-US:
```ts
    'families.colId': 'Family ID',
    'families.colStudentId': 'Student ID',
    'families.colStudentName': 'Name',
    'families.colGrade': 'Grade',
    'families.colStatus': 'Status',
    'families.addStudent': 'Add student',
```
zh-CN:
```ts
    'families.colId': '家庭ID',
    'families.colStudentId': '学号',
    'families.colStudentName': '姓名',
    'families.colGrade': '年级',
    'families.colStatus': '状态',
    'families.addStudent': '添加学生',
```

- [ ] **Step 2: Rewrite `FamiliesPage`**

Replace the whole component body of `admindash/frontend/src/pages/FamiliesPage.tsx` with:
```tsx
import { useEffect, useMemo, useState, useCallback } from 'react';
import { useTranslation } from '../hooks/useTranslation.ts';
import { useModel } from '../contexts/ModelContext.tsx';
import { postQuery, getStudentsByFamily } from '../api/client.ts';
import DataTable, { type Column } from '../components/DataTable.tsx';
import AddFamilyModal from '../components/AddFamilyModal.tsx';
import AddStudentModal from '../components/AddStudentModal.tsx';
import StudentDetailModal from '../components/StudentDetailModal.tsx';
import type { Family, ModelDefinition } from '../types/models.ts';
import './FamiliesPage.css';

interface FamiliesPageProps { tenant: string; }
type Row = Record<string, unknown>;

const PAGE_SIZE = 20;

export default function FamiliesPage({ tenant }: FamiliesPageProps) {
  const { t } = useTranslation();
  const { getModel } = useModel();
  const [rows, setRows] = useState<Family[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadTick, setLoadTick] = useState(0);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [showAdd, setShowAdd] = useState(false);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [studentsByFamily, setStudentsByFamily] = useState<Record<string, Row[]>>({});
  const [studentModel, setStudentModel] = useState<ModelDefinition | null>(null);
  const [addStudentTo, setAddStudentTo] = useState<Family | null>(null);
  const [detailStudent, setDetailStudent] = useState<Row | null>(null);

  useEffect(() => { getModel(tenant, 'student').then(setStudentModel).catch(() => setStudentModel(null)); }, [tenant, getModel]);

  useEffect(() => {
    postQuery(tenant, 'entities',
      "SELECT * FROM data WHERE entity_type = 'family' AND _status = 'active'")
      .then((res) => { setRows(res.data as unknown as Family[]); setLoading(false); })
      .catch(() => { setRows([]); setLoading(false); });
  }, [tenant, loadTick]);

  const loadStudents = useCallback((familyId: string) => {
    getStudentsByFamily(tenant, familyId)
      .then((list) => setStudentsByFamily((prev) => ({ ...prev, [familyId]: list })))
      .catch(() => setStudentsByFamily((prev) => ({ ...prev, [familyId]: [] })));
  }, [tenant]);

  function toggleExpand(id: string) {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else { next.add(id); loadStudents(id); }
      return next;
    });
  }

  function handleReload() {
    setLoading(true);
    // refresh any currently-expanded families' students too
    expandedIds.forEach((id) => loadStudents(id));
    setLoadTick((n) => n + 1);
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((f) =>
      String(f.family_name ?? '').toLowerCase().includes(q) ||
      String(f.primary_email ?? '').toLowerCase().includes(q) ||
      String(f.primary_phone ?? '').toLowerCase().includes(q) ||
      String(f.entity_id ?? '').toLowerCase().includes(q));
  }, [rows, search]);

  const currentPage = useMemo(() => {
    const maxPage = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
    return Math.min(page, maxPage);
  }, [filtered.length, page]);

  const paged = useMemo(() => {
    const start = (currentPage - 1) * PAGE_SIZE;
    return filtered.slice(start, start + PAGE_SIZE);
  }, [filtered, currentPage]);

  function handleSearch(e: React.ChangeEvent<HTMLInputElement>) { setSearch(e.target.value); setPage(1); }

  const columns: Column<Row>[] = useMemo(() => [
    { key: 'entity_id', label: t('families.colId'), render: (r) => <code className="families-id">{String(r.entity_id ?? '-')}</code> },
    { key: 'family_name', label: t('families.colName'), render: (r) => String(r.family_name ?? '-') },
    { key: 'primary_email', label: t('families.colEmail'), render: (r) => String(r.primary_email ?? '-') },
    { key: 'primary_phone', label: t('families.colPhone'), render: (r) => String(r.primary_phone ?? '-') },
  ], [t]);

  function renderExpanded(family: Row): React.ReactNode {
    const fid = String(family.entity_id ?? '');
    const students = studentsByFamily[fid];
    return (
      <div className="families-expanded">
        {students == null ? (
          <p>{t('common.loading')}</p>
        ) : students.length === 0 ? (
          <p className="families-empty">{t('families.noStudents')}</p>
        ) : (
          <table className="families-students-table">
            <thead>
              <tr>
                <th>{t('families.colStudentId')}</th>
                <th>{t('families.colStudentName')}</th>
                <th>{t('families.colGrade')}</th>
                <th>{t('families.colStatus')}</th>
              </tr>
            </thead>
            <tbody>
              {students.map((s) => (
                <tr key={String(s.entity_id)}>
                  <td>
                    <button
                      type="button"
                      className="families-student-id"
                      title={t('studentDetail.title')}
                      onDoubleClick={() => setDetailStudent(s)}
                    >
                      {String(s.student_id ?? '-')}
                    </button>
                  </td>
                  <td>{String(s.first_name ?? '')} {String(s.last_name ?? '')}</td>
                  <td>{String(s.grade_level ?? '-')}</td>
                  <td>{String(s.status ?? '-')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <button
          className="families-add-btn"
          onClick={() => setAddStudentTo(family as unknown as Family)}
        >
          {t('families.addStudent')}
        </button>
      </div>
    );
  }

  return (
    <div className="families-page">
      <div className="families-header">
        <h2>{t('families.title')}</h2>
        <div className="families-actions">
          <input className="families-search" placeholder={t('families.search')} value={search} onChange={handleSearch} />
          <button className="families-add-btn" onClick={() => setShowAdd(true)}>{t('families.addFamily')}</button>
        </div>
      </div>

      {loading ? (
        <p>{t('common.loading')}</p>
      ) : filtered.length === 0 ? (
        <p className="families-empty">{t('families.empty')}</p>
      ) : (
        <DataTable<Row>
          columns={columns}
          data={paged}
          total={filtered.length}
          page={currentPage}
          pageSize={PAGE_SIZE}
          loading={false}
          onPageChange={setPage}
          rowKey={(r) => String(r.entity_id ?? '')}
          renderExpanded={renderExpanded}
          expandedIds={expandedIds}
          onToggleExpand={toggleExpand}
        />
      )}

      {showAdd && (
        <AddFamilyModal tenant={tenant} onClose={() => setShowAdd(false)} onSuccess={() => { setShowAdd(false); handleReload(); }} />
      )}

      {addStudentTo && (
        <AddStudentModal
          tenant={tenant}
          presetFamilyId={addStudentTo.entity_id}
          presetFamilyLabel={String(addStudentTo.family_name ?? '')}
          lockFamily
          onClose={() => setAddStudentTo(null)}
          onSuccess={() => { setAddStudentTo(null); handleReload(); }}
        />
      )}

      {detailStudent && studentModel && (
        <StudentDetailModal student={detailStudent} model={studentModel} onClose={() => setDetailStudent(null)} />
      )}
    </div>
  );
}
```

- [ ] **Step 3: Add styles**

Append to `admindash/frontend/src/pages/FamiliesPage.css`:
```css
.families-id { font-size: 12px; color: #555; }
.families-expanded { display: flex; flex-direction: column; gap: 10px; }
.families-students-table { width: 100%; border-collapse: collapse; background: #fff; border-radius: 6px; overflow: hidden; }
.families-students-table th, .families-students-table td { text-align: left; padding: 8px 10px; border-bottom: 1px solid var(--color-border, #eee); font-size: 13px; }
.families-student-id { background: none; border: none; color: var(--color-primary, #378ADD); cursor: pointer; font-family: monospace; padding: 0; }
.families-expanded .families-add-btn { align-self: flex-start; }
```

- [ ] **Step 4: Delete the obsolete LinkExistingStudentModal**

The link-existing flow is now the AddStudentModal "Existing student" tab; remove the standalone component:
```bash
git rm admindash/frontend/src/components/LinkExistingStudentModal.tsx admindash/frontend/src/components/LinkExistingStudentModal.css
```
NOTE: AddStudentModal (Task 4 Step 3 item 10) imports `LinkExistingStudentModal.css` for `.link-student-*` styles. If you deleted that CSS, instead MOVE the `.link-student-*` rules into `AddStudentModal.css` and import that. Verify no remaining import references the deleted files: `grep -rn "LinkExistingStudentModal" src/` must return nothing.

- [ ] **Step 5: Type-check + lint + test**

Run: `npm run build && npm run lint && npm run test`
Expected: build passes (no dangling imports); no NEW lint; 25/25.

- [ ] **Step 6: Manual QA**

Families tab: (a) a **Family ID** column shows each family's id; search matches it. (b) Click the expand chevron → the row expands listing that family's students (student id, name, grade, status). (c) **Double-click a student id** → StudentDetailModal opens read-only. (d) **Add student** button in the expanded area opens AddStudentModal with the family **locked** (no change control) and three tabs incl. **Existing student**; adding a new student or linking an existing one (with confirm-then-move) refreshes the family's list.

- [ ] **Step 7: Commit**

```bash
git add admindash/frontend/src/pages/FamiliesPage.tsx admindash/frontend/src/pages/FamiliesPage.css admindash/frontend/src/i18n/translations.ts admindash/frontend/src/components/AddStudentModal.tsx
git commit -m "feat(admindash): family rows expand to students; Family ID column; unified Add Student; retire LinkExistingStudentModal"
```

---

### Task 6: `StudentsPage` — double-click student id → detail

**Files:**
- Modify: `admindash/frontend/src/pages/StudentsPage.tsx`

**Interfaces:** Consumes `StudentDetailModal` (Task 2); uses the page's already-loaded `model`.

- [ ] **Step 1: Import + state**

In `admindash/frontend/src/pages/StudentsPage.tsx`:
1. Add import:
```ts
import StudentDetailModal from '../components/StudentDetailModal.tsx';
```
2. Add state near `editingEntity`:
```ts
  const [detailStudent, setDetailStudent] = useState<DataRow | null>(null);
```

- [ ] **Step 2: Make the student_id cell double-clickable**

READ the current `buildColumnsFromModel` (around lines 100-135). The `student_id` field is pushed via the generic `cols.push({ key: field.name, ... })` branch with no custom `render`. `buildColumnsFromModel` is a module-scope function that cannot call `setDetailStudent` directly, so thread a callback: change its signature to accept an `onStudentIdDblClick` and give the `student_id` field a render.
1. Update the function signature:
```ts
function buildColumnsFromModel(model: ModelDefinition, onStudentIdDblClick: (row: DataRow) => void): Column<DataRow>[] {
```
2. Inside the loop, BEFORE the generic `cols.push`, special-case student_id:
```ts
    if (field.name === 'student_id') {
      cols.push({
        key: 'student_id',
        label: formatFieldLabel('student_id'),
        i18nKey: 'students.studentId',
        render: (row: DataRow) => (
          <button
            type="button"
            className="students-id-btn"
            title="Double-click for detail"
            onDoubleClick={() => onStudentIdDblClick(row)}
          >
            {String(row.student_id ?? '-')}
          </button>
        ),
      });
      continue;
    }
```
3. Update the single call site of `buildColumnsFromModel(model)` to pass the callback: `buildColumnsFromModel(model, setDetailStudent)`. (Find it with `grep -n "buildColumnsFromModel(" src/pages/StudentsPage.tsx`. If it is memoized in a `useMemo`, add `setDetailStudent` — a stable setter — is fine; you may omit it from deps or include it.)

- [ ] **Step 3: Add a minimal style**

Append to `admindash/frontend/src/pages/StudentsPage.css`:
```css
.students-id-btn { background: none; border: none; color: var(--color-primary, #378ADD); cursor: pointer; font-family: monospace; padding: 0; }
```

- [ ] **Step 4: Render the detail modal**

Near the edit-student modal render (`{editingEntity && model && (...)}`), add:
```tsx
      {detailStudent && model && (
        <StudentDetailModal
          student={detailStudent as Record<string, unknown>}
          model={model}
          onClose={() => setDetailStudent(null)}
        />
      )}
```

- [ ] **Step 5: Type-check + lint + test**

Run: `npm run build && npm run lint && npm run test`
Expected: build passes; no NEW lint; 25/25.

- [ ] **Step 6: Manual QA**

Students list: double-click a student id → StudentDetailModal opens read-only with the student's fields; close works; the existing edit flow (via "Edit Selected") is unaffected.

- [ ] **Step 7: Commit**

```bash
git add admindash/frontend/src/pages/StudentsPage.tsx admindash/frontend/src/pages/StudentsPage.css
git commit -m "feat(admindash): double-click student id opens StudentDetailModal on students list"
```

---

## Self-Review

**Requirement coverage:**
- Family rows expandable listing students with default fields → Task 3 (DataTable expansion) + Task 5 (renderExpanded student table). ✓
- Double-click student id → detail modal, in family list AND student list → Task 2 (StudentDetailModal) + Task 5 Step 2 + Task 6. ✓
- "Add existing student" reuses the Add Student button + adds a search tab (name/id/email) → Task 1 (email search) + Task 4 (Existing student tab) + Task 5 (single Add Student button in family context). ✓
- In the family-context Add Student modal, family not changeable → Task 4 (FamilyPicker `locked` + `lockFamily`). ✓
- Family list includes Family ID → Task 5 Step 2 (entity_id column). ✓

**Placeholder scan:** none — full code or exact edits per step. Task 5 Step 4 and Task 6 Step 2 include real grep/verify instructions for integration into existing files, not placeholders.

**Type consistency:** `StudentDetailModalProps` (Task 2) used identically in Tasks 5 & 6. `FamilyPicker` `locked?` (Task 4) consumed in AddStudentModal. `AddStudentModal` `lockFamily?` (Task 4) consumed in FamiliesPage (Task 5). DataTable expansion props (Task 3) consumed in FamiliesPage (Task 5); StudentsPage does not pass them (unaffected). `family_id` scalar; all student writes remain full-form via EditStudentModal/DynamicForm.
