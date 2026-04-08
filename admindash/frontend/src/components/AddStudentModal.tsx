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
              className="add-modal-cancel-btn"
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
