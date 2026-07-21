import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { submitPublicLead } from '../api/client.ts';
import '../components/DynamicForm.css';
import './PublicInquiryPage.css';

export default function PublicInquiryPage() {
  const { tenantId = '' } = useParams();
  const [f, setF] = useState({ guardian_name: '', email: '', phone: '',
    student_first_name: '', student_last_name: '', grade_of_interest: '', message: '' });
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setF({ ...f, [k]: e.target.value });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!f.guardian_name.trim() || !f.email.trim()) {
      setError('Name and email are required.'); return;
    }
    try {
      const payload = Object.fromEntries(Object.entries(f).filter(([, v]) => v.trim()));
      await submitPublicLead(tenantId, payload);
      setDone(true);
    } catch { setError('Sorry, something went wrong. Please try again.'); }
  }

  if (done) return <div className="inquiry-page"><h1>Thank you!</h1><p>We'll be in touch soon.</p></div>;

  return (
    <div className="inquiry-page">
      <h1>Request Information</h1>
      <form onSubmit={submit}>
        {error && <div className="dynamic-form-error">{error}</div>}
        <div className="dynamic-form-fields">
          <div className="dynamic-form-field">
            <label>Your name<span className="dynamic-form-required">*</span></label>
            <input value={f.guardian_name} onChange={set('guardian_name')} />
          </div>
          <div className="dynamic-form-field">
            <label>Email<span className="dynamic-form-required">*</span></label>
            <input value={f.email} onChange={set('email')} />
          </div>
          <div className="dynamic-form-field">
            <label>Phone</label>
            <input value={f.phone} onChange={set('phone')} />
          </div>
          <div className="dynamic-form-field">
            <label>Student first name</label>
            <input value={f.student_first_name} onChange={set('student_first_name')} />
          </div>
          <div className="dynamic-form-field">
            <label>Student last name</label>
            <input value={f.student_last_name} onChange={set('student_last_name')} />
          </div>
          <div className="dynamic-form-field">
            <label>Grade of interest</label>
            <input value={f.grade_of_interest} onChange={set('grade_of_interest')} />
          </div>
          <div className="dynamic-form-field">
            <label>Message</label>
            <textarea value={f.message} onChange={set('message')} />
          </div>
        </div>
        <div className="dynamic-form-actions">
          <button type="submit" className="dynamic-form-btn-primary">Submit</button>
        </div>
      </form>
    </div>
  );
}
