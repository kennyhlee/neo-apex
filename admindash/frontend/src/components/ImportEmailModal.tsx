import { useState } from 'react';
import { type FormEvent } from 'react';
import { createLead } from '../api/client.ts';
import { parseInquiryEmail } from '../utils/parseInquiryEmail.ts';
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
    <div className="modal-backdrop" onClick={onClose}>
      <form className="modal" onClick={(e) => e.stopPropagation()} onSubmit={confirm}>
        <h3>Import from Email</h3>
        {error && <p className="error">{error}</p>}
        {!parsed ? (
          <>
            <textarea
              rows={10}
              value={raw}
              onChange={(e) => setRaw(e.target.value)}
              placeholder="Paste the inquiry email here…"
            />
            <div className="modal-actions">
              <button type="button" onClick={onClose}>Cancel</button>
              <button type="button" onClick={doParse} disabled={!raw.trim()}>Parse</button>
            </div>
          </>
        ) : (
          <>
            {Object.keys(parsed).map((k) => (
              <label key={k}>{k}
                <input
                  value={parsed[k]}
                  onChange={(e) => setParsed({ ...parsed, [k]: e.target.value })}
                />
              </label>
            ))}
            <div className="modal-actions">
              <button type="button" onClick={() => setParsed(null)}>Back</button>
              <button type="submit">Create Lead</button>
            </div>
          </>
        )}
      </form>
    </div>
  );
}
