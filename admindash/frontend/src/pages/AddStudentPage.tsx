import { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from '../hooks/useTranslation.ts';
import {
  createStudent,
  extractStudentFromDocument,
  fetchNextStudentId,
  checkDuplicateStudents,
} from '../api/client.ts';
import { useModel } from '../contexts/ModelContext.tsx';
import { useDashboard } from '../contexts/DashboardContext.tsx';
import DynamicForm from '../components/DynamicForm.tsx';
import DocumentUpload from '../components/DocumentUpload.tsx';
import DuplicateWarningModal from '../components/DuplicateWarningModal.tsx';
import type { ModelDefinition, DuplicateMatch } from '../types/models.ts';
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
  const [checkingDuplicates, setCheckingDuplicates] = useState(false);
  const readOnlyFields = useMemo(() => generatedId ? ['student_id'] : [], [generatedId]);

  // Duplicate detection state
  const [duplicateMatches, setDuplicateMatches] = useState<DuplicateMatch[] | null>(null);
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
      // Strip auto-generated student_id so the backend assigns and increments it
      const { student_id: _, ...submitData } = baseData;
      const result = await createStudent(tenant, submitData, customFields);
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
    setCheckingDuplicates(true);
    setSubmitError(null);

    // Run duplicate check before creating
    try {
      const searchData = {
        first_name: String(baseData.first_name || ''),
        last_name: String(baseData.last_name || ''),
        dob: String(baseData.dob || ''),
        primary_address: String(baseData.primary_address || ''),
      };
      const result = await checkDuplicateStudents(tenant, searchData);

      if (result.matches.length > 0) {
        // Show modal — pause submission
        setDuplicateMatches(result.matches);
        setPendingSubmission({ baseData, customFields });
        setSubmitting(false);
        setCheckingDuplicates(false);
        return;
      }
    } catch {
      // Similarity search failed — ask user what to do
      setDuplicateMatches([]);
      setPendingSubmission({ baseData, customFields });
      setSubmitting(false);
      setCheckingDuplicates(false);
      return;
    }

    // No duplicates found — proceed
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
  const submitButtonText = checkingDuplicates
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
