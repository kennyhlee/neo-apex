import { useMemo } from 'react';
import { useTranslation } from '../hooks/useTranslation.ts';
import { toBool } from '../utils/boolValue.ts';
import type { ModelDefinition, ModelFieldDefinition } from '../types/models.ts';
import Modal from './ui/Modal.tsx';
import Button from './ui/Button.tsx';
import './StudentDetailModal.css';
import { toLabel } from '../utils/listValue.ts';

interface StudentDetailModalProps {
  student: Record<string, unknown>;
  model: ModelDefinition;
  onClose: () => void;
}

function formatLabel(name: string): string {
  return name.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function displayValue(field: ModelFieldDefinition, raw: unknown): string {
  if (raw == null || raw === '') return '-';
  if (field.type === 'bool') return toBool(raw) ? 'Yes' : 'No';
  return toLabel(raw, '—');
}

export default function StudentDetailModal({ student, model, onClose }: StudentDetailModalProps) {
  const { t } = useTranslation();
  const fields = useMemo(
    () => [...model.base_fields, ...model.custom_fields],
    [model],
  );
  const name = `${String(student.first_name ?? '')} ${String(student.last_name ?? '')}`.trim();

  return (
    <Modal
      open
      onClose={onClose}
      title={t('studentDetail.title')}
      subtitle={name || undefined}
      footer={
        <Button variant="secondary" onClick={onClose}>{t('studentDetail.close')}</Button>
      }
    >
      <dl className="student-detail-fields">
        {fields.map((f) => (
          <div key={f.name} className="student-detail-row">
            <dt>{formatLabel(f.name)}</dt>
            <dd>{displayValue(f, student[f.name])}</dd>
          </div>
        ))}
      </dl>
    </Modal>
  );
}
