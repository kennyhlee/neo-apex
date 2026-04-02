# Smart Student Enrollment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add auto-generated read-only student IDs and semantic duplicate detection to the add student flow.

**Architecture:** On form load, `AddStudentPage` fetches the next sequential student ID from datacore and passes it as a read-only `initialValues` field to `DynamicForm` (which gains a new generic `readOnlyFields` prop). On save, before calling `createStudent`, the page calls a similarity search endpoint with name/DOB/address fields. If matches are found, a `DuplicateWarningModal` lets the user abort or proceed.

**Tech Stack:** React 19, TypeScript 5.9, native Fetch API, CSS variables, custom i18n

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `frontend/src/types/models.ts` | Modify | Add `NextIdResponse`, `SimilaritySearchRequest`, `SimilaritySearchResponse`, `SimilarityMatch` interfaces |
| `frontend/src/api/client.ts` | Modify | Add `fetchNextStudentId()` and `searchSimilarStudents()` functions |
| `frontend/src/components/DynamicForm.tsx` | Modify | Add `readOnlyFields?: string[]` prop, disable + style matching fields, show helper text |
| `frontend/src/components/DynamicForm.css` | Modify | Add `.dynamic-form-field-readonly` and `.dynamic-form-field-helper` styles |
| `frontend/src/components/DuplicateWarningModal.tsx` | Create | Modal showing matched student records with similarity scores, Go Back / Save Anyway buttons |
| `frontend/src/components/DuplicateWarningModal.css` | Create | Styles for the duplicate warning modal |
| `frontend/src/pages/AddStudentPage.tsx` | Modify | Fetch next-id on mount, intercept submit for similarity check, manage modal state |
| `frontend/src/i18n/translations.ts` | Modify | Add en-US and zh-CN keys for auto-ID, duplicate detection, and modal strings |

---

### Task 1: Add TypeScript Interfaces

**Files:**
- Modify: `frontend/src/types/models.ts:80-98` (append after `QueryStudentsResponse`)

- [ ] **Step 1: Add new interfaces to models.ts**

Append the following after line 97 (end of `QueryStudentsResponse`):

```typescript
export interface NextIdResponse {
  next_id: string;
  tenant_abbrev: string;
  entity_abbrev: string;
  sequence: number;
}

export interface SimilarityMatch {
  entity_id: string;
  student_id: string;
  first_name: string;
  last_name: string;
  dob: string;
  primary_address: string;
  similarity_score: number;
}

export interface SimilaritySearchRequest {
  first_name: string;
  last_name: string;
  dob?: string;
  primary_address?: string;
}

export interface SimilaritySearchResponse {
  matches: SimilarityMatch[];
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `cd frontend && npx tsc -b`
Expected: Clean compile, no errors.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/types/models.ts
git commit -m "feat: add TypeScript interfaces for next-id and similarity search"
```

---

### Task 2: Add API Client Functions

**Files:**
- Modify: `frontend/src/api/client.ts:1-9` (imports), append after line 117

- [ ] **Step 1: Add imports for new types**

At the top of `frontend/src/api/client.ts`, add the new types to the import statement. Replace the existing import (lines 1-9):

```typescript
import type {
  StudentsResponse,
  TenantsResponse,
  ModelResponse,
  CreateEntityResponse,
  ExtractResponse,
  QueryStudentsParams,
  QueryStudentsResponse,
  NextIdResponse,
  SimilaritySearchRequest,
  SimilaritySearchResponse,
} from '../types/models.ts';
```

- [ ] **Step 2: Add fetchNextStudentId function**

Append after the `queryStudents` function (after line 117):

```typescript
export async function fetchNextStudentId(
  tenantId: string,
): Promise<NextIdResponse> {
  const resp = await fetch(
    `${DATACORE_API_BASE}/api/entities/${tenantId}/student/next-id`,
  );
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  return resp.json();
}
```

- [ ] **Step 3: Add searchSimilarStudents function**

Append after `fetchNextStudentId`:

```typescript
export async function searchSimilarStudents(
  tenantId: string,
  data: SimilaritySearchRequest,
): Promise<SimilaritySearchResponse> {
  const resp = await fetch(
    `${DATACORE_API_BASE}/api/entities/${tenantId}/student/similarity-search`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    },
  );
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  return resp.json();
}
```

- [ ] **Step 4: Verify TypeScript compiles**

Run: `cd frontend && npx tsc -b`
Expected: Clean compile, no errors.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/api/client.ts
git commit -m "feat: add API client functions for next-id and similarity search"
```

---

### Task 3: Add readOnlyFields Support to DynamicForm

**Files:**
- Modify: `frontend/src/components/DynamicForm.tsx:6-13` (props), `47-173` (renderField), `264-280` (field rendering)
- Modify: `frontend/src/components/DynamicForm.css` (append styles)

- [ ] **Step 1: Add readOnlyFields to DynamicFormProps interface**

In `frontend/src/components/DynamicForm.tsx`, update the `DynamicFormProps` interface (lines 6-13) to add the new prop:

```typescript
interface DynamicFormProps {
  modelDefinition: ModelDefinition;
  initialValues?: Record<string, unknown>;
  readOnlyFields?: string[];
  onSubmit: (baseData: Record<string, unknown>, customFields: Record<string, unknown>) => void;
  onCancel: () => void;
  submitting?: boolean;
  error?: string | null;
}
```

- [ ] **Step 2: Destructure readOnlyFields in the component**

Update the destructuring in the `DynamicForm` component (line 181-188). Replace:

```typescript
export default function DynamicForm({
  modelDefinition,
  initialValues,
  onSubmit,
  onCancel,
  submitting = false,
  error,
}: DynamicFormProps) {
```

with:

```typescript
export default function DynamicForm({
  modelDefinition,
  initialValues,
  readOnlyFields = [],
  onSubmit,
  onCancel,
  submitting = false,
  error,
}: DynamicFormProps) {
```

- [ ] **Step 3: Update renderField to accept and use isReadOnly parameter**

Update the `renderField` function signature (lines 47-52) to accept an `isReadOnly` parameter. Replace:

```typescript
function renderField(
  field: ModelFieldDefinition,
  value: unknown,
  onChange: (name: string, value: unknown) => void,
  fieldError: string | null,
) {
```

with:

```typescript
function renderField(
  field: ModelFieldDefinition,
  value: unknown,
  onChange: (name: string, value: unknown) => void,
  fieldError: string | null,
  isReadOnly: boolean,
) {
```

Then in each input case inside `renderField`, add `disabled={isReadOnly}` and append the readonly CSS class. Update the `str` case (lines 57-65) as the pattern — all other input cases follow the same pattern:

For `str` (line 57-65):
```typescript
    case 'str':
      return (
        <input
          type="text"
          className={`${errorClass}${isReadOnly ? ' dynamic-form-input-readonly' : ''}`}
          value={strValue}
          onChange={(e) => onChange(field.name, e.target.value)}
          disabled={isReadOnly}
        />
      );
```

Apply the same `disabled={isReadOnly}` and `className` pattern to these cases:
- `number` (lines 67-75): add `disabled={isReadOnly}` and readonly class to the `<input type="number">`
- `bool` (lines 77-84): add `disabled={isReadOnly}` to the `<input type="checkbox">`
- `date` (lines 86-94): add `disabled={isReadOnly}` and readonly class to the `<input type="date">`
- `datetime` (lines 96-104): add `disabled={isReadOnly}` and readonly class to the `<input type="datetime-local">`
- `email` (lines 106-114): add `disabled={isReadOnly}` and readonly class to the `<input type="email">`
- `phone` (lines 116-124): add `disabled={isReadOnly}` and readonly class to the `<input type="tel">`
- `selection` single (lines 149-162): add `disabled={isReadOnly}` and readonly class to the `<select>`
- `selection` multiple (lines 127-148): add `disabled={isReadOnly}` to each checkbox `<input>`
- `default` (lines 164-172): add `disabled={isReadOnly}` and readonly class to the `<input type="text">`

- [ ] **Step 4: Pass isReadOnly when calling renderField**

In the field rendering loop (around line 276), update the `renderField` call to pass the read-only status. Replace:

```typescript
              {renderField(field, values[field.name], handleChange, fieldError)}
```

with:

```typescript
              {renderField(field, values[field.name], handleChange, fieldError, readOnlyFields.includes(field.name))}
```

- [ ] **Step 5: Add helper text for read-only fields**

In the same field rendering block, after the `renderField` call and before the `fieldError` span (around lines 276-277), add helper text for read-only fields. After:

```typescript
              {renderField(field, values[field.name], handleChange, fieldError, readOnlyFields.includes(field.name))}
```

Add:

```typescript
              {readOnlyFields.includes(field.name) && (
                <span className="dynamic-form-field-helper">{t('dynamicForm.autoGenerated')}</span>
              )}
```

- [ ] **Step 6: Add CSS styles for read-only fields and helper text**

Append the following to `frontend/src/components/DynamicForm.css` after line 139:

```css
.dynamic-form-input-readonly {
  background: var(--bg-tertiary) !important;
  color: var(--text-secondary) !important;
  cursor: not-allowed;
  opacity: 0.8;
}

.dynamic-form-field-helper {
  font-size: 0.7rem;
  color: var(--text-tertiary, #94a3b8);
  font-style: italic;
}
```

- [ ] **Step 7: Verify TypeScript compiles**

Run: `cd frontend && npx tsc -b`
Expected: Clean compile, no errors.

- [ ] **Step 8: Commit**

```bash
git add frontend/src/components/DynamicForm.tsx frontend/src/components/DynamicForm.css
git commit -m "feat: add readOnlyFields prop to DynamicForm"
```

---

### Task 4: Create DuplicateWarningModal Component

**Files:**
- Create: `frontend/src/components/DuplicateWarningModal.tsx`
- Create: `frontend/src/components/DuplicateWarningModal.css`

- [ ] **Step 1: Create DuplicateWarningModal.tsx**

Create `frontend/src/components/DuplicateWarningModal.tsx`:

```typescript
import type { SimilarityMatch } from '../types/models.ts';
import { useTranslation } from '../hooks/useTranslation.ts';
import './DuplicateWarningModal.css';

interface DuplicateWarningModalProps {
  matches: SimilarityMatch[];
  onGoBack: () => void;
  onSaveAnyway: () => void;
}

export default function DuplicateWarningModal({
  matches,
  onGoBack,
  onSaveAnyway,
}: DuplicateWarningModalProps) {
  const { t } = useTranslation();
  const displayed = matches
    .sort((a, b) => b.similarity_score - a.similarity_score)
    .slice(0, 5);

  return (
    <div className="duplicate-modal-overlay" onClick={onGoBack}>
      <div className="duplicate-modal" onClick={(e) => e.stopPropagation()}>
        <h3 className="duplicate-modal-title">
          {t('duplicateWarning.title')}
        </h3>
        <p className="duplicate-modal-description">
          {t('duplicateWarning.description')}
        </p>

        <div className="duplicate-modal-matches">
          {displayed.map((match) => (
            <div key={match.entity_id} className="duplicate-modal-match-card">
              <div className="duplicate-modal-match-score">
                {Math.round(match.similarity_score * 100)}%
              </div>
              <div className="duplicate-modal-match-details">
                <div className="duplicate-modal-match-name">
                  {match.first_name} {match.last_name}
                </div>
                <div className="duplicate-modal-match-info">
                  <span>{t('duplicateWarning.studentId')}: {match.student_id}</span>
                  {match.dob && <span>{t('duplicateWarning.dob')}: {match.dob}</span>}
                  {match.primary_address && (
                    <span>{t('duplicateWarning.address')}: {match.primary_address}</span>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>

        <div className="duplicate-modal-actions">
          <button
            className="duplicate-modal-btn-secondary"
            onClick={onGoBack}
          >
            {t('duplicateWarning.goBack')}
          </button>
          <button
            className="duplicate-modal-btn-primary"
            onClick={onSaveAnyway}
          >
            {t('duplicateWarning.saveAnyway')}
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Create DuplicateWarningModal.css**

Create `frontend/src/components/DuplicateWarningModal.css`:

```css
.duplicate-modal-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
  animation: fadeIn 0.2s ease;
}

.duplicate-modal {
  background: var(--bg-card);
  border-radius: 12px;
  padding: 1.5rem;
  max-width: 560px;
  width: 90%;
  max-height: 80vh;
  overflow-y: auto;
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
}

.duplicate-modal-title {
  font-size: 1.1rem;
  font-weight: 700;
  color: var(--color-warning, #e5a00d);
  margin: 0 0 0.5rem 0;
}

.duplicate-modal-description {
  font-size: 0.85rem;
  color: var(--text-secondary);
  margin: 0 0 1rem 0;
  line-height: 1.4;
}

.duplicate-modal-matches {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  margin-bottom: 1.25rem;
}

.duplicate-modal-match-card {
  display: flex;
  align-items: flex-start;
  gap: 0.75rem;
  padding: 0.75rem;
  background: var(--bg-secondary);
  border-radius: 8px;
  border: 1px solid var(--border-primary);
}

.duplicate-modal-match-score {
  font-size: 0.85rem;
  font-weight: 700;
  color: var(--color-warning, #e5a00d);
  background: rgba(229, 160, 13, 0.1);
  padding: 0.25rem 0.5rem;
  border-radius: 6px;
  white-space: nowrap;
}

.duplicate-modal-match-details {
  flex: 1;
  min-width: 0;
}

.duplicate-modal-match-name {
  font-size: 0.9rem;
  font-weight: 600;
  color: var(--text-primary);
  margin-bottom: 0.25rem;
}

.duplicate-modal-match-info {
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
  font-size: 0.78rem;
  color: var(--text-secondary);
}

.duplicate-modal-actions {
  display: flex;
  justify-content: flex-end;
  gap: 0.75rem;
  padding-top: 1rem;
  border-top: 1px solid var(--border-subtle);
}

.duplicate-modal-btn-primary,
.duplicate-modal-btn-secondary {
  font-family: var(--font-sans);
  font-size: 0.85rem;
  font-weight: 500;
  padding: 0.45rem 1rem;
  border-radius: var(--radius-sm);
  border: none;
  cursor: pointer;
  transition: all 0.15s;
}

.duplicate-modal-btn-primary {
  background: var(--color-warning, #e5a00d);
  color: #fff;
}

.duplicate-modal-btn-primary:hover {
  transform: translateY(-1px);
  box-shadow: 0 4px 16px rgba(229, 160, 13, 0.3);
}

.duplicate-modal-btn-secondary {
  background: var(--bg-tertiary);
  color: var(--text-secondary);
}

.duplicate-modal-btn-secondary:hover {
  background: #f1f5f9;
}
```

- [ ] **Step 3: Verify TypeScript compiles**

Run: `cd frontend && npx tsc -b`
Expected: Clean compile, no errors.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/DuplicateWarningModal.tsx frontend/src/components/DuplicateWarningModal.css
git commit -m "feat: create DuplicateWarningModal component"
```

---

### Task 5: Add i18n Translation Keys

**Files:**
- Modify: `frontend/src/i18n/translations.ts:86-95` (en-US addStudent section), `237-246` (zh-CN addStudent section)

- [ ] **Step 1: Add en-US translation keys**

In `frontend/src/i18n/translations.ts`, after the existing `addStudent.submitError` line (line 95), add:

```typescript
    'addStudent.checkingDuplicates': 'Checking for duplicates...',
    'addStudent.duplicateCheckUnavailable': 'Duplicate checking is unavailable. Save anyway?',
    'addStudent.autoIdUnavailable': 'Auto-ID generation unavailable. Please enter manually.',

    // Dynamic Form
    'dynamicForm.autoGenerated': 'Auto-generated',

    // Duplicate Warning Modal
    'duplicateWarning.title': 'Potential Duplicate Found',
    'duplicateWarning.description': 'The following existing students look similar to the one you are adding. Please review before saving.',
    'duplicateWarning.studentId': 'ID',
    'duplicateWarning.dob': 'DOB',
    'duplicateWarning.address': 'Address',
    'duplicateWarning.goBack': 'Go Back',
    'duplicateWarning.saveAnyway': 'Save Anyway',
    'duplicateWarning.proceedWithoutCheck': 'Save Without Check',
    'duplicateWarning.cancelSave': 'Cancel',
```

- [ ] **Step 2: Add zh-CN translation keys**

After the existing `addStudent.submitError` zh-CN line (line 246), add:

```typescript
    'addStudent.checkingDuplicates': '\u6b63\u5728\u68c0\u67e5\u91cd\u590d...',
    'addStudent.duplicateCheckUnavailable': '\u91cd\u590d\u68c0\u67e5\u4e0d\u53ef\u7528\u3002\u662f\u5426\u4ecd\u7136\u4fdd\u5b58\uff1f',
    'addStudent.autoIdUnavailable': '\u81ea\u52a8ID\u751f\u6210\u4e0d\u53ef\u7528\uff0c\u8bf7\u624b\u52a8\u8f93\u5165\u3002',

    // Dynamic Form
    'dynamicForm.autoGenerated': '\u81ea\u52a8\u751f\u6210',

    // Duplicate Warning Modal
    'duplicateWarning.title': '\u53d1\u73b0\u6f5c\u5728\u91cd\u590d\u8bb0\u5f55',
    'duplicateWarning.description': '\u4ee5\u4e0b\u73b0\u6709\u5b66\u751f\u4e0e\u60a8\u6b63\u5728\u6dfb\u52a0\u7684\u5b66\u751f\u76f8\u4f3c\u3002\u8bf7\u5728\u4fdd\u5b58\u524d\u68c0\u67e5\u3002',
    'duplicateWarning.studentId': '\u5b66\u53f7',
    'duplicateWarning.dob': '\u51fa\u751f\u65e5\u671f',
    'duplicateWarning.address': '\u5730\u5740',
    'duplicateWarning.goBack': '\u8fd4\u56de',
    'duplicateWarning.saveAnyway': '\u4ecd\u7136\u4fdd\u5b58',
    'duplicateWarning.proceedWithoutCheck': '\u4e0d\u68c0\u67e5\u76f4\u63a5\u4fdd\u5b58',
    'duplicateWarning.cancelSave': '\u53d6\u6d88',
```

- [ ] **Step 3: Verify TypeScript compiles**

Run: `cd frontend && npx tsc -b`
Expected: Clean compile, no errors.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/i18n/translations.ts
git commit -m "feat: add i18n keys for auto-ID and duplicate detection"
```

---

### Task 6: Wire Up AddStudentPage — Auto-ID + Duplicate Detection + Modal

**Files:**
- Modify: `frontend/src/pages/AddStudentPage.tsx` (entire file, major changes)

This is the integration task. `AddStudentPage` orchestrates: fetch next-id on mount, pass `readOnlyFields` to `DynamicForm`, intercept submit for similarity search, show `DuplicateWarningModal` if matches, proceed on confirm.

- [ ] **Step 1: Rewrite AddStudentPage.tsx**

Replace the entire contents of `frontend/src/pages/AddStudentPage.tsx` with:

```typescript
import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from '../hooks/useTranslation.ts';
import {
  createStudent,
  extractStudentFromDocument,
  fetchNextStudentId,
  searchSimilarStudents,
} from '../api/client.ts';
import { useModel } from '../contexts/ModelContext.tsx';
import { useDashboard } from '../contexts/DashboardContext.tsx';
import DynamicForm from '../components/DynamicForm.tsx';
import DocumentUpload from '../components/DocumentUpload.tsx';
import DuplicateWarningModal from '../components/DuplicateWarningModal.tsx';
import type { ModelDefinition, SimilarityMatch } from '../types/models.ts';
import './AddStudentPage.css';

interface AddStudentPageProps {
  tenant: string;
}

export default function AddStudentPage({ tenant }: AddStudentPageProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
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
  const readOnlyFields = generatedId ? ['student_id'] : [];

  // Duplicate detection state
  const [duplicateMatches, setDuplicateMatches] = useState<SimilarityMatch[] | null>(null);
  const [pendingSubmission, setPendingSubmission] = useState<{
    baseData: Record<string, unknown>;
    customFields: Record<string, unknown>;
  } | null>(null);

  // Load model + fetch next ID
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
      const result = await createStudent(tenant, baseData, customFields);
      invalidateStudentCount();
      setSuccessMessage(t('addStudent.success'));
      setTimeout(() => navigate('/students', {
        state: { highlightEntityId: result.entity_id },
      }), 1500);
    } catch (e) {
      setSubmitError(e instanceof Error ? e.message : t('addStudent.submitError'));
    } finally {
      setSubmitting(false);
    }
  }, [tenant, invalidateStudentCount, navigate, t]);

  const handleSubmit = async (
    baseData: Record<string, unknown>,
    customFields: Record<string, unknown>,
  ) => {
    setSubmitting(true);
    setSubmitError(null);

    // Run similarity search before creating
    try {
      const searchData = {
        first_name: String(baseData.first_name || ''),
        last_name: String(baseData.last_name || ''),
        dob: baseData.dob ? String(baseData.dob) : undefined,
        primary_address: baseData.primary_address ? String(baseData.primary_address) : undefined,
      };
      const result = await searchSimilarStudents(tenant, searchData);

      if (result.matches.length > 0) {
        // Show modal — pause submission
        setDuplicateMatches(result.matches);
        setPendingSubmission({ baseData, customFields });
        setSubmitting(false);
        return;
      }
    } catch {
      // Similarity search failed — ask user what to do
      setDuplicateMatches([]);
      setPendingSubmission({ baseData, customFields });
      setSubmitting(false);
      return;
    }

    // No duplicates found — proceed
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

  // Build initialValues: merge extracted values with generated ID
  const initialValues: Record<string, unknown> = {
    ...extractedValues,
    ...(generatedId ? { student_id: generatedId } : {}),
  };

  if (loading) {
    return (
      <div className="add-student-page">
        <p>{t('common.loading')}</p>
      </div>
    );
  }

  if (modelError) {
    return (
      <div className="add-student-page">
        <div className="add-student-header">
          <h2>{t('addStudent.title')}</h2>
        </div>
        <div className="add-student-model-error">{modelError}</div>
        <button
          className="add-student-back-btn"
          onClick={() => navigate('/students')}
        >
          {t('common.cancel')}
        </button>
      </div>
    );
  }

  // Determine submit button text
  const submitButtonText = submitting
    ? t('addStudent.checkingDuplicates')
    : undefined;

  return (
    <div className="add-student-page">
      <div className="add-student-header">
        <h2>{t('addStudent.title')}</h2>
      </div>

      {successMessage && (
        <div className="add-student-success">{successMessage}</div>
      )}

      {idError && (
        <div className="add-student-id-warning">{idError}</div>
      )}

      <div className="add-student-tabs">
        <button
          className={`add-student-tab ${activeTab === 'form' ? 'active' : ''}`}
          onClick={() => setActiveTab('form')}
        >
          {t('addStudent.webForm')}
        </button>
        <button
          className={`add-student-tab ${activeTab === 'upload' ? 'active' : ''}`}
          onClick={() => setActiveTab('upload')}
        >
          {t('addStudent.uploadDocument')}
        </button>
      </div>

      <div className="add-student-content">
        {activeTab === 'form' && modelDef && (
          <DynamicForm
            modelDefinition={modelDef}
            initialValues={initialValues}
            readOnlyFields={readOnlyFields}
            onSubmit={handleSubmit}
            onCancel={() => navigate('/students')}
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
  );
}
```

- [ ] **Step 2: Add submitButtonText prop to DynamicForm**

The rewritten AddStudentPage passes `submitButtonText` to DynamicForm for the "Checking for duplicates..." state. Update `DynamicForm.tsx`:

Add to `DynamicFormProps` interface:

```typescript
  submitButtonText?: string;
```

Destructure it in the component:

```typescript
  submitButtonText,
```

Update the submit button text (around line 296). Replace:

```typescript
          {submitting ? t('common.loading') : t('common.save')}
```

with:

```typescript
          {submitting ? (submitButtonText || t('common.loading')) : t('common.save')}
```

- [ ] **Step 3: Add CSS for the auto-ID warning message**

Append to `frontend/src/pages/AddStudentPage.css`:

```css
.add-student-id-warning {
  background: rgba(229, 160, 13, 0.1);
  color: var(--color-warning, #e5a00d);
  padding: 0.6rem 1rem;
  border-radius: 8px;
  margin-bottom: 1rem;
  font-size: 0.82rem;
}
```

- [ ] **Step 4: Verify TypeScript compiles**

Run: `cd frontend && npx tsc -b`
Expected: Clean compile, no errors.

- [ ] **Step 5: Verify the dev server starts**

Run: `cd frontend && npm run dev` (start and quickly check no crash; Ctrl+C to stop)
Expected: Vite dev server starts without compile errors.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/pages/AddStudentPage.tsx frontend/src/pages/AddStudentPage.css frontend/src/components/DynamicForm.tsx
git commit -m "feat: wire up auto-ID generation and duplicate detection in AddStudentPage"
```

---

## Self-Review Checklist

**Spec coverage:**
- Auto-generate sequential student ID on form load: Task 2 (API), Task 6 (fetch on mount) ✓
- Student ID field is read-only via readOnlyFields: Task 3 ✓
- Auto-generated ID included in form submission: Task 3 step 4 (read-only fields still in submission data) ✓
- Backend next-id endpoint: Consumed by Task 2's `fetchNextStudentId` (backend not in scope) ✓
- Similarity check on save: Task 6 `handleSubmit` ✓
- Duplicate warning modal: Task 4 ✓
- Loading state during similarity check: Task 6 (submitButtonText = "Checking for duplicates...") ✓
- Backend similarity search endpoint: Consumed by Task 2's `searchSimilarStudents` (backend not in scope) ✓
- Similarity search failure handling: Task 6 catch block shows fallback modal ✓
- i18n for all new strings: Task 5 ✓

**Placeholder scan:** No TBDs, TODOs, or incomplete sections found.

**Type consistency:** `NextIdResponse`, `SimilarityMatch`, `SimilaritySearchRequest`, `SimilaritySearchResponse` — defined in Task 1, imported in Tasks 2 and 4, consumed in Task 6. Names consistent throughout.
