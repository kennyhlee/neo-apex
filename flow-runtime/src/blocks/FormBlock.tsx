// flow-runtime/src/blocks/FormBlock.tsx
import { useId } from 'react';
import type { FlowField } from '../types';
import { useFlowT } from '../i18n';

export interface FormBlockProps {
  blockId: string;
  fields: FlowField[];
  values: Record<string, unknown>;
  errors: Record<string, string | null>;
  /** True after a failed step-advance: show every error, not only touched ones. */
  showErrors: boolean;
  readOnly: boolean;
  onChange: (name: string, value: unknown) => void;
}

function labelOf(name: string): string {
  return name.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

export function FormBlock({
  blockId, fields, values, errors, showErrors, readOnly, onChange,
}: FormBlockProps) {
  const t = useFlowT();
  const baseId = useId();
  const idFor = (name: string) => `${baseId}-${blockId}-${name}`;

  const renderControl = (field: FlowField) => {
    const value = values[field.name] ?? field.default ?? (field.type === 'bool' ? false : '');
    const str = value != null ? String(value) : '';
    const id = idFor(field.name);
    const err = showErrors ? errors[field.name] : null;
    const common = {
      id,
      disabled: readOnly,
      'aria-invalid': err ? true : undefined,
      'aria-describedby': err ? `${id}-error` : undefined,
    } as const;

    switch (field.type) {
      case 'number':
        return (
          <input {...common} type="number" className="fr-input" value={str}
            onChange={(e) => onChange(field.name, e.target.value === '' ? '' : Number(e.target.value))} />
        );
      case 'bool':
        return (
          <input {...common} type="checkbox" checked={value === true || value === 'true'}
            onChange={(e) => onChange(field.name, e.target.checked)} />
        );
      case 'date':
        return <input {...common} type="date" className="fr-input" value={str}
          onChange={(e) => onChange(field.name, e.target.value)} />;
      case 'datetime':
        return <input {...common} type="datetime-local" className="fr-input" value={str}
          onChange={(e) => onChange(field.name, e.target.value)} />;
      case 'email':
        return <input {...common} type="email" className="fr-input" value={str}
          onChange={(e) => onChange(field.name, e.target.value)} />;
      case 'phone':
        return <input {...common} type="tel" className="fr-input" value={str}
          onChange={(e) => onChange(field.name, e.target.value)} />;
      case 'selection': {
        if (field.multiple) {
          const selected = Array.isArray(value)
            ? (value as string[])
            : typeof value === 'string' && value ? [value] : [];
          return (
            <div className="fr-choice-group">
              {(field.options ?? []).map((opt, i) => (
                <label key={opt} className="fr-choice-label">
                  <input id={i === 0 ? id : undefined} type="checkbox" disabled={readOnly}
                    checked={selected.includes(opt)}
                    onChange={(e) => onChange(
                      field.name,
                      e.target.checked ? [...selected, opt] : selected.filter((s) => s !== opt),
                    )} />
                  {opt}
                </label>
              ))}
            </div>
          );
        }
        const radioValue = Array.isArray(value)
          ? (value[0] != null ? String(value[0]) : '')
          : str;
        return (
          <div className="fr-choice-group">
            {(field.options ?? []).map((opt, i) => (
              <label key={opt} className="fr-choice-label">
                <input id={i === 0 ? id : undefined} type="radio" name={`${id}-group`} value={opt}
                  disabled={readOnly} checked={radioValue === opt}
                  onChange={() => onChange(field.name, opt)} />
                {opt}
              </label>
            ))}
          </div>
        );
      }
      default:
        return <input {...common} type="text" className="fr-input" value={str}
          onChange={(e) => onChange(field.name, e.target.value)} />;
    }
  };

  if (fields.length === 0) return <p className="fr-empty">{t('noFields')}</p>;

  return (
    <div className="fr-form-fields">
      {fields.map((field) => {
        const id = idFor(field.name);
        const err = showErrors ? errors[field.name] : null;
        const labelText = (
          <>
            {labelOf(field.name)}
            {field.required && (
              <>
                <span className="fr-required" aria-hidden="true">*</span>
                <span className="fr-sr-only"> ({t('required')})</span>
              </>
            )}
          </>
        );
        const errorNode = err
          ? <span className="fr-field-error" id={`${id}-error`}>{err}</span>
          : null;

        // A single <label> cannot name a set of controls; selection groups get
        // fieldset/legend (design-system invariant).
        if (field.type === 'selection') {
          return (
            <fieldset key={field.name} className="fr-field fr-fieldset"
              aria-invalid={err ? true : undefined}
              aria-describedby={err ? `${id}-error` : undefined}
              aria-required={field.required || undefined}>
              <legend className="fr-legend">{labelText}</legend>
              {renderControl(field)}
              {errorNode}
            </fieldset>
          );
        }
        return (
          <div key={field.name}
            className={`fr-field${field.type === 'bool' ? ' fr-field--checkbox' : ''}`}>
            <label htmlFor={id}>{labelText}</label>
            {renderControl(field)}
            {errorNode}
          </div>
        );
      })}
    </div>
  );
}
