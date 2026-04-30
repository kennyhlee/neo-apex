# Add Student Modal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the page-based AddStudentPage with an inline modal on StudentsPage, keeping all functionality (tabbed form/upload, auto-ID, duplicate detection).

**Architecture:** Extract all add-student logic from AddStudentPage into a new AddStudentModal component. StudentsPage opens the modal via state toggle instead of navigating to `/students/add`. On success, the modal calls back to refresh the student list and highlight the new row.

**Tech Stack:** React 19, TypeScript, CSS variables, existing DynamicForm/DocumentUpload/DuplicateWarningModal components.

---

### Task 1: Create AddStudentModal CSS

**Files:**
- Create: `frontend/src/components/AddStudentModal.css`

- [ ] **Step 1: Create the CSS file**

Create `frontend/src/components/AddStudentModal.css` with styles for the modal card and tabs. Reuse the `students-confirm-overlay` class from StudentsPage.css for the backdrop. The modal card uses a new `add-modal` class, wider than the edit modal (780px vs 640px).

```css
/* Add Student Modal — wider than edit modal for tabbed interface */
.add-modal {
  background: var(--bg-card);
  border-radius: var(--radius-md);
  padding: 0;
  width: 92%;
  max-width: 780px;
  max-height: 85vh;
  overflow-y: auto;
  box-shadow: var(--shadow-elevated);
}

.add-modal-header {
  padding: 1.25rem 1.5rem 0;
}

.add-modal-header h3 {
  font-size: 1.1rem;
  font-weight: 600;
  margin: 0 0 1rem 0;
}

.add-modal-tabs {
  display: flex;
  gap: 0;
  border-bottom: 2px solid var(--border-primary);
  padding: 0 1.5rem;
}

.add-modal-tab {
  padding: 0.6rem 1.25rem;
  font-size: 0.85rem;
  font-weight: 500;
  background: none;
  border: none;
  border-bottom: 2px solid transparent;
  margin-bottom: -2px;
  cursor: pointer;
  color: var(--text-secondary);
  transition: color 0.2s, border-color 0.2s;
}

.add-modal-tab:hover {
  color: var(--text-primary);
}

.add-modal-tab.active {
  color: var(--color-accent);
  border-bottom-color: var(--color-accent);
}

.add-modal-body {
  padding: 1rem 1.5rem 1.5rem;
}

.add-modal-success {
  background: rgba(99, 153, 34, 0.1);
  color: var(--color-success);
  padding: 0.75rem 1rem;
  border-radius: 8px;
  margin-bottom: 1rem;
  font-size: 0.85rem;
}

.add-modal-error {
  background: rgba(212, 83, 126, 0.1);
  color: var(--color-danger);
  padding: 1rem 1.25rem;
  border-radius: 8px;
  margin-bottom: 1rem;
  font-size: 0.9rem;
}

.add-modal-id-warning {
  background: rgba(229, 160, 13, 0.1);
  color: var(--color-warning, #e5a00d);
  padding: 0.6rem 1rem;
  border-radius: 8px;
  margin-bottom: 1rem;
  font-size: 0.82rem;
}
```

- [ ] **Step 2: Commit**

```bash
cd /Users/kennylee/Development/NeoApex
git add admindash/frontend/src/components/AddStudentModal.css
git commit -m "feat(admindash): add AddStudentModal CSS styles"
```

---

### Task 2: Create AddStudentModal Component

**Files:**
- Create: `frontend/src/components/AddStudentModal.tsx`
- Reference (read-only): `frontend/src/pages/AddStudentPage.tsx`

This component extracts all add-student logic from AddStudentPage into a modal. It manages its own state (tabs, form data, auto-ID, duplicate detection, submission) and communicates with StudentsPage via `onClose` and `onSuccess` callbacks.

- [ ] **Step 1: Create the component file**

Create `frontend/src/components/AddStudentModal.tsx` with the following content. This is adapted from `AddStudentPage.tsx` — the key differences are: (1) no `useNavigate`, (2) success calls `onSuccess(entityId)` instead of navigating, (3) cancel calls `onClose()`, (4) wrapped in the overlay/modal card markup.

```tsx
import { useState, useEffect, useCallback, useMemo } from 'react';
import { useTranslation } from '../hooks/useTranslation.ts';
import {
  createStudent,
  extractStudentFromDocument,
  fetchNextStudentId,
  checkDuplicateStudents,
} from '../api/client.ts';
import { useModel } from '../contexts/ModelContext.tsx';
import { useDashboard } from '../contexts/DashboardContext.tsx';
import DynamicForm from './DynamicForm.tsx';
import DocumentUpload from './DocumentUpload.tsx';
import DuplicateWarningModal from './DuplicateWarningModal.tsx';
import type { ModelDefinition, DuplicateMatch } from '../types/models.ts';
import './AddStudentModal.css';

interface AddStudentModalProps {
  tenant: string;
  onClose: () => void;
  onSuccess: (entityId: string) => void;
}

export default function AddStudentModal({ tenant, onClose, onSuccess }: AddStudentModalProps) {
  const { t } = useTranslation();
  const { getModel } = useModel();
  const { invalidateStudentCount } = useDashboard();

  const [activeTab, setActiveTab] = useState<'form' | 'upload'>('form');
  const [modelDef, setModelDef] = useState<ModelDefinition | null>(null);
  const [modelError, setModelError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [extractedValues, setExtractedValues] = useState<Record<string, unknown>>({});
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // Auto-ID state
  const [generatedId, setGeneratedId] = useState<string | null>(null);
  const [idError, setIdError] = useState<string | null>(null);
  const [checkingDuplicates, setCheckingDuplicates] = useState(false);
  const readOnlyFields = useMemo(() => generatedId ? ['student_id'] : [], [generatedId]);

  // Duplicate detection state
  const [duplicateMatches, setDuplicateMatches] = useState<DuplicateMatch[] | null>(null);
  const [pendingSubmission, setPendingSubmission] = useState<{
    baseData: Record<string, unknown>;
    customFields: Record<string, unknown>;
  } | null>(null);

  // Load model + fetch next ID on mount
  useEffect(() => {
    setLoading(true);
    setModelError(null);

    Promise.all([
      getModel(tenant, 'student'),
      fetchNextStudentId(tenant).catch(() => null),
    ])
      .then(([def, nextId]) => {
        setModelDef(def);
        if (nextId) {
          setGeneratedId(nextId.next_id);
        } else {
          setIdError(t('addStudent.autoIdUnavailable'));
        }
      })
      .catch(() => setModelError(t('addStudent.modelNotFound')))
      .finally(() => setLoading(false));
  }, [tenant, getModel, t]);

  const handleExtracted = (fields: Record<string, string>) => {
    setExtractedValues((prev) => ({ ...prev, ...fields }));
    setActiveTab('form');
  };

  const handleUpload = async (file: File): Promise<Record<string, string>> => {
    const resp = await extractStudentFromDocument(tenant, file);
    return resp.fields;
  };

  const doCreateStudent = useCallback(async (
    baseData: Record<string, unknown>,
    customFields: Record<string, unknown>,
  ) => {
    setSubmitting(true);
    setSubmitError(null);
    try {
      const { student_id: _, ...submitData } = baseData;
      const result = await createStudent(tenant, submitData, customFields);
      invalidateStudentCount();
      setSuccessMessage(t('addStudent.success'));
      setTimeout(() => onSuccess(result.entity_id), 1200);
    } catch (e) {
      setSubmitError(e instanceof Error ? e.message : t('addStudent.submitError'));
    } finally {
      setSubmitting(false);
    }
  }, [tenant, invalidateStudentCount, onSuccess, t]);

  const handleSubmit = async (
    baseData: Record<string, unknown>,
    customFields: Record<string, unknown>,
  ) => {
    setSubmitting(true);
    setCheckingDuplicates(true);
    setSubmitError(null);

    try {
      const searchData = {
        first_name: String(baseData.first_name || ''),
        last_name: String(baseData.last_name || ''),
        dob: String(baseData.dob || ''),
        primary_address: String(baseData.primary_address || ''),
      };
      const result = await checkDuplicateStudents(tenant, searchData);

      if (result.matches.length > 0) {
        setDuplicateMatches(result.matches);
        setPendingSubmission({ baseData, customFields });
        setSubmitting(false);
        setCheckingDuplicates(false);
        return;
      }
    } catch {
      setDuplicateMatches([]);
      setPendingSubmission({ baseData, customFields });
      setSubmitting(false);
      setCheckingDuplicates(false);
      return;
    }

    setCheckingDuplicates(false);
    setSubmitting(false);
    await doCreateStudent(baseData, customFields);
  };

  const handleSaveAnyway = async () => {
    if (!pendingSubmission) return;
    setDuplicateMatches(null);
    const { baseData, customFields } = pendingSubmission;
    setPendingSubmission(null);
    await doCreateStudent(baseData, customFields);
  };

  const handleGoBack = () => {
    setDuplicateMatches(null);
    setPendingSubmission(null);
  };

  const initialValues: Record<string, unknown> = {
    ...extractedValues,
    ...(generatedId ? { student_id: generatedId } : {}),
  };

  const submitButtonText = checkingDuplicates
    ? t('addStudent.checkingDuplicates')
    : undefined;

  return (
    <div className="students-confirm-overlay">
      <div className="add-modal">
        <div className="add-modal-header">
          <h3>{t('addStudent.title')}</h3>
        </div>

        {loading ? (
          <div className="add-modal-body">
            <p>{t('common.loading')}</p>
          </div>
        ) : modelError ? (
          <div className="add-modal-body">
            <div className="add-modal-error">{modelError}</div>
            <button
              className="add-student-back-btn"
              onClick={onClose}
            >
              {t('common.cancel')}
            </button>
          </div>
        ) : (
          <>
            <div className="add-modal-tabs">
              <button
                className={`add-modal-tab ${activeTab === 'form' ? 'active' : ''}`}
                onClick={() => setActiveTab('form')}
              >
                {t('addStudent.webForm')}
              </button>
              <button
                className={`add-modal-tab ${activeTab === 'upload' ? 'active' : ''}`}
                onClick={() => setActiveTab('upload')}
              >
                {t('addStudent.uploadDocument')}
              </button>
            </div>

            <div className="add-modal-body">
              {successMessage && (
                <div className="add-modal-success">{successMessage}</div>
              )}

              {idError && (
                <div className="add-modal-id-warning">{idError}</div>
              )}

              {activeTab === 'form' && modelDef && (
                <DynamicForm
                  modelDefinition={modelDef}
                  initialValues={initialValues}
                  readOnlyFields={readOnlyFields}
                  onSubmit={handleSubmit}
                  onCancel={onClose}
                  submitting={submitting}
                  error={submitError}
                  submitButtonText={submitButtonText}
                />
              )}
              {activeTab === 'upload' && (
                <DocumentUpload
                  onExtracted={handleExtracted}
                  onUpload={handleUpload}
                />
              )}
            </div>
          </>
        )}

        {/* Duplicate warning modal — matches found */}
        {duplicateMatches !== null && duplicateMatches.length > 0 && (
          <DuplicateWarningModal
            matches={duplicateMatches}
            onGoBack={handleGoBack}
            onSaveAnyway={handleSaveAnyway}
          />
        )}

        {/* Duplicate check failed — let user choose */}
        {duplicateMatches !== null && duplicateMatches.length === 0 && pendingSubmission && (
          <div className="duplicate-modal-overlay" onClick={handleGoBack}>
            <div className="duplicate-modal" onClick={(e) => e.stopPropagation()}>
              <h3 className="duplicate-modal-title">
                {t('duplicateWarning.title')}
              </h3>
              <p className="duplicate-modal-description">
                {t('addStudent.duplicateCheckUnavailable')}
              </p>
              <div className="duplicate-modal-actions">
                <button
                  className="duplicate-modal-btn-secondary"
                  onClick={handleGoBack}
                >
                  {t('duplicateWarning.cancelSave')}
                </button>
                <button
                  className="duplicate-modal-btn-primary"
                  onClick={handleSaveAnyway}
                >
                  {t('duplicateWarning.proceedWithoutCheck')}
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

- [ ] **Step 2: Commit**

```bash
cd /Users/kennylee/Development/NeoApex
git add admindash/frontend/src/components/AddStudentModal.tsx
git commit -m "feat(admindash): add AddStudentModal component"
```

---

### Task 3: Integrate AddStudentModal into StudentsPage

**Files:**
- Modify: `frontend/src/pages/StudentsPage.tsx`

- [ ] **Step 1: Add the import**

At the top of `frontend/src/pages/StudentsPage.tsx`, add the import after the existing component imports (around line 13, after the `StatusBadge` import):

```tsx
import AddStudentModal from '../components/AddStudentModal.tsx';
```

- [ ] **Step 2: Add showAddModal state**

In the `StudentsPage` component function, add a new state variable after the `showComingSoon` state (line 253):

```tsx
  // Add student modal
  const [showAddModal, setShowAddModal] = useState(false);
```

- [ ] **Step 3: Wire the Add Student button to open the modal**

In StudentsPage.tsx, find the "Add Student" button (line 514):

```tsx
        <button className="students-toolbar-primary" onClick={() => navigate('/students/add')}>
```

Replace it with:

```tsx
        <button className="students-toolbar-primary" onClick={() => setShowAddModal(true)}>
```

- [ ] **Step 4: Add the onSuccess handler and render the modal**

Find the closing `{/* Coming soon dialog for batch edit */}` block that ends around line 635. After that block's closing `)}`, add the AddStudentModal render:

```tsx
      {/* Add student modal */}
      {showAddModal && (
        <AddStudentModal
          tenant={tenant}
          onClose={() => setShowAddModal(false)}
          onSuccess={(entityId) => {
            setShowAddModal(false);
            setActiveHighlight(entityId);
            loadData(page, filters);
          }}
        />
      )}
```

- [ ] **Step 5: Commit**

```bash
cd /Users/kennylee/Development/NeoApex
git add admindash/frontend/src/pages/StudentsPage.tsx
git commit -m "feat(admindash): integrate AddStudentModal into StudentsPage"
```

---

### Task 4: Remove AddStudentPage Route

**Files:**
- Modify: `frontend/src/App.tsx`

- [ ] **Step 1: Remove the AddStudentPage import**

In `frontend/src/App.tsx`, remove line 12:

```tsx
import AddStudentPage from './pages/AddStudentPage.tsx';
```

- [ ] **Step 2: Remove the /students/add route**

In `frontend/src/App.tsx`, remove the route block (lines 41-44):

```tsx
                    <Route
                      path="/students/add"
                      element={<AddStudentPage tenant={tenant} />}
                    />
```

- [ ] **Step 3: Commit**

```bash
cd /Users/kennylee/Development/NeoApex
git add admindash/frontend/src/App.tsx
git commit -m "refactor(admindash): remove AddStudentPage route from router"
```

---

### Task 5: Build Verification

**Files:**
- None (verification only)

- [ ] **Step 1: Run TypeScript build**

```bash
cd /Users/kennylee/Development/NeoApex/admindash/frontend && npm run build
```

Expected: Clean build with no TypeScript errors.

- [ ] **Step 2: Run lint**

```bash
cd /Users/kennylee/Development/NeoApex/admindash/frontend && npm run lint
```

Expected: No lint errors in changed files.

- [ ] **Step 3: Fix any issues and commit if needed**

If there are build or lint errors, fix them and commit:

```bash
cd /Users/kennylee/Development/NeoApex
git add -A admindash/frontend/src/
git commit -m "fix(admindash): fix build/lint issues in add student modal"
```
