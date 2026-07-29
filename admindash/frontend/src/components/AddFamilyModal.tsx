import { useEffect, useMemo, useState } from 'react';
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

  // Strip `family_id` from the form model so a custom family model with a
  // family_id base field doesn't render an editable/POSTable input.
  const formModelDef = useMemo<ModelDefinition | null>(() => {
    if (!modelDef) return null;
    return {
      ...modelDef,
      base_fields: modelDef.base_fields.filter((f) => f.name !== 'family_id'),
    };
  }, [modelDef]);

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
          ) : formModelDef ? (
            <DynamicForm
              modelDefinition={formModelDef}
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
