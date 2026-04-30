# AdminDash Program Page — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a full Program management page in AdminDash with CRUD operations, list view (DataTable), week calendar view (default), and month calendar view with overflow handling.

**Architecture:** Mirrors StudentsPage patterns — load model definition via `useModel()`, build dynamic columns, query via `postQuery()` SQL, CRUD via generic `createEntity`/`updateEntity`/`archiveEntities`. Calendar views are pure CSS Grid components. All styling uses `@neoapex/ui-tokens` design tokens.

**Tech Stack:** React 19, TypeScript 5.9, Vite 8, CSS Grid, `@neoapex/ui-tokens`

**OpenSpec Change:** `openspec/changes/admindash-program-page/`

---

## File Structure

| File | Responsibility |
|---|---|
| `ui-tokens/tokens.css` | Add `--warning` and `--warning-muted` tokens |
| `admindash/frontend/package.json` | Add `@neoapex/ui-tokens` dependency |
| `admindash/frontend/src/index.css` | Import ui-tokens, remove duplicated `:root` block |
| `admindash/frontend/src/i18n/translations.ts` | Program i18n keys (en-US + zh-CN) |
| `admindash/frontend/src/contexts/DashboardContext.tsx` | Add program count cache |
| `admindash/frontend/src/pages/ProgramPage.tsx` | Main page: list view, toolbar, action menu, view toggle, modals |
| `admindash/frontend/src/pages/ProgramPage.css` | Styles for list view, toolbar, modals, view toggle |
| `admindash/frontend/src/components/ProgramWeekView.tsx` | Week calendar component |
| `admindash/frontend/src/components/ProgramMonthView.tsx` | Month calendar component |
| `admindash/frontend/src/components/ProgramCalendar.css` | Shared calendar styles (week + month) |

---

### Task 1: UI Tokens Integration

**Files:**
- Modify: `ui-tokens/tokens.css:29-35`
- Modify: `admindash/frontend/package.json:12-15`
- Modify: `admindash/frontend/src/index.css:1-65`

- [ ] **Step 1: Add warning tokens to ui-tokens**

In `ui-tokens/tokens.css`, add `--warning` and `--warning-muted` after the `--info-muted` line (after line 35):

```css
  --warning: #EF9F27;
  --warning-muted: rgba(239, 159, 39, 0.1);
```

The Status section should now read:
```css
  /* Status */
  --success: #639922;
  --success-muted: rgba(99, 153, 34, 0.1);
  --danger: #D4537E;
  --danger-muted: rgba(212, 83, 126, 0.08);
  --info: #378ADD;
  --info-muted: rgba(55, 138, 221, 0.08);
  --warning: #EF9F27;
  --warning-muted: rgba(239, 159, 39, 0.1);
```

- [ ] **Step 2: Add ui-tokens dependency to admindash**

In `admindash/frontend/package.json`, add to the `dependencies` section:

```json
"@neoapex/ui-tokens": "file:../../ui-tokens"
```

Then run:
```bash
cd admindash/frontend && npm install
```

- [ ] **Step 3: Replace duplicated tokens with import**

In `admindash/frontend/src/index.css`, replace the first 65 lines (the `@import url(...)` for Google Fonts and the entire `:root { ... }` block) with:

```css
@import '@neoapex/ui-tokens/tokens.css';

:root {
  /* AdminDash-specific tokens not in shared ui-tokens */
  --bg-glass: #FFFFFF;
  --border-glass: #E2E8F0;
  --font-mono: 'Inter', system-ui, sans-serif;
}
```

Keep everything from line 67 onward (`*, *::before, *::after { ... }`, `html`, `body`, etc.) unchanged.

- [ ] **Step 4: Verify build**

Run: `cd admindash/frontend && npx tsc -b`
Expected: No errors.

- [ ] **Step 5: Commit**

```bash
git add ui-tokens/tokens.css admindash/frontend/package.json admindash/frontend/package-lock.json admindash/frontend/src/index.css
git commit -m "chore(admindash): integrate @neoapex/ui-tokens and add warning tokens"
```

---

### Task 2: I18n Translation Keys

**Files:**
- Modify: `admindash/frontend/src/i18n/translations.ts:123-125` (en-US) and `:289-290` (zh-CN)

- [ ] **Step 1: Add en-US program keys**

In `admindash/frontend/src/i18n/translations.ts`, replace the en-US Program section (lines 123-124):

```typescript
    // Program
    'program.title': 'Course Management',
```

With:

```typescript
    // Program
    'program.title': 'Program Management',
    'program.addProgram': 'Add Program',
    'program.noResults': 'No program data',
    'program.search': 'Search',
    'program.reset': 'Reset',
    'program.searchName': 'Program Name',
    'program.searchNamePlaceholder': 'Enter program name',
    'program.archiveConfirmTitle': 'Archive Programs',
    'program.archiveConfirmMessage': 'Are you sure you want to archive the selected programs? This action can be undone by an administrator.',
    'program.archiveSuccess': 'Programs archived successfully.',
    'program.addSuccess': 'Program added successfully.',
    'program.addError': 'Failed to add program. Please try again.',
    'program.editSuccess': 'Program updated successfully.',
    'program.editError': 'Failed to update program. Please try again.',
    'program.batchEditComingSoon': 'Batch editing is coming soon.',
    'program.autoIdUnavailable': 'Auto-ID generation unavailable. Please enter manually.',
    'program.modelNotFound': 'Program model not configured. Please set up the program model in Papermite first.',
    'program.viewList': 'List',
    'program.viewWeek': 'Week',
    'program.viewMonth': 'Month',
    'program.calendarNoDateFields': 'No date fields found in the program model. Add date fields via Papermite to use the calendar view.',
    'program.calendarToday': 'Today',
    'program.calendarMore': '+{count} more',
```

- [ ] **Step 2: Add zh-CN program keys**

Replace the zh-CN Program section (lines 289-290):

```typescript
    // Program
    'program.title': '课程管理',
```

With:

```typescript
    // Program
    'program.title': '课程管理',
    'program.addProgram': '添加课程',
    'program.noResults': '暂无课程数据',
    'program.search': '搜索',
    'program.reset': '重置',
    'program.searchName': '课程名称',
    'program.searchNamePlaceholder': '输入课程名称',
    'program.archiveConfirmTitle': '归档课程',
    'program.archiveConfirmMessage': '确定要归档所选课程吗？管理员可以撤销此操作。',
    'program.archiveSuccess': '课程归档成功。',
    'program.addSuccess': '课程添加成功。',
    'program.addError': '添加课程失败，请重试。',
    'program.editSuccess': '课程更新成功。',
    'program.editError': '更新课程失败，请重试。',
    'program.batchEditComingSoon': '批量编辑即将推出。',
    'program.autoIdUnavailable': '自动ID生成不可用，请手动输入。',
    'program.modelNotFound': '课程模型未配置。请先在 Papermite 中设置课程模型。',
    'program.viewList': '列表',
    'program.viewWeek': '周视图',
    'program.viewMonth': '月视图',
    'program.calendarNoDateFields': '课程模型中未找到日期字段。请通过 Papermite 添加日期字段以使用日历视图。',
    'program.calendarToday': '今天',
    'program.calendarMore': '+{count} 更多',
```

- [ ] **Step 3: Verify build**

Run: `cd admindash/frontend && npx tsc -b`
Expected: No errors.

- [ ] **Step 4: Commit**

```bash
git add admindash/frontend/src/i18n/translations.ts
git commit -m "feat(admindash): add program page i18n keys for en-US and zh-CN"
```

---

### Task 3: Dashboard Context — Program Count

**Files:**
- Modify: `admindash/frontend/src/contexts/DashboardContext.tsx`

- [ ] **Step 1: Add program count to DashboardContext**

In `admindash/frontend/src/contexts/DashboardContext.tsx`, make the following changes:

Replace the `DashboardContextValue` interface (lines 11-14):

```typescript
interface DashboardContextValue {
  getStudentCount: (tenantId: string) => Promise<number | null>;
  invalidateStudentCount: () => void;
}
```

With:

```typescript
interface DashboardContextValue {
  getStudentCount: (tenantId: string) => Promise<number | null>;
  invalidateStudentCount: () => void;
  getProgramCount: (tenantId: string) => Promise<number | null>;
  invalidateProgramCount: () => void;
}
```

Replace the context default (lines 16-19):

```typescript
const DashboardContext = createContext<DashboardContextValue>({
  getStudentCount: () => Promise.resolve(null),
  invalidateStudentCount: () => {},
});
```

With:

```typescript
const DashboardContext = createContext<DashboardContextValue>({
  getStudentCount: () => Promise.resolve(null),
  invalidateStudentCount: () => {},
  getProgramCount: () => Promise.resolve(null),
  invalidateProgramCount: () => {},
});
```

Inside `DashboardProvider`, after the `const [cache, setCache]` line (line 22), add:

```typescript
  const [programCache, setProgramCache] = useState<CachedCount | null>(null);
```

After the `invalidateStudentCount` callback (after line 46), add:

```typescript
  const getProgramCount = useCallback(
    async (tenantId: string): Promise<number | null> => {
      if (programCache && Date.now() - programCache.fetchedAt < TTL_MS) {
        return programCache.value;
      }
      try {
        const sql = "SELECT COUNT(*) as count FROM data WHERE entity_type = 'program' AND _status = 'active'";
        const result = await postQuery(tenantId, 'entities', sql);
        const count = Number(result.data[0]?.count ?? 0);
        setProgramCache({ value: count, fetchedAt: Date.now() });
        return count;
      } catch {
        return null;
      }
    },
    [programCache],
  );

  const invalidateProgramCount = useCallback(() => {
    setProgramCache(null);
  }, []);
```

Update the Provider value to include the new functions:

```typescript
    <DashboardContext.Provider value={{ getStudentCount, invalidateStudentCount, getProgramCount, invalidateProgramCount }}>
```

- [ ] **Step 2: Verify build**

Run: `cd admindash/frontend && npx tsc -b`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add admindash/frontend/src/contexts/DashboardContext.tsx
git commit -m "feat(admindash): add program count to DashboardContext"
```

---

### Task 4: ProgramPage — List View + Toolbar + Action Menu + CRUD Modals

This is the largest task. It replaces the placeholder ProgramPage with a full implementation mirroring StudentsPage patterns.

**Files:**
- Modify: `admindash/frontend/src/pages/ProgramPage.tsx` (full rewrite)
- Modify: `admindash/frontend/src/pages/ProgramPage.css` (full rewrite)

- [ ] **Step 1: Write ProgramPage.tsx**

Replace the entire contents of `admindash/frontend/src/pages/ProgramPage.tsx` with a component that:

1. **Imports**: `useModel`, `useDashboard`, `useAuth`, `useTablePreferences`, `useTranslation`, `postQuery`, `archiveEntities`, `updateEntity`, `createEntity`, `fetchNextEntityId`, `DataTable`, `DynamicForm`, `FilterForm`, `StatusBadge`, and model types
2. **State**: `data`, `total`, `page`, `filters`, `selectedIds`, `showMenu`, `showAddModal`, `editingEntity`, `showArchiveConfirm`, `showComingSoon`, `modelLoaded`, `loading`, `model` (from context), `activeView` (list/week/month)
3. **Model loading**: `useEffect` that calls `getModel(tenant, 'program')` and sets `modelLoaded`
4. **Column building**: `buildColumnsFromModel()` function same as StudentsPage — iterates `model.base_fields` + `model.custom_fields`, creates Column objects with type-appropriate renderers (StatusBadge for selection/bool, plain text otherwise). Composite name field handling (first_name + last_name → Name column).
5. **Data loading**: `loadData(pageNum, currentFilters)` function that builds SQL query: `SELECT * FROM data WHERE entity_type = 'program' AND _status = 'active'` + filter conditions + `ORDER BY` + `LIMIT/OFFSET`
6. **Filter form**: Dynamic filter fields from model base fields, using FilterForm component
7. **Toolbar**: "Add Program" button, selection count, three-dots action menu with disabled states (Edit Selected, Delete Selected, Export Selected), Columns toggle, view toggle (List/Week/Month)
8. **Action menu**: Same pattern as StudentsPage lines 529-582 — always render action items with `disabled={selectedIds.size === 0}`, danger class on Delete
9. **View toggle**: Three buttons in toolbar, active button highlighted with accent color
10. **Conditional view rendering**: When `activeView === 'list'` show FilterForm + DataTable; when `'week'` show ProgramWeekView; when `'month'` show ProgramMonthView
11. **Edit modal**: DynamicForm in a modal overlay, pre-populated with selected entity data, calls `updateEntity(tenant, 'program', entityId, baseData, customFields)` on submit
12. **Add modal**: Simpler than AddStudentModal — no document upload tab. Calls `fetchNextEntityId(tenant, 'program')` for auto-ID, then `createEntity(tenant, 'program', baseData, customFields)` on submit
13. **Archive confirmation**: Dialog with confirm/cancel, calls `archiveEntities(tenant, 'program', [...selectedIds])` on confirm
14. **Batch edit coming soon**: Simple dialog saying batch edit is coming soon

Use the exact same patterns as StudentsPage for: outside-click handler for menu, useTablePreferences for sort/pageSize/hiddenColumns, dynamic filter field building, buildColumnsFromModel, edit entity flow, archive flow.

Key differences from StudentsPage:
- Entity type is `'program'` not `'student'`
- No duplicate checking
- No document upload tab in add modal
- View toggle buttons in toolbar (List/Week/Month)
- `activeView` state controls which view renders
- Default sort field should be `'name'` not `'last_name'`

The add modal should be inline in ProgramPage (not a separate component), using DynamicForm directly. The modal overlay pattern:

```tsx
{showAddModal && model && (
  <div className="programs-confirm-overlay" onClick={() => setShowAddModal(false)}>
    <div className="programs-confirm-dialog programs-add-dialog" onClick={(e) => e.stopPropagation()}>
      <h3>{t('program.addProgram')}</h3>
      <DynamicForm
        modelDefinition={model}
        initialValues={addFormInitialValues}
        readOnlyFields={['program_id']}
        onSubmit={handleAddSubmit}
        onCancel={() => setShowAddModal(false)}
      />
    </div>
  </div>
)}
```

Where `addFormInitialValues` is computed from `fetchNextEntityId`:

```tsx
const [addFormInitialValues, setAddFormInitialValues] = useState<Record<string, unknown>>({});

// When add modal opens:
const handleOpenAddModal = async () => {
  try {
    const nextId = await fetchNextEntityId(tenant, 'program');
    setAddFormInitialValues({ program_id: nextId.next_id });
  } catch {
    setAddFormInitialValues({});
  }
  setShowAddModal(true);
};
```

For the view toggle buttons in the toolbar:

```tsx
<div className="programs-view-toggle">
  {(['list', 'week', 'month'] as const).map((view) => (
    <button
      key={view}
      className={`programs-view-btn ${activeView === view ? 'programs-view-btn-active' : ''}`}
      onClick={() => setActiveView(view)}
    >
      {t(`program.view${view.charAt(0).toUpperCase() + view.slice(1)}`)}
    </button>
  ))}
</div>
```

For conditional rendering by view:

```tsx
{activeView === 'list' && (
  <>
    <FilterForm onSearch={handleSearch} onReset={handleReset}>
      {/* filter fields */}
    </FilterForm>
    <DataTable columns={visibleColumns} data={data} ... />
  </>
)}
{activeView === 'week' && (
  <ProgramWeekView programs={data} model={model} onEditProgram={setEditingEntity} />
)}
{activeView === 'month' && (
  <ProgramMonthView programs={data} model={model} onEditProgram={setEditingEntity} onSwitchToWeek={(date) => { setActiveView('week'); setWeekStartDate(date); }} />
)}
```

- [ ] **Step 2: Write ProgramPage.css**

Replace the entire contents of `admindash/frontend/src/pages/ProgramPage.css`. Use the same class naming pattern as StudentsPage but with `programs-` prefix. All values MUST use ui-tokens CSS variables:

```css
.programs-page {
  animation: fadeIn 0.3s ease;
}

.programs-page h1 {
  font-size: 28px;
  font-weight: 800;
  letter-spacing: -0.02em;
  color: var(--text-primary);
  margin-bottom: 0.75rem;
}

.programs-toolbar {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin-bottom: 0.75rem;
  flex-wrap: wrap;
}

.programs-toolbar-primary {
  font-family: var(--font-sans);
  background: var(--accent);
  color: var(--text-inverse);
  border: none;
  padding: 0.4rem 1rem;
  border-radius: var(--radius-sm);
  font-size: 0.85rem;
  font-weight: 600;
  cursor: pointer;
  transition: background 0.15s;
}

.programs-toolbar-primary:hover {
  background: var(--accent-hover);
}

.programs-toolbar-spacer {
  flex: 1;
}

.programs-selected-count {
  font-size: 0.8rem;
  color: var(--text-tertiary);
}

/* View Toggle */
.programs-view-toggle {
  display: flex;
  gap: 0;
  border: 1px solid var(--border-primary);
  border-radius: var(--radius-sm);
  overflow: hidden;
}

.programs-view-btn {
  font-family: var(--font-sans);
  background: var(--bg-tertiary);
  border: none;
  border-right: 1px solid var(--border-primary);
  padding: 0.35rem 0.75rem;
  font-size: 0.8rem;
  color: var(--text-secondary);
  cursor: pointer;
  transition: all 0.15s;
}

.programs-view-btn:last-child {
  border-right: none;
}

.programs-view-btn:hover {
  background: var(--bg-card);
}

.programs-view-btn-active {
  background: var(--accent);
  color: var(--text-inverse);
}

.programs-view-btn-active:hover {
  background: var(--accent-hover);
}

/* Action Menu — same pattern as students */
.programs-menu-toggle {
  position: relative;
}

.programs-menu-btn {
  font-family: var(--font-sans);
  background: var(--bg-tertiary);
  border: 1px solid var(--border-primary);
  padding: 0.35rem 0.6rem;
  border-radius: var(--radius-sm);
  font-size: 1.1rem;
  line-height: 1;
  color: var(--text-secondary);
  cursor: pointer;
  transition: all 0.15s;
}

.programs-menu-btn:hover {
  background: var(--bg-card);
  color: var(--text-primary);
}

.programs-menu-popover {
  position: absolute;
  top: 100%;
  right: 0;
  z-index: 100;
  margin-top: 0.25rem;
  background: var(--bg-card);
  border: 1px solid var(--border-primary);
  border-radius: var(--radius-sm);
  box-shadow: var(--shadow-elevated);
  padding: 0.4rem 0;
  min-width: 200px;
  max-height: 400px;
  overflow-y: auto;
}

.programs-menu-section-label {
  font-size: 0.7rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  color: var(--text-tertiary);
  padding: 0.4rem 0.75rem 0.2rem;
}

.programs-menu-item {
  display: block;
  width: 100%;
  text-align: left;
  background: none;
  border: none;
  font-family: var(--font-sans);
  font-size: 0.8rem;
  color: var(--text-primary);
  padding: 0.4rem 0.75rem;
  cursor: pointer;
}

.programs-menu-item:hover {
  background: var(--accent-glow);
}

.programs-menu-item:disabled {
  color: var(--text-tertiary);
  cursor: not-allowed;
}

.programs-menu-item:disabled:hover {
  background: none;
}

.programs-menu-item-danger {
  color: var(--danger);
}

.programs-menu-item-danger:disabled {
  color: var(--text-tertiary);
}

.programs-menu-divider {
  height: 1px;
  background: var(--border-primary);
  margin: 0.3rem 0;
}

.programs-menu-column-option {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  font-size: 0.8rem;
  color: var(--text-primary);
  padding: 0.25rem 0.75rem;
  cursor: pointer;
}

.programs-menu-column-option:hover {
  background: var(--accent-glow);
}

.programs-menu-column-option input[type="checkbox"] {
  width: 0.9rem;
  height: 0.9rem;
}

/* Confirm/Archive Dialog */
.programs-confirm-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.4);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 200;
  animation: fadeIn 0.15s ease;
}

.programs-confirm-dialog {
  background: var(--bg-card);
  border-radius: var(--radius-md);
  padding: 1.5rem;
  max-width: 420px;
  width: 90%;
  box-shadow: var(--shadow-elevated);
}

.programs-confirm-dialog h3 {
  font-size: 1rem;
  font-weight: 700;
  color: var(--text-primary);
  margin-bottom: 0.75rem;
}

.programs-confirm-dialog p {
  font-size: 0.85rem;
  color: var(--text-secondary);
  margin-bottom: 1rem;
  line-height: 1.5;
}

.programs-confirm-actions {
  display: flex;
  justify-content: flex-end;
  gap: 0.5rem;
}

.programs-add-dialog {
  max-width: 600px;
}

.programs-edit-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.4);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 200;
  animation: fadeIn 0.15s ease;
}

.programs-edit-dialog {
  background: var(--bg-card);
  border-radius: var(--radius-md);
  padding: 1.5rem;
  max-width: 600px;
  width: 90%;
  max-height: 80vh;
  overflow-y: auto;
  box-shadow: var(--shadow-elevated);
}

.programs-edit-dialog h3 {
  font-size: 1rem;
  font-weight: 700;
  color: var(--text-primary);
  margin-bottom: 0.75rem;
}
```

- [ ] **Step 3: Verify build**

Run: `cd admindash/frontend && npx tsc -b`
Expected: No errors.

- [ ] **Step 4: Verify lint**

Run: `cd admindash/frontend && npm run lint -- --no-error-on-unmatched-pattern admindash/frontend/src/pages/ProgramPage.tsx`
Expected: No new lint errors from ProgramPage.

- [ ] **Step 5: Commit**

```bash
git add admindash/frontend/src/pages/ProgramPage.tsx admindash/frontend/src/pages/ProgramPage.css
git commit -m "feat(admindash): implement ProgramPage with list view, CRUD modals, and action menu"
```

---

### Task 5: ProgramWeekView Component

**Files:**
- Create: `admindash/frontend/src/components/ProgramWeekView.tsx`
- Create: `admindash/frontend/src/components/ProgramCalendar.css`

- [ ] **Step 1: Write ProgramWeekView.tsx**

Create `admindash/frontend/src/components/ProgramWeekView.tsx`:

```tsx
import { useState, useMemo } from 'react';
import { useTranslation } from '../hooks/useTranslation.ts';
import type { ModelDefinition, ModelFieldDefinition } from '../types/models.ts';
import './ProgramCalendar.css';

type DataRow = Record<string, unknown>;

const TINT_PAIRS = [
  { bg: 'var(--tint-blue-bg)', text: 'var(--tint-blue-text)' },
  { bg: 'var(--tint-green-bg)', text: 'var(--tint-green-text)' },
  { bg: 'var(--tint-amber-bg)', text: 'var(--tint-amber-text)' },
  { bg: 'var(--tint-pink-bg)', text: 'var(--tint-pink-text)' },
];

const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

interface ProgramWeekViewProps {
  programs: DataRow[];
  model: ModelDefinition | null;
  onEditProgram: (program: DataRow) => void;
  weekStart?: Date;
}

function getDateFields(model: ModelDefinition | null): ModelFieldDefinition[] {
  if (!model) return [];
  const all = [...model.base_fields, ...model.custom_fields];
  return all.filter((f) => f.type === 'date' || f.type === 'datetime');
}

function getWeekStart(date: Date): Date {
  const d = new Date(date);
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day; // Monday start
  d.setDate(d.getDate() + diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

function formatDate(date: Date): string {
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function formatWeekHeader(weekStart: Date): string {
  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekEnd.getDate() + 6);
  return `${formatDate(weekStart)} — ${formatDate(weekEnd)}`;
}

function isSameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function parseDateValue(value: unknown): Date | null {
  if (!value || typeof value !== 'string') return null;
  const d = new Date(value);
  return isNaN(d.getTime()) ? null : d;
}

export default function ProgramWeekView({ programs, model, onEditProgram, weekStart: externalWeekStart }: ProgramWeekViewProps) {
  const { t } = useTranslation();
  const [currentWeekStart, setCurrentWeekStart] = useState(() =>
    externalWeekStart ? getWeekStart(externalWeekStart) : getWeekStart(new Date())
  );

  const dateFields = useMemo(() => getDateFields(model), [model]);

  const weekDays = useMemo(() => {
    const days: Date[] = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(currentWeekStart);
      d.setDate(d.getDate() + i);
      days.push(d);
    }
    return days;
  }, [currentWeekStart]);

  const today = useMemo(() => new Date(), []);

  const programsByDay = useMemo(() => {
    const map = new Map<number, DataRow[]>();
    for (let i = 0; i < 7; i++) map.set(i, []);

    if (dateFields.length === 0) return map;

    const startField = dateFields[0]?.name;
    const endField = dateFields.length > 1 ? dateFields[1]?.name : null;

    for (const prog of programs) {
      const startDate = parseDateValue(prog[startField]);
      if (!startDate) continue;

      const endDate = endField ? parseDateValue(prog[endField]) : null;

      for (let i = 0; i < 7; i++) {
        const day = weekDays[i];
        if (endDate) {
          if (day >= startDate && day <= endDate) {
            map.get(i)!.push(prog);
          }
        } else {
          if (isSameDay(day, startDate)) {
            map.get(i)!.push(prog);
          }
        }
      }
    }
    return map;
  }, [programs, dateFields, weekDays]);

  const handlePrevWeek = () => {
    setCurrentWeekStart((prev) => {
      const d = new Date(prev);
      d.setDate(d.getDate() - 7);
      return d;
    });
  };

  const handleNextWeek = () => {
    setCurrentWeekStart((prev) => {
      const d = new Date(prev);
      d.setDate(d.getDate() + 7);
      return d;
    });
  };

  const handleToday = () => {
    setCurrentWeekStart(getWeekStart(new Date()));
  };

  if (dateFields.length === 0) {
    return (
      <div className="calendar-empty-state">
        <p>{t('program.calendarNoDateFields')}</p>
      </div>
    );
  }

  return (
    <div className="calendar-week">
      <div className="calendar-nav">
        <button className="calendar-nav-btn" onClick={handlePrevWeek}>‹</button>
        <span className="calendar-nav-title">{formatWeekHeader(currentWeekStart)}</span>
        <button className="calendar-nav-btn" onClick={handleNextWeek}>›</button>
        <button className="calendar-nav-today" onClick={handleToday}>{t('program.calendarToday')}</button>
      </div>
      <div className="calendar-week-grid">
        {weekDays.map((day, i) => (
          <div
            key={i}
            className={`calendar-week-col ${isSameDay(day, today) ? 'calendar-week-col-today' : ''}`}
          >
            <div className="calendar-week-header">
              <span className="calendar-week-day-label">{DAY_LABELS[i]}</span>
              <span className="calendar-week-day-num">{day.getDate()}</span>
            </div>
            <div className="calendar-week-body">
              {(programsByDay.get(i) ?? []).map((prog, j) => {
                const tint = TINT_PAIRS[j % TINT_PAIRS.length];
                const name = (prog.name as string) || (prog.program_id as string) || 'Program';
                return (
                  <button
                    key={String(prog.entity_id)}
                    className="calendar-chip"
                    style={{ background: tint.bg, color: tint.text }}
                    onClick={() => onEditProgram(prog)}
                  >
                    {name}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Write ProgramCalendar.css**

Create `admindash/frontend/src/components/ProgramCalendar.css`:

```css
/* Shared Calendar Styles */

.calendar-nav {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin-bottom: 0.75rem;
}

.calendar-nav-btn {
  font-family: var(--font-sans);
  background: var(--bg-tertiary);
  border: 1px solid var(--border-primary);
  border-radius: var(--radius-sm);
  padding: 0.3rem 0.6rem;
  font-size: 1.1rem;
  color: var(--text-secondary);
  cursor: pointer;
  line-height: 1;
}

.calendar-nav-btn:hover {
  background: var(--bg-card);
  color: var(--text-primary);
}

.calendar-nav-title {
  font-size: 0.95rem;
  font-weight: 600;
  color: var(--text-primary);
  min-width: 200px;
  text-align: center;
}

.calendar-nav-today {
  font-family: var(--font-sans);
  background: var(--bg-tertiary);
  border: 1px solid var(--border-primary);
  border-radius: var(--radius-sm);
  padding: 0.3rem 0.75rem;
  font-size: 0.8rem;
  color: var(--text-secondary);
  cursor: pointer;
  margin-left: auto;
}

.calendar-nav-today:hover {
  background: var(--bg-card);
  color: var(--text-primary);
}

/* Week View */
.calendar-week-grid {
  display: grid;
  grid-template-columns: repeat(7, 1fr);
  gap: 1px;
  background: var(--border-primary);
  border: 1px solid var(--border-primary);
  border-radius: var(--radius-md);
  overflow: hidden;
}

.calendar-week-col {
  background: var(--bg-secondary);
  min-height: 300px;
  display: flex;
  flex-direction: column;
}

.calendar-week-col-today {
  background: var(--accent-muted);
  border-left: 2px solid var(--border-accent);
}

.calendar-week-header {
  padding: 0.5rem;
  text-align: center;
  border-bottom: 1px solid var(--border-subtle);
}

.calendar-week-day-label {
  display: block;
  font-size: 0.7rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  color: var(--text-tertiary);
}

.calendar-week-day-num {
  display: block;
  font-size: 1.1rem;
  font-weight: 700;
  color: var(--text-primary);
}

.calendar-week-body {
  padding: 0.4rem;
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
  flex: 1;
}

/* Program Chip */
.calendar-chip {
  display: block;
  width: 100%;
  text-align: left;
  border: none;
  font-family: var(--font-sans);
  font-size: 0.75rem;
  font-weight: 500;
  padding: 0.3rem 0.5rem;
  border-radius: 4px;
  cursor: pointer;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  transition: opacity 0.15s;
}

.calendar-chip:hover {
  opacity: 0.8;
}

/* Month View */
.calendar-month-grid {
  display: grid;
  grid-template-columns: repeat(7, 1fr);
  gap: 1px;
  background: var(--border-primary);
  border: 1px solid var(--border-primary);
  border-radius: var(--radius-md);
  overflow: hidden;
}

.calendar-month-header {
  background: var(--bg-tertiary);
  padding: 0.4rem;
  text-align: center;
  font-size: 0.7rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  color: var(--text-tertiary);
}

.calendar-month-cell {
  background: var(--bg-secondary);
  min-height: 90px;
  padding: 0.3rem;
  display: flex;
  flex-direction: column;
}

.calendar-month-cell-inactive {
  background: var(--bg-tertiary);
}

.calendar-month-cell-today {
  background: var(--accent-muted);
}

.calendar-month-day-num {
  font-size: 0.75rem;
  font-weight: 600;
  color: var(--text-secondary);
  margin-bottom: 0.2rem;
}

.calendar-month-cell-today .calendar-month-day-num {
  color: var(--accent);
  font-weight: 700;
}

.calendar-month-chips {
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
  flex: 1;
}

.calendar-month-chip {
  display: block;
  width: 100%;
  text-align: left;
  border: none;
  font-family: var(--font-sans);
  font-size: 0.65rem;
  font-weight: 500;
  padding: 0.15rem 0.35rem;
  border-radius: 3px;
  cursor: pointer;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.calendar-month-chip:hover {
  opacity: 0.8;
}

.calendar-more-link {
  font-family: var(--font-sans);
  font-size: 0.65rem;
  color: var(--text-tertiary);
  background: none;
  border: none;
  padding: 0.1rem 0.35rem;
  cursor: pointer;
  text-align: left;
}

.calendar-more-link:hover {
  color: var(--accent);
}

/* More Popover */
.calendar-more-popover {
  position: absolute;
  z-index: 150;
  background: var(--bg-card);
  border: 1px solid var(--border-primary);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-elevated);
  padding: 0.5rem;
  min-width: 180px;
  max-height: 250px;
  overflow-y: auto;
}

.calendar-more-popover-title {
  font-size: 0.75rem;
  font-weight: 600;
  color: var(--text-secondary);
  margin-bottom: 0.4rem;
  padding-bottom: 0.3rem;
  border-bottom: 1px solid var(--border-subtle);
}

.calendar-more-popover .calendar-chip {
  margin-bottom: 0.2rem;
}

/* Empty State */
.calendar-empty-state {
  padding: 3rem;
  text-align: center;
  color: var(--text-tertiary);
  font-size: 0.9rem;
  background: var(--bg-tertiary);
  border-radius: var(--radius-md);
  border: 1px dashed var(--border-primary);
}
```

- [ ] **Step 3: Verify build**

Run: `cd admindash/frontend && npx tsc -b`
Expected: No errors.

- [ ] **Step 4: Commit**

```bash
git add admindash/frontend/src/components/ProgramWeekView.tsx admindash/frontend/src/components/ProgramCalendar.css
git commit -m "feat(admindash): add ProgramWeekView calendar component"
```

---

### Task 6: ProgramMonthView Component

**Files:**
- Create: `admindash/frontend/src/components/ProgramMonthView.tsx`

- [ ] **Step 1: Write ProgramMonthView.tsx**

Create `admindash/frontend/src/components/ProgramMonthView.tsx`:

```tsx
import { useState, useMemo, useRef, useEffect } from 'react';
import { useTranslation } from '../hooks/useTranslation.ts';
import type { ModelDefinition, ModelFieldDefinition } from '../types/models.ts';
import './ProgramCalendar.css';

type DataRow = Record<string, unknown>;

const TINT_PAIRS = [
  { bg: 'var(--tint-blue-bg)', text: 'var(--tint-blue-text)' },
  { bg: 'var(--tint-green-bg)', text: 'var(--tint-green-text)' },
  { bg: 'var(--tint-amber-bg)', text: 'var(--tint-amber-text)' },
  { bg: 'var(--tint-pink-bg)', text: 'var(--tint-pink-text)' },
];

const MAX_CHIPS = 3;
const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

interface ProgramMonthViewProps {
  programs: DataRow[];
  model: ModelDefinition | null;
  onEditProgram: (program: DataRow) => void;
  onSwitchToWeek: (date: Date) => void;
}

function getDateFields(model: ModelDefinition | null): ModelFieldDefinition[] {
  if (!model) return [];
  const all = [...model.base_fields, ...model.custom_fields];
  return all.filter((f) => f.type === 'date' || f.type === 'datetime');
}

function parseDateValue(value: unknown): Date | null {
  if (!value || typeof value !== 'string') return null;
  const d = new Date(value);
  return isNaN(d.getTime()) ? null : d;
}

function isSameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function getMonthGrid(year: number, month: number): (Date | null)[] {
  const firstDay = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0);
  const startDow = firstDay.getDay() === 0 ? 6 : firstDay.getDay() - 1; // Monday start
  const cells: (Date | null)[] = [];
  for (let i = 0; i < startDow; i++) cells.push(null);
  for (let d = 1; d <= lastDay.getDate(); d++) cells.push(new Date(year, month, d));
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
}

export default function ProgramMonthView({ programs, model, onEditProgram, onSwitchToWeek }: ProgramMonthViewProps) {
  const { t } = useTranslation();
  const [currentYear, setCurrentYear] = useState(() => new Date().getFullYear());
  const [currentMonth, setCurrentMonth] = useState(() => new Date().getMonth());
  const [morePopover, setMorePopover] = useState<{ cellIndex: number; programs: DataRow[] } | null>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

  const dateFields = useMemo(() => getDateFields(model), [model]);
  const today = useMemo(() => new Date(), []);

  const grid = useMemo(() => getMonthGrid(currentYear, currentMonth), [currentYear, currentMonth]);

  const programsByDay = useMemo(() => {
    const map = new Map<string, DataRow[]>();
    if (dateFields.length === 0) return map;

    const startField = dateFields[0]?.name;
    const endField = dateFields.length > 1 ? dateFields[1]?.name : null;

    for (const prog of programs) {
      const startDate = parseDateValue(prog[startField]);
      if (!startDate) continue;
      const endDate = endField ? parseDateValue(prog[endField]) : null;

      for (const cell of grid) {
        if (!cell) continue;
        const key = cell.toISOString().slice(0, 10);
        if (endDate) {
          if (cell >= startDate && cell <= endDate) {
            if (!map.has(key)) map.set(key, []);
            map.get(key)!.push(prog);
          }
        } else {
          if (isSameDay(cell, startDate)) {
            if (!map.has(key)) map.set(key, []);
            map.get(key)!.push(prog);
          }
        }
      }
    }
    return map;
  }, [programs, dateFields, grid]);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        setMorePopover(null);
      }
    }
    if (morePopover) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [morePopover]);

  const handlePrevMonth = () => {
    if (currentMonth === 0) {
      setCurrentYear((y) => y - 1);
      setCurrentMonth(11);
    } else {
      setCurrentMonth((m) => m - 1);
    }
  };

  const handleNextMonth = () => {
    if (currentMonth === 11) {
      setCurrentYear((y) => y + 1);
      setCurrentMonth(0);
    } else {
      setCurrentMonth((m) => m + 1);
    }
  };

  const handleToday = () => {
    setCurrentYear(new Date().getFullYear());
    setCurrentMonth(new Date().getMonth());
  };

  const monthLabel = new Date(currentYear, currentMonth).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

  if (dateFields.length === 0) {
    return (
      <div className="calendar-empty-state">
        <p>{t('program.calendarNoDateFields')}</p>
      </div>
    );
  }

  return (
    <div className="calendar-month">
      <div className="calendar-nav">
        <button className="calendar-nav-btn" onClick={handlePrevMonth}>‹</button>
        <span className="calendar-nav-title">{monthLabel}</span>
        <button className="calendar-nav-btn" onClick={handleNextMonth}>›</button>
        <button className="calendar-nav-today" onClick={handleToday}>{t('program.calendarToday')}</button>
      </div>
      <div className="calendar-month-grid">
        {DAY_LABELS.map((label) => (
          <div key={label} className="calendar-month-header">{label}</div>
        ))}
        {grid.map((cell, i) => {
          if (!cell) {
            return <div key={`empty-${i}`} className="calendar-month-cell calendar-month-cell-inactive" />;
          }
          const key = cell.toISOString().slice(0, 10);
          const dayPrograms = programsByDay.get(key) ?? [];
          const isToday = isSameDay(cell, today);
          const visible = dayPrograms.slice(0, MAX_CHIPS);
          const overflow = dayPrograms.length - MAX_CHIPS;

          return (
            <div key={key} className={`calendar-month-cell ${isToday ? 'calendar-month-cell-today' : ''}`} style={{ position: 'relative' }}>
              <div className="calendar-month-day-num">{cell.getDate()}</div>
              <div className="calendar-month-chips">
                {visible.map((prog, j) => {
                  const tint = TINT_PAIRS[j % TINT_PAIRS.length];
                  const name = (prog.name as string) || (prog.program_id as string) || 'Program';
                  return (
                    <button
                      key={String(prog.entity_id)}
                      className="calendar-month-chip"
                      style={{ background: tint.bg, color: tint.text }}
                      onClick={() => onEditProgram(prog)}
                    >
                      {name}
                    </button>
                  );
                })}
                {overflow > 0 && (
                  <button
                    className="calendar-more-link"
                    onClick={() => setMorePopover({ cellIndex: i, programs: dayPrograms })}
                  >
                    +{overflow} more
                  </button>
                )}
              </div>
              {morePopover && morePopover.cellIndex === i && (
                <div className="calendar-more-popover" ref={popoverRef}>
                  <div className="calendar-more-popover-title">
                    {cell.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
                  </div>
                  {dayPrograms.map((prog, j) => {
                    const tint = TINT_PAIRS[j % TINT_PAIRS.length];
                    const name = (prog.name as string) || (prog.program_id as string) || 'Program';
                    return (
                      <button
                        key={String(prog.entity_id)}
                        className="calendar-chip"
                        style={{ background: tint.bg, color: tint.text }}
                        onClick={() => {
                          setMorePopover(null);
                          onSwitchToWeek(cell);
                          onEditProgram(prog);
                        }}
                      >
                        {name}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify build**

Run: `cd admindash/frontend && npx tsc -b`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add admindash/frontend/src/components/ProgramMonthView.tsx
git commit -m "feat(admindash): add ProgramMonthView calendar component with overflow popover"
```

---

### Task 7: Final Verification

**Files:** None (verification only)

- [ ] **Step 1: TypeScript check**

Run: `cd admindash/frontend && npx tsc -b`
Expected: No errors.

- [ ] **Step 2: Lint check**

Run: `cd admindash/frontend && npm run lint`
Expected: No new errors from program page files. Pre-existing errors in other files are acceptable.

- [ ] **Step 3: Verify all imports resolve**

Ensure ProgramPage.tsx imports ProgramWeekView and ProgramMonthView correctly:
```typescript
import ProgramWeekView from '../components/ProgramWeekView.tsx';
import ProgramMonthView from '../components/ProgramMonthView.tsx';
```

- [ ] **Step 4: Commit any fixes**

If lint or type errors were found and fixed:
```bash
git add -u
git commit -m "fix(admindash): resolve lint/type errors in program page"
```
