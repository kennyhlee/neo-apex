import { useState, useEffect, useMemo } from 'react';
import type { ModelFieldDefinition, ModelDefinition } from '../types/models.ts';
import { useTranslation } from '../hooks/useTranslation.ts';
import './DynamicForm.css';

interface DynamicFormProps {
  modelDefinition: ModelDefinition;
  initialValues?: Record<string, unknown>;
  readOnlyFields?: string[];
  onSubmit: (baseData: Record<string, unknown>, customFields: Record<string, unknown>) => void;
  onCancel: () => void;
  submitting?: boolean;
  error?: string | null;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_RE = /^[+]?[\d\s\-().]{7,}$/;

function validateField(field: ModelFieldDefinition, value: unknown): string | null {
  const strValue = value != null ? String(value) : '';
  const isEmpty = strValue.trim() === '';

  if (field.type === 'bool') return null; // booleans always valid
  if (field.type === 'selection' && field.multiple) {
    const arr = Array.isArray(value) ? value : [];
    if (field.required && arr.length === 0) return 'Required';
    return null;
  }

  if (field.required && isEmpty) return 'Required';
  if (isEmpty) return null; // optional and empty is fine

  switch (field.type) {
    case 'number':
      if (isNaN(Number(strValue))) return 'Must be a number';
      break;
    case 'email':
      if (!EMAIL_RE.test(strValue)) return 'Invalid email';
      break;
    case 'phone':
      if (!PHONE_RE.test(strValue)) return 'Invalid phone number';
      break;
  }

  return null;
}

function renderField(
  field: ModelFieldDefinition,
  value: unknown,
  onChange: (name: string, value: unknown) => void,
  fieldError: string | null,
  isReadOnly: boolean,
) {
  const strValue = value != null ? String(value) : '';
  const errorClass = fieldError ? ' dynamic-form-input-error' : '';

  switch (field.type) {
    case 'str':
      return (
        <input
          type="text"
          className={`${errorClass}${isReadOnly ? ' dynamic-form-input-readonly' : ''}`}
          value={strValue}
          onChange={(e) => onChange(field.name, e.target.value)}
          disabled={isReadOnly}
        />
      );

    case 'number':
      return (
        <input
          type="number"
          className={`${errorClass}${isReadOnly ? ' dynamic-form-input-readonly' : ''}`}
          value={strValue}
          onChange={(e) => onChange(field.name, e.target.value ? Number(e.target.value) : '')}
          disabled={isReadOnly}
        />
      );

    case 'bool':
      return (
        <input
          type="checkbox"
          checked={Boolean(value)}
          onChange={(e) => onChange(field.name, e.target.checked)}
          disabled={isReadOnly}
        />
      );

    case 'date':
      return (
        <input
          type="date"
          className={`${errorClass}${isReadOnly ? ' dynamic-form-input-readonly' : ''}`}
          value={strValue}
          onChange={(e) => onChange(field.name, e.target.value)}
          disabled={isReadOnly}
        />
      );

    case 'datetime':
      return (
        <input
          type="datetime-local"
          className={`${errorClass}${isReadOnly ? ' dynamic-form-input-readonly' : ''}`}
          value={strValue}
          onChange={(e) => onChange(field.name, e.target.value)}
          disabled={isReadOnly}
        />
      );

    case 'email':
      return (
        <input
          type="email"
          className={`${errorClass}${isReadOnly ? ' dynamic-form-input-readonly' : ''}`}
          value={strValue}
          onChange={(e) => onChange(field.name, e.target.value)}
          disabled={isReadOnly}
        />
      );

    case 'phone':
      return (
        <input
          type="tel"
          className={`${errorClass}${isReadOnly ? ' dynamic-form-input-readonly' : ''}`}
          value={strValue}
          onChange={(e) => onChange(field.name, e.target.value)}
          disabled={isReadOnly}
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
                  disabled={isReadOnly}
                />
                {opt}
              </label>
            ))}
          </div>
        );
      }
      return (
        <select
          className={`${errorClass}${isReadOnly ? ' dynamic-form-input-readonly' : ''}`}
          value={strValue}
          onChange={(e) => onChange(field.name, e.target.value)}
          disabled={isReadOnly}
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
          className={`${isReadOnly ? 'dynamic-form-input-readonly' : ''}`}
          value={strValue}
          onChange={(e) => onChange(field.name, e.target.value)}
          disabled={isReadOnly}
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
  readOnlyFields = [],
  onSubmit,
  onCancel,
  submitting = false,
  error,
}: DynamicFormProps) {
  const { t } = useTranslation();
  const allFields = useMemo(() => [
    ...modelDefinition.base_fields.map((f) => ({ ...f, group: 'base' as const })),
    ...modelDefinition.custom_fields.map((f) => ({ ...f, group: 'custom' as const })),
  ], [modelDefinition]);

  const buildValues = (overrides?: Record<string, unknown>) => {
    const result: Record<string, unknown> = {};
    for (const field of allFields) {
      result[field.name] = overrides?.[field.name] ?? (field.type === 'bool' ? false : '');
    }
    return result;
  };

  const [values, setValues] = useState<Record<string, unknown>>(() => buildValues(initialValues));
  const [touched, setTouched] = useState<Record<string, boolean>>({});

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

  const fieldErrors = useMemo(() => {
    const errors: Record<string, string | null> = {};
    for (const field of allFields) {
      errors[field.name] = validateField(field, values[field.name]);
    }
    return errors;
  }, [allFields, values]);

  const hasErrors = Object.values(fieldErrors).some((e) => e !== null);

  const handleChange = (name: string, value: unknown) => {
    setValues((prev) => ({ ...prev, [name]: value }));
    setTouched((prev) => ({ ...prev, [name]: true }));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    if (hasErrors) {
      // Mark all fields as touched to show errors
      const allTouched: Record<string, boolean> = {};
      for (const field of allFields) allTouched[field.name] = true;
      setTouched(allTouched);
      return;
    }

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
    <form className="dynamic-form" onSubmit={handleSubmit} noValidate>
      {error && <div className="dynamic-form-error">{error}</div>}

      <div className="dynamic-form-fields">
        {allFields.map((field) => {
          const fieldError = touched[field.name] ? fieldErrors[field.name] : null;
          return (
            <div
              key={field.name}
              className={`dynamic-form-field ${field.type === 'bool' ? 'dynamic-form-field-checkbox' : ''}`}
            >
              <label>
                {formatFieldLabel(field.name)}
                {field.required && <span className="dynamic-form-required">*</span>}
              </label>
              {renderField(field, values[field.name], handleChange, fieldError, readOnlyFields.includes(field.name))}
              {readOnlyFields.includes(field.name) && (
                <span className="dynamic-form-field-helper">{t('dynamicForm.autoGenerated')}</span>
              )}
              {fieldError && <span className="dynamic-form-field-error">{fieldError}</span>}
            </div>
          );
        })}
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
          className={`dynamic-form-btn-primary ${hasErrors ? 'dynamic-form-btn-invalid' : ''}`}
          disabled={submitting}
        >
          {submitting ? t('common.loading') : t('common.save')}
        </button>
      </div>
    </form>
  );
}
