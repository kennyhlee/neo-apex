# Student List View Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the legacy student list with a datacore-backed table featuring server-side filtering/sorting, adaptive page size, column toggle, localStorage preferences, and newly-added student highlighting.

**Architecture:** A new datacore query endpoint exposes filtered/sorted/paginated entity queries via DuckDB SQL. The admindash frontend caches model definitions in a ModelContext (per session), persists table preferences in localStorage, and enhances the DataTable component with sort, page size, column toggle, and row highlighting support.

**Tech Stack:** Python/FastAPI/DuckDB (datacore), React 19/TypeScript 5.9/Vite 8/React Router 7 (admindash), CSS with CSS variables, localStorage for preferences.

**OpenSpec Change:** `openspec/changes/student-list-view/`

---

## File Map

### Datacore (backend)
| File | Action | Responsibility |
|------|--------|---------------|
| `datacore/src/datacore/api/routes.py` | Modify | Add query endpoint |
| `datacore/tests/test_api.py` | Modify | Add query endpoint tests |

### Admindash (frontend)
| File | Action | Responsibility |
|------|--------|---------------|
| `frontend/src/api/client.ts` | Modify | Add `queryStudents()` function |
| `frontend/src/types/models.ts` | Modify | Add `QueryStudentsResponse` type |
| `frontend/src/contexts/ModelContext.tsx` | Create | Session-scoped model definition cache |
| `frontend/src/App.tsx` | Modify | Wrap with ModelProvider |
| `frontend/src/hooks/useTablePreferences.ts` | Create | localStorage read/write for table prefs |
| `frontend/src/i18n/translations.ts` | Modify | Add new i18n keys |
| `frontend/src/components/DataTable.tsx` | Modify | Add sort, page size, column toggle, rowClassName |
| `frontend/src/components/DataTable.css` | Modify | Sort indicator, page size selector, highlight styles |
| `frontend/src/pages/StudentsPage.tsx` | Rewrite | New data fetching, search, column ordering, preferences |
| `frontend/src/pages/StudentsPage.css` | Modify | Column toggle popover, highlight row styles |
| `frontend/src/pages/AddStudentPage.tsx` | Modify | Pass entity_id via router state |

---

### Task 1: Datacore Query Endpoint

**Files:**
- Modify: `datacore/src/datacore/api/routes.py`
- Modify: `datacore/tests/test_api.py`

This task adds `GET /api/entities/{tenant_id}/{entity_type}/query` with filter, sort, and pagination support. The endpoint builds a SQL WHERE clause from query params, delegates to `QueryEngine.query()`, and returns `{ data: [...], total: int }`.

- [ ] **Step 1: Write tests for the query endpoint**

Add to `datacore/tests/test_api.py`:

```python
# --- Query endpoint tests ---

def test_query_default_returns_active_students(client, store):
    """Default query returns only active entities sorted by last_name."""
    store.put_entity("t1", "student", "s1", {"first_name": "Zara", "last_name": "Adams"}, {})
    store.put_entity("t1", "student", "s2", {"first_name": "Alice", "last_name": "Brown"}, {})
    store.put_entity("t1", "student", "s3", {"first_name": "Bob", "last_name": "Clark"}, {})
    # Archive one to test status filter
    store.put_entity("t1", "student", "s3", {"first_name": "Bob", "last_name": "Clark"}, {}, status="archived")

    resp = client.get("/api/entities/t1/student/query")
    assert resp.status_code == 200
    body = resp.json()
    assert body["total"] == 2
    assert len(body["data"]) == 2
    # Default sort by last_name ASC
    assert body["data"][0]["last_name"] == "Adams"
    assert body["data"][1]["last_name"] == "Brown"


def test_query_status_filter(client, store):
    """Explicit _status param filters correctly."""
    store.put_entity("t1", "student", "s1", {"last_name": "A"}, {})
    store.put_entity("t1", "student", "s1", {"last_name": "A"}, {}, status="archived")

    resp = client.get("/api/entities/t1/student/query?_status=archived")
    assert resp.status_code == 200
    assert resp.json()["total"] == 1

    resp_all = client.get("/api/entities/t1/student/query?_status=all")
    assert resp_all.status_code == 200
    assert resp_all.json()["total"] == 2


def test_query_filters_by_entity_type(client, store):
    """Only returns entities matching the entity_type path param."""
    store.put_entity("t1", "student", "s1", {"last_name": "A"}, {})
    store.put_entity("t1", "teacher", "t1", {"last_name": "B"}, {})

    resp = client.get("/api/entities/t1/student/query")
    assert resp.status_code == 200
    assert resp.json()["total"] == 1
    assert resp.json()["data"][0]["entity_type"] == "student"


def test_query_sort(client, store):
    """Custom sort_by and sort_dir."""
    store.put_entity("t1", "student", "s1", {"first_name": "Zara", "last_name": "A"}, {})
    store.put_entity("t1", "student", "s2", {"first_name": "Alice", "last_name": "B"}, {})

    resp = client.get("/api/entities/t1/student/query?sort_by=first_name&sort_dir=desc")
    assert resp.status_code == 200
    data = resp.json()["data"]
    assert data[0]["first_name"] == "Zara"


def test_query_invalid_sort_column(client, store):
    """Invalid sort_by returns 400."""
    store.put_entity("t1", "student", "s1", {"last_name": "A"}, {})
    resp = client.get("/api/entities/t1/student/query?sort_by=nonexistent")
    assert resp.status_code == 400


def test_query_pagination(client, store):
    """Limit and offset work correctly."""
    for i in range(5):
        store.put_entity("t1", "student", f"s{i}", {"last_name": f"Name{i:02d}"}, {})

    resp = client.get("/api/entities/t1/student/query?limit=2&offset=2")
    body = resp.json()
    assert body["total"] == 5
    assert len(body["data"]) == 2


def test_query_limit_clamped(client, store):
    """Limit above 50 is clamped."""
    store.put_entity("t1", "student", "s1", {"last_name": "A"}, {})
    resp = client.get("/api/entities/t1/student/query?limit=100")
    assert resp.status_code == 200  # No error, just clamped


def test_query_base_field_filter(client, store):
    """ILIKE filter on base fields."""
    store.put_entity("t1", "student", "s1", {"first_name": "Jane", "last_name": "Doe"}, {})
    store.put_entity("t1", "student", "s2", {"first_name": "John", "last_name": "Smith"}, {})

    resp = client.get("/api/entities/t1/student/query?first_name=jan")
    body = resp.json()
    assert body["total"] == 1
    assert body["data"][0]["first_name"] == "Jane"


def test_query_address_fuzzy(client, store):
    """Address param searches across address-related columns with OR logic."""
    store.put_entity("t1", "student", "s1", {"last_name": "A", "city": "Springfield"}, {})
    store.put_entity("t1", "student", "s2", {"last_name": "B", "city": "Portland"}, {})

    resp = client.get("/api/entities/t1/student/query?address=spring")
    body = resp.json()
    assert body["total"] == 1
    assert body["data"][0]["city"] == "Springfield"
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /Users/kennylee/Development/NeoApex/datacore && python -m pytest tests/test_api.py -v -k "query" 2>&1 | tail -20`
Expected: All `test_query_*` tests FAIL (endpoint doesn't exist yet)

- [ ] **Step 3: Implement the query endpoint**

In `datacore/src/datacore/api/routes.py`, add the following. The `register_routes` function already receives `store`, and we need to import `QueryEngine` from `datacore.query`:

At the top of the file, add the import:

```python
from datacore.query import QueryEngine, TableNotFoundError
```

Inside `register_routes()`, after the existing `create_entity` endpoint, add:

```python
    @app.get("/api/entities/{tenant_id}/{entity_type}/query")
    def query_entities(
        tenant_id: str,
        entity_type: str,
        _status: str = "active",
        sort_by: str = "last_name",
        sort_dir: str = "asc",
        limit: int = 20,
        offset: int = 0,
        first_name: str | None = None,
        last_name: str | None = None,
        student_id: str | None = None,
        email: str | None = None,
        grade_level: str | None = None,
        gender: str | None = None,
        address: str | None = None,
    ):
        # Clamp pagination
        if limit < 1:
            limit = 20
        if limit > 50:
            limit = 50
        if offset < 0:
            offset = 0
        if sort_dir not in ("asc", "desc"):
            sort_dir = "asc"

        # Build WHERE clauses
        conditions = [f"entity_type = '{entity_type}'"]

        if _status and _status != "all":
            conditions.append(f"_status = '{_status}'")

        # Base field ILIKE filters
        field_filters = {
            "first_name": first_name,
            "last_name": last_name,
            "student_id": student_id,
            "email": email,
            "grade_level": grade_level,
            "gender": gender,
        }
        for col, val in field_filters.items():
            if val:
                safe_val = val.replace("'", "''")
                conditions.append(f"{col} ILIKE '%{safe_val}%'")

        # Fuzzy address search (OR across address-related columns)
        if address:
            safe_addr = address.replace("'", "''")
            # We'll check which address columns exist after table is loaded
            # For now, build the OR clause; nonexistent columns handled below
            address_cols = ["address", "city", "state", "zip"]
            # Dynamically check columns via QueryEngine
            qe = QueryEngine(store)
            arrow_table = store.get_table_as_arrow(tenant_id, "entities")
            if arrow_table is not None:
                # Flatten to get actual column names
                from datacore.query import QueryEngine as QE
                flat = qe._flatten_custom_fields(arrow_table)
                available_cols = set(flat.column_names)
                matching_addr_cols = [c for c in address_cols if c in available_cols]
                if matching_addr_cols:
                    addr_parts = [f"{c} ILIKE '%{safe_addr}%'" for c in matching_addr_cols]
                    conditions.append(f"({' OR '.join(addr_parts)})")

        where = " AND ".join(conditions)
        sql = f"SELECT * FROM data WHERE {where}"

        # Validate sort column by checking available columns
        qe = QueryEngine(store)
        try:
            # First, check if sort_by is valid by running a schema check
            arrow_table = store.get_table_as_arrow(tenant_id, "entities")
            if arrow_table is None:
                return {"data": [], "total": 0}
            flat = qe._flatten_custom_fields(arrow_table)
            if sort_by not in flat.column_names:
                raise HTTPException(
                    status_code=400,
                    detail=f"Invalid sort column: '{sort_by}'. Available: {sorted(flat.column_names)}",
                )

            sql += f" ORDER BY {sort_by} {sort_dir.upper()}"
            result = qe.query(tenant_id, "entities", sql, limit=limit, offset=offset)
            return {"data": result["rows"], "total": result["total"]}

        except TableNotFoundError:
            return {"data": [], "total": 0}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /Users/kennylee/Development/NeoApex/datacore && python -m pytest tests/test_api.py -v -k "query" 2>&1 | tail -30`
Expected: All `test_query_*` tests PASS

- [ ] **Step 5: Run full test suite**

Run: `cd /Users/kennylee/Development/NeoApex/datacore && python -m pytest tests/ -v 2>&1 | tail -20`
Expected: All tests PASS

- [ ] **Step 6: Commit**

```bash
cd /Users/kennylee/Development/NeoApex/admindash
git add ../datacore/src/datacore/api/routes.py ../datacore/tests/test_api.py
git commit -m "feat: add GET /api/entities query endpoint with filter, sort, pagination"
```

---

### Task 2: Admindash API Client and Types

**Files:**
- Modify: `frontend/src/api/client.ts`
- Modify: `frontend/src/types/models.ts`

- [ ] **Step 1: Add QueryStudentsParams and QueryStudentsResponse types**

In `frontend/src/types/models.ts`, add after the `ExtractResponse` interface (end of file):

```typescript
export interface QueryStudentsParams {
  _status?: string;
  sort_by?: string;
  sort_dir?: 'asc' | 'desc';
  limit?: number;
  offset?: number;
  first_name?: string;
  last_name?: string;
  student_id?: string;
  email?: string;
  grade_level?: string;
  gender?: string;
  address?: string;
}

export interface QueryStudentsResponse {
  data: Record<string, unknown>[];
  total: number;
}
```

- [ ] **Step 2: Add queryStudents function**

In `frontend/src/api/client.ts`, add the import for the new types at the top:

```typescript
import type {
  StudentsResponse,
  TenantsResponse,
  ModelResponse,
  CreateEntityResponse,
  ExtractResponse,
  QueryStudentsParams,
  QueryStudentsResponse,
} from '../types/models.ts';
```

Add the function at the end of the file:

```typescript
export async function queryStudents(
  tenantId: string,
  params: QueryStudentsParams = {},
): Promise<QueryStudentsResponse> {
  const searchParams = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value != null && value !== '') {
      searchParams.set(key, String(value));
    }
  }
  const resp = await fetch(
    `${DATACORE_API_BASE}/api/entities/${tenantId}/student/query?${searchParams}`,
  );
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  return resp.json();
}
```

- [ ] **Step 3: Type check**

Run: `cd /Users/kennylee/Development/NeoApex/admindash/frontend && npx tsc -b 2>&1`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
cd /Users/kennylee/Development/NeoApex/admindash
git add frontend/src/api/client.ts frontend/src/types/models.ts
git commit -m "feat: add queryStudents API client function and types"
```

---

### Task 3: ModelContext

**Files:**
- Create: `frontend/src/contexts/ModelContext.tsx`
- Modify: `frontend/src/App.tsx`
- Modify: `frontend/src/pages/AddStudentPage.tsx`

- [ ] **Step 1: Create ModelContext**

Create `frontend/src/contexts/ModelContext.tsx`:

```typescript
import { createContext, useContext, useState, useCallback, type ReactNode } from 'react';
import { fetchStudentModel } from '../api/client.ts';
import type { ModelDefinition } from '../types/models.ts';

interface ModelCache {
  [entityType: string]: ModelDefinition;
}

interface ModelContextValue {
  getModel: (tenantId: string, entityType: string) => Promise<ModelDefinition>;
  getCachedModel: (entityType: string) => ModelDefinition | undefined;
  clearCache: () => void;
}

const ModelContext = createContext<ModelContextValue>({
  getModel: () => Promise.reject(new Error('ModelContext not initialized')),
  getCachedModel: () => undefined,
  clearCache: () => {},
});

export function ModelProvider({ children }: { children: ReactNode }) {
  const [cache, setCache] = useState<ModelCache>({});

  const getModel = useCallback(
    async (tenantId: string, entityType: string): Promise<ModelDefinition> => {
      if (cache[entityType]) return cache[entityType];

      const resp = await fetchStudentModel(tenantId);
      const modelDef = resp.model_definition;
      setCache((prev) => ({ ...prev, [entityType]: modelDef }));
      return modelDef;
    },
    [cache],
  );

  const getCachedModel = useCallback(
    (entityType: string): ModelDefinition | undefined => cache[entityType],
    [cache],
  );

  const clearCache = useCallback(() => setCache({}), []);

  return (
    <ModelContext.Provider value={{ getModel, getCachedModel, clearCache }}>
      {children}
    </ModelContext.Provider>
  );
}

export function useModel() {
  return useContext(ModelContext);
}
```

- [ ] **Step 2: Wrap App with ModelProvider and clear on logout**

In `frontend/src/App.tsx`, add the import:

```typescript
import { ModelProvider, useModel } from './contexts/ModelContext.tsx';
```

Wrap the protected routes section with `<ModelProvider>`. The full `AppRoutes` function becomes:

```typescript
function AppRoutes() {
  const { user, ready } = useAuth();
  const [tenant, setTenant] = useState(user?.tenant_id ?? '');

  useEffect(() => {
    if (user?.tenant_id) setTenant(user.tenant_id);
  }, [user?.tenant_id]);

  if (!ready) return null;

  return (
    <Routes>
      <Route
        path="/login"
        element={user ? <Navigate to="/home" replace /> : <LoginPage />}
      />
      <Route
        path="*"
        element={
          !user ? (
            <Navigate to="/login" replace />
          ) : (
            <ModelProvider>
              <div className="app-shell">
                <Navbar currentTenant={tenant} onTenantChange={setTenant} />
                <main className="app-main">
                  <Routes>
                    <Route path="/home" element={<HomePage />} />
                    <Route
                      path="/students/add"
                      element={<AddStudentPage tenant={tenant} />}
                    />
                    <Route
                      path="/students"
                      element={<StudentsPage tenant={tenant} />}
                    />
                    <Route path="/leads" element={<LeadPage />} />
                    <Route path="/programs" element={<ProgramPage />} />
                    <Route path="*" element={<Navigate to="/home" replace />} />
                  </Routes>
                </main>
                <Footer />
              </div>
            </ModelProvider>
          )
        }
      />
    </Routes>
  );
}
```

Note: `ModelProvider` is inside the `!user` guard, so it unmounts (and clears cache) on logout automatically.

- [ ] **Step 3: Refactor AddStudentPage to use ModelContext**

In `frontend/src/pages/AddStudentPage.tsx`, replace the direct `fetchStudentModel` call with `useModel()`.

Replace the imports:

```typescript
import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from '../hooks/useTranslation.ts';
import { createStudent, extractStudentFromDocument } from '../api/client.ts';
import { useModel } from '../contexts/ModelContext.tsx';
import DynamicForm from '../components/DynamicForm.tsx';
import DocumentUpload from '../components/DocumentUpload.tsx';
import type { ModelDefinition } from '../types/models.ts';
import './AddStudentPage.css';
```

Replace the state and useEffect for model fetching (lines 18-34) with:

```typescript
  const { getModel } = useModel();

  const [activeTab, setActiveTab] = useState<'form' | 'upload'>('form');
  const [modelDef, setModelDef] = useState<ModelDefinition | null>(null);
  const [modelError, setModelError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [extractedValues, setExtractedValues] = useState<Record<string, unknown>>({});
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setModelError(null);
    getModel(tenant, 'student')
      .then((def) => setModelDef(def))
      .catch(() => setModelError(t('addStudent.modelNotFound')))
      .finally(() => setLoading(false));
  }, [tenant, getModel, t]);
```

Remove `fetchStudentModel` from the import of `'../api/client.ts'`.

- [ ] **Step 4: Type check and build**

Run: `cd /Users/kennylee/Development/NeoApex/admindash/frontend && npx tsc -b && npm run build 2>&1 | tail -10`
Expected: No errors, build succeeds

- [ ] **Step 5: Commit**

```bash
cd /Users/kennylee/Development/NeoApex/admindash
git add frontend/src/contexts/ModelContext.tsx frontend/src/App.tsx frontend/src/pages/AddStudentPage.tsx
git commit -m "feat: add ModelContext for session-scoped model definition caching"
```

---

### Task 4: i18n Keys

**Files:**
- Modify: `frontend/src/i18n/translations.ts`

- [ ] **Step 1: Add en-US keys**

In `frontend/src/i18n/translations.ts`, add after the `addStudent.submitError` line, before `// Program`:

```typescript
    // Student List
    'students.pageSize': 'Rows per page',
    'students.columnSettings': 'Columns',
    'students.addressSearch': 'Address',
    'students.addressSearchPlaceholder': 'Search by address, city, state, zip',
    'students.sortAsc': 'Sorted ascending',
    'students.sortDesc': 'Sorted descending',
    'students.showAll': 'Show All',
```

- [ ] **Step 2: Add zh-CN keys**

In the same file, add after the zh-CN `addStudent.submitError` line, before `// Program`:

```typescript
    // Student List
    'students.pageSize': '每页行数',
    'students.columnSettings': '列设置',
    'students.addressSearch': '地址',
    'students.addressSearchPlaceholder': '按地址、城市、州、邮编搜索',
    'students.sortAsc': '升序排列',
    'students.sortDesc': '降序排列',
    'students.showAll': '显示全部',
```

- [ ] **Step 3: Type check**

Run: `cd /Users/kennylee/Development/NeoApex/admindash/frontend && npx tsc -b 2>&1`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
cd /Users/kennylee/Development/NeoApex/admindash
git add frontend/src/i18n/translations.ts
git commit -m "feat: add i18n keys for student list view enhancements"
```

---

### Task 5: useTablePreferences Hook

**Files:**
- Create: `frontend/src/hooks/useTablePreferences.ts`

- [ ] **Step 1: Create the hook**

Create `frontend/src/hooks/useTablePreferences.ts`:

```typescript
import { useState, useCallback } from 'react';

const VALID_PAGE_SIZES = [10, 20, 30, 40, 50] as const;
type ValidPageSize = (typeof VALID_PAGE_SIZES)[number];

export interface TablePreferences {
  hiddenColumns: string[];
  pageSize: ValidPageSize;
  sortBy: string;
  sortDir: 'asc' | 'desc';
}

const DEFAULT_PREFS: TablePreferences = {
  hiddenColumns: [],
  pageSize: 20,
  sortBy: 'last_name',
  sortDir: 'asc',
};

function buildStorageKey(userId: string, tenantId: string): string {
  return `admindash_table_prefs_${userId}_${tenantId}`;
}

function validatePageSize(size: number): ValidPageSize {
  return VALID_PAGE_SIZES.includes(size as ValidPageSize)
    ? (size as ValidPageSize)
    : 20;
}

function loadPreferences(
  userId: string,
  tenantId: string,
  currentColumns: string[],
): TablePreferences {
  const key = buildStorageKey(userId, tenantId);
  const raw = localStorage.getItem(key);
  if (!raw) return { ...DEFAULT_PREFS };

  try {
    const parsed = JSON.parse(raw) as Partial<TablePreferences>;
    const colSet = new Set(currentColumns);
    return {
      hiddenColumns: (parsed.hiddenColumns ?? []).filter((c) => colSet.has(c)),
      pageSize: validatePageSize(parsed.pageSize ?? 20),
      sortBy: parsed.sortBy ?? DEFAULT_PREFS.sortBy,
      sortDir: parsed.sortDir === 'desc' ? 'desc' : 'asc',
    };
  } catch {
    return { ...DEFAULT_PREFS };
  }
}

function savePreferences(
  userId: string,
  tenantId: string,
  prefs: TablePreferences,
): void {
  const key = buildStorageKey(userId, tenantId);
  localStorage.setItem(key, JSON.stringify(prefs));
}

export function useTablePreferences(
  userId: string,
  tenantId: string,
  currentColumns: string[],
) {
  const [prefs, setPrefs] = useState<TablePreferences>(() =>
    loadPreferences(userId, tenantId, currentColumns),
  );

  const updatePrefs = useCallback(
    (updates: Partial<TablePreferences>) => {
      setPrefs((prev) => {
        const next = { ...prev, ...updates };
        savePreferences(userId, tenantId, next);
        return next;
      });
    },
    [userId, tenantId],
  );

  const toggleColumn = useCallback(
    (columnKey: string) => {
      setPrefs((prev) => {
        const hidden = prev.hiddenColumns.includes(columnKey)
          ? prev.hiddenColumns.filter((c) => c !== columnKey)
          : [...prev.hiddenColumns, columnKey];
        const next = { ...prev, hiddenColumns: hidden };
        savePreferences(userId, tenantId, next);
        return next;
      });
    },
    [userId, tenantId],
  );

  return { prefs, updatePrefs, toggleColumn };
}
```

- [ ] **Step 2: Type check**

Run: `cd /Users/kennylee/Development/NeoApex/admindash/frontend && npx tsc -b 2>&1`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
cd /Users/kennylee/Development/NeoApex/admindash
git add frontend/src/hooks/useTablePreferences.ts
git commit -m "feat: add useTablePreferences hook for localStorage persistence"
```

---

### Task 6: DataTable Enhancements

**Files:**
- Modify: `frontend/src/components/DataTable.tsx`
- Modify: `frontend/src/components/DataTable.css`

This task adds optional props to DataTable for sort, page size selector, hidden columns, and row class names. All new props are optional so existing usage is unaffected.

- [ ] **Step 1: Update DataTable props and rendering**

Replace the full content of `frontend/src/components/DataTable.tsx`:

```typescript
import { useState, type ReactNode } from 'react';
import { useTranslation } from '../hooks/useTranslation.ts';
import './DataTable.css';

export interface Column<T> {
  key: string;
  label: string;
  i18nKey?: string;
  render?: (row: T) => ReactNode;
}

interface DataTableProps<T> {
  columns: Column<T>[];
  data: T[];
  total: number;
  page: number;
  pageSize: number;
  loading?: boolean;
  onPageChange: (page: number) => void;
  rowKey: (row: T) => string;
  // Sort
  sortBy?: string;
  sortDir?: 'asc' | 'desc';
  onSortChange?: (column: string) => void;
  // Page size
  pageSizeOptions?: number[];
  onPageSizeChange?: (size: number) => void;
  // Column visibility
  hiddenColumns?: string[];
  // Row styling
  rowClassName?: (row: T) => string;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export default function DataTable<T extends Record<string, any>>({
  columns,
  data,
  total,
  page,
  pageSize,
  loading,
  onPageChange,
  rowKey,
  sortBy,
  sortDir,
  onSortChange,
  pageSizeOptions,
  onPageSizeChange,
  hiddenColumns,
  rowClassName,
}: DataTableProps<T>) {
  const { t } = useTranslation();
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  // Filter out hidden columns
  const visibleColumns = hiddenColumns
    ? columns.filter((col) => !hiddenColumns.includes(col.key))
    : columns;

  const allOnPageSelected =
    data.length > 0 && data.every((row) => selectedIds.has(rowKey(row)));

  function toggleAll() {
    if (allOnPageSelected) {
      const next = new Set(selectedIds);
      data.forEach((row) => next.delete(rowKey(row)));
      setSelectedIds(next);
    } else {
      const next = new Set(selectedIds);
      data.forEach((row) => next.add(rowKey(row)));
      setSelectedIds(next);
    }
  }

  function toggleRow(id: string) {
    const next = new Set(selectedIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelectedIds(next);
  }

  function handleHeaderClick(colKey: string) {
    if (!onSortChange) return;
    onSortChange(colKey);
  }

  const startRecord = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const endRecord = Math.min(page * pageSize, total);

  const maxButtons = 5;
  let btnStart = Math.max(1, page - Math.floor(maxButtons / 2));
  const btnEnd = Math.min(totalPages, btnStart + maxButtons - 1);
  if (btnEnd - btnStart < maxButtons - 1) {
    btnStart = Math.max(1, btnEnd - maxButtons + 1);
  }
  const pageButtons: number[] = [];
  for (let i = btnStart; i <= btnEnd; i++) pageButtons.push(i);

  return (
    <div className="data-table-card">
      <div className="data-table-wrapper">
        <table className="data-table">
          <thead>
            <tr>
              <th className="data-table-checkbox">
                <input
                  type="checkbox"
                  checked={allOnPageSelected}
                  onChange={toggleAll}
                />
              </th>
              {visibleColumns.map((col) => {
                const isSorted = sortBy === col.key;
                const sortable = !!onSortChange;
                return (
                  <th
                    key={col.key}
                    className={sortable ? 'data-table-sortable' : ''}
                    onClick={() => handleHeaderClick(col.key)}
                  >
                    <span className="data-table-header-content">
                      {col.i18nKey ? t(col.i18nKey) : col.label}
                      {isSorted && (
                        <span className="data-table-sort-indicator">
                          {sortDir === 'asc' ? ' \u25B2' : ' \u25BC'}
                        </span>
                      )}
                    </span>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td
                  colSpan={visibleColumns.length + 1}
                  className="data-table-empty"
                >
                  {t('common.loading')}
                </td>
              </tr>
            ) : data.length === 0 ? (
              <tr>
                <td
                  colSpan={visibleColumns.length + 1}
                  className="data-table-empty"
                >
                  {t('students.noResults')}
                </td>
              </tr>
            ) : (
              data.map((row) => {
                const id = rowKey(row);
                const extraClass = rowClassName ? rowClassName(row) : '';
                return (
                  <tr key={id} className={extraClass}>
                    <td className="data-table-checkbox">
                      <input
                        type="checkbox"
                        checked={selectedIds.has(id)}
                        onChange={() => toggleRow(id)}
                      />
                    </td>
                    {visibleColumns.map((col) => (
                      <td key={col.key}>
                        {col.render
                          ? col.render(row)
                          : (String(row[col.key] ?? '-'))}
                      </td>
                    ))}
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
      <div className="data-table-pagination">
        <div className="data-table-pagination-info">
          {t('common.showing')} {startRecord} {t('common.to')} {endRecord}{' '}
          {t('common.of')} {total} {t('common.records')}
          {pageSizeOptions && onPageSizeChange && (
            <span className="data-table-page-size">
              {' | '}{t('students.pageSize')}:{' '}
              <select
                value={pageSize}
                onChange={(e) => onPageSizeChange(Number(e.target.value))}
              >
                {pageSizeOptions.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </span>
          )}
        </div>
        <div className="data-table-pagination-controls">
          <button
            disabled={page <= 1}
            onClick={() => onPageChange(page - 1)}
          >
            {t('common.previous')}
          </button>
          {pageButtons.map((p) => (
            <button
              key={p}
              className={p === page ? 'active' : ''}
              onClick={() => onPageChange(p)}
            >
              {p}
            </button>
          ))}
          <button
            disabled={page >= totalPages}
            onClick={() => onPageChange(page + 1)}
          >
            {t('common.next')}
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Add CSS for sort indicators, page size selector, and row highlight**

Append to `frontend/src/components/DataTable.css`:

```css
/* Sort */
.data-table-sortable {
  cursor: pointer;
  user-select: none;
}

.data-table-sortable:hover {
  color: var(--accent);
}

.data-table-header-content {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
}

.data-table-sort-indicator {
  font-size: 0.65rem;
  color: var(--accent);
}

/* Page size selector */
.data-table-page-size {
  margin-left: 0.25rem;
}

.data-table-page-size select {
  font-family: var(--font-sans);
  font-size: 0.8rem;
  padding: 0.15rem 0.4rem;
  border: 1px solid var(--border-primary);
  border-radius: var(--radius-sm);
  background: var(--bg-input);
  color: var(--text-primary);
  cursor: pointer;
}

/* Row highlight for newly added */
.data-table-row-highlight {
  background: var(--accent-muted) !important;
  animation: fadeIn 0.5s ease;
}

.data-table-row-highlight:hover {
  background: rgba(55, 138, 221, 0.15) !important;
}
```

- [ ] **Step 3: Type check and build**

Run: `cd /Users/kennylee/Development/NeoApex/admindash/frontend && npx tsc -b && npm run build 2>&1 | tail -10`
Expected: No errors, build succeeds (existing DataTable usage doesn't break since new props are optional)

- [ ] **Step 4: Commit**

```bash
cd /Users/kennylee/Development/NeoApex/admindash
git add frontend/src/components/DataTable.tsx frontend/src/components/DataTable.css
git commit -m "feat: enhance DataTable with sort, page size, column toggle, row highlight"
```

---

### Task 7: StudentsPage Rewrite

**Files:**
- Rewrite: `frontend/src/pages/StudentsPage.tsx`
- Modify: `frontend/src/pages/StudentsPage.css`

This is the largest task. It replaces the legacy data fetching with the new datacore query, adds dynamic search pane from model definition, column ordering from ModelContext, column visibility toggle, adaptive page size, preferences integration, and newly-added student highlighting.

- [ ] **Step 1: Rewrite StudentsPage**

Replace the full content of `frontend/src/pages/StudentsPage.tsx`:

```typescript
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useTranslation } from '../hooks/useTranslation.ts';
import { useAuth } from '../contexts/AuthContext.tsx';
import { useModel } from '../contexts/ModelContext.tsx';
import { useTablePreferences } from '../hooks/useTablePreferences.ts';
import { queryStudents } from '../api/client.ts';
import DataTable, { type Column } from '../components/DataTable.tsx';
import FilterForm from '../components/FilterForm.tsx';
import StatusBadge from '../components/StatusBadge.tsx';
import type { ModelDefinition } from '../types/models.ts';
import './StudentsPage.css';

const PAGE_SIZE_OPTIONS = [10, 20, 30, 40, 50];
const STATUS_OPTIONS = ['Active', 'On Leave', 'Suspended', 'Graduated', 'Dropped'];
const STATUS_I18N: Record<string, string> = {
  Active: 'students.status.active',
  'On Leave': 'students.status.onLeave',
  Suspended: 'students.status.suspended',
  Graduated: 'students.status.graduated',
  Dropped: 'students.status.dropped',
};

interface StudentsPageProps {
  tenant: string;
}

/**
 * Converts snake_case or camelCase to Title Case labels.
 */
function formatFieldLabel(key: string): string {
  return key
    .replace(/_/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * Builds columns from model definition: base_fields first, then custom_fields.
 */
function buildColumns(modelDef: ModelDefinition): Column<Record<string, unknown>>[] {
  const cols: Column<Record<string, unknown>>[] = [];

  for (const field of modelDef.base_fields) {
    if (field.name === 'enrollment_status' || field.name === '_status') {
      cols.push({
        key: field.name,
        label: formatFieldLabel(field.name),
        render: (row) => <StatusBadge status={String(row[field.name] ?? '')} />,
      });
    } else {
      cols.push({
        key: field.name,
        label: formatFieldLabel(field.name),
        render: (row) => {
          const val = row[field.name];
          if (val == null) return '-';
          if (typeof val === 'object') return JSON.stringify(val);
          return String(val);
        },
      });
    }
  }

  for (const field of modelDef.custom_fields) {
    cols.push({
      key: `custom:${field.name}`,
      label: formatFieldLabel(field.name),
      render: (row) => {
        const val = row[field.name];
        if (val == null) return '-';
        if (typeof val === 'object') return JSON.stringify(val);
        return String(val);
      },
    });
  }

  return cols;
}

/**
 * Calculate best-fit page size for viewport. Rounds down to nearest 10.
 */
function calcAdaptivePageSize(containerRef: React.RefObject<HTMLDivElement | null>): number {
  const el = containerRef.current;
  if (!el) return 20;
  // Estimate: table header ~180px, pagination ~60px, row ~48px
  const available = el.clientHeight - 240;
  const rows = Math.floor(available / 48);
  const rounded = Math.floor(rows / 10) * 10;
  if (rounded < 10) return 10;
  if (rounded > 50) return 50;
  return rounded;
}

export default function StudentsPage({ tenant }: StudentsPageProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const { user } = useAuth();
  const { getModel, getCachedModel } = useModel();

  // Model definition
  const [modelDef, setModelDef] = useState<ModelDefinition | null>(
    getCachedModel('student') ?? null,
  );
  const [modelLoading, setModelLoading] = useState(!modelDef);

  // Data
  const [data, setData] = useState<Record<string, unknown>[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Newly added highlight
  const highlightId = (location.state as { highlightEntityId?: string } | null)
    ?.highlightEntityId ?? null;
  const [activeHighlight, setActiveHighlight] = useState<string | null>(highlightId);

  // Container ref for adaptive page size
  const containerRef = useRef<HTMLDivElement>(null);

  // Build column keys for preferences
  const allColumnKeys = useMemo(() => {
    if (!modelDef) return [];
    return [
      ...modelDef.base_fields.map((f) => f.name),
      ...modelDef.custom_fields.map((f) => `custom:${f.name}`),
    ];
  }, [modelDef]);

  // Preferences
  const { prefs, updatePrefs, toggleColumn } = useTablePreferences(
    user?.user_id ?? '',
    tenant,
    allColumnKeys,
  );

  // Filter state
  const [filters, setFilters] = useState<Record<string, string>>({
    _status: 'active',
  });

  // Column toggle popover
  const [showColumnSettings, setShowColumnSettings] = useState(false);

  // Fetch model on mount
  useEffect(() => {
    if (modelDef) return;
    setModelLoading(true);
    getModel(tenant, 'student')
      .then((def) => setModelDef(def))
      .catch(() => setError('Failed to load student model'))
      .finally(() => setModelLoading(false));
  }, [tenant, getModel, modelDef]);

  // Adaptive page size on mount
  useEffect(() => {
    if (!prefs) return;
    const adaptive = calcAdaptivePageSize(containerRef);
    if (adaptive !== prefs.pageSize && prefs.pageSize === 20) {
      // Only auto-adjust if user hasn't manually set a preference
      updatePrefs({ pageSize: adaptive });
    }
  }, [modelDef]); // eslint-disable-line react-hooks/exhaustive-deps

  // Build columns from model
  const columns = useMemo(() => {
    if (!modelDef) return [];
    return buildColumns(modelDef);
  }, [modelDef]);

  // Data loading
  const loadData = useCallback(
    async (p: number) => {
      setLoading(true);
      setError(null);
      try {
        const res = await queryStudents(tenant, {
          ...filters,
          sort_by: prefs.sortBy,
          sort_dir: prefs.sortDir,
          limit: prefs.pageSize,
          offset: (p - 1) * prefs.pageSize,
        });
        let rows = res.data ?? [];

        // If there's a highlighted new student, prepend it
        if (activeHighlight && p === 1) {
          const idx = rows.findIndex((r) => r.entity_id === activeHighlight);
          if (idx > 0) {
            const [item] = rows.splice(idx, 1);
            rows = [item, ...rows];
          }
        }

        setData(rows);
        setTotal(res.total ?? 0);
        setPage(p);
      } catch (err) {
        setError(`Failed to load students. Is datacore running? (${err})`);
        setData([]);
        setTotal(0);
      } finally {
        setLoading(false);
      }
    },
    [tenant, filters, prefs.sortBy, prefs.sortDir, prefs.pageSize, activeHighlight],
  );

  useEffect(() => {
    if (!modelDef) return;
    loadData(1);
  }, [loadData, modelDef]);

  // Handlers
  function handleSearch() {
    loadData(1);
  }

  function handleReset() {
    setFilters({ _status: 'active' });
    loadData(1);
  }

  function handleFilterChange(field: string, value: string) {
    setFilters((prev) => ({ ...prev, [field]: value }));
  }

  function handleSortChange(column: string) {
    // Clear highlight when sort changes
    setActiveHighlight(null);
    if (column === prefs.sortBy) {
      updatePrefs({ sortDir: prefs.sortDir === 'asc' ? 'desc' : 'asc' });
    } else {
      updatePrefs({ sortBy: column, sortDir: 'asc' });
    }
  }

  function handlePageSizeChange(size: number) {
    updatePrefs({ pageSize: size as 10 | 20 | 30 | 40 | 50 });
    loadData(1);
  }

  // Row highlight class
  function rowClassName(row: Record<string, unknown>): string {
    if (activeHighlight && row.entity_id === activeHighlight) {
      return 'data-table-row-highlight';
    }
    return '';
  }

  if (modelLoading) {
    return (
      <div className="students-page" ref={containerRef}>
        <p>{t('common.loading')}</p>
      </div>
    );
  }

  // Build search fields from model base_fields
  const searchFields = modelDef?.base_fields ?? [];

  return (
    <div className="students-page" ref={containerRef}>
      <h1>{t('students.title')}</h1>

      <FilterForm onSearch={handleSearch} onReset={handleReset}>
        {searchFields.map((field) => {
          if (field.name === 'enrollment_status' || field.name === '_status') return null;
          return (
            <div className="filter-field" key={field.name}>
              <label>{formatFieldLabel(field.name)}</label>
              {field.type === 'selection' && field.options ? (
                <select
                  value={filters[field.name] ?? ''}
                  onChange={(e) => handleFilterChange(field.name, e.target.value)}
                >
                  <option value="">All</option>
                  {field.options.map((opt) => (
                    <option key={opt} value={opt}>{opt}</option>
                  ))}
                </select>
              ) : (
                <input
                  type="text"
                  placeholder={`Search ${formatFieldLabel(field.name).toLowerCase()}`}
                  value={filters[field.name] ?? ''}
                  onChange={(e) => handleFilterChange(field.name, e.target.value)}
                />
              )}
            </div>
          );
        })}
        {/* Status filter */}
        <div className="filter-field">
          <label>{t('students.searchStatus')}</label>
          <select
            value={filters._status ?? 'active'}
            onChange={(e) => handleFilterChange('_status', e.target.value)}
          >
            <option value="active">{t('students.status.active')}</option>
            {STATUS_OPTIONS.map((s) => (
              <option key={s} value={s.toLowerCase()}>
                {t(STATUS_I18N[s])}
              </option>
            ))}
            <option value="all">{t('students.showAll')}</option>
          </select>
        </div>
        {/* Address fuzzy search */}
        <div className="filter-field">
          <label>{t('students.addressSearch')}</label>
          <input
            type="text"
            placeholder={t('students.addressSearchPlaceholder')}
            value={filters.address ?? ''}
            onChange={(e) => handleFilterChange('address', e.target.value)}
          />
        </div>
      </FilterForm>

      <div className="students-toolbar">
        <button>{t('students.batchExport')}</button>
        <button>{t('students.batchActions')}</button>
        <div className="students-column-toggle">
          <button onClick={() => setShowColumnSettings((v) => !v)}>
            {t('students.columnSettings')}
          </button>
          {showColumnSettings && (
            <div className="students-column-popover">
              {columns.map((col) => (
                <label key={col.key} className="students-column-option">
                  <input
                    type="checkbox"
                    checked={!prefs.hiddenColumns.includes(col.key)}
                    onChange={() => toggleColumn(col.key)}
                  />
                  {col.label}
                </label>
              ))}
            </div>
          )}
        </div>
        <button onClick={() => navigate('/students/add')}>
          {t('students.addStudent')}
        </button>
      </div>

      {error ? (
        <div className="student-error">{error}</div>
      ) : (
        <DataTable<Record<string, unknown>>
          columns={columns}
          data={data}
          total={total}
          page={page}
          pageSize={prefs.pageSize}
          loading={loading}
          onPageChange={loadData}
          rowKey={(row) => String(row.entity_id ?? row.student_id ?? '')}
          sortBy={prefs.sortBy}
          sortDir={prefs.sortDir}
          onSortChange={handleSortChange}
          pageSizeOptions={PAGE_SIZE_OPTIONS}
          onPageSizeChange={handlePageSizeChange}
          hiddenColumns={prefs.hiddenColumns}
          rowClassName={rowClassName}
        />
      )}
    </div>
  );
}
```

- [ ] **Step 2: Add column toggle popover CSS**

Append to `frontend/src/pages/StudentsPage.css`:

```css
/* Column toggle */
.students-column-toggle {
  position: relative;
}

.students-column-popover {
  position: absolute;
  top: 100%;
  left: 0;
  z-index: 100;
  margin-top: 0.25rem;
  background: var(--bg-card);
  border: 1px solid var(--border-primary);
  border-radius: var(--radius-sm);
  box-shadow: var(--shadow-elevated);
  padding: 0.5rem;
  min-width: 180px;
  max-height: 300px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

.students-column-option {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  font-size: 0.8rem;
  color: var(--text-primary);
  padding: 0.25rem 0.4rem;
  border-radius: 4px;
  cursor: pointer;
}

.students-column-option:hover {
  background: var(--accent-glow);
}

.students-column-option input[type="checkbox"] {
  width: 0.9rem;
  height: 0.9rem;
}
```

- [ ] **Step 3: Type check and build**

Run: `cd /Users/kennylee/Development/NeoApex/admindash/frontend && npx tsc -b && npm run build 2>&1 | tail -10`
Expected: No errors, build succeeds

- [ ] **Step 4: Commit**

```bash
cd /Users/kennylee/Development/NeoApex/admindash
git add frontend/src/pages/StudentsPage.tsx frontend/src/pages/StudentsPage.css
git commit -m "feat: rewrite StudentsPage with datacore query, dynamic search, column toggle, preferences"
```

---

### Task 8: AddStudentPage Integration

**Files:**
- Modify: `frontend/src/pages/AddStudentPage.tsx`

- [ ] **Step 1: Pass entity_id via router state on successful creation**

In `frontend/src/pages/AddStudentPage.tsx`, update the `handleSubmit` function. Find the line:

```typescript
      setTimeout(() => navigate('/students'), 1500);
```

Replace with:

```typescript
      setTimeout(() => navigate('/students', {
        state: { highlightEntityId: result.entity_id },
      }), 1500);
```

This requires capturing the return value from `createStudent`. Update the try block:

```typescript
    try {
      const result = await createStudent(tenant, baseData, customFields);
      setSuccessMessage(t('addStudent.success'));
      setTimeout(() => navigate('/students', {
        state: { highlightEntityId: result.entity_id },
      }), 1500);
    } catch (e) {
```

- [ ] **Step 2: Type check and build**

Run: `cd /Users/kennylee/Development/NeoApex/admindash/frontend && npx tsc -b && npm run build 2>&1 | tail -10`
Expected: No errors, build succeeds

- [ ] **Step 3: Commit**

```bash
cd /Users/kennylee/Development/NeoApex/admindash
git add frontend/src/pages/AddStudentPage.tsx
git commit -m "feat: pass entity_id via router state for newly-added student highlighting"
```

---

## Task Dependency Graph

```
Task 1 (Query API)  ──┐
                       ├──► Task 7 (StudentsPage Rewrite)
Task 2 (API Client) ──┤
Task 3 (ModelContext)──┤
Task 4 (i18n)       ──┤
Task 5 (Preferences) ─┤
Task 6 (DataTable)  ──┘
                          Task 7 ──► Task 8 (AddStudent Integration)
```

Tasks 1-6 are independent of each other and can run in parallel. Task 7 depends on all of 1-6. Task 8 depends on Task 7.
