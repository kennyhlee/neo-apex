import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from '../hooks/useTranslation.ts';
import { createStudent, extractStudentFromDocument } from '../api/client.ts';
import { useModel } from '../contexts/ModelContext.tsx';
import { useDashboard } from '../contexts/DashboardContext.tsx';
import DynamicForm from '../components/DynamicForm.tsx';
import DocumentUpload from '../components/DocumentUpload.tsx';
import type { ModelDefinition } from '../types/models.ts';
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

  useEffect(() => {
    setLoading(true);
    setModelError(null);
    getModel(tenant, 'student')
      .then((def) => setModelDef(def))
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

  const handleSubmit = async (
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

  return (
    <div className="add-student-page">
      <div className="add-student-header">
        <h2>{t('addStudent.title')}</h2>
      </div>

      {successMessage && (
        <div className="add-student-success">{successMessage}</div>
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
            initialValues={extractedValues}
            onSubmit={handleSubmit}
            onCancel={() => navigate('/students')}
            submitting={submitting}
            error={submitError}
          />
        )}
        {activeTab === 'upload' && (
          <DocumentUpload
            onExtracted={handleExtracted}
            onUpload={handleUpload}
          />
        )}
      </div>
    </div>
  );
}
