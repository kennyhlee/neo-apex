import { useState } from 'react';
import { type FormEvent } from 'react';
import { createLead } from '../api/client.ts';
import { parseInquiryEmail } from '../utils/parseInquiryEmail.ts';
import './DynamicForm.css';
import './LeadModal.css';

export default function ImportEmailModal(
  { tenant, onClose, onCreated }: { tenant: string; onClose: () => void; onCreated: () => void },
) {
  const [raw, setRaw] = useState('');
  const [parsed, setParsed] = useState<Record<string, string> | null>(null);
  const [error, setError] = useState<string | null>(null);

  function doParse() {
    const p = parseInquiryEmail(raw);
    setParsed({
      guardian_name: p.guardian_name ?? '',
      email: p.email ?? '',
      phone: p.phone ?? '',
      student_first_name: p.student_first_name ?? '',
      student_last_name: p.student_last_name ?? '',
      message: p.message ?? '',
    });
  }

  async function confirm(e: FormEvent) {
    e.preventDefault();
    if (!parsed) return;
    if (!parsed.guardian_name.trim() || (!parsed.email.trim() && !parsed.phone.trim())) {
      setError('Guardian name and at least one contact are required.');
      return;
    }
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
                    <label>{k}</label>
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
