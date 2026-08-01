import { useTranslation } from '../hooks/useTranslation.ts';
import { toBool } from '../utils/boolValue.ts';
import type { ModelDefinition, ModelFieldDefinition } from '../types/models.ts';
import Modal from './ui/Modal.tsx';
import Button from './ui/Button.tsx';
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
  if (type === 'bool') return toBool(raw) ? 'Yes' : 'No';
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

  // Escape, focus trap and scroll lock all come from the shared Modal.
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
    <Modal
      open
      onClose={onClose}
      title={title}
      subtitle={subtitle || undefined}
      size="sm"
      footer={
        <Button variant="secondary" onClick={onClose}>{t('common.close')}</Button>
      }
    >
      <div className="pdm-grid">
        {visibleFields.map((field) => (
          <div className="pdm-field" key={field.name}>
            <div className="pdm-label">{formatFieldLabel(field.name)}</div>
            <div className="pdm-value">{formatValue(program[field.name], field.type)}</div>
          </div>
        ))}
      </div>
    </Modal>
  );
}
