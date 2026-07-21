import { useEffect, useState } from 'react';
import { type FormEvent } from 'react';
import { createLead } from '../api/client.ts';
import { parseInquiryEmail } from '../utils/parseInquiryEmail.ts';
import { useModel } from '../contexts/ModelContext.tsx';
import { formModel, formatFieldLabel } from '../utils/leadModel.ts';
import type { ModelDefinition } from '../types/models.ts';
import './DynamicForm.css';
import './LeadModal.css';

const FIXED_REVIEW_KEYS = [
  'guardian_name', 'email', 'phone',
  'student_first_name', 'student_last_name', 'message',
] as const;

export default function ImportEmailModal(
  { tenant, onClose, onCreated }: { tenant: string; onClose: () => void; onCreated: () => void },
) {
  const { getModel } = useModel();
  const [model, setModel] = useState<ModelDefinition | null>(null);
  const [raw, setRaw] = useState('');
  const [parsed, setParsed] = useState<Record<string, string> | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { getModel(tenant, 'lead').then(setModel).catch(() => setModel(null)); }, [tenant, getModel]);

  // Field names shown in the review step: model base fields (non-reserved) or fixed fallback.
  const reviewFieldNames: string[] = model
    ? formModel(model).base_fields.map((fld) => fld.name)
    : [...FIXED_REVIEW_KEYS];

  function doParse() {
    const p = parseInquiryEmail(raw);
    // Values the parser can produce, keyed by name.
    const parserValues: Record<string, string> = {
      guardian_name: p.guardian_name ?? '',
      email: p.email ?? '',
      phone: p.phone ?? '',
      student_first_name: p.student_first_name ?? '',
      student_last_name: p.student_last_name ?? '',
      message: p.message ?? '',
    };
    // Pre-fill review fields by matching field name; leave others blank.
    const initial: Record<string, string> = {};
    for (const name of reviewFieldNames) {
      initial[name] = parserValues[name] ?? '';
    }
    setParsed(initial);
  }

  async function confirm(e: FormEvent) {
    e.preventDefault();
    if (!parsed) return;
    try {
      const payload = Object.fromEntries(Object.entries(parsed).filter(([, v]) => v.trim()));
      await createLead(tenant, { ...payload, source: 'email_import' });
      onCreated();
    } catch (err) {
      setError(String(err));
    }
  }

  return (
    <div className="lead-modal-overlay" onClick={onClose}>
      <form className="lead-modal" onClick={(e) => e.stopPropagation()} onSubmit={confirm}>
        <div className="lead-modal-header"><h3>Import from Email</h3></div>
        <div className="lead-modal-body">
          {error && <div className="dynamic-form-error">{error}</div>}
          {!parsed ? (
            <>
              <div className="dynamic-form-field">
                <textarea
                  rows={10}
                  value={raw}
                  onChange={(e) => setRaw(e.target.value)}
                  placeholder="Paste the inquiry email here…"
                />
              </div>
              <div className="dynamic-form-actions">
                <button type="button" className="dynamic-form-btn-secondary" onClick={onClose}>Cancel</button>
                <button type="button" className="dynamic-form-btn-primary" onClick={doParse} disabled={!raw.trim()}>Parse</button>
              </div>
            </>
          ) : (
            <>
              <div className="dynamic-form-fields">
                {Object.keys(parsed).map((k) => (
                  <div key={k} className="dynamic-form-field">
                    <label>{formatFieldLabel(k)}</label>
                    <input
                      value={parsed[k]}
                      onChange={(e) => setParsed({ ...parsed, [k]: e.target.value })}
                    />
                  </div>
                ))}
              </div>
              <div className="dynamic-form-actions">
                <button type="button" className="dynamic-form-btn-secondary" onClick={() => setParsed(null)}>Back</button>
                <button type="submit" className="dynamic-form-btn-primary">Create Lead</button>
              </div>
            </>
          )}
        </div>
      </form>
    </div>
  );
}
