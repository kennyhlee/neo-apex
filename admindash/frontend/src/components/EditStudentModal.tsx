import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from '../hooks/useTranslation.ts';
import { updateEntity, createFamily, getFamilyById } from '../api/client.ts';
import DynamicForm from './DynamicForm.tsx';
import Modal from './ui/Modal.tsx';
import FamilyPicker from './FamilyPicker.tsx';
import type { ModelDefinition, FamilySelection } from '../types/models.ts';
import '../pages/StudentsPage.css';

interface EditStudentModalProps {
  tenant: string;
  entity: Record<string, unknown>;
  model: ModelDefinition;
  presetFamily?: { familyId: string; label: string };
  onClose: () => void;
  onSaved: () => void;
}

export default function EditStudentModal({
  tenant, entity, model, presetFamily, onClose, onSaved,
}: EditStudentModalProps) {
  const { t } = useTranslation();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [familySelection, setFamilySelection] = useState<FamilySelection | null>(
    presetFamily
      ? { mode: 'existing', familyId: presetFamily.familyId, label: presetFamily.label }
      : null,
  );

  // Seed the picker from the student's existing family_id (fetch its name for the label).
  const entityFamilyId = entity.family_id ? String(entity.family_id) : '';
  const entityId = entity.entity_id ? String(entity.entity_id) : '';
  useEffect(() => {
    if (presetFamily) return; // caller already set the family
    const fid = entityFamilyId;
    if (!fid) return;
    let cancelled = false;
    getFamilyById(tenant, fid)
      .then((fam) => {
        if (cancelled) return;
        setFamilySelection({ mode: 'existing', familyId: fid, label: fam?.family_name ?? fid });
      })
      .catch(() => {
        if (!cancelled) setFamilySelection({ mode: 'existing', familyId: fid, label: fid });
      });
    return () => { cancelled = true; };
  }, [tenant, entityFamilyId, entityId, presetFamily]);

  // The picker owns family_id — strip it from the rendered form.
  const formModel = useMemo<ModelDefinition>(() => ({
    ...model,
    base_fields: model.base_fields.filter((f) => f.name !== 'family_id'),
  }), [model]);

  async function handleSubmit(baseData: Record<string, unknown>, customFields: Record<string, unknown>) {
    setSubmitting(true);
    setError(null);
    try {
      // Resolve family into a scalar family_id (create first if new; '' clears the link).
      if (familySelection?.mode === 'existing') {
        baseData.family_id = familySelection.familyId;
      } else if (familySelection?.mode === 'new') {
        const fam = await createFamily(tenant, familySelection.data);
        baseData.family_id = fam.entity_id;
      } else {
        baseData.family_id = '';
      }
      await updateEntity(tenant, 'student', String(entity.entity_id), baseData, customFields);
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : t('editStudent.saveError'));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={t('editStudent.title')}
      subtitle={`${String(entity.first_name ?? '')} ${String(entity.last_name ?? '')}`.trim()}
      size="md"
      dismissOnBackdrop={!submitting}
      dismissOnEscape={!submitting}
    >
      <FamilyPicker tenant={tenant} value={familySelection} onChange={setFamilySelection} />
      <DynamicForm
        modelDefinition={formModel}
        initialValues={entity}
        readOnlyFields={['student_id', 'first_name', 'last_name', 'middle_name']}
        onSubmit={handleSubmit}
        onCancel={onClose}
        submitting={submitting}
        error={error}
      />
    </Modal>
  );
}
