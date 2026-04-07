# Students Toolbar Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the StudentsPage toolbar with a unified three-dot menu containing bulk actions (delete/edit) and column visibility toggles, plus a new DataCore archive endpoint.

**Architecture:** DataCore gets `store.archive_entity()` and `POST /api/entities/{tenant_id}/{entity_type}/archive`. DataTable exposes selection via callback prop. StudentsPage replaces its toolbar buttons and column popover with a single ⋮ menu.

**Tech Stack:** Python/FastAPI/LanceDB (DataCore), TypeScript/React (AdminDash)

**Spec:** `docs/superpowers/specs/2026-04-06-students-toolbar-redesign-design.md`

---

## File Structure

| File | Action | Responsibility |
|---|---|---|
| `datacore/src/datacore/store.py` | Modify | Add `archive_entity()` method |
| `datacore/src/datacore/api/routes.py` | Modify | Add `POST /api/entities/{tenant_id}/{entity_type}/archive` |
| `datacore/tests/test_archive_api.py` | Create | Tests for archive endpoint |
| `admindash/frontend/src/components/DataTable.tsx` | Modify | Expose selection via `onSelectionChange` prop |
| `admindash/frontend/src/api/client.ts` | Modify | Add `archiveEntities()` function |
| `admindash/frontend/src/pages/StudentsPage.tsx` | Modify | Replace toolbar with ⋮ menu, add archive flow |
| `admindash/frontend/src/pages/StudentsPage.css` | Modify | Restyle toolbar, add three-dot menu styles |

---

### Task 1: DataCore — add archive_entity store method and API endpoint with tests

**Files:**
- Modify: `datacore/src/datacore/store.py`
- Modify: `datacore/src/datacore/api/routes.py`
- Create: `datacore/tests/test_archive_api.py`

- [ ] **Step 1: Write failing tests**

Create `datacore/tests/test_archive_api.py`:

```python
"""Tests for POST /api/entities/{tenant_id}/{entity_type}/archive endpoint."""
import tempfile

import pytest
from fastapi.testclient import TestClient
from unittest.mock import MagicMock

from datacore import Store
from datacore.api import create_app


@pytest.fixture
def arc_client():
    with tempfile.TemporaryDirectory() as tmp:
        mock_embedder = MagicMock()
        mock_embedder.embed.return_value = [0.0] * 1024
        store = Store(data_dir=tmp, embedder=mock_embedder)

        store.put_entity(
            tenant_id="t1", entity_type="tenant", entity_id="t1",
            base_data={"tenant_id": "t1", "name": "Test School", "_abbrev": "TES"},
        )
        store.put_entity(
            tenant_id="t1", entity_type="student", entity_id="s1",
            base_data={"first_name": "Alice", "last_name": "Smith"},
        )
        store.put_entity(
            tenant_id="t1", entity_type="student", entity_id="s2",
            base_data={"first_name": "Bob", "last_name": "Jones"},
        )
        store.put_entity(
            tenant_id="t1", entity_type="student", entity_id="s3",
            base_data={"first_name": "Carol", "last_name": "Lee"},
        )

        app = create_app(store)
        yield TestClient(app), store


def test_archive_single(arc_client):
    client, store = arc_client
    resp = client.post("/api/entities/t1/student/archive", json={
        "entity_ids": ["s1"],
    })
    assert resp.status_code == 200
    assert resp.json() == {"archived": 1}

    # Verify entity is no longer active
    entity = store.get_active_entity("t1", "student", "s1")
    assert entity is None


def test_archive_multiple(arc_client):
    client, store = arc_client
    resp = client.post("/api/entities/t1/student/archive", json={
        "entity_ids": ["s1", "s2"],
    })
    assert resp.status_code == 200
    assert resp.json() == {"archived": 2}

    assert store.get_active_entity("t1", "student", "s1") is None
    assert store.get_active_entity("t1", "student", "s2") is None
    # s3 still active
    assert store.get_active_entity("t1", "student", "s3") is not None


def test_archive_nonexistent(arc_client):
    client, _ = arc_client
    resp = client.post("/api/entities/t1/student/archive", json={
        "entity_ids": ["nonexistent"],
    })
    assert resp.status_code == 200
    assert resp.json() == {"archived": 0}


def test_archive_empty_list(arc_client):
    client, _ = arc_client
    resp = client.post("/api/entities/t1/student/archive", json={
        "entity_ids": [],
    })
    assert resp.status_code == 200
    assert resp.json() == {"archived": 0}


def test_archive_missing_body(arc_client):
    client, _ = arc_client
    resp = client.post("/api/entities/t1/student/archive", json={})
    assert resp.status_code == 422
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd datacore && uv run python -m pytest tests/test_archive_api.py -v`
Expected: FAIL — endpoint doesn't exist

- [ ] **Step 3: Add archive_entity to Store**

In `datacore/src/datacore/store.py`, add after `get_active_entity()` (after line 396):

```python
    def archive_entity(
        self, tenant_id: str, entity_type: str, entity_id: str
    ) -> bool:
        """Set _status to 'archived' on the active version of an entity.

        Returns True if an active entity was found and archived, False otherwise.
        """
        table_name = self._entities_table_name(tenant_id)
        if table_name not in self._table_names():
            return False

        table = self._db.open_table(table_name)
        where = (
            f"entity_type = '{entity_type}' "
            f"AND entity_id = '{entity_id}' "
            f"AND _status = 'active'"
        )
        active_rows = table.search().where(where).to_list()
        if not active_rows:
            return False

        now = self._now()
        table.delete(where)
        for row in active_rows:
            row["_status"] = "archived"
            row["_updated_at"] = now
        table.add(active_rows)
        return True
```

- [ ] **Step 4: Add archive endpoint to routes.py**

In `datacore/src/datacore/api/routes.py`, add inside `register_routes()`, after `create_entity`:

First add the request model near the top of `register_routes` (after existing models):

```python
    class ArchiveRequest(BaseModel):
        entity_ids: list[str]
```

Then add the endpoint:

```python
    @app.post("/api/entities/{tenant_id}/{entity_type}/archive")
    def archive_entities(tenant_id: str, entity_type: str, body: ArchiveRequest):
        count = 0
        for eid in body.entity_ids:
            if store.archive_entity(tenant_id, entity_type, eid):
                count += 1
        return {"archived": count}
```

- [ ] **Step 5: Run tests**

Run: `cd datacore && uv run python -m pytest tests/test_archive_api.py -v`
Expected: All 5 tests pass

- [ ] **Step 6: Run all DataCore tests**

Run: `cd datacore && uv run python -m pytest tests/ -q`
Expected: All tests pass (no regressions)

- [ ] **Step 7: Commit**

```bash
git add datacore/src/datacore/store.py datacore/src/datacore/api/routes.py datacore/tests/test_archive_api.py
git commit -m "feat(datacore): add archive entity endpoint and store method"
```

---

### Task 2: DataTable — expose selection via callback prop

**Files:**
- Modify: `admindash/frontend/src/components/DataTable.tsx`

- [ ] **Step 1: Add onSelectionChange and selectedIds props**

In `admindash/frontend/src/components/DataTable.tsx`, add to the `DataTableProps` interface (after line 31):

```typescript
  // Selection
  selectedIds?: Set<string>;
  onSelectionChange?: (ids: Set<string>) => void;
```

- [ ] **Step 2: Update component to use external selection when provided**

Replace the internal `selectedIds` state (line 53) and the `toggleAll`/`toggleRow` functions (lines 64-81):

```typescript
  const [internalSelectedIds, setInternalSelectedIds] = useState<Set<string>>(new Set());
  const selectedIds = propSelectedIds ?? internalSelectedIds;
  const setSelectedIds = onSelectionChange ?? setInternalSelectedIds;
```

Where `propSelectedIds` is the destructured prop name. Update the destructuring at the top of the component — rename the prop to avoid conflict:

Change the destructuring to add the new props:

```typescript
}: DataTableProps<T> & { selectedIds?: Set<string>; onSelectionChange?: (ids: Set<string>) => void }) {
```

Actually, cleaner approach — add to the interface and destructure with rename:

In the interface (lines 12-32), add:
```typescript
  // Selection
  selectedIds?: Set<string>;
  onSelectionChange?: (ids: Set<string>) => void;
```

In the destructuring (lines 35-51), add:
```typescript
  selectedIds: controlledSelectedIds,
  onSelectionChange,
```

Then replace lines 53 and 64-81 with:

```typescript
  const [internalSelectedIds, setInternalSelectedIds] = useState<Set<string>>(new Set());
  const selectedIds = controlledSelectedIds ?? internalSelectedIds;

  function updateSelection(next: Set<string>) {
    if (onSelectionChange) {
      onSelectionChange(next);
    } else {
      setInternalSelectedIds(next);
    }
  }

  // ... (keep totalPages, hiddenSet, visibleColumns, allOnPageSelected unchanged)

  function toggleAll() {
    const next = new Set(selectedIds);
    if (allOnPageSelected) {
      data.forEach((row) => next.delete(rowKey(row)));
    } else {
      data.forEach((row) => next.add(rowKey(row)));
    }
    updateSelection(next);
  }

  function toggleRow(id: string) {
    const next = new Set(selectedIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    updateSelection(next);
  }
```

- [ ] **Step 3: Verify TypeScript compiles**

Run: `cd admindash/frontend && npx tsc -b --noEmit`
Expected: No errors (existing callers don't pass the new optional props, so they still work)

- [ ] **Step 4: Commit**

```bash
git add admindash/frontend/src/components/DataTable.tsx
git commit -m "feat(admindash): expose DataTable selection via optional controlled props"
```

---

### Task 3: AdminDash — add archiveEntities client function

**Files:**
- Modify: `admindash/frontend/src/api/client.ts`

- [ ] **Step 1: Add archiveEntities function**

In `admindash/frontend/src/api/client.ts`, add after `postQuery()` (after line 32):

```typescript
export async function archiveEntities(
  tenantId: string,
  entityType: string,
  entityIds: string[],
): Promise<{ archived: number }> {
  const resp = await fetch(
    `${DATACORE_API_BASE}/api/entities/${tenantId}/${entityType}/archive`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ entity_ids: entityIds }),
    },
  );
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  return resp.json();
}
```

- [ ] **Step 2: Commit**

```bash
git add admindash/frontend/src/api/client.ts
git commit -m "feat(admindash): add archiveEntities API client function"
```

---

### Task 4: StudentsPage — replace toolbar with three-dot menu and archive flow

**Files:**
- Modify: `admindash/frontend/src/pages/StudentsPage.tsx`
- Modify: `admindash/frontend/src/pages/StudentsPage.css`

- [ ] **Step 1: Add selection state and menu state to StudentsPage**

In `admindash/frontend/src/pages/StudentsPage.tsx`, add imports at the top:

```typescript
import { archiveEntities } from '../api/client.ts';
```

Add state variables after the existing state declarations (after the `activeHighlight` state around line 201):

```typescript
  // Selection state (controlled, passed to DataTable)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // Three-dot menu state
  const [showMenu, setShowMenu] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // Archive confirmation
  const [showArchiveConfirm, setShowArchiveConfirm] = useState(false);
  const [archiving, setArchiving] = useState(false);
```

- [ ] **Step 2: Add menu close-on-outside-click and archive handler**

Replace the existing column popover outside-click `useEffect` (the one referencing `columnToggleRef` and `showColumnPopover`) with:

```typescript
  // Close menu on outside click
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setShowMenu(false);
      }
    }
    if (showMenu) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [showMenu]);
```

Add archive handler after `handlePageSizeChange`:

```typescript
  async function handleArchive() {
    if (selectedIds.size === 0) return;
    setShowArchiveConfirm(false);
    setArchiving(true);
    try {
      await archiveEntities(tenant, 'student', [...selectedIds]);
      setSelectedIds(new Set());
      loadData(1, filters);
    } catch (err) {
      setError(`Failed to archive students: ${err}`);
    } finally {
      setArchiving(false);
    }
  }
```

- [ ] **Step 3: Replace toolbar JSX**

Remove the old `columnToggleRef` ref declaration and `showColumnPopover` state. Remove the old toolbar `<div className="students-toolbar">` block entirely (lines 469-494).

Replace with:

```tsx
      <div className="students-toolbar">
        <button className="students-toolbar-primary" onClick={() => navigate('/students/add')}>
          {t('students.addStudent')}
        </button>

        <div style={{ flex: 1 }} />

        {selectedIds.size > 0 && (
          <span className="students-selection-count">
            {selectedIds.size} selected
          </span>
        )}

        <div className="students-menu-toggle" ref={menuRef}>
          <button
            className="students-menu-btn"
            onClick={() => setShowMenu((prev) => !prev)}
            aria-label="More actions"
          >
            ⋮
          </button>
          {showMenu && (
            <div className="students-menu-popover">
              {selectedIds.size > 0 && (
                <>
                  <div className="students-menu-section-label">Actions</div>
                  <button
                    className="students-menu-item"
                    disabled={selectedIds.size !== 1}
                    onClick={() => { setShowMenu(false); alert('Edit page coming soon'); }}
                  >
                    Edit Selected
                  </button>
                  <button
                    className="students-menu-item students-menu-item-danger"
                    onClick={() => { setShowMenu(false); setShowArchiveConfirm(true); }}
                  >
                    Delete Selected
                  </button>
                  <button
                    className="students-menu-item"
                    onClick={() => { setShowMenu(false); alert('Export coming soon'); }}
                  >
                    Export Selected
                  </button>
                  <div className="students-menu-divider" />
                </>
              )}
              <div className="students-menu-section-label">Columns</div>
              {columns.map((col) => (
                <label key={col.key} className="students-menu-column-option">
                  <input
                    type="checkbox"
                    checked={!prefs.hiddenColumns.includes(col.key)}
                    onChange={() => toggleColumn(col.key)}
                  />
                  {col.i18nKey ? t(col.i18nKey) : col.label}
                </label>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Archive confirmation dialog */}
      {showArchiveConfirm && (
        <div className="students-confirm-overlay" onClick={() => setShowArchiveConfirm(false)}>
          <div className="students-confirm-dialog" onClick={(e) => e.stopPropagation()}>
            <p>Delete {selectedIds.size} student(s)?</p>
            <div className="students-confirm-actions">
              <button onClick={() => setShowArchiveConfirm(false)}>Cancel</button>
              <button className="students-confirm-danger" onClick={handleArchive} disabled={archiving}>
                {archiving ? 'Deleting...' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
```

- [ ] **Step 4: Pass selection props to DataTable**

Update the DataTable JSX to include selection props:

```tsx
        <DataTable<DataRow>
          columns={columns}
          data={data}
          total={total}
          page={page}
          pageSize={prefs.pageSize}
          loading={loading}
          onPageChange={(p) => loadData(p, filters)}
          rowKey={(row) => String(row.entity_id ?? '')}
          sortBy={prefs.sortBy === 'last_name' ? 'name' : prefs.sortBy}
          sortDir={prefs.sortDir}
          onSortChange={handleSortChange}
          pageSizeOptions={[...PAGE_SIZE_OPTIONS]}
          onPageSizeChange={handlePageSizeChange}
          hiddenColumns={prefs.hiddenColumns}
          rowClassName={rowClassName}
          selectedIds={selectedIds}
          onSelectionChange={setSelectedIds}
        />
```

- [ ] **Step 5: Clean up removed state and refs**

Remove these declarations that are no longer needed:
- `const [showColumnPopover, setShowColumnPopover] = useState(false);`
- `const columnToggleRef = useRef<HTMLDivElement>(null);`
- The old `useEffect` for `showColumnPopover` outside-click handling

- [ ] **Step 6: Update CSS**

Replace the toolbar and column toggle styles in `admindash/frontend/src/pages/StudentsPage.css`. Replace everything from `.students-toolbar` through `.students-column-option input[type="checkbox"]` (lines 13-129) with:

```css
.students-toolbar {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin-bottom: 1rem;
}

.students-toolbar-primary {
  font-family: var(--font-sans);
  font-size: 0.85rem;
  font-weight: 500;
  padding: 0.45rem 0.85rem;
  border: none;
  border-radius: var(--radius-sm);
  background: #378ADD;
  color: var(--text-inverse);
  cursor: pointer;
  transition: all 0.2s;
}

.students-toolbar-primary:hover {
  transform: translateY(-2px);
  box-shadow: 0 8px 32px rgba(55, 138, 221, 0.3);
}

.students-selection-count {
  font-size: 0.8rem;
  color: var(--text-tertiary);
}

.students-menu-toggle {
  position: relative;
}

.students-menu-btn {
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

.students-menu-btn:hover {
  background: var(--bg-card);
  color: var(--text-primary);
}

.students-menu-popover {
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

.students-menu-section-label {
  font-size: 0.7rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  color: var(--text-tertiary);
  padding: 0.4rem 0.75rem 0.2rem;
}

.students-menu-item {
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

.students-menu-item:hover {
  background: var(--accent-glow);
}

.students-menu-item:disabled {
  color: var(--text-tertiary);
  cursor: not-allowed;
}

.students-menu-item:disabled:hover {
  background: none;
}

.students-menu-item-danger {
  color: var(--danger);
}

.students-menu-divider {
  height: 1px;
  background: var(--border-primary);
  margin: 0.3rem 0;
}

.students-menu-column-option {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  font-size: 0.8rem;
  color: var(--text-primary);
  padding: 0.25rem 0.75rem;
  cursor: pointer;
}

.students-menu-column-option:hover {
  background: var(--accent-glow);
}

.students-menu-column-option input[type="checkbox"] {
  width: 0.9rem;
  height: 0.9rem;
}

/* Archive confirmation dialog */
.students-confirm-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.4);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 200;
}

.students-confirm-dialog {
  background: var(--bg-card);
  border-radius: var(--radius-md);
  padding: 1.5rem;
  min-width: 300px;
  box-shadow: var(--shadow-elevated);
}

.students-confirm-dialog p {
  font-size: 0.95rem;
  font-weight: 500;
  margin-bottom: 1rem;
}

.students-confirm-actions {
  display: flex;
  gap: 0.5rem;
  justify-content: flex-end;
}

.students-confirm-actions button {
  font-family: var(--font-sans);
  font-size: 0.85rem;
  padding: 0.4rem 0.85rem;
  border-radius: var(--radius-sm);
  cursor: pointer;
  border: 1px solid var(--border-primary);
  background: var(--bg-tertiary);
  color: var(--text-primary);
}

.students-confirm-danger {
  background: var(--danger) !important;
  color: var(--text-inverse) !important;
  border-color: var(--danger) !important;
}
```

- [ ] **Step 7: Verify TypeScript build**

Run: `cd admindash/frontend && npx tsc -b --noEmit`
Expected: No errors

- [ ] **Step 8: Commit**

```bash
git add admindash/frontend/src/pages/StudentsPage.tsx admindash/frontend/src/pages/StudentsPage.css admindash/frontend/src/api/client.ts
git commit -m "feat(admindash): replace toolbar with three-dot menu and archive flow"
```

---

### Task 5: Full verification

- [ ] **Step 1: Run DataCore tests**

Run: `cd datacore && uv run python -m pytest tests/ -q`
Expected: All tests pass

- [ ] **Step 2: Build AdminDash**

Run: `cd admindash/frontend && npx tsc -b --noEmit`
Expected: No errors

- [ ] **Step 3: Verify no stale references**

Run from repo root:
```bash
grep -r "batchExport\|batchActions\|columnSettings\|showColumnPopover\|columnToggleRef" admindash/frontend/src/ --include="*.ts" --include="*.tsx"
```
Expected: No matches (all old toolbar references removed)

- [ ] **Step 4: Test archive endpoint with curl**

```bash
curl -s -X POST http://localhost:5800/api/entities/acme/student/archive \
  -H "Content-Type: application/json" \
  -d '{"entity_ids": ["test-nonexistent"]}' | python3 -m json.tool
```
Expected: `{"archived": 0}`
