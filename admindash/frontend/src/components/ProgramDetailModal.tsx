import { useEffect } from 'react';
import { useTranslation } from '../hooks/useTranslation.ts';
import type { ModelDefinition, ModelFieldDefinition } from '../types/models.ts';
import './ProgramDetailModal.css';

type DataRow = Record<string, unknown>;

interface Props {
  program: DataRow | null;
  model: ModelDefinition | null;
  onClose: () => void;
}

/** Title Case a snake_case / camelCase field name. */
function formatFieldLabel(key: string): string {
  return key
    .replace(/_/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Read-only display of a field value, type-aware. */
function formatValue(raw: unknown, type?: ModelFieldDefinition['type']): string {
  if (raw == null || raw === '') return '—';
  if (type === 'bool') {
    if (typeof raw === 'boolean') return raw ? 'Yes' : 'No';
    const s = String(raw).toLowerCase();
    if (s === 'true') return 'Yes';
    if (s === 'false') return 'No';
  }
  if (Array.isArray(raw)) return raw.map((x) => String(x)).join(', ') || '—';
  const s = String(raw);
  if (s.startsWith('[')) {
    try {
      const arr = JSON.parse(s);
      if (Array.isArray(arr)) return arr.map((x) => String(x)).join(', ') || '—';
    } catch {
      /* not JSON — fall through */
    }
  }
  return s;
}

// System/internal fields never shown in the read-only detail.
const HIDDEN_FIELDS = new Set(['entity_id', 'tenant_id', 'entity_type', 'custom_fields', '_status']);

/**
 * Read-only modal showing a program's details. Non-editable — it presents the
 * program's fields as label/value pairs, driven by the model definition when
 * available (falling back to the row's own keys otherwise).
 */
export default function ProgramDetailModal({ program, model, onClose }: Props) {
  const { t } = useTranslation();

  // Close on Escape while the modal is open.
  useEffect(() => {
    if (!program) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [program, onClose]);

  if (!program) return null;

  const fields: ModelFieldDefinition[] = model
    ? [...model.base_fields, ...model.custom_fields]
    : Object.keys(program)
        .filter((k) => !HIDDEN_FIELDS.has(k))
        .map((name) => ({ name, type: 'str', required: false }));

  const visibleFields = fields.filter((f) => !HIDDEN_FIELDS.has(f.name));
  const title = String(program.name ?? program.program_id ?? 'Program');
  const subtitle = program.program_id ? String(program.program_id) : '';

  return (
    <div className="pdm-overlay" onClick={onClose}>
      <div
        className="pdm-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="pdm-header">
          <div className="pdm-header-text">
            <h3 className="pdm-title">{title}</h3>
            {subtitle && <span className="pdm-subtitle">{subtitle}</span>}
          </div>
          <button className="pdm-x" onClick={onClose} aria-label={t('common.close')}>
            &times;
          </button>
        </div>
        <div className="pdm-body">
          <div className="pdm-grid">
            {visibleFields.map((field) => (
              <div className="pdm-field" key={field.name}>
                <div className="pdm-label">{formatFieldLabel(field.name)}</div>
                <div className="pdm-value">{formatValue(program[field.name], field.type)}</div>
              </div>
            ))}
          </div>
        </div>
        <div className="pdm-footer">
          <button className="pdm-close-btn" onClick={onClose}>
            {t('common.close')}
          </button>
        </div>
      </div>
    </div>
  );
}
