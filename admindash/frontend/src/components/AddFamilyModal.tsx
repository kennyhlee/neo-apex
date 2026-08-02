import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from '../hooks/useTranslation.ts';
import { useModel } from '../contexts/ModelContext.tsx';
import { createEntity, fetchNextEntityId } from '../api/client.ts';
import DynamicForm from './DynamicForm.tsx';
import Modal from './ui/Modal.tsx';
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

  // Auto-ID state
  const [generatedId, setGeneratedId] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    getModel(tenant, 'family')
      .then(setModelDef)
      .catch(() => setModelDef(FALLBACK_FAMILY_MODEL))
      .finally(() => setLoading(false));
    fetchNextEntityId(tenant, 'family').then((r) => setGeneratedId(r.next_id)).catch(() => setGeneratedId(null));
  }, [tenant, getModel]);

  const readOnlyFields = generatedId ? ['family_id'] : [];
  const initialValues = generatedId ? { family_id: generatedId } : undefined;

  const formModelDef = useMemo<ModelDefinition | null>(() => {
    if (!modelDef) return null;
    return modelDef;
  }, [modelDef]);

  async function handleSubmit(baseData: Record<string, unknown>, customFields: Record<string, unknown>) {
    setSubmitting(true);
    setError(null);
    try {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { family_id, ...submitData } = baseData;
      const result = await createEntity(tenant, 'family', submitData, customFields);
      setSuccess(t('addFamily.success'));
      onSuccess(result.entity_id);
    } catch (e) {
      setError(e instanceof Error ? e.message : t('addFamily.error'));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={t('addFamily.title')}
      size="lg"
      className="modal-flush"
      dismissOnBackdrop={!submitting}
      dismissOnEscape={!submitting}
    >
        <div className="add-modal-body">
          {success && <div className="add-modal-success">{success}</div>}
          {loading ? (
            <p>{t('common.loading')}</p>
          ) : formModelDef ? (
            <DynamicForm
              modelDefinition={formModelDef}
              initialValues={initialValues}
              readOnlyFields={readOnlyFields}
              onSubmit={handleSubmit}
              onCancel={onClose}
              submitting={submitting}
              error={error}
            />
          ) : null}
        </div>
    </Modal>
  );
}
