import { useState } from 'react';
import { type ChangeEvent, type FormEvent } from 'react';
import { createLead } from '../api/client.ts';
import './DynamicForm.css';
import './LeadModal.css';

export default function AddLeadModal(
  { tenant, onClose, onCreated }: { tenant: string; onClose: () => void; onCreated: () => void },
) {
  const [f, setF] = useState({
    guardian_name: '', email: '', phone: '',
    student_first_name: '', student_last_name: '', grade_of_interest: '', message: '',
  });
  const [error, setError] = useState<string | null>(null);
  const set = (k: string) => (e: ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!f.guardian_name.trim() || (!f.email.trim() && !f.phone.trim())) {
      setError('Guardian name and at least one contact (email or phone) are required.');
      return;
    }
    try {
      const payload = Object.fromEntries(Object.entries(f).filter(([, v]) => v.trim()));
      await createLead(tenant, payload);
      onCreated();
    } catch (err) {
      setError(String(err));
    }
  }

  return (
    <div className="lead-modal-overlay" onClick={onClose}>
      <form className="lead-modal" onClick={(e) => e.stopPropagation()} onSubmit={submit}>
        <div className="lead-modal-header"><h3>Add Lead</h3></div>
        <div className="lead-modal-body">
          {error && <div className="dynamic-form-error">{error}</div>}
          <div className="dynamic-form-fields">
            <div className="dynamic-form-field">
              <label>Guardian name<span className="dynamic-form-required">*</span></label>
              <input value={f.guardian_name} onChange={set('guardian_name')} />
            </div>
            <div className="dynamic-form-field">
              <label>Email</label>
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
          </div>
          <div className="dynamic-form-actions">
            <button type="button" className="dynamic-form-btn-secondary" onClick={onClose}>Cancel</button>
            <button type="submit" className="dynamic-form-btn-primary">Create</button>
          </div>
        </div>
      </form>
    </div>
  );
}
