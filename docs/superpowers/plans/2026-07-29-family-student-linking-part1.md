# Family ↔ Student Linking — Part 1 (Foundation + Single-Record + Families Tab) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let staff link a student to an existing family or create a new family inline while adding a student (web-form and single-document flows), and add a Families tab (mirroring the Students page) that lists families and their linked students.

**Architecture:** Three reusable pieces — a pure `familyMatch` util (Vitest-tested), family API helpers over the existing `/api/query` + `/api/entities` proxies (no new backend routes), and a `FamilyPicker` component — power the `AddStudentModal` integration and a new `FamiliesPage`. Family is created before the student so the student can carry a scalar `family_id`.

**Tech Stack:** React 19 + TypeScript 5.9 + Vite 8, native Fetch (no axios), CSS variables (no CSS-in-JS), custom i18n hook (en-US + zh-CN), Vitest 3 (added here) for pure logic.

## Global Constraints

- **`family_id` is a scalar string** (the family's `entity_id`) on a student — one family per student. Never an array.
- **Family base fields:** `family_name` (required), `primary_email`, `primary_phone`, `primary_address`. Reuse these exact names (they match `leads.py` lead→family conversion).
- **No new backend endpoints.** Family create/read go through existing `createEntity` (`POST /api/entities/{tenant}/family`) and `postQuery` (`POST /api/query`, table `entities`).
- **Escape single quotes** in any user-supplied value interpolated into SQL: `value.replace(/'/g, "''")`.
- **i18n:** every user-facing string added to both `en-US` and `zh-CN` in `src/i18n/translations.ts`; access via `useTranslation().t('key')`.
- **No axios.** Use `fetch` via helpers in `src/api/client.ts`.
- Frontend commands run from `admindash/frontend`. Type-check/build: `npm run build`. Lint: `npm run lint`. Tests: `npm run test`.
- Work on branch `feat/family-student-linking` (already created). Use SSH remotes.

---

### Task 1: Add Vitest to the frontend

**Files:**
- Modify: `admindash/frontend/package.json`
- Create: `admindash/frontend/vitest.config.ts`
- Create: `admindash/frontend/src/utils/__tests__/smoke.test.ts`

**Interfaces:**
- Produces: `npm run test` runs Vitest in run-once mode over `src/**/*.test.ts`.

- [ ] **Step 1: Install Vitest**

Run from `admindash/frontend`:
```bash
npm install -D vitest@^3.2.4
```
Expected: `vitest` added under devDependencies; no peer-dep errors (Vite 8 is compatible).

- [ ] **Step 2: Add test scripts to package.json**

In `admindash/frontend/package.json`, change the `scripts` block to:
```json
  "scripts": {
    "dev": "vite",
    "build": "tsc -b && vite build",
    "lint": "eslint .",
    "preview": "vite preview",
    "test": "vitest run",
    "test:watch": "vitest"
  },
```

- [ ] **Step 3: Create the Vitest config**

Create `admindash/frontend/vitest.config.ts`:
```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
```

- [ ] **Step 4: Write a smoke test**

Create `admindash/frontend/src/utils/__tests__/smoke.test.ts`:
```ts
import { describe, it, expect } from 'vitest';

describe('vitest wiring', () => {
  it('runs', () => {
    expect(1 + 1).toBe(2);
  });
});
```

- [ ] **Step 5: Run the test**

Run: `npm run test`
Expected: 1 passed. Also run `npm run build` — expected: succeeds (tsconfig should not choke; if `tsc -b` complains about test files, that's fine only if it fails — it should pass because `.test.ts` are included in the app tsconfig glob and Vitest globals aren't used as ambient here).

- [ ] **Step 6: Commit**

```bash
git add admindash/frontend/package.json admindash/frontend/package-lock.json admindash/frontend/vitest.config.ts admindash/frontend/src/utils/__tests__/smoke.test.ts
git commit -m "chore(admindash): add Vitest for frontend unit tests"
```

---

### Task 2: Family + student types

**Files:**
- Modify: `admindash/frontend/src/types/models.ts`

**Interfaces:**
- Produces:
  - `Student.family_id?: string` added to existing `Student` interface.
  - `interface Family { entity_id: string; family_name: string; primary_email?: string; primary_phone?: string; primary_address?: string; student_count?: number; custom_fields?: Record<string, unknown>; [key: string]: unknown; }`
  - `interface FamilyData { family_name: string; primary_email?: string; primary_phone?: string; primary_address?: string; }`
  - `type FamilySelection = { mode: 'existing'; familyId: string; label: string } | { mode: 'new'; data: FamilyData }`

- [ ] **Step 1: Add `family_id` to `Student`**

In `admindash/frontend/src/types/models.ts`, inside `export interface Student { ... }` (after `preferred_name?: string;`), add:
```ts
  family_id?: string;
```

- [ ] **Step 2: Add family types**

Append to `admindash/frontend/src/types/models.ts`:
```ts
export interface Family {
  entity_id: string;
  family_name: string;
  primary_email?: string;
  primary_phone?: string;
  primary_address?: string;
  student_count?: number;
  custom_fields?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface FamilyData {
  family_name: string;
  primary_email?: string;
  primary_phone?: string;
  primary_address?: string;
}

export type FamilySelection =
  | { mode: 'existing'; familyId: string; label: string }
  | { mode: 'new'; data: FamilyData };
```

- [ ] **Step 3: Type-check**

Run: `npm run build`
Expected: succeeds (no usages yet).

- [ ] **Step 4: Commit**

```bash
git add admindash/frontend/src/types/models.ts
git commit -m "feat(admindash): add Family/FamilyData/FamilySelection types + Student.family_id"
```

---

### Task 3: `familyMatch` pure util (TDD)

**Files:**
- Create: `admindash/frontend/src/utils/familyMatch.ts`
- Create: `admindash/frontend/src/utils/__tests__/familyMatch.test.ts`

**Interfaces:**
- Consumes: `FamilyData` (Task 2) shape for inputs (structurally — takes a fields record).
- Produces:
  - `interface FamilySignature { email: string; phone: string; name: string; address: string }`
  - `normalizeSignature(fields: Record<string, unknown>): FamilySignature`
  - `signatureKey(sig: FamilySignature): string` — `''` when no identifying info.
  - `matchFamily(sig: FamilySignature, candidates: Array<{ entity_id: string } & Record<string, unknown>>): string | null`
  - `clusterSiblings(sigs: FamilySignature[]): number[]` — cluster id per input index; `-1` for rows with no family info.

- [ ] **Step 1: Write the failing tests**

Create `admindash/frontend/src/utils/__tests__/familyMatch.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import {
  normalizeSignature,
  signatureKey,
  matchFamily,
  clusterSiblings,
} from '../familyMatch.ts';

describe('normalizeSignature', () => {
  it('lowercases/trims email, strips non-digits from phone, collapses name/address', () => {
    const sig = normalizeSignature({
      primary_email: '  Nguyen@Example.COM ',
      primary_phone: '(415) 555-0100',
      family_name: '  Nguyen   Family ',
      primary_address: '12  Main St. ',
    });
    expect(sig.email).toBe('nguyen@example.com');
    expect(sig.phone).toBe('4155550100');
    expect(sig.name).toBe('nguyen family');
    expect(sig.address).toBe('12 main st.');
  });

  it('yields empty strings for missing fields', () => {
    expect(normalizeSignature({})).toEqual({ email: '', phone: '', name: '', address: '' });
  });
});

describe('signatureKey', () => {
  it('prefers email, then phone, then name+address', () => {
    expect(signatureKey({ email: 'a@b.com', phone: '123', name: 'x', address: 'y' })).toBe('e:a@b.com');
    expect(signatureKey({ email: '', phone: '4155550100', name: 'x', address: 'y' })).toBe('p:4155550100');
    expect(signatureKey({ email: '', phone: '', name: 'nguyen', address: '12 main' })).toBe('na:nguyen|12 main');
  });

  it('is empty when nothing identifies the family', () => {
    expect(signatureKey({ email: '', phone: '', name: 'nguyen', address: '' })).toBe('');
    expect(signatureKey({ email: '', phone: '', name: '', address: '' })).toBe('');
  });
});

describe('matchFamily', () => {
  const candidates = [
    { entity_id: 'fam-email', primary_email: 'match@x.com' },
    { entity_id: 'fam-phone', primary_phone: '415-555-0100' },
    { entity_id: 'fam-na', family_name: 'Nguyen', primary_address: '12 Main St' },
  ];

  it('matches on email first', () => {
    const sig = normalizeSignature({ primary_email: 'MATCH@x.com', primary_phone: '415-555-0100' });
    expect(matchFamily(sig, candidates)).toBe('fam-email');
  });

  it('falls back to phone', () => {
    const sig = normalizeSignature({ primary_phone: '(415) 555-0100' });
    expect(matchFamily(sig, candidates)).toBe('fam-phone');
  });

  it('falls back to name+address', () => {
    const sig = normalizeSignature({ family_name: 'nguyen', primary_address: '12 main st' });
    expect(matchFamily(sig, candidates)).toBe('fam-na');
  });

  it('returns null when nothing matches', () => {
    const sig = normalizeSignature({ primary_email: 'nobody@x.com' });
    expect(matchFamily(sig, candidates)).toBeNull();
  });

  it('returns null for an empty signature', () => {
    expect(matchFamily(normalizeSignature({}), candidates)).toBeNull();
  });
});

describe('clusterSiblings', () => {
  it('groups rows with the same key and marks family-less rows as -1', () => {
    const sigs = [
      normalizeSignature({ family_name: 'Nguyen', primary_address: '12 Main' }),
      normalizeSignature({ family_name: 'nguyen', primary_address: '12 main' }),
      normalizeSignature({ primary_email: 'lee@x.com' }),
      normalizeSignature({}),
    ];
    const clusters = clusterSiblings(sigs);
    expect(clusters[0]).toBe(clusters[1]); // siblings share a cluster
    expect(clusters[0]).not.toBe(clusters[2]);
    expect(clusters[3]).toBe(-1); // no family info
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test`
Expected: FAIL — `Cannot find module '../familyMatch.ts'`.

- [ ] **Step 3: Implement the util**

Create `admindash/frontend/src/utils/familyMatch.ts`:
```ts
export interface FamilySignature {
  email: string;
  phone: string;
  name: string;
  address: string;
}

function text(v: unknown): string {
  return String(v ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function digits(v: unknown): string {
  return String(v ?? '').replace(/\D/g, '');
}

export function normalizeSignature(fields: Record<string, unknown>): FamilySignature {
  return {
    email: text(fields.primary_email),
    phone: digits(fields.primary_phone),
    name: text(fields.family_name),
    address: text(fields.primary_address),
  };
}

export function signatureKey(sig: FamilySignature): string {
  if (sig.email) return `e:${sig.email}`;
  if (sig.phone) return `p:${sig.phone}`;
  if (sig.name && sig.address) return `na:${sig.name}|${sig.address}`;
  return '';
}

export function matchFamily(
  sig: FamilySignature,
  candidates: Array<{ entity_id: string } & Record<string, unknown>>,
): string | null {
  const key = signatureKey(sig);
  if (!key) return null;
  for (const c of candidates) {
    if (signatureKey(normalizeSignature(c)) === key) return c.entity_id;
  }
  return null;
}

export function clusterSiblings(sigs: FamilySignature[]): number[] {
  const keyToCluster = new Map<string, number>();
  let next = 0;
  return sigs.map((sig) => {
    const key = signatureKey(sig);
    if (!key) return -1;
    if (!keyToCluster.has(key)) keyToCluster.set(key, next++);
    return keyToCluster.get(key)!;
  });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test`
Expected: all pass (smoke + familyMatch).

- [ ] **Step 5: Commit**

```bash
git add admindash/frontend/src/utils/familyMatch.ts admindash/frontend/src/utils/__tests__/familyMatch.test.ts
git commit -m "feat(admindash): add pure family matching/clustering util with tests"
```

---

### Task 4: Family API helpers (TDD with mocked fetch)

**Files:**
- Modify: `admindash/frontend/src/api/client.ts`
- Create: `admindash/frontend/src/api/__tests__/familyApi.test.ts`

**Interfaces:**
- Consumes: existing `postQuery`, `createEntity`, `authHeaders` in `client.ts`; `Family`, `FamilyData`, `CreateEntityResponse` types.
- Produces (exports in `client.ts`):
  - `searchFamilies(tenantId: string, query: string): Promise<Family[]>`
  - `getFamilyById(tenantId: string, familyId: string): Promise<Family | null>`
  - `getStudentsByFamily(tenantId: string, familyId: string): Promise<Record<string, unknown>[]>`
  - `createFamily(tenantId: string, data: FamilyData): Promise<CreateEntityResponse>`
  - `escapeSql(value: string): string` (exported helper)

- [ ] **Step 1: Write the failing tests**

Create `admindash/frontend/src/api/__tests__/familyApi.test.ts`:
```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { escapeSql, searchFamilies, getStudentsByFamily, createFamily } from '../client.ts';

const fetchMock = vi.fn();

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
  vi.stubGlobal('localStorage', { getItem: () => 'tok' });
  fetchMock.mockReset();
});
afterEach(() => vi.unstubAllGlobals());

function ok(body: unknown) {
  return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) });
}

describe('escapeSql', () => {
  it("doubles single quotes", () => {
    expect(escapeSql("O'Brien")).toBe("O''Brien");
  });
});

describe('searchFamilies', () => {
  it('queries the family entity and escapes the search term', async () => {
    fetchMock.mockReturnValue(ok({ data: [{ entity_id: 'f1', family_name: "O'Brien" }], total: 1 }));
    const res = await searchFamilies('t1', "O'Brien");
    expect(res).toHaveLength(1);
    expect(res[0].entity_id).toBe('f1');
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.table).toBe('entities');
    expect(body.sql).toContain("entity_type = 'family'");
    expect(body.sql).toContain("O''Brien"); // escaped
  });
});

describe('getStudentsByFamily', () => {
  it('filters students by family_id', async () => {
    fetchMock.mockReturnValue(ok({ data: [{ entity_id: 's1' }], total: 1 }));
    const res = await getStudentsByFamily('t1', 'fam-9');
    expect(res).toHaveLength(1);
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.sql).toContain("entity_type = 'student'");
    expect(body.sql).toContain("family_id = 'fam-9'");
  });
});

describe('createFamily', () => {
  it('POSTs to the family entity endpoint with base_data', async () => {
    fetchMock.mockReturnValue(ok({ entity_id: 'fam-new' }));
    const res = await createFamily('t1', { family_name: 'Nguyen', primary_email: 'a@b.com' });
    expect(res.entity_id).toBe('fam-new');
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toContain('/api/entities/t1/family');
    const body = JSON.parse(init.body);
    expect(body.base_data.family_name).toBe('Nguyen');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test`
Expected: FAIL — `escapeSql`/`searchFamilies` not exported.

- [ ] **Step 3: Implement the helpers**

In `admindash/frontend/src/api/client.ts`: add `Family`, `FamilyData` to the type import at the top:
```ts
import type {
  CreateEntityResponse,
  ExtractResponse,
  NextIdResponse,
  DuplicateCheckRequest,
  DuplicateCheckResponse,
  Lead,
  LeadActivity,
  LeadModelField,
  Family,
  FamilyData,
} from '../types/models.ts';
```
Then append at the end of the file:
```ts
/** Double single quotes so a value is safe to interpolate into a SQL literal. */
export function escapeSql(value: string): string {
  return value.replace(/'/g, "''");
}

export async function searchFamilies(tenantId: string, query: string): Promise<Family[]> {
  const q = escapeSql(query.trim().toLowerCase());
  const where = q
    ? ` AND (LOWER(family_name) LIKE '%${q}%' OR LOWER(primary_email) LIKE '%${q}%' OR primary_phone LIKE '%${q}%')`
    : '';
  const sql =
    `SELECT * FROM data WHERE entity_type = 'family' AND _status = 'active'${where} LIMIT 20`;
  const res = await postQuery(tenantId, 'entities', sql);
  return res.data as unknown as Family[];
}

export async function getFamilyById(tenantId: string, familyId: string): Promise<Family | null> {
  const sql =
    `SELECT * FROM data WHERE entity_type = 'family' AND _status = 'active' AND entity_id = '${escapeSql(familyId)}'`;
  const res = await postQuery(tenantId, 'entities', sql);
  return (res.data[0] as unknown as Family) ?? null;
}

export async function getStudentsByFamily(
  tenantId: string,
  familyId: string,
): Promise<Record<string, unknown>[]> {
  const sql =
    `SELECT * FROM data WHERE entity_type = 'student' AND _status = 'active' AND family_id = '${escapeSql(familyId)}'`;
  const res = await postQuery(tenantId, 'entities', sql);
  return res.data;
}

export async function createFamily(
  tenantId: string,
  data: FamilyData,
): Promise<CreateEntityResponse> {
  return createEntity(tenantId, 'family', data as Record<string, unknown>, {});
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test`
Expected: all pass.

- [ ] **Step 5: Type-check**

Run: `npm run build`
Expected: succeeds.

- [ ] **Step 6: Commit**

```bash
git add admindash/frontend/src/api/client.ts admindash/frontend/src/api/__tests__/familyApi.test.ts
git commit -m "feat(admindash): add family API helpers (search/get/students/create) with tests"
```

---

### Task 5: `FamilyPicker` component

**Files:**
- Create: `admindash/frontend/src/components/FamilyPicker.tsx`
- Create: `admindash/frontend/src/components/FamilyPicker.css`
- Modify: `admindash/frontend/src/i18n/translations.ts`

**Interfaces:**
- Consumes: `searchFamilies` (Task 4); `FamilySelection`, `FamilyData`, `Family` (Task 2).
- Produces: default export `FamilyPicker` with props:
  ```ts
  interface FamilyPickerProps {
    tenant: string;
    value: FamilySelection | null;
    onChange: (v: FamilySelection | null) => void;
  }
  ```

- [ ] **Step 1: Add i18n strings**

In `admindash/frontend/src/i18n/translations.ts`, add these keys to BOTH the `en-US` and `zh-CN` objects (place near other form keys). en-US values:
```ts
    'familyPicker.label': 'Family',
    'familyPicker.searchPlaceholder': 'Search existing family by name, email, or phone…',
    'familyPicker.noResults': 'No matching family',
    'familyPicker.createNew': '+ Create new family',
    'familyPicker.newFamilyName': 'Family name',
    'familyPicker.newEmail': 'Primary email',
    'familyPicker.newPhone': 'Primary phone',
    'familyPicker.newAddress': 'Primary address',
    'familyPicker.selected': 'Linked family',
    'familyPicker.clear': 'Change',
    'familyPicker.creatingNew': 'New family',
    'familyPicker.studentsCount': '{n} students',
```
zh-CN values:
```ts
    'familyPicker.label': '家庭',
    'familyPicker.searchPlaceholder': '按姓名、邮箱或电话搜索现有家庭…',
    'familyPicker.noResults': '没有匹配的家庭',
    'familyPicker.createNew': '+ 新建家庭',
    'familyPicker.newFamilyName': '家庭名称',
    'familyPicker.newEmail': '主要邮箱',
    'familyPicker.newPhone': '主要电话',
    'familyPicker.newAddress': '主要地址',
    'familyPicker.selected': '关联家庭',
    'familyPicker.clear': '更改',
    'familyPicker.creatingNew': '新家庭',
    'familyPicker.studentsCount': '{n} 名学生',
```
Note: if `t()` does not support interpolation, render the count inline in JSX (Step 2 avoids relying on `{n}`).

- [ ] **Step 2: Implement the component**

Create `admindash/frontend/src/components/FamilyPicker.tsx`:
```tsx
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from '../hooks/useTranslation.ts';
import { searchFamilies } from '../api/client.ts';
import type { Family, FamilyData, FamilySelection } from '../types/models.ts';
import './FamilyPicker.css';

interface FamilyPickerProps {
  tenant: string;
  value: FamilySelection | null;
  onChange: (v: FamilySelection | null) => void;
}

export default function FamilyPicker({ tenant, value, onChange }: FamilyPickerProps) {
  const { t } = useTranslation();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Family[]>([]);
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState<FamilyData>({ family_name: '' });
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!query.trim()) { setResults([]); return; }
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      searchFamilies(tenant, query).then(setResults).catch(() => setResults([]));
    }, 250);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [query, tenant]);

  // Keep the new-family draft in sync with the parent selection.
  useEffect(() => {
    if (value?.mode === 'new') { setCreating(true); setDraft(value.data); }
  }, [value]);

  function pickExisting(fam: Family) {
    onChange({ mode: 'existing', familyId: fam.entity_id, label: fam.family_name });
    setOpen(false);
    setQuery('');
  }

  function startCreate() {
    setCreating(true);
    const seed: FamilyData = { family_name: query.trim() };
    setDraft(seed);
    onChange({ mode: 'new', data: seed });
    setOpen(false);
  }

  function updateDraft(patch: Partial<FamilyData>) {
    const next = { ...draft, ...patch };
    setDraft(next);
    onChange({ mode: 'new', data: next });
  }

  function clear() {
    onChange(null);
    setCreating(false);
    setDraft({ family_name: '' });
    setQuery('');
  }

  // Selected existing family — show a chip.
  if (value?.mode === 'existing') {
    return (
      <div className="family-picker">
        <label className="family-picker-label">{t('familyPicker.label')}</label>
        <div className="family-picker-chip">
          <span>{value.label}</span>
          <button type="button" onClick={clear}>{t('familyPicker.clear')}</button>
        </div>
      </div>
    );
  }

  // Creating a new family — inline mini-form.
  if (creating) {
    return (
      <div className="family-picker">
        <label className="family-picker-label">
          {t('familyPicker.label')} · {t('familyPicker.creatingNew')}
          <button type="button" className="family-picker-link" onClick={clear}>{t('familyPicker.clear')}</button>
        </label>
        <div className="family-picker-newform">
          <input
            type="text" placeholder={t('familyPicker.newFamilyName')}
            value={draft.family_name}
            onChange={(e) => updateDraft({ family_name: e.target.value })}
          />
          <input
            type="email" placeholder={t('familyPicker.newEmail')}
            value={draft.primary_email ?? ''}
            onChange={(e) => updateDraft({ primary_email: e.target.value })}
          />
          <input
            type="tel" placeholder={t('familyPicker.newPhone')}
            value={draft.primary_phone ?? ''}
            onChange={(e) => updateDraft({ primary_phone: e.target.value })}
          />
          <input
            type="text" placeholder={t('familyPicker.newAddress')}
            value={draft.primary_address ?? ''}
            onChange={(e) => updateDraft({ primary_address: e.target.value })}
          />
        </div>
      </div>
    );
  }

  // Default — search combobox.
  return (
    <div className="family-picker">
      <label className="family-picker-label">{t('familyPicker.label')}</label>
      <input
        type="text"
        className="family-picker-search"
        placeholder={t('familyPicker.searchPlaceholder')}
        value={query}
        onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
      />
      {open && query.trim() && (
        <ul className="family-picker-results">
          {results.map((fam) => (
            <li key={fam.entity_id}>
              <button type="button" onClick={() => pickExisting(fam)}>
                <strong>{fam.family_name}</strong>
                {fam.primary_email ? <span> · {fam.primary_email}</span> : null}
              </button>
            </li>
          ))}
          {results.length === 0 && (
            <li className="family-picker-empty">{t('familyPicker.noResults')}</li>
          )}
          <li className="family-picker-create">
            <button type="button" onClick={startCreate}>{t('familyPicker.createNew')}</button>
          </li>
        </ul>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Add styles**

Create `admindash/frontend/src/components/FamilyPicker.css`:
```css
.family-picker { display: flex; flex-direction: column; gap: 4px; margin-bottom: 12px; }
.family-picker-label { font-size: 13px; font-weight: 600; color: var(--color-text, #333); display: flex; gap: 8px; align-items: center; }
.family-picker-link { background: none; border: none; color: var(--color-primary, #378ADD); cursor: pointer; font-size: 12px; }
.family-picker-search { padding: 8px; border: 1px solid var(--color-border, #ccc); border-radius: 6px; }
.family-picker-results { list-style: none; margin: 2px 0 0; padding: 4px; border: 1px solid var(--color-border, #ccc); border-radius: 6px; background: #fff; max-height: 220px; overflow-y: auto; }
.family-picker-results li button { width: 100%; text-align: left; background: none; border: none; padding: 8px; cursor: pointer; border-radius: 4px; }
.family-picker-results li button:hover { background: var(--color-hover, #f2f7fc); }
.family-picker-empty { padding: 8px; color: #888; font-size: 13px; }
.family-picker-create { border-top: 1px solid var(--color-border, #eee); margin-top: 4px; }
.family-picker-create button { color: var(--color-primary, #378ADD); font-weight: 600; }
.family-picker-chip { display: inline-flex; align-items: center; gap: 10px; padding: 6px 10px; background: var(--color-hover, #f2f7fc); border-radius: 6px; width: fit-content; }
.family-picker-chip button { background: none; border: none; color: var(--color-primary, #378ADD); cursor: pointer; font-size: 12px; }
.family-picker-newform { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
.family-picker-newform input { padding: 8px; border: 1px solid var(--color-border, #ccc); border-radius: 6px; }
```

- [ ] **Step 4: Type-check + lint**

Run: `npm run build && npm run lint`
Expected: both succeed. (If `t('familyPicker.studentsCount')` interpolation is unused here, that's fine — it's used in Task 7.)

- [ ] **Step 5: Commit**

```bash
git add admindash/frontend/src/components/FamilyPicker.tsx admindash/frontend/src/components/FamilyPicker.css admindash/frontend/src/i18n/translations.ts
git commit -m "feat(admindash): add FamilyPicker (search existing / create new inline)"
```

---

### Task 6: Integrate `FamilyPicker` into `AddStudentModal`

**Files:**
- Modify: `admindash/frontend/src/components/AddStudentModal.tsx`

**Interfaces:**
- Consumes: `FamilyPicker` (Task 5), `createFamily` (Task 4), `FamilySelection` (Task 2).
- Produces: `AddStudentModal` gains optional prop `presetFamilyId?: string` and `presetFamilyLabel?: string`; on submit it resolves `family_id` (creating a new family first if needed) and includes it in the student's `base_data`. The `family_id` model field, if present, is hidden from the `DynamicForm` (the picker owns it).

- [ ] **Step 1: Extend props + imports**

In `admindash/frontend/src/components/AddStudentModal.tsx`, update imports and the props interface:
```tsx
import FamilyPicker from './FamilyPicker.tsx';
import { createFamily } from '../api/client.ts';
import type { ModelDefinition, DuplicateMatch, FamilySelection } from '../types/models.ts';
```
```tsx
interface AddStudentModalProps {
  tenant: string;
  onClose: () => void;
  onSuccess: (entityId: string) => void;
  presetFamilyId?: string;
  presetFamilyLabel?: string;
}
```
And the signature:
```tsx
export default function AddStudentModal({ tenant, onClose, onSuccess, presetFamilyId, presetFamilyLabel }: AddStudentModalProps) {
```

- [ ] **Step 2: Add family selection state, seeded from preset**

After the `successMessage` state declaration (around line 35), add:
```tsx
  const [familySelection, setFamilySelection] = useState<FamilySelection | null>(
    presetFamilyId
      ? { mode: 'existing', familyId: presetFamilyId, label: presetFamilyLabel ?? presetFamilyId }
      : null,
  );
```

- [ ] **Step 3: Hide the raw `family_id` field from the form**

Replace the `initialValues` block (lines ~151-154) and add a derived model that strips `family_id`. Insert before `initialValues`:
```tsx
  const formModelDef = useMemo<ModelDefinition | null>(() => {
    if (!modelDef) return null;
    return {
      ...modelDef,
      base_fields: modelDef.base_fields.filter((f) => f.name !== 'family_id'),
    };
  }, [modelDef]);
```
Keep `initialValues` as-is.

- [ ] **Step 4: Resolve family on create**

Replace the body of `doCreateStudent` (lines ~81-99) so it resolves `family_id` before creating the student:
```tsx
  const doCreateStudent = useCallback(async (
    baseData: Record<string, unknown>,
    customFields: Record<string, unknown>,
  ) => {
    setSubmitting(true);
    setSubmitError(null);
    try {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { student_id, ...submitData } = baseData;

      // Resolve family: create it first if the user chose "new".
      if (familySelection?.mode === 'existing') {
        submitData.family_id = familySelection.familyId;
      } else if (familySelection?.mode === 'new') {
        const fam = await createFamily(tenant, familySelection.data);
        submitData.family_id = fam.entity_id;
      }

      const result = await createEntity(tenant, 'student', submitData, customFields);
      invalidateStudentCount();
      setSuccessMessage(t('addStudent.success'));
      setTimeout(() => onSuccess(result.entity_id), 1200);
    } catch (e) {
      setSubmitError(e instanceof Error ? e.message : t('addStudent.submitError'));
    } finally {
      setSubmitting(false);
    }
  }, [tenant, invalidateStudentCount, onSuccess, t, familySelection]);
```

- [ ] **Step 5: Render the picker above the form; use the stripped model**

In the `activeTab === 'form' && modelDef` block (lines ~207-218), render the picker and switch to `formModelDef`:
```tsx
              {activeTab === 'form' && formModelDef && (
                <>
                  <FamilyPicker tenant={tenant} value={familySelection} onChange={setFamilySelection} />
                  <DynamicForm
                    modelDefinition={formModelDef}
                    initialValues={initialValues}
                    readOnlyFields={readOnlyFields}
                    onSubmit={handleSubmit}
                    onCancel={onClose}
                    submitting={submitting}
                    error={submitError}
                    submitButtonText={submitButtonText}
                  />
                </>
              )}
```

- [ ] **Step 6: Type-check + lint**

Run: `npm run build && npm run lint`
Expected: both succeed.

- [ ] **Step 7: Manual QA**

Start backend + frontend (`./start-services.sh` from repo root, or per-service dev commands). In the app: Students → Add Student.
- Verify: (a) search an existing family → chip appears; save → new student's `family_id` set (confirm by editing the student / querying). (b) "Create new family", fill name+email, save a student → a family row is created and linked. (c) Upload Document tab → extract → land on Web Form → family picker present and usable. (d) `family_id` no longer appears as a raw text field in the form.

- [ ] **Step 8: Commit**

```bash
git add admindash/frontend/src/components/AddStudentModal.tsx
git commit -m "feat(admindash): link/create family from Add Student (web-form + single-doc)"
```

---

### Task 7: Families tab (page, add-family modal, linked students, nav)

**Files:**
- Create: `admindash/frontend/src/pages/FamiliesPage.tsx`
- Create: `admindash/frontend/src/pages/FamiliesPage.css`
- Create: `admindash/frontend/src/components/AddFamilyModal.tsx`
- Modify: `admindash/frontend/src/components/Navbar.tsx`
- Modify: `admindash/frontend/src/App.tsx`
- Modify: `admindash/frontend/src/i18n/translations.ts`

**Interfaces:**
- Consumes: `postQuery`, `getStudentsByFamily`, `getFamilyById` (Task 4); `useModel().getModel`; `DynamicForm`; `DataTable`; `AddStudentModal` with `presetFamilyId`/`presetFamilyLabel` (Task 6); `Family` type.
- Produces: route `/families` → `FamiliesPage`; nav item `Families`.

- [ ] **Step 1: Add i18n strings**

In `admindash/frontend/src/i18n/translations.ts`, add to BOTH locales. en-US:
```ts
    'nav.family': 'Families',
    'families.title': 'Families',
    'families.search': 'Search families…',
    'families.addFamily': 'Add Family',
    'families.colName': 'Family',
    'families.colEmail': 'Primary Email',
    'families.colPhone': 'Primary Phone',
    'families.colStudents': 'Students',
    'families.empty': 'No families yet',
    'families.detailStudents': 'Students in this family',
    'families.addStudentToFamily': '+ Add student to this family',
    'families.noStudents': 'No students linked yet',
    'families.close': 'Close',
    'addFamily.title': 'Add Family',
    'addFamily.success': 'Family created',
    'addFamily.error': 'Could not create family',
```
zh-CN:
```ts
    'nav.family': '家庭',
    'families.title': '家庭',
    'families.search': '搜索家庭…',
    'families.addFamily': '添加家庭',
    'families.colName': '家庭',
    'families.colEmail': '主要邮箱',
    'families.colPhone': '主要电话',
    'families.colStudents': '学生',
    'families.empty': '暂无家庭',
    'families.detailStudents': '该家庭的学生',
    'families.addStudentToFamily': '+ 添加学生到该家庭',
    'families.noStudents': '暂无关联学生',
    'families.close': '关闭',
    'addFamily.title': '添加家庭',
    'addFamily.success': '家庭已创建',
    'addFamily.error': '无法创建家庭',
```

- [ ] **Step 2: Create `AddFamilyModal` (model-driven, mirrors AddStudentModal web-form path)**

Create `admindash/frontend/src/components/AddFamilyModal.tsx`:
```tsx
import { useEffect, useState } from 'react';
import { useTranslation } from '../hooks/useTranslation.ts';
import { useModel } from '../contexts/ModelContext.tsx';
import { createEntity } from '../api/client.ts';
import DynamicForm from './DynamicForm.tsx';
import type { ModelDefinition } from '../types/models.ts';
import './AddStudentModal.css';

interface AddFamilyModalProps {
  tenant: string;
  onClose: () => void;
  onSuccess: (entityId: string) => void;
}

// Fallback model if no `family` model is registered for the tenant.
const FALLBACK_FAMILY_MODEL: ModelDefinition = {
  base_fields: [
    { name: 'family_name', type: 'str', required: true },
    { name: 'primary_email', type: 'email', required: false },
    { name: 'primary_phone', type: 'phone', required: false },
    { name: 'primary_address', type: 'str', required: false },
  ],
  custom_fields: [],
};

export default function AddFamilyModal({ tenant, onClose, onSuccess }: AddFamilyModalProps) {
  const { t } = useTranslation();
  const { getModel } = useModel();
  const [modelDef, setModelDef] = useState<ModelDefinition | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    getModel(tenant, 'family')
      .then(setModelDef)
      .catch(() => setModelDef(FALLBACK_FAMILY_MODEL))
      .finally(() => setLoading(false));
  }, [tenant, getModel]);

  async function handleSubmit(baseData: Record<string, unknown>, customFields: Record<string, unknown>) {
    setSubmitting(true);
    setError(null);
    try {
      const result = await createEntity(tenant, 'family', baseData, customFields);
      setSuccess(t('addFamily.success'));
      setTimeout(() => onSuccess(result.entity_id), 900);
    } catch (e) {
      setError(e instanceof Error ? e.message : t('addFamily.error'));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="students-confirm-overlay">
      <div className="add-modal" onClick={(e) => e.stopPropagation()}>
        <div className="add-modal-header"><h3>{t('addFamily.title')}</h3></div>
        <div className="add-modal-body">
          {success && <div className="add-modal-success">{success}</div>}
          {loading ? (
            <p>{t('common.loading')}</p>
          ) : modelDef ? (
            <DynamicForm
              modelDefinition={modelDef}
              onSubmit={handleSubmit}
              onCancel={onClose}
              submitting={submitting}
              error={error}
            />
          ) : null}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Create `FamiliesPage`**

Create `admindash/frontend/src/pages/FamiliesPage.tsx`:
```tsx
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from '../hooks/useTranslation.ts';
import { postQuery, getStudentsByFamily } from '../api/client.ts';
import DataTable, { type Column } from '../components/DataTable.tsx';
import AddFamilyModal from '../components/AddFamilyModal.tsx';
import AddStudentModal from '../components/AddStudentModal.tsx';
import type { Family } from '../types/models.ts';
import './FamiliesPage.css';

interface FamiliesPageProps { tenant: string; }
type Row = Record<string, unknown>;

export default function FamiliesPage({ tenant }: FamiliesPageProps) {
  const { t } = useTranslation();
  const [rows, setRows] = useState<Family[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [showAdd, setShowAdd] = useState(false);
  const [detail, setDetail] = useState<Family | null>(null);
  const [detailStudents, setDetailStudents] = useState<Row[]>([]);
  const [addStudentTo, setAddStudentTo] = useState<Family | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    postQuery(tenant, 'entities',
      "SELECT * FROM data WHERE entity_type = 'family' AND _status = 'active'")
      .then((res) => setRows(res.data as unknown as Family[]))
      .catch(() => setRows([]))
      .finally(() => setLoading(false));
  }, [tenant]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!detail) { setDetailStudents([]); return; }
    getStudentsByFamily(tenant, detail.entity_id).then(setDetailStudents).catch(() => setDetailStudents([]));
  }, [detail, tenant]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((f) =>
      String(f.family_name ?? '').toLowerCase().includes(q) ||
      String(f.primary_email ?? '').toLowerCase().includes(q) ||
      String(f.primary_phone ?? '').toLowerCase().includes(q));
  }, [rows, search]);

  const columns: Column<Row>[] = [
    { key: 'family_name', label: t('families.colName'), render: (r) => String(r.family_name ?? '-') },
    { key: 'primary_email', label: t('families.colEmail'), render: (r) => String(r.primary_email ?? '-') },
    { key: 'primary_phone', label: t('families.colPhone'), render: (r) => String(r.primary_phone ?? '-') },
  ];

  return (
    <div className="families-page">
      <div className="families-header">
        <h2>{t('families.title')}</h2>
        <div className="families-actions">
          <input
            className="families-search" placeholder={t('families.search')}
            value={search} onChange={(e) => setSearch(e.target.value)}
          />
          <button className="families-add-btn" onClick={() => setShowAdd(true)}>{t('families.addFamily')}</button>
        </div>
      </div>

      {loading ? (
        <p>{t('common.loading')}</p>
      ) : filtered.length === 0 ? (
        <p className="families-empty">{t('families.empty')}</p>
      ) : (
        <DataTable
          data={filtered as unknown as Row[]}
          columns={columns}
          onRowClick={(r) => setDetail(r as unknown as Family)}
        />
      )}

      {showAdd && (
        <AddFamilyModal
          tenant={tenant}
          onClose={() => setShowAdd(false)}
          onSuccess={() => { setShowAdd(false); load(); }}
        />
      )}

      {detail && (
        <div className="students-confirm-overlay" onClick={() => setDetail(null)}>
          <div className="families-detail" onClick={(e) => e.stopPropagation()}>
            <div className="families-detail-header">
              <h3>{String(detail.family_name ?? '')}</h3>
              <button onClick={() => setDetail(null)}>{t('families.close')}</button>
            </div>
            <dl className="families-detail-fields">
              <dt>{t('families.colEmail')}</dt><dd>{String(detail.primary_email ?? '-')}</dd>
              <dt>{t('families.colPhone')}</dt><dd>{String(detail.primary_phone ?? '-')}</dd>
            </dl>
            <h4>{t('families.detailStudents')}</h4>
            {detailStudents.length === 0 ? (
              <p className="families-empty">{t('families.noStudents')}</p>
            ) : (
              <ul className="families-detail-students">
                {detailStudents.map((s) => (
                  <li key={String(s.entity_id)}>
                    {String(s.first_name ?? '')} {String(s.last_name ?? '')}
                    {s.grade_level ? <span className="families-grade"> · {String(s.grade_level)}</span> : null}
                  </li>
                ))}
              </ul>
            )}
            <button
              className="families-add-btn"
              onClick={() => { setAddStudentTo(detail); setDetail(null); }}
            >
              {t('families.addStudentToFamily')}
            </button>
          </div>
        </div>
      )}

      {addStudentTo && (
        <AddStudentModal
          tenant={tenant}
          presetFamilyId={addStudentTo.entity_id}
          presetFamilyLabel={String(addStudentTo.family_name ?? '')}
          onClose={() => setAddStudentTo(null)}
          onSuccess={() => { setAddStudentTo(null); load(); }}
        />
      )}
    </div>
  );
}
```

- [ ] **Step 4: Verify `DataTable`'s props match**

Run: `sed -n '1,40p' admindash/frontend/src/components/DataTable.tsx`
Confirm `Column<T>` has `key`, `label`, `render`, and `DataTable` accepts `data`, `columns`, and an `onRowClick?: (row: T) => void` prop. If `onRowClick` is named differently (e.g. `onRow`) or absent, adapt Step 3's usage to the actual prop (and if absent, wrap each name cell render in a `<button onClick>` instead). Do not invent props.

- [ ] **Step 5: Add styles**

Create `admindash/frontend/src/pages/FamiliesPage.css`:
```css
.families-page { padding: 24px; }
.families-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; }
.families-actions { display: flex; gap: 8px; }
.families-search { padding: 8px 10px; border: 1px solid var(--color-border, #ccc); border-radius: 6px; min-width: 260px; }
.families-add-btn { padding: 8px 14px; background: var(--color-primary, #378ADD); color: #fff; border: none; border-radius: 6px; cursor: pointer; }
.families-empty { color: #888; }
.families-detail { background: #fff; border-radius: 10px; padding: 20px; width: min(560px, 92vw); max-height: 82vh; overflow-y: auto; }
.families-detail-header { display: flex; justify-content: space-between; align-items: center; }
.families-detail-header button { background: none; border: none; color: var(--color-primary, #378ADD); cursor: pointer; }
.families-detail-fields { display: grid; grid-template-columns: auto 1fr; gap: 4px 12px; margin: 12px 0; }
.families-detail-fields dt { font-weight: 600; color: #555; }
.families-detail-students { list-style: none; padding: 0; margin: 8px 0 16px; }
.families-detail-students li { padding: 8px; border-bottom: 1px solid var(--color-border, #eee); }
.families-grade { color: #888; }
```

- [ ] **Step 6: Wire the route**

In `admindash/frontend/src/App.tsx`, add the import:
```tsx
import FamiliesPage from './pages/FamiliesPage.tsx';
```
And add the route inside the inner `<Routes>` (after the `/students/bulk-add` route):
```tsx
                    <Route path="/families" element={<FamiliesPage tenant={tenant} />} />
```

- [ ] **Step 7: Add the nav item**

In `admindash/frontend/src/components/Navbar.tsx`, add to `navItems` after the student entry:
```tsx
    { to: '/families', label: t('nav.family') },
```

- [ ] **Step 8: Type-check + lint**

Run: `npm run build && npm run lint`
Expected: both succeed.

- [ ] **Step 9: Manual QA**

- Nav shows **Families**; `/families` lists family rows; search filters by name/email/phone.
- **Add Family** creates a family (model-driven if a `family` model exists, else the 4 fallback fields) and the list refreshes.
- Clicking a family opens the detail with its linked students (create a student linked to that family via Task 6 first to verify).
- **"+ Add student to this family"** opens `AddStudentModal` with the family pre-linked (chip shown); saving links the new student.

- [ ] **Step 10: Commit**

```bash
git add admindash/frontend/src/pages/FamiliesPage.tsx admindash/frontend/src/pages/FamiliesPage.css admindash/frontend/src/components/AddFamilyModal.tsx admindash/frontend/src/components/Navbar.tsx admindash/frontend/src/App.tsx admindash/frontend/src/i18n/translations.ts
git commit -m "feat(admindash): add Families tab (search, add, detail with linked students, add-student pre-link)"
```

---

## Self-Review

**Spec coverage (Part 1 scope):**
- Inline family field on web-form → Task 5 + 6. ✓
- Single-doc flow shares the same picker → Task 6 Step 5/7 (Upload tab lands on Web Form which has the picker). ✓
- Create-new-family inline → Task 5 + Task 6 Step 4. ✓
- Families tab: search → Task 7 Step 3; detail lists linked students → Task 7 Step 3; "Add student" pre-link → Task 7 Step 3 + Task 6 preset props. ✓
- Add family (model-driven, D3 fallback) → Task 7 Step 2. ✓
- Vitest for pure logic → Task 1, 3, 4. ✓
- One family per student, scalar `family_id` → Task 2 + Task 6 Step 4. ✓
- (Deferred to Part 2: batch/CSV family linking; deferred to Phase 2: Papermite family extraction.)

**Placeholder scan:** No TBD/TODO; every code step shows full code. Task 7 Step 4 is a deliberate *verify-against-real-API* guard for `DataTable` props, with an explicit fallback instruction — not a placeholder.

**Type consistency:** `FamilySelection` shape (`mode`/`familyId`/`label`/`data`) is identical across Tasks 2, 5, 6. `createFamily` returns `CreateEntityResponse` (has `entity_id`), used in Task 6 Step 4. `searchFamilies` returns `Family[]`, consumed in Task 5. `getStudentsByFamily` returns `Record<string, unknown>[]`, consumed in Task 7.

**Open verification during execution:** Task 7 Step 4 (DataTable prop names) and the i18n interpolation note in Task 5 Step 1 are the only spots requiring the implementer to check the real codebase; both include explicit adaptation instructions.
