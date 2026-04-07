# Read API Consolidation Phase 2 — Consumer Migration Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate LaunchPad, Papermite, and AdminDash from old DataCore GET read endpoints to the unified `POST /api/query` endpoint.

**Architecture:** Each service's existing GET calls are replaced inline with `POST /api/query` calls that include DuckDB SQL. No new abstractions or wrappers. AdminDash additionally removes the cross-tenant listing and tenant dropdown (tenant comes from JWT).

**Tech Stack:** Python/httpx (backends), TypeScript/React/fetch (AdminDash frontend)

**Spec:** `docs/superpowers/specs/2026-04-06-read-api-consolidation-phase2-design.md`

---

## File Structure

| File | Action | Responsibility |
|---|---|---|
| `launchpad/backend/app/api/tenants.py` | Modify | Replace 4 GET calls with POST /api/query |
| `papermite/backend/app/api/extraction.py` | Modify | Replace `_get_active_model()` GET with POST /api/query |
| `papermite/backend/app/api/extract.py` | Modify | Replace `_get_active_model()` GET with POST /api/query |
| `admindash/frontend/src/api/client.ts` | Modify | Add `postQuery()`, remove `fetchTenants`, `fetchStudentModel`, `runQuery`, `queryStudents` |
| `admindash/frontend/src/types/models.ts` | Modify | Remove `TenantsResponse`, `QueryStudentsParams`, update `QueryResult` |
| `admindash/frontend/src/components/Navbar.tsx` | Modify | Remove tenant dropdown, display tenant from auth |
| `admindash/frontend/src/App.tsx` | Modify | Remove `onTenantChange`, simplify tenant state |
| `admindash/frontend/src/contexts/DashboardContext.tsx` | Modify | Use `postQuery` instead of `runQuery`, fix `rows` → `data` |
| `admindash/frontend/src/contexts/ModelContext.tsx` | Modify | Use `postQuery` instead of `fetchStudentModel` |
| `admindash/frontend/src/pages/StudentsPage.tsx` | Modify | Build SQL directly, use `postQuery` instead of `queryStudents` |
| `admindash/frontend/src/pages/AddStudentPage.tsx` | Modify | Use `postQuery` instead of `fetchStudentModel` (via ModelContext) |

---

### Task 1: LaunchPad backend — migrate tenant reads to unified query

**Files:**
- Modify: `launchpad/backend/app/api/tenants.py`

- [ ] **Step 1: Migrate get_tenant_profile()**

In `launchpad/backend/app/api/tenants.py`, replace `get_tenant_profile()` (lines 23-35):

```python
@router.get("/tenants/{tenant_id}")
def get_tenant_profile(tenant_id: str, user=Depends(require_role("admin", "staff"))):
    if user["tenant_id"] != tenant_id:
        raise HTTPException(status_code=403, detail="Tenant mismatch")
    resp = httpx.post(
        _datacore_url("/api/query"),
        json={
            "tenant_id": tenant_id,
            "table": "tenants",
            "sql": "SELECT * FROM data WHERE entity_type = 'tenant' AND _status = 'active'",
        },
    )
    if resp.status_code != 200:
        raise HTTPException(status_code=502, detail="Failed to fetch tenant")
    rows = resp.json().get("data", [])
    if not rows:
        return {"tenant_id": tenant_id, "name": user["tenant_name"]}
    data = rows[0]
    data["tenant_id"] = tenant_id
    return data
```

- [ ] **Step 2: Migrate update_tenant_profile() existence check**

In the same file, replace the GET in `update_tenant_profile()` (lines 38-58):

```python
@router.put("/tenants/{tenant_id}")
def update_tenant_profile(tenant_id: str, body: dict, user=Depends(require_role("admin"))):
    if user["tenant_id"] != tenant_id:
        raise HTTPException(status_code=403, detail="Tenant mismatch")
    body.pop("name", None)
    body.pop("tenant_id", None)

    existing_resp = httpx.post(
        _datacore_url("/api/query"),
        json={
            "tenant_id": tenant_id,
            "table": "tenants",
            "sql": "SELECT * FROM data WHERE entity_type = 'tenant' AND _status = 'active'",
        },
    )
    if existing_resp.status_code == 200 and existing_resp.json().get("data"):
        existing = existing_resp.json()["data"][0]
        base_data = {**existing, **body}
    else:
        base_data = {"tenant_id": tenant_id, **body}

    resp = httpx.put(
        _datacore_url(f"/tenants/{tenant_id}"),
        json={"base_data": base_data},
    )
    if resp.status_code not in (200, 201):
        raise HTTPException(status_code=502, detail="Failed to update tenant")
    return {**base_data, "tenant_id": tenant_id}
```

- [ ] **Step 3: Migrate get_model()**

Replace `get_model()` (lines 61-71):

```python
@router.get("/tenants/{tenant_id}/model")
def get_model(tenant_id: str, user=Depends(get_current_user)):
    if user["tenant_id"] != tenant_id:
        raise HTTPException(status_code=403, detail="Tenant mismatch")
    resp = httpx.post(
        _datacore_url("/api/query"),
        json={
            "tenant_id": tenant_id,
            "table": "models",
            "sql": "SELECT * FROM data WHERE entity_type = 'tenant' AND _status = 'active'",
        },
    )
    if resp.status_code != 200:
        raise HTTPException(status_code=502, detail="Failed to fetch model")
    rows = resp.json().get("data", [])
    if not rows:
        return None
    return rows[0].get("model_definition")
```

- [ ] **Step 4: Migrate get_model_info()**

Replace `get_model_info()` (lines 74-90):

```python
@router.get("/tenants/{tenant_id}/model/info")
def get_model_info(tenant_id: str, user=Depends(get_current_user)):
    if user["tenant_id"] != tenant_id:
        raise HTTPException(status_code=403, detail="Tenant mismatch")
    resp = httpx.post(
        _datacore_url("/api/query"),
        json={
            "tenant_id": tenant_id,
            "table": "models",
            "sql": "SELECT * FROM data WHERE entity_type = 'tenant' AND _status = 'active'",
        },
    )
    if resp.status_code != 200:
        raise HTTPException(status_code=502, detail="Failed to fetch model")
    rows = resp.json().get("data", [])
    if not rows:
        return None
    model = rows[0]
    return {
        "model_definition": model.get("model_definition"),
        "version": model.get("_version"),
        "change_id": model.get("_change_id"),
        "created_at": model.get("_created_at"),
        "updated_at": model.get("_updated_at"),
    }
```

- [ ] **Step 5: Verify LaunchPad backend starts**

Run: `cd launchpad/backend && python -c "from app.main import app; print('OK')"`
Expected: `OK` — no import errors.

- [ ] **Step 6: Commit**

```bash
git add launchpad/backend/app/api/tenants.py
git commit -m "refactor(launchpad): migrate read endpoints to unified POST /api/query"
```

---

### Task 2: Papermite backend — migrate model reads to unified query

**Files:**
- Modify: `papermite/backend/app/api/extraction.py`
- Modify: `papermite/backend/app/api/extract.py`

- [ ] **Step 1: Migrate _get_active_model() in extraction.py**

In `papermite/backend/app/api/extraction.py`, replace `_get_active_model()` (lines 13-20):

```python
def _get_active_model(tenant_id: str) -> dict | None:
    """Fetch the combined active model from DataCore unified query API."""
    resp = httpx.post(
        f"{settings.datacore_api_url}/api/query",
        json={
            "tenant_id": tenant_id,
            "table": "models",
            "sql": "SELECT * FROM data WHERE _status = 'active'",
        },
    )
    if resp.status_code != 200:
        raise HTTPException(status_code=502, detail="Failed to fetch model from DataCore")
    rows = resp.json().get("data", [])
    if not rows:
        return None
    return rows[0]
```

- [ ] **Step 2: Migrate _get_active_model() in extract.py**

In `papermite/backend/app/api/extract.py`, replace `_get_active_model()` (lines 19-26):

```python
def _get_active_model(tenant_id: str) -> dict | None:
    """Fetch the combined active model from DataCore unified query API."""
    resp = httpx.post(
        f"{settings.datacore_api_url}/api/query",
        json={
            "tenant_id": tenant_id,
            "table": "models",
            "sql": "SELECT * FROM data WHERE _status = 'active'",
        },
    )
    if resp.status_code != 200:
        raise HTTPException(status_code=502, detail="Failed to fetch model from DataCore")
    rows = resp.json().get("data", [])
    if not rows:
        return None
    return rows[0]
```

- [ ] **Step 3: Run Papermite tests**

Run: `cd papermite/backend && python -m pytest tests/ -v`
Expected: All tests pass. The extract API tests mock `_get_active_model` at the call site (`patch("app.api.extract.get_active_model", ...)`), so they are unaffected by the internal implementation change.

- [ ] **Step 4: Verify Papermite backend starts**

Run: `cd papermite/backend && python -c "from app.main import app; print('OK')"`
Expected: `OK` — no import errors.

- [ ] **Step 5: Commit**

```bash
git add papermite/backend/app/api/extraction.py papermite/backend/app/api/extract.py
git commit -m "refactor(papermite): migrate model reads to unified POST /api/query"
```

---

### Task 3: AdminDash frontend — add postQuery and migrate DashboardContext

**Files:**
- Modify: `admindash/frontend/src/api/client.ts`
- Modify: `admindash/frontend/src/types/models.ts`
- Modify: `admindash/frontend/src/contexts/DashboardContext.tsx`

- [ ] **Step 1: Add postQuery() to client.ts**

In `admindash/frontend/src/api/client.ts`, add after the `authHeaders()` function (after line 22) and before `fetchTenants`:

```typescript
export async function postQuery(
  tenantId: string,
  table: 'entities' | 'models' | 'tenants',
  sql: string,
): Promise<{ data: Record<string, unknown>[]; total: number }> {
  const resp = await fetch(`${DATACORE_API_BASE}/api/query`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tenant_id: tenantId, table, sql }),
  });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  return resp.json();
}
```

- [ ] **Step 2: Remove fetchTenants() from client.ts**

Delete the `fetchTenants` function (lines 24-28):

```typescript
// DELETE this entire function:
export async function fetchTenants(): Promise<TenantsResponse> {
  const resp = await fetch(`${DATACORE_API_BASE}/api/tenants`);
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  return resp.json();
}
```

Also remove `TenantsResponse` from the import at the top of the file (line 2).

- [ ] **Step 3: Remove runQuery() and QueryResult from client.ts**

Delete the `QueryResult` interface and `runQuery` function (lines 79-95):

```typescript
// DELETE this interface:
export interface QueryResult {
  rows: Record<string, unknown>[];
  total: number;
}

// DELETE this function:
export async function runQuery(
  tenantId: string,
  tableType: string,
  sql: string,
): Promise<QueryResult> {
  const params = new URLSearchParams({ sql });
  const resp = await fetch(
    `${DATACORE_API_BASE}/api/query/${tenantId}/${tableType}?${params}`,
  );
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  return resp.json();
}
```

- [ ] **Step 4: Remove fetchStudentModel() from client.ts**

Delete the `fetchStudentModel` function (lines 30-39):

```typescript
// DELETE this entire function:
export async function fetchStudentModel(
  tenantId: string,
): Promise<ModelResponse> {
  const resp = await fetch(
    `${DATACORE_API_BASE}/api/models/${tenantId}/student`,
  );
  if (resp.status === 404) throw new Error('Student model not configured');
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  return resp.json();
}
```

- [ ] **Step 5: Remove queryStudents() from client.ts**

Delete the `queryStudents` function (lines 97-112):

```typescript
// DELETE this entire function:
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

- [ ] **Step 6: Clean up unused imports in client.ts**

Remove unused type imports from line 1. The remaining imports should only include types still used by remaining functions (`CreateEntityResponse`, `ExtractResponse`, `NextIdResponse`, `DuplicateCheckRequest`, `DuplicateCheckResponse`). Remove: `TenantsResponse`, `ModelResponse`, `QueryStudentsParams`, `QueryStudentsResponse`.

- [ ] **Step 7: Clean up types/models.ts**

In `admindash/frontend/src/types/models.ts`:

Remove `TenantsResponse` (lines 48-50):
```typescript
// DELETE:
export interface TenantsResponse {
  tenants: { id: string; name?: string }[];
}
```

Remove `QueryStudentsParams` (lines 83-90):
```typescript
// DELETE:
export interface QueryStudentsParams {
  _status?: string;
  sort_by?: string;
  sort_dir?: 'asc' | 'desc';
  limit?: number;
  offset?: number;
  [field: string]: string | number | undefined;
}
```

`QueryStudentsResponse` (lines 92-95) can remain — it matches the unified response shape (`{data, total}`) and is used by StudentsPage.

- [ ] **Step 8: Migrate DashboardContext.tsx**

In `admindash/frontend/src/contexts/DashboardContext.tsx`, replace the import and usage:

Change line 2 from:
```typescript
import { runQuery } from '../api/client.ts';
```
to:
```typescript
import { postQuery } from '../api/client.ts';
```

Replace lines 32-34 (inside `getStudentCount`):
```typescript
        const sql = "SELECT COUNT(*) as count FROM data WHERE entity_type = 'student' AND _status = 'active'";
        const result = await postQuery(tenantId, 'entities', sql);
        const count = Number(result.data[0]?.count ?? 0);
```

- [ ] **Step 9: Run TypeScript check**

Run: `cd admindash/frontend && npx tsc -b --noEmit`
Expected: Type errors for `ModelContext.tsx`, `StudentsPage.tsx` (they still import removed functions). These will be fixed in the next tasks. `DashboardContext.tsx` and `client.ts` should have no errors of their own.

- [ ] **Step 10: Commit**

```bash
git add admindash/frontend/src/api/client.ts admindash/frontend/src/types/models.ts admindash/frontend/src/contexts/DashboardContext.tsx
git commit -m "refactor(admindash): add postQuery, remove old read helpers, migrate DashboardContext"
```

---

### Task 4: AdminDash frontend — migrate ModelContext and AddStudentPage

**Files:**
- Modify: `admindash/frontend/src/contexts/ModelContext.tsx`
- Modify: `admindash/frontend/src/pages/AddStudentPage.tsx`

- [ ] **Step 1: Migrate ModelContext.tsx**

Replace the full file content of `admindash/frontend/src/contexts/ModelContext.tsx`:

```typescript
import { createContext, useContext, useState, useCallback, type ReactNode } from 'react';
import { postQuery } from '../api/client.ts';
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

      const sql = `SELECT * FROM data WHERE entity_type = '${entityType}' AND _status = 'active'`;
      const result = await postQuery(tenantId, 'models', sql);
      if (!result.data.length) throw new Error('Model not configured');
      const modelDef = result.data[0].model_definition as unknown as ModelDefinition;
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

- [ ] **Step 2: Verify AddStudentPage.tsx needs no changes**

`AddStudentPage.tsx` calls `getModel(tenant, 'student')` from `ModelContext` — it doesn't import `fetchStudentModel` directly. No changes needed. Confirm by checking its imports (line 4-9) — none reference removed functions.

- [ ] **Step 3: Run TypeScript check**

Run: `cd admindash/frontend && npx tsc -b --noEmit`
Expected: Errors only from `StudentsPage.tsx` (still imports `queryStudents`) and `Navbar.tsx` (still imports `fetchTenants`).

- [ ] **Step 4: Commit**

```bash
git add admindash/frontend/src/contexts/ModelContext.tsx
git commit -m "refactor(admindash): migrate ModelContext to unified query"
```

---

### Task 5: AdminDash frontend — migrate StudentsPage to construct SQL

**Files:**
- Modify: `admindash/frontend/src/pages/StudentsPage.tsx`

- [ ] **Step 1: Update imports**

In `admindash/frontend/src/pages/StudentsPage.tsx`, change line 8 from:
```typescript
import { queryStudents } from '../api/client.ts';
```
to:
```typescript
import { postQuery } from '../api/client.ts';
```

- [ ] **Step 2: Replace loadData callback**

Replace the `loadData` callback (lines 244-300) with SQL-constructing version:

```typescript
  const loadData = useCallback(
    async (p: number, currentFilters?: Record<string, string>) => {
      setLoading(true);
      setError(null);
      const f = currentFilters ?? filters;
      try {
        // Build WHERE clauses
        const conditions: string[] = ["entity_type = 'student'"];

        for (const [key, value] of Object.entries(f)) {
          if (!value) continue;
          const safeVal = value.replace(/'/g, "''");
          if (key === '_status') {
            if (value !== 'all') conditions.push(`_status = '${safeVal}'`);
          } else {
            conditions.push(`${key} ILIKE '%${safeVal}%'`);
          }
        }

        const where = conditions.join(' AND ');
        const sortCol = prefs.sortBy;
        const dir = prefs.sortDir.toUpperCase();
        const limit = prefs.pageSize;
        const offset = (p - 1) * prefs.pageSize;

        const sql = `SELECT * FROM data WHERE ${where} ORDER BY ${sortCol} ${dir} LIMIT ${limit} OFFSET ${offset}`;
        const res = await postQuery(tenant, 'entities', sql);
        let rows = res.data ?? [];

        // For total count, run a separate count query with same filters (no LIMIT/OFFSET)
        const countSql = `SELECT COUNT(*) as count FROM data WHERE ${where}`;
        const countRes = await postQuery(tenant, 'entities', countSql);
        const totalCount = Number(countRes.data[0]?.count ?? 0);

        // Highlight: move newly-added entity to top of list on page 1
        if (activeHighlight && p === 1) {
          const idx = rows.findIndex((r) => String(r.entity_id) === activeHighlight);
          if (idx > 0) {
            const [item] = rows.splice(idx, 1);
            rows = [item, ...rows];
          } else if (idx === -1) {
            try {
              const highlightSql = `SELECT * FROM data WHERE entity_id = '${activeHighlight.replace(/'/g, "''")}' LIMIT 1`;
              const highlighted = await postQuery(tenant, 'entities', highlightSql);
              const found = highlighted.data?.[0];
              if (found) {
                rows = [found, ...rows];
              }
            } catch {
              // ignore — highlight is best effort
            }
          }
        }

        setData(rows);
        setTotal(totalCount);
        setPage(p);
      } catch (err) {
        setError(
          `Failed to load students. Is the datacore API at ${DATACORE_URL} running? (${err})`,
        );
        setData([]);
        setTotal(0);
      } finally {
        setLoading(false);
      }
    },
    [tenant, filters, prefs.sortBy, prefs.sortDir, prefs.pageSize, activeHighlight],
  );
```

- [ ] **Step 3: Run TypeScript check**

Run: `cd admindash/frontend && npx tsc -b --noEmit`
Expected: Errors only from `Navbar.tsx` (still imports `fetchTenants`). StudentsPage should compile cleanly.

- [ ] **Step 4: Commit**

```bash
git add admindash/frontend/src/pages/StudentsPage.tsx
git commit -m "refactor(admindash): migrate StudentsPage to construct SQL for unified query"
```

---

### Task 6: AdminDash frontend — remove tenant dropdown, simplify Navbar and App

**Files:**
- Modify: `admindash/frontend/src/components/Navbar.tsx`
- Modify: `admindash/frontend/src/App.tsx`

- [ ] **Step 1: Rewrite Navbar.tsx**

Replace the full content of `admindash/frontend/src/components/Navbar.tsx`:

```tsx
import { NavLink, useNavigate } from 'react-router-dom';
import { useTranslation } from '../hooks/useTranslation.ts';
import { useAuth } from '../contexts/AuthContext.tsx';
import type { Locale } from '../i18n/translations.ts';
import './Navbar.css';

export default function Navbar() {
  const { t, locale, setLocale } = useTranslation();
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  const navItems = [
    { to: '/home', label: t('nav.home') },
    { to: '/leads', label: t('nav.lead') },
    { to: '/students', label: t('nav.student') },
    { to: '/programs', label: t('nav.program') },
  ];

  const displayName = user?.name ?? 'User';
  const avatarInitial = displayName.charAt(0).toUpperCase();
  const tenantName = user?.tenant_name ?? '';

  function handleLogout() {
    logout();
    navigate('/login');
  }

  return (
    <nav className="navbar">
      <div className="navbar-inner">
        <a className="navbar-brand" href="/">
          <img
            src="https://www.acmeschool.com/uploads/2/7/1/4/27147223/1418317113.png"
            alt="Logo"
          />
          <span className="navbar-brand-text" style={{ color: '#378ADD' }}>{t('nav.systemName')}</span>
        </a>

        <ul className="navbar-nav">
          {navItems.map((item) => (
            <li key={item.to}>
              <NavLink
                to={item.to}
                className={({ isActive }) => (isActive ? 'active' : '')}
              >
                {item.label}
              </NavLink>
            </li>
          ))}
        </ul>

        <div className="navbar-right">
          <span className="navbar-site-label">{tenantName}</span>

          <select
            className="navbar-lang-select"
            value={locale}
            onChange={(e) => setLocale(e.target.value as Locale)}
          >
            <option value="en-US">English</option>
            <option value="zh-CN">中文</option>
          </select>

          <div className="navbar-user" onClick={handleLogout} title={t('nav.logout')}>
            <div className="navbar-avatar">{avatarInitial}</div>
            <span className="navbar-username">{displayName}</span>
          </div>
        </div>
      </div>
    </nav>
  );
}
```

Key changes:
- Removed `fetchTenants` import, `useState`/`useEffect` imports, `Tenant` type import
- Removed `NavbarProps` interface — no more props
- Removed tenant state, `useEffect` to fetch tenants, and `<select>` dropdown
- Display `user.tenant_name` as static text via `navbar-site-label`

- [ ] **Step 2: Update App.tsx**

Replace the full content of `admindash/frontend/src/App.tsx`:

```tsx
import { useEffect, useState } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './contexts/AuthContext.tsx';
import { ModelProvider } from './contexts/ModelContext.tsx';
import { DashboardProvider } from './contexts/DashboardContext.tsx';
import Navbar from './components/Navbar.tsx';
import Footer from './components/Footer.tsx';
import LoginPage from './pages/LoginPage.tsx';
import HomePage from './pages/HomePage.tsx';
import StudentsPage from './pages/StudentsPage.tsx';
import LeadPage from './pages/LeadPage.tsx';
import ProgramPage from './pages/ProgramPage.tsx';
import AddStudentPage from './pages/AddStudentPage.tsx';
import './App.css';

function AppRoutes() {
  const { user, ready } = useAuth();
  const [tenant, setTenant] = useState('');

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
            <DashboardProvider>
              <div className="app-shell">
                <Navbar />
                <main className="app-main">
                  <Routes>
                    <Route path="/home" element={<HomePage tenant={tenant} />} />
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
            </DashboardProvider>
            </ModelProvider>
          )
        }
      />
    </Routes>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <AppRoutes />
      </AuthProvider>
    </BrowserRouter>
  );
}
```

Key changes:
- `Navbar` no longer receives `currentTenant`/`onTenantChange` props
- `tenant` state is still needed for page components but is read-only from `user.tenant_id`

- [ ] **Step 3: Remove Tenant type from models.ts**

In `admindash/frontend/src/types/models.ts`, delete the `Tenant` interface (lines 38-41):

```typescript
// DELETE:
export interface Tenant {
  id: string;
  name: string;
}
```

- [ ] **Step 4: Run TypeScript build**

Run: `cd admindash/frontend && npm run build`
Expected: Build succeeds with no errors.

- [ ] **Step 5: Run lint**

Run: `cd admindash/frontend && npm run lint`
Expected: No new lint errors (unused import warnings may surface — fix any).

- [ ] **Step 6: Commit**

```bash
git add admindash/frontend/src/components/Navbar.tsx admindash/frontend/src/App.tsx admindash/frontend/src/types/models.ts
git commit -m "refactor(admindash): remove tenant dropdown, derive tenant from JWT"
```

---

### Task 7: Full build verification

- [ ] **Step 1: Build AdminDash**

Run: `cd admindash/frontend && npm run build`
Expected: Clean build, no errors.

- [ ] **Step 2: Verify LaunchPad backend imports**

Run: `cd launchpad/backend && python -c "from app.main import app; print('OK')"`
Expected: `OK`

- [ ] **Step 3: Run Papermite tests**

Run: `cd papermite/backend && python -m pytest tests/ -v`
Expected: All tests pass.

- [ ] **Step 4: Verify no stale imports**

Run from repo root:
```bash
grep -r "fetchTenants\|runQuery\|queryStudents\|fetchStudentModel" admindash/frontend/src/ --include="*.ts" --include="*.tsx"
```
Expected: No matches (all old function references removed).

```bash
grep -r "GET.*\/api\/tenants\|GET.*\/api\/models\|GET.*\/api\/entities.*query\|GET.*\/api\/query" launchpad/backend/ papermite/backend/ --include="*.py"
```
Expected: No matches in Python files (all old GET patterns replaced).
