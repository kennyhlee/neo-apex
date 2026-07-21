import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { fetchPublicLeadModel, submitPublicLead } from '../api/client.ts';
import { formatFieldLabel } from '../utils/leadModel.ts';
import { type LeadModelField } from '../types/models.ts';
import '../components/DynamicForm.css';
import './PublicInquiryPage.css';

const DEFAULT_FIELDS: LeadModelField[] = [
  { name: 'guardian_name', type: 'str', required: true },
  { name: 'email', type: 'email', required: true },
  { name: 'phone', type: 'phone', required: false },
  { name: 'student_first_name', type: 'str', required: false },
  { name: 'student_last_name', type: 'str', required: false },
  { name: 'grade_of_interest', type: 'str', required: false },
  { name: 'message', type: 'str', required: false },
];

function renderInput(
  field: LeadModelField,
  value: string,
  onChange: (v: string) => void,
) {
  const id = `field-${field.name}`;
  if (field.name === 'message' || (field.type !== 'email' && field.type !== 'phone' && field.type !== 'selection' && field.type !== 'str' && field.type !== 'number' && field.type !== 'date')) {
    return (
      <textarea
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    );
  }
  if (field.type === 'selection' && field.options && field.options.length > 0) {
    return (
      <select id={id} value={value} onChange={(e) => onChange(e.target.value)}>
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
      id={id}
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

  function setValue(name: string, v: string) {
    setValues((prev) => ({ ...prev, [name]: v }));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const missing = fields
      .filter((f) => f.required && !(values[f.name] ?? '').trim())
      .map((f) => formatFieldLabel(f.name));
    if (missing.length > 0) {
      setError(`Required: ${missing.join(', ')}`);
      return;
    }
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
      <form onSubmit={submit}>
        {error && <div className="dynamic-form-error">{error}</div>}
        <div className="dynamic-form-fields">
          {fields.map((field) => (
            <div key={field.name} className="dynamic-form-field">
              <label htmlFor={`field-${field.name}`}>
                {formatFieldLabel(field.name)}
                {field.required && <span className="dynamic-form-required">*</span>}
              </label>
              {renderInput(field, values[field.name] ?? '', (v) => setValue(field.name, v))}
            </div>
          ))}
        </div>
        <div className="dynamic-form-actions">
          <button type="submit" className="dynamic-form-btn-primary">Submit</button>
        </div>
      </form>
    </div>
  );
}
