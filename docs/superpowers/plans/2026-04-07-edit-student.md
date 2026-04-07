# Edit Student Modal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a modal-based edit flow for single student records, triggered from the StudentsPage ⋮ menu, with a new DataCore update entity endpoint.

**Architecture:** New PUT endpoint in DataCore exposes existing `store.put_entity()` for updates. AdminDash gets an `updateStudent()` client function. StudentsPage adds an edit modal using the existing `DynamicForm` component with `readOnlyFields` for identity fields. Multiple selection shows a "Coming soon" dialog.

**Tech Stack:** Python/FastAPI/LanceDB (DataCore), TypeScript/React (AdminDash)

**Spec:** `docs/superpowers/specs/2026-04-07-edit-student-design.md`

---

## File Structure

| File | Action | Responsibility |
|---|---|---|
| `datacore/src/datacore/api/routes.py` | Modify | Add `PUT /api/entities/{tenant_id}/{entity_type}/{entity_id}` |
| `datacore/tests/test_update_entity_api.py` | Create | Tests for update endpoint |
| `admindash/frontend/src/api/client.ts` | Modify | Add `updateStudent()` function |
| `admindash/frontend/src/pages/StudentsPage.tsx` | Modify | Add edit modal, coming-soon dialog, wire menu items |
| `admindash/frontend/src/pages/StudentsPage.css` | Modify | Edit modal styles |

---

### Task 1: DataCore — add PUT entity endpoint with tests

**Files:**
- Modify: `datacore/src/datacore/api/routes.py`
- Create: `datacore/tests/test_update_entity_api.py`

- [ ] **Step 1: Write failing tests**

Create `datacore/tests/test_update_entity_api.py`:

```python
"""Tests for PUT /api/entities/{tenant_id}/{entity_type}/{entity_id} endpoint."""
import tempfile

import pytest
from fastapi.testclient import TestClient
from unittest.mock import MagicMock

from datacore import Store
from datacore.api import create_app


@pytest.fixture
def upd_client():
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
            base_data={"first_name": "Alice", "last_name": "Smith", "grade_level": "2nd"},
            custom_fields={"transportation": "bus"},
        )

        app = create_app(store)
        yield TestClient(app), store


def test_update_entity(upd_client):
    client, store = upd_client
    resp = client.put("/api/entities/t1/student/s1", json={
        "base_data": {"first_name": "Alice", "last_name": "Smith", "grade_level": "3rd"},
        "custom_fields": {"transportation": "car"},
    })
    assert resp.status_code == 200
    body = resp.json()
    assert body["base_data"]["grade_level"] == "3rd"
    assert body["custom_fields"]["transportation"] == "car"
    assert body["_version"] == 2

    # Verify via store
    entity = store.get_active_entity("t1", "student", "s1")
    assert entity["base_data"]["grade_level"] == "3rd"


def test_update_entity_not_found(upd_client):
    client, _ = upd_client
    resp = client.put("/api/entities/t1/student/nonexistent", json={
        "base_data": {"first_name": "Bob"},
    })
    assert resp.status_code == 200
    # put_entity creates if not exists — this is by design
    assert resp.json()["_version"] == 1


def test_update_entity_no_tenant(upd_client):
    client, _ = upd_client
    resp = client.put("/api/entities/no_tenant/student/s1", json={
        "base_data": {"first_name": "Alice"},
    })
    assert resp.status_code == 400
    assert "Tenant" in resp.json()["detail"]


def test_update_entity_missing_body(upd_client):
    client, _ = upd_client
    resp = client.put("/api/entities/t1/student/s1", json={})
    assert resp.status_code == 422


def test_update_preserves_version_history(upd_client):
    client, store = upd_client
    # Update twice
    client.put("/api/entities/t1/student/s1", json={
        "base_data": {"first_name": "Alice", "last_name": "Smith", "grade_level": "3rd"},
    })
    client.put("/api/entities/t1/student/s1", json={
        "base_data": {"first_name": "Alice", "last_name": "Smith", "grade_level": "4th"},
    })
    entity = store.get_active_entity("t1", "student", "s1")
    assert entity["_version"] == 3
    assert entity["base_data"]["grade_level"] == "4th"
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd datacore && uv run python -m pytest tests/test_update_entity_api.py -v`
Expected: FAIL — endpoint doesn't exist

- [ ] **Step 3: Add PUT endpoint to routes.py**

In `datacore/src/datacore/api/routes.py`, add the update endpoint after the `archive_entities` endpoint (after line 259) and before `create_entity`:

```python
    @app.put("/api/entities/{tenant_id}/{entity_type}/{entity_id}")
    def update_entity(
        tenant_id: str, entity_type: str, entity_id: str, body: CreateEntityRequest
    ):
        try:
            result = store.put_entity(
                tenant_id=tenant_id,
                entity_type=entity_type,
                entity_id=entity_id,
                base_data=dict(body.base_data),
                custom_fields=body.custom_fields,
            )
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e))
        return result
```

Important: This must be registered BEFORE the `POST /api/entities/{tenant_id}/{entity_type}` route because FastAPI matches routes in registration order, and `{entity_id}` could conflict with the `archive` and other sub-paths. Actually, PUT vs POST methods won't conflict. But `PUT /api/entities/{tenant_id}/{entity_type}/{entity_id}` must be placed before `POST /api/entities/{tenant_id}/{entity_type}` to avoid any path confusion. Since they are different HTTP methods (PUT vs POST), there's no actual conflict — just add it near the other entity endpoints.

- [ ] **Step 4: Run tests**

Run: `cd datacore && uv run python -m pytest tests/test_update_entity_api.py -v`
Expected: All 5 tests pass

- [ ] **Step 5: Run all DataCore tests**

Run: `cd datacore && uv run python -m pytest tests/ -q`
Expected: All tests pass

- [ ] **Step 6: Commit**

```bash
git add datacore/src/datacore/api/routes.py datacore/tests/test_update_entity_api.py
git commit -m "feat(datacore): add PUT /api/entities/{tenant_id}/{entity_type}/{entity_id} update endpoint"
```

---

### Task 2: AdminDash — add updateStudent client function

**Files:**
- Modify: `admindash/frontend/src/api/client.ts`

- [ ] **Step 1: Add updateStudent function**

In `admindash/frontend/src/api/client.ts`, add after `archiveEntities()` (after line 49):

```typescript
export async function updateStudent(
  tenantId: string,
  entityId: string,
  baseData: Record<string, unknown>,
  customFields: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const resp = await fetch(
    `${DATACORE_API_BASE}/api/entities/${tenantId}/student/${entityId}`,
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify({
        base_data: baseData,
        custom_fields: customFields,
      }),
    },
  );
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  return resp.json();
}
```

- [ ] **Step 2: Commit**

```bash
git add admindash/frontend/src/api/client.ts
git commit -m "feat(admindash): add updateStudent API client function"
```

---

### Task 3: StudentsPage — add edit modal and coming-soon dialog

**Files:**
- Modify: `admindash/frontend/src/pages/StudentsPage.tsx`
- Modify: `admindash/frontend/src/pages/StudentsPage.css`

- [ ] **Step 1: Add imports and state**

In `admindash/frontend/src/pages/StudentsPage.tsx`, add to the import from `../api/client.ts`:

```typescript
import { postQuery, archiveEntities, updateStudent } from '../api/client.ts';
```

Add `DynamicForm` import:
```typescript
import DynamicForm from '../components/DynamicForm.tsx';
```

Add state variables after the existing `archiving` state:

```typescript
  // Edit modal state
  const [editingEntity, setEditingEntity] = useState<DataRow | null>(null);
  const [editSubmitting, setEditSubmitting] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  // Coming soon dialog
  const [showComingSoon, setShowComingSoon] = useState(false);
```

- [ ] **Step 2: Add edit handler**

Add after `handleArchive`:

```typescript
  async function handleEditSave(baseData: Record<string, unknown>, customFields: Record<string, unknown>) {
    if (!editingEntity) return;
    setEditSubmitting(true);
    setEditError(null);
    try {
      const entityId = String(editingEntity.entity_id);
      await updateStudent(tenant, entityId, baseData, customFields);
      setEditingEntity(null);
      setSelectedIds(new Set());
      loadData(page, filters);
    } catch (err) {
      setEditError(`Failed to update student: ${err}`);
    } finally {
      setEditSubmitting(false);
    }
  }
```

- [ ] **Step 3: Update Edit Selected menu item**

Replace the "Edit Selected" button (the one with `alert('Edit page coming soon')`) with:

```tsx
                  <button
                    className="students-menu-item"
                    onClick={() => {
                      setShowMenu(false);
                      if (selectedIds.size === 1) {
                        const entityId = [...selectedIds][0];
                        const row = data.find((r) => String(r.entity_id) === entityId);
                        if (row) setEditingEntity(row);
                      } else {
                        setShowComingSoon(true);
                      }
                    }}
                  >
                    Edit Selected
                  </button>
```

- [ ] **Step 4: Add edit modal JSX**

Add after the archive confirmation dialog (before the `{error ? ...}` block):

```tsx
      {/* Edit student modal */}
      {editingEntity && model && (
        <div className="students-confirm-overlay" onClick={() => { setEditingEntity(null); setEditError(null); }}>
          <div className="students-edit-modal" onClick={(e) => e.stopPropagation()}>
            <div className="students-edit-modal-header">
              <h3>Edit Student</h3>
              <span className="students-edit-modal-subtitle">
                {String(editingEntity.first_name ?? '')} {String(editingEntity.last_name ?? '')}
              </span>
            </div>
            <div className="students-edit-modal-body">
              <DynamicForm
                modelDefinition={model}
                initialValues={editingEntity as Record<string, unknown>}
                readOnlyFields={['student_id', 'first_name', 'last_name', 'middle_name', 'family_id']}
                onSubmit={handleEditSave}
                onCancel={() => { setEditingEntity(null); setEditError(null); }}
                submitting={editSubmitting}
                error={editError}
              />
            </div>
          </div>
        </div>
      )}

      {/* Coming soon dialog for batch edit */}
      {showComingSoon && (
        <div className="students-confirm-overlay" onClick={() => setShowComingSoon(false)}>
          <div className="students-confirm-dialog" onClick={(e) => e.stopPropagation()}>
            <p>Batch edit is coming soon.</p>
            <div className="students-confirm-actions">
              <button onClick={() => setShowComingSoon(false)}>OK</button>
            </div>
          </div>
        </div>
      )}
```

- [ ] **Step 5: Remove old state and refs that are no longer needed**

Remove `showColumnPopover` state and `columnToggleRef` ref if they still exist (they may have been removed in the toolbar redesign — verify before removing).

- [ ] **Step 6: Add CSS for edit modal**

In `admindash/frontend/src/pages/StudentsPage.css`, add after the existing confirm dialog styles:

```css
/* Edit student modal */
.students-edit-modal {
  background: var(--bg-card);
  border-radius: var(--radius-md);
  padding: 0;
  width: 90%;
  max-width: 640px;
  max-height: 85vh;
  overflow-y: auto;
  box-shadow: var(--shadow-elevated);
}

.students-edit-modal-header {
  padding: 1.25rem 1.5rem;
  border-bottom: 1px solid var(--border-primary);
}

.students-edit-modal-header h3 {
  font-size: 1.1rem;
  font-weight: 600;
  margin: 0;
}

.students-edit-modal-subtitle {
  font-size: 0.85rem;
  color: var(--text-tertiary);
}

.students-edit-modal-body {
  padding: 1rem 1.5rem 1.5rem;
}
```

- [ ] **Step 7: Verify TypeScript build**

Run: `cd admindash/frontend && npx tsc -b --noEmit`
Expected: No errors

- [ ] **Step 8: Commit**

```bash
git add admindash/frontend/src/pages/StudentsPage.tsx admindash/frontend/src/pages/StudentsPage.css
git commit -m "feat(admindash): add edit student modal and coming-soon batch dialog"
```

---

### Task 4: Full verification

- [ ] **Step 1: Run DataCore tests**

Run: `cd datacore && uv run python -m pytest tests/ -q`
Expected: All tests pass

- [ ] **Step 2: Build AdminDash**

Run: `cd admindash/frontend && npx tsc -b --noEmit`
Expected: No errors

- [ ] **Step 3: Verify update endpoint with curl**

```bash
curl -s -X PUT http://localhost:5800/api/entities/acme/student/test-entity \
  -H "Content-Type: application/json" \
  -d '{"base_data": {"first_name": "Test", "last_name": "User"}}' | python3 -c "import sys,json; d=json.load(sys.stdin); print('version:', d.get('_version'), 'status:', d.get('_status'))"
```
Expected: `version: 1 status: active`
