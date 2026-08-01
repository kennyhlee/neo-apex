import { useMemo } from 'react';
import { useTranslation } from '../hooks/useTranslation.ts';
import { toBool } from '../utils/boolValue.ts';
import type { ModelDefinition, ModelFieldDefinition } from '../types/models.ts';
import './StudentDetailModal.css';

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
  const s = String(raw);
  if (s.startsWith('[')) {
    try {
      const arr = JSON.parse(s);
      if (Array.isArray(arr)) return arr.join(', ') || '-';
    } catch { /* not JSON */ }
  }
  return s;
}

export default function StudentDetailModal({ student, model, onClose }: StudentDetailModalProps) {
  const { t } = useTranslation();
  const fields = useMemo(
    () => [...model.base_fields, ...model.custom_fields],
    [model],
  );
  const name = `${String(student.first_name ?? '')} ${String(student.last_name ?? '')}`.trim();

  return (
    <div className="students-confirm-overlay" onClick={onClose}>
      <div className="student-detail-modal" onClick={(e) => e.stopPropagation()}>
        <div className="student-detail-header">
          <div>
            <h3>{t('studentDetail.title')}</h3>
            {name && <span className="student-detail-subtitle">{name}</span>}
          </div>
          <button onClick={onClose}>{t('studentDetail.close')}</button>
        </div>
        <dl className="student-detail-fields">
          {fields.map((f) => (
            <div key={f.name} className="student-detail-row">
              <dt>{formatLabel(f.name)}</dt>
              <dd>{displayValue(f, student[f.name])}</dd>
            </div>
          ))}
        </dl>
      </div>
    </div>
  );
}
