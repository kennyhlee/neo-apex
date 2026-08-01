# Family ↔ Student Linking — Part 2 (Batch / Bulk Add) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. **Prerequisite: Part 1 (`2026-07-29-family-student-linking-part1.md`) is merged** — this plan consumes `familyMatch.ts`, `FamilyPicker`, family API helpers, and the family types it created.

**Goal:** Capture family info in the bulk-add flow (CSV column mapping + manual per-row assignment), group siblings into one family, and create students linked to their family via a two-phase create (families first, then students).

**Architecture:** Family values ride through the existing CSV mapping into each row's `values` under four dedicated keys (`family_name`, `family_email`, `family_phone`, `family_address`) — none of which are student model fields, so they never leak into the student payload. At submit, a pure planner clusters rows into families, auto-matches each cluster against existing families, creates the new ones in one phase, then injects the resolved `family_id` into each student. Bulk *document* imports (Phase 1) assign family manually per row via the `FamilyPicker` in the row drawer; auto-extraction from documents is Phase 2.

**Tech Stack:** React 19 + TS 5.9, Vitest 3 (from Part 1), native Fetch, custom i18n.

## Global Constraints

- **`family_id` is a scalar string** on the student; one family per student.
- **Family base fields on the family entity:** `family_name`, `primary_email`, `primary_phone`, `primary_address`.
- **CSV family mapping targets** (distinct from student fields so they never collide): `family_name`, `family_email`, `family_phone`, `family_address`. These land in `BulkRow.values` and are read out at submit — they are NOT student model fields, so `submitFromGate`'s existing `baseFieldNames`/`customFieldNames` filter already excludes them from the student payload.
- **Two-phase create:** create unique new families, then students carrying `family_id`. If a family create fails, its rows fail as a group and are reported for retry (reuse existing `failed` status).
- **No new backend endpoints** (reuse `createFamily`/`createEntity`, `searchFamilies`).
- **i18n** strings in both `en-US` and `zh-CN`.
- Commands run from `admindash/frontend`: `npm run test`, `npm run build`, `npm run lint`. Branch: `feat/family-student-linking`.

---

### Task 1: Extend batch types

**Files:**
- Modify: `admindash/frontend/src/types/bulkAdd.ts`

**Interfaces:**
- Produces: `BulkRow.familyLink?: { familyId: string; label: string }` (a manually-chosen existing family for the row). New-family values live in `BulkRow.values` under the family target keys.

- [ ] **Step 1: Add `familyLink` to `BulkRow`**

In `admindash/frontend/src/types/bulkAdd.ts`, inside `export interface BulkRow { ... }`, after `assignedStudentId?: string;` add:
```ts
  /** Manually-chosen existing family for this row (drawer override). New-family
   *  values live in `values` under family_name/family_email/family_phone/family_address. */
  familyLink?: { familyId: string; label: string };
```

- [ ] **Step 2: Type-check**

Run: `npm run build`
Expected: succeeds.

- [ ] **Step 3: Commit**

```bash
git add admindash/frontend/src/types/bulkAdd.ts
git commit -m "feat(admindash): add BulkRow.familyLink for batch family assignment"
```

---

### Task 2: Family CSV-mapping util (pure, TDD)

**Files:**
- Create: `admindash/frontend/src/utils/familyBulk.ts`
- Create: `admindash/frontend/src/utils/__tests__/familyBulk.test.ts`

**Interfaces:**
- Consumes: `FamilyData` (Part 1, Task 2).
- Produces:
  - `FAMILY_TARGETS: ReadonlyArray<{ target: string; i18nKey: string }>`
  - `FAMILY_TARGET_NAMES: readonly string[]`
  - `extractFamilyValues(values: Record<string, unknown>): FamilyData | null`

- [ ] **Step 1: Write the failing tests**

Create `admindash/frontend/src/utils/__tests__/familyBulk.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { FAMILY_TARGET_NAMES, extractFamilyValues } from '../familyBulk.ts';

describe('FAMILY_TARGET_NAMES', () => {
  it('lists the four family mapping targets', () => {
    expect(FAMILY_TARGET_NAMES).toEqual([
      'family_name', 'family_email', 'family_phone', 'family_address',
    ]);
  });
});

describe('extractFamilyValues', () => {
  it('maps family_* keys onto FamilyData', () => {
    const fam = extractFamilyValues({
      first_name: 'An',                 // student field — ignored
      family_name: 'Nguyen',
      family_email: 'ng@x.com',
      family_phone: '415-555-0100',
      family_address: '12 Main',
    });
    expect(fam).toEqual({
      family_name: 'Nguyen',
      primary_email: 'ng@x.com',
      primary_phone: '415-555-0100',
      primary_address: '12 Main',
    });
  });

  it('returns null when no family field is present', () => {
    expect(extractFamilyValues({ first_name: 'An' })).toBeNull();
  });

  it('keeps a family with only a name', () => {
    expect(extractFamilyValues({ family_name: 'Lee' })).toEqual({
      family_name: 'Lee',
      primary_email: undefined,
      primary_phone: undefined,
      primary_address: undefined,
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test`
Expected: FAIL — `../familyBulk.ts` not found.

- [ ] **Step 3: Implement the util**

Create `admindash/frontend/src/utils/familyBulk.ts`:
```ts
import type { FamilyData } from '../types/models.ts';

/** CSV mapping targets for family fields. Kept distinct from student field
 *  names so a mapped family column never collides with a student column. */
export const FAMILY_TARGETS = [
  { target: 'family_name', i18nKey: 'familyPicker.newFamilyName' },
  { target: 'family_email', i18nKey: 'familyPicker.newEmail' },
  { target: 'family_phone', i18nKey: 'familyPicker.newPhone' },
  { target: 'family_address', i18nKey: 'familyPicker.newAddress' },
] as const;

export const FAMILY_TARGET_NAMES = FAMILY_TARGETS.map((f) => f.target);

function str(v: unknown): string {
  return v == null ? '' : String(v).trim();
}

/** Read the four family_* keys out of a row's values into FamilyData, or null
 *  if the row carries no family info at all. */
export function extractFamilyValues(values: Record<string, unknown>): FamilyData | null {
  const family_name = str(values.family_name);
  const primary_email = str(values.family_email);
  const primary_phone = str(values.family_phone);
  const primary_address = str(values.family_address);
  if (!family_name && !primary_email && !primary_phone && !primary_address) return null;
  return {
    family_name,
    primary_email: primary_email || undefined,
    primary_phone: primary_phone || undefined,
    primary_address: primary_address || undefined,
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add admindash/frontend/src/utils/familyBulk.ts admindash/frontend/src/utils/__tests__/familyBulk.test.ts
git commit -m "feat(admindash): family CSV mapping targets + extractFamilyValues (tested)"
```

---

### Task 3: Family planning util (pure, TDD)

**Files:**
- Create: `admindash/frontend/src/utils/familyPlan.ts`
- Create: `admindash/frontend/src/utils/__tests__/familyPlan.test.ts`

**Interfaces:**
- Consumes: `normalizeSignature`, `signatureKey`, `FamilySignature` (Part 1 `familyMatch.ts`); `FamilyData`.
- Produces:
  - `interface RowFamilyInput { rowId: string; data: FamilyData | null }`
  - `interface FamilyPlan { resolved: Record<string,string>; toCreate: { clusterKey: string; data: FamilyData }[]; rowToCluster: Record<string,string>; unassigned: string[] }`
  - `planFamilies(inputs: RowFamilyInput[], matchExisting: (sig: FamilySignature) => string | null): FamilyPlan`

- [ ] **Step 1: Write the failing tests**

Create `admindash/frontend/src/utils/__tests__/familyPlan.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { planFamilies } from '../familyPlan.ts';
import { normalizeSignature, signatureKey, type FamilySignature } from '../familyMatch.ts';

// Fake matcher: an existing family exists only for email match@x.com.
const matchExisting = (sig: FamilySignature): string | null =>
  sig.email === 'match@x.com' ? 'fam-existing' : null;

describe('planFamilies', () => {
  it('groups siblings sharing a key into one new family', () => {
    const plan = planFamilies([
      { rowId: 'r1', data: { family_name: 'Nguyen', primary_address: '12 Main' } },
      { rowId: 'r2', data: { family_name: 'nguyen', primary_address: '12 main' } },
    ], matchExisting);
    expect(plan.toCreate).toHaveLength(1);
    expect(plan.rowToCluster.r1).toBe(plan.rowToCluster.r2);
    expect(Object.keys(plan.resolved)).toHaveLength(0);
  });

  it('resolves rows that match an existing family', () => {
    const plan = planFamilies([
      { rowId: 'r1', data: { family_name: 'X', primary_email: 'match@x.com' } },
    ], matchExisting);
    expect(plan.resolved.r1).toBe('fam-existing');
    expect(plan.toCreate).toHaveLength(0);
  });

  it('marks rows with no family data as unassigned', () => {
    const plan = planFamilies([{ rowId: 'r1', data: null }], matchExisting);
    expect(plan.unassigned).toEqual(['r1']);
  });

  it('creates a solo family for data that has no dedupe key (name only)', () => {
    const plan = planFamilies([
      { rowId: 'r1', data: { family_name: 'Lee' } },
      { rowId: 'r2', data: { family_name: 'Lee' } },
    ], matchExisting);
    // name-only has no signature key → each row gets its own family
    expect(plan.toCreate).toHaveLength(2);
    expect(plan.rowToCluster.r1).not.toBe(plan.rowToCluster.r2);
  });

  it('sanity: a keyed signature is non-empty', () => {
    expect(signatureKey(normalizeSignature({ primary_email: 'a@b.com' }))).not.toBe('');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test`
Expected: FAIL — `../familyPlan.ts` not found.

- [ ] **Step 3: Implement the planner**

Create `admindash/frontend/src/utils/familyPlan.ts`:
```ts
import type { FamilyData } from '../types/models.ts';
import { normalizeSignature, signatureKey, type FamilySignature } from './familyMatch.ts';

export interface RowFamilyInput {
  rowId: string;
  data: FamilyData | null;
}

export interface FamilyPlan {
  /** rowId -> already-known family entity_id (matched existing family). */
  resolved: Record<string, string>;
  /** unique new families to create, one per clusterKey. */
  toCreate: { clusterKey: string; data: FamilyData }[];
  /** rowId -> clusterKey (row whose family must be created in phase A). */
  rowToCluster: Record<string, string>;
  /** rowIds with no family info at all. */
  unassigned: string[];
}

export function planFamilies(
  inputs: RowFamilyInput[],
  matchExisting: (sig: FamilySignature) => string | null,
): FamilyPlan {
  const resolved: Record<string, string> = {};
  const rowToCluster: Record<string, string> = {};
  const unassigned: string[] = [];
  const toCreate: { clusterKey: string; data: FamilyData }[] = [];
  const seenClusters = new Set<string>();

  for (const { rowId, data } of inputs) {
    if (!data) { unassigned.push(rowId); continue; }
    const sig = normalizeSignature(data as unknown as Record<string, unknown>);
    const key = signatureKey(sig);
    if (key) {
      const existing = matchExisting(sig);
      if (existing) { resolved[rowId] = existing; continue; }
      if (!seenClusters.has(key)) { seenClusters.add(key); toCreate.push({ clusterKey: key, data }); }
      rowToCluster[rowId] = key;
    } else {
      // Data present but no dedupe key (e.g. name only) — create a unique family.
      const solo = `solo:${rowId}`;
      toCreate.push({ clusterKey: solo, data });
      rowToCluster[rowId] = solo;
    }
  }

  return { resolved, toCreate, rowToCluster, unassigned };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add admindash/frontend/src/utils/familyPlan.ts admindash/frontend/src/utils/__tests__/familyPlan.test.ts
git commit -m "feat(admindash): pure family planner (cluster + match + solo) with tests"
```

---

### Task 4: `bulkCreateFamilies` orchestrator + two-phase wiring

**Files:**
- Modify: `admindash/frontend/src/api/bulkAddOrchestrators.ts`
- Modify: `admindash/frontend/src/pages/BulkAddStudentsPage.tsx`

**Interfaces:**
- Consumes: `createFamily`, `searchFamilies` (Part 1); `matchFamily`, `normalizeSignature` (Part 1); `planFamilies` (Task 3); `extractFamilyValues` (Task 2); `FamilyData`.
- Produces:
  - In `bulkAddOrchestrators.ts`: `resolveRowFamilies(tenantId, rows): Promise<{ rowFamilyId: Map<string,string>; failedRowIds: Set<string>; failMessage: string }>` — does phase A (create new families) and returns the rowId→family_id map plus rows that failed because their family create failed.

- [ ] **Step 1: Add `resolveRowFamilies` to the orchestrator**

In `admindash/frontend/src/api/bulkAddOrchestrators.ts`, add imports at the top (after existing imports):
```ts
import { createFamily, searchFamilies } from './client.ts';
import { matchFamily, normalizeSignature } from '../utils/familyMatch.ts';
import { extractFamilyValues } from '../utils/familyBulk.ts';
import { planFamilies, type RowFamilyInput } from '../utils/familyPlan.ts';
import type { FamilyData } from '../types/models.ts';
```
Then append this function at the end of the file:
```ts
/**
 * Phase A of the two-phase create: resolve each row's family.
 * - Rows with a manual `familyLink` use it directly.
 * - Otherwise family values are read from the row (family_* keys), clustered,
 *   matched against existing families, and any new families are created here.
 * Returns rowId -> family_id, plus the rows whose family creation failed.
 */
export async function resolveRowFamilies(
  tenantId: string,
  rows: BulkRow[],
): Promise<{ rowFamilyId: Map<string, string>; failedRowIds: Set<string>; failMessage: string }> {
  const rowFamilyId = new Map<string, string>();
  const failedRowIds = new Set<string>();

  // 1) Manual links resolve immediately.
  const needsPlanning: RowFamilyInput[] = [];
  for (const row of rows) {
    if (row.familyLink) {
      rowFamilyId.set(row.id, row.familyLink.familyId);
    } else {
      needsPlanning.push({ rowId: row.id, data: extractFamilyValues(row.values) });
    }
  }

  // 2) Fetch a candidate pool of existing families to match against.
  //    A broad, empty-query fetch returns the (capped) family list; adequate for
  //    typical tenant sizes. Matching is exact-signature so false positives are nil.
  let candidates: Awaited<ReturnType<typeof searchFamilies>> = [];
  try {
    candidates = await searchFamilies(tenantId, '');
  } catch {
    candidates = [];
  }
  const plan = planFamilies(
    needsPlanning,
    (sig) => matchFamily(sig, candidates as Array<{ entity_id: string } & Record<string, unknown>>),
  );

  // 3) Rows matched to an existing family.
  for (const [rowId, familyId] of Object.entries(plan.resolved)) {
    rowFamilyId.set(rowId, familyId);
  }

  // 4) Phase A: create each unique new family once.
  const clusterToFamilyId = new Map<string, string>();
  let failMessage = '';
  for (const { clusterKey, data } of plan.toCreate) {
    try {
      const created = await createFamily(tenantId, data as FamilyData);
      clusterToFamilyId.set(clusterKey, created.entity_id);
    } catch (e) {
      failMessage = e instanceof Error ? e.message : String(e);
      // Fail every row in this cluster.
      for (const [rowId, key] of Object.entries(plan.rowToCluster)) {
        if (key === clusterKey) failedRowIds.add(rowId);
      }
    }
  }

  // 5) Map new-family rows to their created family_id.
  for (const [rowId, clusterKey] of Object.entries(plan.rowToCluster)) {
    const fid = clusterToFamilyId.get(clusterKey);
    if (fid) rowFamilyId.set(rowId, fid);
  }

  return { rowFamilyId, failedRowIds, failMessage };
}
```

- [ ] **Step 2: Wire two-phase create into `submitFromGate`**

In `admindash/frontend/src/pages/BulkAddStudentsPage.tsx`, update the orchestrator import:
```ts
import { extractStudentBatch, bulkCreateStudents, resolveRowFamilies } from '../api/bulkAddOrchestrators.ts';
```
Then in `submitFromGate` (starts ~line 210), insert family resolution right after `setPhase('submitting');` and the status update, BEFORE building payloads. Replace the section from `// Build payloads` down to the `.map((r) => { ... return { rowId: r.id, baseData, customFields }; })` assignment with:
```tsx
    const creatingRows = creating
      .map((id) => rows.find((r) => r.id === id))
      .filter((r): r is BulkRow => r != null);

    // Phase A: resolve/create families for these rows.
    const { rowFamilyId, failedRowIds, failMessage } = await resolveRowFamilies(tenant, creatingRows);
    if (failedRowIds.size > 0) {
      setRows((prev) =>
        prev.map((r) =>
          failedRowIds.has(r.id)
            ? { ...r, status: 'failed', error: { source: 'create', message: failMessage || 'Family creation failed' } }
            : r,
        ),
      );
    }

    // Build student payloads (skip rows whose family failed). Strip empty student_id.
    const baseFieldNames = new Set(modelDef!.base_fields.map((f) => f.name));
    const customFieldNames = new Set(modelDef!.custom_fields.map((f) => f.name));
    const payloads = creatingRows
      .filter((r) => !failedRowIds.has(r.id))
      .map((r) => {
        const baseData: Record<string, unknown> = {};
        const customFields: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(r.values)) {
          if (k === 'student_id') {
            if (mode === 'documents') continue;
            if (v == null || String(v).trim() === '') continue;
          }
          if (baseFieldNames.has(k)) baseData[k] = v;
          else if (customFieldNames.has(k)) customFields[k] = v;
        }
        const familyId = rowFamilyId.get(r.id);
        if (familyId) baseData.family_id = familyId;
        return { rowId: r.id, baseData, customFields };
      });
```
Leave the subsequent `await bulkCreateStudents({ ... })` and `setPhase('post_submit')` unchanged. (The old `creating.map(...).filter(...).map(...)` block is fully replaced by the above.)

- [ ] **Step 3: Type-check + lint + tests**

Run: `npm run build && npm run lint && npm run test`
Expected: all succeed.

- [ ] **Step 4: Commit**

```bash
git add admindash/frontend/src/api/bulkAddOrchestrators.ts admindash/frontend/src/pages/BulkAddStudentsPage.tsx
git commit -m "feat(admindash): two-phase family+student create in bulk submit"
```

---

### Task 5: CSV mapping — family target options

**Files:**
- Modify: `admindash/frontend/src/components/CsvMappingStep.tsx`

**Interfaces:**
- Consumes: `FAMILY_TARGETS` (Task 2). `applyMapping` (unchanged) already routes non-model targets into `row.values`, so mapping a column to `family_name`/`family_email`/`family_phone`/`family_address` makes those values available to `extractFamilyValues`.

- [ ] **Step 1: Read the component to find the target `<select>`**

Run: `sed -n '1,90p' admindash/frontend/src/components/CsvMappingStep.tsx`
Identify the `<select>` whose value is `mapping[i]` and the `<option>` list it renders (built from `modelDef.base_fields` + `custom_fields` + the `SKIP_FIELD` option).

- [ ] **Step 2: Add a Family option group**

Add the import at the top of `CsvMappingStep.tsx`:
```ts
import { FAMILY_TARGETS } from '../utils/familyBulk.ts';
import { useTranslation } from '../hooks/useTranslation.ts'; // if not already imported
```
Inside the target `<select>` (the one bound to `mapping[i]`), after the existing model-field `<option>`s, add a grouped list:
```tsx
              <optgroup label={t('bulkAdd.mapping.familyGroup')}>
                {FAMILY_TARGETS.map((f) => (
                  <option key={f.target} value={f.target}>{t(f.i18nKey)}</option>
                ))}
              </optgroup>
```
(If the existing options are not already wrapped in an `<optgroup>`, wrapping only the family ones in an `optgroup` is fine — plain `<option>`s and an `<optgroup>` can coexist in a `<select>`.)

- [ ] **Step 3: Add the i18n string**

In `admindash/frontend/src/i18n/translations.ts`, add to both locales:
```ts
    // en-US
    'bulkAdd.mapping.familyGroup': 'Family fields',
```
```ts
    // zh-CN
    'bulkAdd.mapping.familyGroup': '家庭字段',
```

- [ ] **Step 4: Type-check + lint**

Run: `npm run build && npm run lint`
Expected: both succeed.

- [ ] **Step 5: Manual QA**

Bulk Add → CSV → upload a CSV with a "Parent Email" / "Family Name" column → in mapping, those columns can now be mapped to the **Family fields** group. Apply → rows carry the family values (not shown as student columns).

- [ ] **Step 6: Commit**

```bash
git add admindash/frontend/src/components/CsvMappingStep.tsx admindash/frontend/src/i18n/translations.ts
git commit -m "feat(admindash): map CSV columns to family fields in bulk import"
```

---

### Task 6: Review-table family column + per-row family override

**Files:**
- Modify: `admindash/frontend/src/components/BulkReviewTable.tsx`
- Modify: `admindash/frontend/src/components/BulkRowDrawer.tsx`
- Modify: `admindash/frontend/src/i18n/translations.ts`

**Interfaces:**
- Consumes: `extractFamilyValues` (Task 2), `FAMILY_TARGET_NAMES` (Task 2), `FamilyPicker` (Part 1), `BulkRow.familyLink` (Task 1).
- Produces: `BulkRowDrawer` gains an `onSetRowFamily(rowId, selection)` prop; `BulkAddStudentsPage` handles it by writing `familyLink` (existing) or the four `family_*` values (new) onto the row.

- [ ] **Step 1: Read both components for their prop shapes**

Run:
```bash
sed -n '1,60p' admindash/frontend/src/components/BulkReviewTable.tsx
sed -n '1,80p' admindash/frontend/src/components/BulkRowDrawer.tsx
```
Note `BulkReviewTable`'s `Props` (it receives `rows`, `modelDef`, `onEditRow`, `onDeleteRow`, `onRetryExtract`) and how it renders each row's cells; note `BulkRowDrawer`'s `Props` and where the per-row form renders.

- [ ] **Step 2: Add a Family column to `BulkReviewTable`**

Add near the top of `BulkReviewTable.tsx`:
```ts
import { extractFamilyValues } from '../utils/familyBulk.ts';
```
Add a helper inside the component module (above the component or inline):
```tsx
function familyLabel(row: import('../types/bulkAdd.ts').BulkRow): string {
  if (row.familyLink) return row.familyLink.label;
  const fam = extractFamilyValues(row.values);
  return fam ? `+ ${fam.family_name || fam.primary_email || fam.primary_phone || 'new'}` : '—';
}
```
In the table header row, add a `<th>{t('bulkAdd.review.familyCol')}</th>` and in each body row add a matching `<td className="bulk-review__family">{familyLabel(row)}</td>` (place it adjacent to the source/name column to match the existing column order).

- [ ] **Step 3: Add family override to `BulkRowDrawer`**

Add imports:
```ts
import FamilyPicker from './FamilyPicker.tsx';
import type { FamilySelection } from '../types/models.ts';
import { extractFamilyValues } from '../utils/familyBulk.ts';
```
Extend the drawer `Props` interface with:
```ts
  tenant: string;
  onSetRowFamily: (rowId: string, selection: FamilySelection | null) => void;
```
Add it to the destructured params: `rows, activeRowIndex, modelDef, tenant, onSaveRow, onSetRowFamily, onClose, onNavigate`.
Compute the current selection for the active row and render the picker above the row's field form:
```tsx
  const activeRow = rows[activeRowIndex];
  const currentSelection: FamilySelection | null = activeRow.familyLink
    ? { mode: 'existing', familyId: activeRow.familyLink.familyId, label: activeRow.familyLink.label }
    : (() => {
        const fam = extractFamilyValues(activeRow.values);
        return fam ? { mode: 'new', data: fam } : null;
      })();
```
```tsx
      <FamilyPicker
        tenant={tenant}
        value={currentSelection}
        onChange={(sel) => onSetRowFamily(activeRow.id, sel)}
      />
```

- [ ] **Step 4: Handle `onSetRowFamily` + pass `tenant` in `BulkAddStudentsPage`**

In `admindash/frontend/src/pages/BulkAddStudentsPage.tsx`, add the family targets import:
```ts
import { FAMILY_TARGET_NAMES } from '../utils/familyBulk.ts';
```
Add a handler near `updateRow`:
```tsx
  const setRowFamily = (rowId: string, selection: import('../types/models.ts').FamilySelection | null) => {
    setRows((prev) => prev.map((r) => {
      if (r.id !== rowId) return r;
      const values = { ...r.values };
      // Clear any previous family_* values first.
      for (const k of FAMILY_TARGET_NAMES) delete values[k];
      if (!selection) return { ...r, values, familyLink: undefined };
      if (selection.mode === 'existing') {
        return { ...r, values, familyLink: { familyId: selection.familyId, label: selection.label } };
      }
      // new family — write family_* values, clear link
      values.family_name = selection.data.family_name ?? '';
      values.family_email = selection.data.primary_email ?? '';
      values.family_phone = selection.data.primary_phone ?? '';
      values.family_address = selection.data.primary_address ?? '';
      return { ...r, values, familyLink: undefined };
    }));
  };
```
Then pass `tenant` and `onSetRowFamily={setRowFamily}` to the `<BulkRowDrawer ... />` element (both occurrences if there is more than one; there is one, ~line 462).

- [ ] **Step 5: Add i18n string**

In `translations.ts`, add to both locales:
```ts
    // en-US
    'bulkAdd.review.familyCol': 'Family',
```
```ts
    // zh-CN
    'bulkAdd.review.familyCol': '家庭',
```

- [ ] **Step 6: Type-check + lint + tests**

Run: `npm run build && npm run lint && npm run test`
Expected: all succeed.

- [ ] **Step 7: Manual QA**

- **CSV siblings:** import a CSV where two rows share the same family email/name+address → review table shows the family per row; submit → exactly one new family created and both students linked (verify in Families tab detail).
- **CSV existing family:** map a family email that already exists → rows resolve to the existing family (no duplicate family created).
- **Documents mode:** upload two docs → open a row's drawer → use the FamilyPicker to link an existing family or create a new one → submit → student linked. Assign the same new family to two rows → confirm one family, two students.
- **Family create failure path:** (optional) simulate by using an invalid family field if the backend rejects it → those rows show `failed` and appear in the retry table; other rows still succeed.

- [ ] **Step 8: Commit**

```bash
git add admindash/frontend/src/components/BulkReviewTable.tsx admindash/frontend/src/components/BulkRowDrawer.tsx admindash/frontend/src/pages/BulkAddStudentsPage.tsx admindash/frontend/src/i18n/translations.ts
git commit -m "feat(admindash): family column + per-row family override in bulk review"
```

---

### Task 7: Draft-persistence check for family fields

**Files:**
- Verify only (no code change expected): `admindash/frontend/src/pages/BulkAddStudentsPage.tsx`, `admindash/frontend/src/db/bulkAddDrafts.ts`

**Interfaces:** none new.

- [ ] **Step 1: Confirm `familyLink` + family_* values persist**

Family values live in `BulkRow.values` and `BulkRow.familyLink`; both are part of the `BulkRow` objects already serialized into `BatchDraft.rows` (the save effect at `BulkAddStudentsPage.tsx:114-128` spreads each row and only strips `file`). Read `admindash/frontend/src/db/bulkAddDrafts.ts` to confirm it stores `draft.rows` verbatim (structured-clone into IndexedDB) with no field allow-list that would drop `familyLink`.

- [ ] **Step 2: Confirm resume keeps family data**

Read `rebuildRowsForCurrentModel` (`BulkAddStudentsPage.tsx:267-284`). It filters `values` to model field names — the family_* keys are NOT model fields, so they would be dropped on resume. Fix: preserve family target keys. Change the filter loop to also keep family keys:
```tsx
    const allFieldNames = new Set([
      ...def.base_fields.map((f) => f.name),
      ...def.custom_fields.map((f) => f.name),
      ...FAMILY_TARGET_NAMES,
    ]);
```
(`FAMILY_TARGET_NAMES` is already imported from Task 6 Step 4. `familyLink` is preserved because `rebuildRowsForCurrentModel` spreads `...r`.)

- [ ] **Step 3: Type-check + manual resume QA**

Run: `npm run build`
Then manually: start a CSV batch with family columns, reach review, reload the page, resume the draft → confirm the family column still shows values and submit still links families.

- [ ] **Step 4: Commit**

```bash
git add admindash/frontend/src/pages/BulkAddStudentsPage.tsx
git commit -m "fix(admindash): preserve family fields when resuming a bulk-add draft"
```

---

## Self-Review

**Spec coverage (Part 2 scope):**
- CSV family column mapping → Task 2 (targets) + Task 5 (UI). ✓
- Sibling grouping → Task 3 `planFamilies` (cluster by signature). ✓
- Auto-match to existing families → Task 4 `resolveRowFamilies` (searchFamilies + matchFamily). ✓
- Two-phase create (families then students) with group failure → Task 4. ✓
- Per-row manual family assignment (required for bulk-documents in Phase 1) → Task 6 (FamilyPicker in drawer). ✓
- Review-table family column → Task 6 Step 2. ✓
- Draft persistence of family data → Task 7. ✓
- (Deferred to Phase 2: auto-extraction/auto-grouping of family from *documents* — needs Papermite; here docs are assigned manually.)

**Placeholder scan:** No TBD/TODO. Pure-logic tasks (2, 3) carry full code + tests. Integration tasks (5, 6) instruct reading the specific component first, then give the exact code to insert — appropriate for editing large existing files, mirroring Part 1's Task 6/7 style.

**Type consistency:**
- `FamilyData` fields (`family_name`/`primary_email`/`primary_phone`/`primary_address`) are consistent across `extractFamilyValues` (Task 2), `planFamilies` (Task 3), `resolveRowFamilies` (Task 4), and `setRowFamily` (Task 6).
- `FamilySelection` (`mode`/`familyId`/`label`/`data`) consumed identically in Task 6's picker + handler as defined in Part 1 Task 2.
- `resolveRowFamilies` returns `{ rowFamilyId: Map, failedRowIds: Set, failMessage: string }`, consumed exactly in Task 4 Step 2.
- Family CSV target names (`family_name`/`family_email`/`family_phone`/`family_address`) are the single source used in Task 2, Task 5 options, Task 6 `setRowFamily`, and Task 7 resume filter.

**Verification-during-execution spots:** Task 5 Step 1 and Task 6 Step 1 (read the real component before inserting) — both include explicit "adapt to actual prop/markup" guidance.
