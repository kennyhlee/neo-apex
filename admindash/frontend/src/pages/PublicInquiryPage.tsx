import { useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { fetchPublicLeadModel, submitPublicLead } from '../api/client.ts';
import { formatFieldLabel } from '../utils/leadModel.ts';
import { type LeadModelField } from '../types/models.ts';
import Button from '../components/ui/Button.tsx';
import '../components/DynamicForm.css';
import './PublicInquiryPage.css';

const DEFAULT_FIELDS: LeadModelField[] = [
  { name: 'guardian_name', type: 'str', required: true },
  { name: 'email', type: 'email', required: false },
  { name: 'phone', type: 'phone', required: false },
  { name: 'student_first_name', type: 'str', required: false },
  { name: 'student_last_name', type: 'str', required: false },
  { name: 'grade_of_interest', type: 'str', required: false },
  { name: 'message', type: 'str', required: false },
];

function fieldId(name: string) {
  return `field-${name}`;
}

function renderInput(
  field: LeadModelField,
  value: string,
  onChange: (v: string) => void,
  invalid: boolean,
) {
  const id = fieldId(field.name);
  const shared = {
    id,
    required: field.required,
    'aria-invalid': invalid || undefined,
  };
  if (field.name === 'message' || (field.type !== 'email' && field.type !== 'phone' && field.type !== 'selection' && field.type !== 'str' && field.type !== 'number' && field.type !== 'date')) {
    return (
      <textarea
        {...shared}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    );
  }
  if (field.type === 'selection' && field.options && field.options.length > 0) {
    return (
      <select {...shared} value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">-- select --</option>
        {field.options.map((opt) => (
          <option key={opt} value={opt}>{opt}</option>
        ))}
      </select>
    );
  }
  const inputType = field.type === 'email' ? 'email' : field.type === 'phone' ? 'tel' : 'text';
  return (
    <input
      {...shared}
      type={inputType}
      value={value}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

export default function PublicInquiryPage() {
  const { tenantId = '' } = useParams();
  const [fields, setFields] = useState<LeadModelField[]>(DEFAULT_FIELDS);
  const [values, setValues] = useState<Record<string, string>>({});
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Required fields left blank on the last submit attempt. */
  const [missing, setMissing] = useState<string[]>([]);
  const alertRef = useRef<HTMLDivElement | null>(null);

  function applyFields(modelFields: LeadModelField[]) {
    setFields(modelFields);
    const init: Record<string, string> = {};
    for (const f of modelFields) init[f.name] = '';
    setValues(init);
  }

  useEffect(() => {
    if (!tenantId) return;
    fetchPublicLeadModel(tenantId)
      .then((modelFields) => {
        if (modelFields && modelFields.length > 0) {
          applyFields(modelFields);
        } else {
          applyFields(DEFAULT_FIELDS);
        }
      })
      .catch(() => applyFields(DEFAULT_FIELDS));
  }, [tenantId]);

  // A failed submit must be announced and reachable, not just painted.
  useEffect(() => {
    if (!error && missing.length === 0) return;
    const node = alertRef.current;
    if (!node) return;
    node.focus();
    node.scrollIntoView({ block: 'nearest' });
  }, [error, missing]);

  function setValue(name: string, v: string) {
    setValues((prev) => ({ ...prev, [name]: v }));
    setMissing((prev) => (prev.includes(name) && v.trim() ? prev.filter((n) => n !== name) : prev));
  }

  function focusField(name: string) {
    const el = document.getElementById(fieldId(name));
    if (!el) return;
    el.scrollIntoView({ block: 'nearest' });
    el.focus();
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const missingNames = fields
      .filter((f) => f.required && !(values[f.name] ?? '').trim())
      .map((f) => f.name);
    if (missingNames.length > 0) {
      setError(null);
      setMissing(missingNames);
      return;
    }
    setMissing([]);
    setError(null);
    try {
      const payload = Object.fromEntries(
        Object.entries(values).filter(([, v]) => v.trim()),
      );
      await submitPublicLead(tenantId, payload);
      setDone(true);
    } catch {
      setError('Sorry, something went wrong. Please try again.');
    }
  }

  if (done) return <div className="inquiry-page"><h1>Thank you!</h1><p>We'll be in touch soon.</p></div>;

  return (
    <div className="inquiry-page">
      <h1>Request Information</h1>
      <form onSubmit={submit} noValidate>
        {error && (
          <div className="dynamic-form-error" role="alert" tabIndex={-1} ref={alertRef}>
            {error}
          </div>
        )}
        {missing.length > 0 && (
          <div
            className="dynamic-form-error-summary"
            role="alert"
            tabIndex={-1}
            ref={alertRef}
          >
            <p className="dynamic-form-error-summary-title">
              {missing.length === 1
                ? 'There is 1 required field still to fill in:'
                : `There are ${missing.length} required fields still to fill in:`}
            </p>
            <ul className="dynamic-form-error-summary-list">
              {missing.map((name) => (
                <li key={name}>
                  <button
                    type="button"
                    className="dynamic-form-error-summary-link"
                    onClick={() => focusField(name)}
                  >
                    {formatFieldLabel(name)}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
        <div className="dynamic-form-fields">
          {fields.map((field) => (
            <div key={field.name} className="dynamic-form-field">
              <label htmlFor={fieldId(field.name)}>
                {formatFieldLabel(field.name)}
                {field.required && (
                  <>
                    <span className="dynamic-form-required" aria-hidden="true">*</span>
                    <span className="sr-only"> (required)</span>
                  </>
                )}
              </label>
              {renderInput(
                field,
                values[field.name] ?? '',
                (v) => setValue(field.name, v),
                missing.includes(field.name),
              )}
            </div>
          ))}
        </div>
        <div className="dynamic-form-actions">
          <Button type="submit" variant="primary">Submit</Button>
        </div>
      </form>
    </div>
  );
}
