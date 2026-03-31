import { useState, useEffect } from 'react';
import type { ModelFieldDefinition, ModelDefinition } from '../types/models.ts';
import { useTranslation } from '../hooks/useTranslation.ts';
import './DynamicForm.css';

interface DynamicFormProps {
  modelDefinition: ModelDefinition;
  initialValues?: Record<string, unknown>;
  onSubmit: (baseData: Record<string, unknown>, customFields: Record<string, unknown>) => void;
  onCancel: () => void;
  submitting?: boolean;
  error?: string | null;
}

function renderField(
  field: ModelFieldDefinition,
  value: unknown,
  onChange: (name: string, value: unknown) => void,
) {
  const strValue = value != null ? String(value) : '';

  switch (field.type) {
    case 'str':
      return (
        <input
          type="text"
          value={strValue}
          onChange={(e) => onChange(field.name, e.target.value)}
          required={field.required}
        />
      );

    case 'number':
      return (
        <input
          type="number"
          value={strValue}
          onChange={(e) => onChange(field.name, e.target.value ? Number(e.target.value) : '')}
          required={field.required}
        />
      );

    case 'bool':
      return (
        <input
          type="checkbox"
          checked={Boolean(value)}
          onChange={(e) => onChange(field.name, e.target.checked)}
        />
      );

    case 'date':
      return (
        <input
          type="date"
          value={strValue}
          onChange={(e) => onChange(field.name, e.target.value)}
          required={field.required}
        />
      );

    case 'datetime':
      return (
        <input
          type="datetime-local"
          value={strValue}
          onChange={(e) => onChange(field.name, e.target.value)}
          required={field.required}
        />
      );

    case 'email':
      return (
        <input
          type="email"
          value={strValue}
          onChange={(e) => onChange(field.name, e.target.value)}
          required={field.required}
        />
      );

    case 'phone':
      return (
        <input
          type="tel"
          value={strValue}
          onChange={(e) => onChange(field.name, e.target.value)}
          required={field.required}
        />
      );

    case 'selection':
      if (field.multiple) {
        const selected = Array.isArray(value) ? (value as string[]) : [];
        return (
          <div className="dynamic-form-multi-select">
            {(field.options || []).map((opt) => (
              <label key={opt} className="dynamic-form-checkbox-label">
                <input
                  type="checkbox"
                  checked={selected.includes(opt)}
                  onChange={(e) => {
                    const next = e.target.checked
                      ? [...selected, opt]
                      : selected.filter((s) => s !== opt);
                    onChange(field.name, next);
                  }}
                />
                {opt}
              </label>
            ))}
          </div>
        );
      }
      return (
        <select
          value={strValue}
          onChange={(e) => onChange(field.name, e.target.value)}
          required={field.required}
        >
          <option value="">--</option>
          {(field.options || []).map((opt) => (
            <option key={opt} value={opt}>
              {opt}
            </option>
          ))}
        </select>
      );

    default:
      return (
        <input
          type="text"
          value={strValue}
          onChange={(e) => onChange(field.name, e.target.value)}
        />
      );
  }
}

function formatFieldLabel(name: string): string {
  return name
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

export default function DynamicForm({
  modelDefinition,
  initialValues,
  onSubmit,
  onCancel,
  submitting = false,
  error,
}: DynamicFormProps) {
  const { t } = useTranslation();
  const allFields = [
    ...modelDefinition.base_fields.map((f) => ({ ...f, group: 'base' as const })),
    ...modelDefinition.custom_fields.map((f) => ({ ...f, group: 'custom' as const })),
  ];

  const buildValues = (overrides?: Record<string, unknown>) => {
    const result: Record<string, unknown> = {};
    for (const field of allFields) {
      result[field.name] = overrides?.[field.name] ?? (field.type === 'bool' ? false : '');
    }
    return result;
  };

  const [values, setValues] = useState<Record<string, unknown>>(() => buildValues(initialValues));

  // Re-populate when initialValues change (e.g., after document extraction)
  useEffect(() => {
    if (initialValues && Object.keys(initialValues).length > 0) {
      setValues((prev) => {
        const next = { ...prev };
        for (const [key, val] of Object.entries(initialValues)) {
          if (val != null && val !== '') next[key] = val;
        }
        return next;
      });
    }
  }, [initialValues]);

  const handleChange = (name: string, value: unknown) => {
    setValues((prev) => ({ ...prev, [name]: value }));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const baseData: Record<string, unknown> = {};
    const customFields: Record<string, unknown> = {};

    for (const field of allFields) {
      const val = values[field.name];
      if (field.group === 'base') {
        baseData[field.name] = val;
      } else {
        customFields[field.name] = val;
      }
    }

    onSubmit(baseData, customFields);
  };

  return (
    <form className="dynamic-form" onSubmit={handleSubmit}>
      {error && <div className="dynamic-form-error">{error}</div>}

      <div className="dynamic-form-fields">
        {allFields.map((field) => (
          <div
            key={field.name}
            className={`dynamic-form-field ${field.type === 'bool' ? 'dynamic-form-field-checkbox' : ''}`}
          >
            <label>
              {formatFieldLabel(field.name)}
              {field.required && <span className="dynamic-form-required">*</span>}
            </label>
            {renderField(field, values[field.name], handleChange)}
          </div>
        ))}
      </div>

      <div className="dynamic-form-actions">
        <button
          type="button"
          className="dynamic-form-btn-secondary"
          onClick={onCancel}
        >
          {t('common.cancel')}
        </button>
        <button
          type="submit"
          className="dynamic-form-btn-primary"
          disabled={submitting}
        >
          {submitting ? t('common.loading') : t('common.save')}
        </button>
      </div>
    </form>
  );
}
