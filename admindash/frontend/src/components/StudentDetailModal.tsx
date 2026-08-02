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
  /** Hands off to the edit form. Omit to keep the panel read-only. */
  onEdit?: (student: Record<string, unknown>) => void;
  onArchive?: (student: Record<string, unknown>) => void;
}

function formatLabel(name: string): string {
  return name.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function displayValue(field: ModelFieldDefinition, raw: unknown): string {
  if (raw == null || raw === '') return '-';
  if (field.type === 'bool') return toBool(raw) ? 'Yes' : 'No';
  return toLabel(raw, '—');
}

export default function StudentDetailModal({
  student,
  model,
  onClose,
  onEdit,
  onArchive,
}: StudentDetailModalProps) {
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
      // The record opens beside the list rather than on top of it, so the row
      // you came from stays in view.
      variant="drawer"
      title={name || t('studentDetail.title')}
      subtitle={
        [student.student_id, student.grade_level].filter(Boolean).map(String).join(' · ') || undefined
      }
      footerClassName={onEdit || onArchive ? 'modal-footer-spread' : undefined}
      footer={
        onEdit || onArchive ? (
          <>
            {onArchive ? (
              <Button variant="secondary" size="sm" onClick={() => onArchive(student)}>
                {t('students.deleteSelected')}
              </Button>
            ) : <span />}
            {onEdit ? (
              <Button variant="primary" onClick={() => onEdit(student)}>
                {t('students.edit')}
              </Button>
            ) : null}
          </>
        ) : (
          <Button variant="secondary" onClick={onClose}>{t('studentDetail.close')}</Button>
        )
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
