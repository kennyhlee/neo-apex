// flow-runtime/src/blocks/FormBlock.tsx
import { useId } from 'react';
import type { FlowField } from '../types';
import { useFlowT } from '../i18n';
import { labelOf } from '../blockConfig';

export interface FormBlockProps {
  blockId: string;
  fields: FlowField[];
  values: Record<string, unknown>;
  errors: Record<string, string | null>;
  /** True after a failed step-advance: show every error, not only touched ones. */
  showErrors: boolean;
  readOnly: boolean;
  onChange: (name: string, value: unknown) => void;
  /**
   * Pre-filled, non-editable facts shown above the inputs — the school and
   * the school year on an application-model block.
   *
   * Deliberately NOT rendered as disabled inputs: a disabled input still
   * reads as "a thing you were supposed to fill", and these are context the
   * engine already knows from the tenant and the application. They are
   * display-only and are never collected, so nothing here reaches
   * `onChange` or `draft_data`.
   */
  context?: { label: string; value: string }[];
}

export function FormBlock({
  blockId, fields, values, errors, showErrors, readOnly, onChange, context,
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

  const contextRows = (context ?? []).filter((c) => c.value);
  const contextNode = contextRows.length > 0 ? (
    <dl className="fr-context">
      {contextRows.map((c) => (
        <div key={c.label} className="fr-context-row">
          <dt>{c.label}</dt>
          <dd>{c.value}</dd>
        </div>
      ))}
    </dl>
  ) : null;

  // Context still renders when the model contributes no editable fields —
  // "here is the school you are applying to" is worth showing on its own,
  // and `noFields` alone would read as a broken step.
  if (fields.length === 0) {
    return contextNode ?? <p className="fr-empty">{t('noFields')}</p>;
  }

  return (
    <div className="fr-form-fields">
      {contextNode}
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
