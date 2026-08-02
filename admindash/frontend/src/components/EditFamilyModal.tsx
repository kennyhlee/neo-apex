import { useState } from 'react';
import { useTranslation } from '../hooks/useTranslation.ts';
import { updateEntity } from '../api/client.ts';
import DynamicForm from './DynamicForm.tsx';
import Modal from './ui/Modal.tsx';
import type { ModelDefinition } from '../types/models.ts';
import '../pages/StudentsPage.css';

interface EditFamilyModalProps {
  tenant: string;
  family: Record<string, unknown>;
  model: ModelDefinition;
  onClose: () => void;
  onSaved: () => void;
}

export default function EditFamilyModal({ tenant, family, model, onClose, onSaved }: EditFamilyModalProps) {
  const { t } = useTranslation();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(baseData: Record<string, unknown>, customFields: Record<string, unknown>) {
    setSubmitting(true);
    setError(null);
    try {
      await updateEntity(tenant, 'family', String(family.entity_id), baseData, customFields);
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : t('editFamily.saveError'));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={t('editFamily.title')}
      subtitle={String(family.family_name ?? '')}
      size="md"
      dismissOnBackdrop={!submitting}
      dismissOnEscape={!submitting}
    >
      <DynamicForm
        modelDefinition={model}
        initialValues={family}
        readOnlyFields={['family_id']}
        onSubmit={handleSubmit}
        onCancel={onClose}
        submitting={submitting}
        error={error}
      />
    </Modal>
  );
}
