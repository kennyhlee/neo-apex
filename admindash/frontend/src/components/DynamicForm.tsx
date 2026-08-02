import { useState, useEffect, useMemo, useRef, useId } from 'react';
import type { ModelFieldDefinition, ModelDefinition } from '../types/models.ts';
import { useTranslation } from '../hooks/useTranslation.ts';
import { validateField } from '../utils/validateField.ts';
import { toBool } from '../utils/boolValue.ts';
import Button from './ui/Button.tsx';
import './DynamicForm.css';

interface DynamicFormProps {
  modelDefinition: ModelDefinition;
  initialValues?: Record<string, unknown>;
  readOnlyFields?: string[];
  onSubmit: (baseData: Record<string, unknown>, customFields: Record<string, unknown>) => void;
  onCancel: () => void;
  submitting?: boolean;
  error?: string | null;
  submitButtonText?: string;
  cancelButtonText?: string;
}

/**
 * Accessibility contract for one field. `inputId` is always the id of the
 * control a user should land on when the error summary sends focus here — for
 * radio / checkbox groups that is the first option, not the group wrapper.
 */
interface FieldA11y {
  inputId: string;
  describedBy?: string;
  invalid: boolean;
}

function renderField(
  field: ModelFieldDefinition,
  value: unknown,
  onChange: (name: string, value: unknown) => void,
  fieldError: string | null,
  isReadOnly: boolean,
  a11y: FieldA11y,
) {
  const strValue = value != null ? String(value) : '';
  const errorClass = fieldError ? ' dynamic-form-input-error' : '';

  // Attributes every single-control field shares.
  const common = {
    id: a11y.inputId,
    disabled: isReadOnly,
    required: field.required,
    'aria-invalid': a11y.invalid || undefined,
    'aria-describedby': a11y.describedBy,
  } as const;

  switch (field.type) {
    case 'str':
      return (
        <input
          {...common}
          type="text"
          className={`${errorClass}${isReadOnly ? ' dynamic-form-input-readonly' : ''}`}
          value={strValue}
          onChange={(e) => onChange(field.name, e.target.value)}
        />
      );

    case 'number':
      return (
        <input
          {...common}
          type="number"
          className={`${errorClass}${isReadOnly ? ' dynamic-form-input-readonly' : ''}`}
          value={strValue}
          onChange={(e) => onChange(field.name, e.target.value ? Number(e.target.value) : '')}
        />
      );

    case 'bool':
      // A checkbox is never "required" here — validateField treats bool as
      // always valid, so the native constraint would contradict our own.
      return (
        <input
          {...common}
          required={false}
          type="checkbox"
          checked={Boolean(value)}
          onChange={(e) => onChange(field.name, e.target.checked)}
        />
      );

    case 'date':
      return (
        <input
          {...common}
          type="date"
          className={`${errorClass}${isReadOnly ? ' dynamic-form-input-readonly' : ''}`}
          value={strValue}
          onChange={(e) => onChange(field.name, e.target.value)}
        />
      );

    case 'datetime':
      return (
        <input
          {...common}
          type="datetime-local"
          className={`${errorClass}${isReadOnly ? ' dynamic-form-input-readonly' : ''}`}
          value={strValue}
          onChange={(e) => onChange(field.name, e.target.value)}
        />
      );

    case 'email':
      return (
        <input
          {...common}
          type="email"
          className={`${errorClass}${isReadOnly ? ' dynamic-form-input-readonly' : ''}`}
          value={strValue}
          onChange={(e) => onChange(field.name, e.target.value)}
        />
      );

    case 'phone':
      return (
        <input
          {...common}
          type="tel"
          className={`${errorClass}${isReadOnly ? ' dynamic-form-input-readonly' : ''}`}
          value={strValue}
          onChange={(e) => onChange(field.name, e.target.value)}
        />
      );

    case 'selection':
      if (field.multiple) {
        // Multi-select: checkbox grid. The group is named by the <legend> of
        // the surrounding <fieldset>; each box keeps its own bound label.
        // Legacy handling: string value → treat as single-element array
        const selected = Array.isArray(value)
          ? (value as string[])
          : (typeof value === 'string' && value ? [value] : []);
        return (
          <div className="dynamic-form-multi-select">
            {(field.options || []).map((opt, i) => (
              <label key={opt} className="dynamic-form-checkbox-label">
                <input
                  // The first option is the focus target for the error summary.
                  id={i === 0 ? a11y.inputId : undefined}
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
      } else {
        // Single-select: radio buttons
        // Legacy handling: array value → use first element
        const radioValue = Array.isArray(value)
          ? (value[0] != null ? String(value[0]) : '')
          : strValue;
        return (
          <div className="dynamic-form-radio-group">
            {(field.options || []).map((opt, i) => (
              <label key={opt} className="dynamic-form-radio-label">
                <input
                  id={i === 0 ? a11y.inputId : undefined}
                  type="radio"
                  name={`${a11y.inputId}-group`}
                  value={opt}
                  checked={radioValue === opt}
                  onChange={() => onChange(field.name, opt)}
                  disabled={isReadOnly}
                  required={field.required}
                />
                {opt}
              </label>
            ))}
          </div>
        );
      }

    default:
      return (
        <input
          {...common}
          type="text"
          className={`${isReadOnly ? 'dynamic-form-input-readonly' : ''}`}
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
  readOnlyFields = [],
  onSubmit,
  onCancel,
  submitting = false,
  error,
  submitButtonText,
  cancelButtonText,
}: DynamicFormProps) {
  const { t } = useTranslation();
  const baseId = useId();
  const allFields = useMemo(() => [
    ...modelDefinition.base_fields.map((f) => ({ ...f, group: 'base' as const })),
    ...modelDefinition.custom_fields.map((f) => ({ ...f, group: 'custom' as const })),
  ], [modelDefinition]);

  const buildValues = (overrides?: Record<string, unknown>) => {
    const result: Record<string, unknown> = {};
    for (const field of allFields) {
      const override = overrides?.[field.name];
      const fallback = field.type === 'bool' ? false : '';
      let resolved: unknown;
      if (override !== undefined) {
        resolved = override;
      } else if (field.default !== undefined) {
        resolved = field.default;
      } else {
        resolved = fallback;
      }
      if (field.type === 'number' && resolved !== '' && resolved !== null && resolved !== undefined) {
        const coerced = Number(resolved);
        resolved = Number.isNaN(coerced) ? '' : coerced;
      }
      if (field.type === 'bool') {
        resolved = toBool(resolved);
      }
      result[field.name] = resolved;
    }
    return result;
  };

  const [values, setValues] = useState<Record<string, unknown>>(() => buildValues(initialValues));
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  /** Field names listed by the post-submit error summary; null = no summary. */
  const [summaryFields, setSummaryFields] = useState<string[] | null>(null);
  const summaryRef = useRef<HTMLDivElement | null>(null);

  // Re-populate when initialValues change (e.g., after document extraction)
  useEffect(() => {
    if (initialValues && Object.keys(initialValues).length > 0) {
      setValues((prev) => {
        const next = { ...prev };
        for (const [key, val] of Object.entries(initialValues)) {
          if (val != null && val !== '') {
            const field = allFields.find((f) => f.name === key);
            next[key] = field?.type === 'bool' ? toBool(val) : val;
          }
        }
        return next;
      });
    }
  }, [initialValues, allFields]);

  const fieldErrors = useMemo(() => {
    const errors: Record<string, string | null> = {};
    for (const field of allFields) {
      errors[field.name] = validateField(field, values[field.name]);
    }
    return errors;
  }, [allFields, values]);

  const hasErrors = Object.values(fieldErrors).some((e) => e !== null);

  // Announce the failure and put the keyboard where the explanation is.
  useEffect(() => {
    if (!summaryFields) return;
    const node = summaryRef.current;
    if (!node) return;
    node.focus();
    node.scrollIntoView({ block: 'nearest' });
  }, [summaryFields]);

  // Entries the user has since fixed drop out of the list as they are fixed.
  const summaryEntries = summaryFields?.filter((name) => fieldErrors[name]) ?? [];

  const fieldInputId = (name: string) => `${baseId}-${name}`;

  const focusField = (name: string) => {
    const el = document.getElementById(fieldInputId(name));
    if (!el) return;
    el.scrollIntoView({ block: 'nearest' });
    el.focus();
  };

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
      // …and say so at the top of the form, where focus can reach it.
      setSummaryFields(allFields.filter((f) => fieldErrors[f.name]).map((f) => f.name));
      return;
    }

    setSummaryFields(null);

    const baseData: Record<string, unknown> = {};
    const customFields: Record<string, unknown> = {};

    for (const field of allFields) {
      const val = field.type === 'bool' ? toBool(values[field.name]) : values[field.name];
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
      {error && <div className="dynamic-form-error" role="alert">{error}</div>}

      {summaryEntries.length > 0 && (
        <div
          className="dynamic-form-error-summary"
          role="alert"
          tabIndex={-1}
          ref={summaryRef}
        >
          <p className="dynamic-form-error-summary-title">
            {summaryEntries.length === 1
              ? 'There is 1 field that needs attention before this can be saved:'
              : `There are ${summaryEntries.length} fields that need attention before this can be saved:`}
          </p>
          <ul className="dynamic-form-error-summary-list">
            {summaryEntries.map((name) => (
              <li key={name}>
                <button
                  type="button"
                  className="dynamic-form-error-summary-link"
                  onClick={() => focusField(name)}
                >
                  {formatFieldLabel(name)}: {fieldErrors[name]}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="dynamic-form-fields">
        {allFields.map((field) => {
          const fieldError = touched[field.name] ? fieldErrors[field.name] : null;
          const isReadOnly = readOnlyFields.includes(field.name);
          const inputId = fieldInputId(field.name);
          const errorId = `${inputId}-error`;
          const helperId = `${inputId}-helper`;
          const describedBy = [
            fieldError ? errorId : null,
            isReadOnly ? helperId : null,
          ].filter(Boolean).join(' ') || undefined;
          const a11y: FieldA11y = { inputId, describedBy, invalid: Boolean(fieldError) };
          // A single <label> cannot name a set of controls; radio and checkbox
          // groups get a <fieldset>/<legend> instead.
          const isGroup = field.type === 'selection';

          const labelText = (
            <>
              {formatFieldLabel(field.name)}
              {field.required && (
                <>
                  <span className="dynamic-form-required" aria-hidden="true">*</span>
                  <span className="sr-only"> (required)</span>
                </>
              )}
            </>
          );

          const control = renderField(
            field,
            values[field.name],
            handleChange,
            fieldError,
            isReadOnly,
            a11y,
          );
          const helper = isReadOnly ? (
            <span className="dynamic-form-field-helper" id={helperId}>
              {t('dynamicForm.autoGenerated')}
            </span>
          ) : null;
          const errorNode = fieldError ? (
            <span className="dynamic-form-field-error" id={errorId}>{fieldError}</span>
          ) : null;

          if (isGroup) {
            return (
              <fieldset
                key={field.name}
                className="dynamic-form-field dynamic-form-fieldset"
                aria-invalid={fieldError ? true : undefined}
                aria-describedby={describedBy}
                aria-required={field.required || undefined}
              >
                <legend className="dynamic-form-legend">{labelText}</legend>
                {control}
                {helper}
                {errorNode}
              </fieldset>
            );
          }

          return (
            <div
              key={field.name}
              className={`dynamic-form-field ${field.type === 'bool' ? 'dynamic-form-field-checkbox' : ''}`}
            >
              <label htmlFor={inputId}>{labelText}</label>
              {control}
              {helper}
              {errorNode}
            </div>
          );
        })}
      </div>

      <div className="dynamic-form-actions">
        <Button variant="secondary" onClick={onCancel}>
          {cancelButtonText || t('common.cancel')}
        </Button>
        <Button variant="primary" type="submit" disabled={submitting}>
          {submitButtonText || (submitting ? t('common.loading') : t('common.save'))}
        </Button>
      </div>
    </form>
  );
}
