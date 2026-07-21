import { useState } from 'react';
import { type ChangeEvent, type FormEvent } from 'react';
import { createLead } from '../api/client.ts';
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
    <div className="modal-backdrop" onClick={onClose}>
      <form className="modal" onClick={(e) => e.stopPropagation()} onSubmit={submit}>
        <h3>Add Lead</h3>
        {error && <p className="error">{error}</p>}
        <label>Guardian name*<input value={f.guardian_name} onChange={set('guardian_name')} /></label>
        <label>Email<input value={f.email} onChange={set('email')} /></label>
        <label>Phone<input value={f.phone} onChange={set('phone')} /></label>
        <label>Student first name<input value={f.student_first_name} onChange={set('student_first_name')} /></label>
        <label>Student last name<input value={f.student_last_name} onChange={set('student_last_name')} /></label>
        <label>Grade of interest<input value={f.grade_of_interest} onChange={set('grade_of_interest')} /></label>
        <div className="modal-actions">
          <button type="button" onClick={onClose}>Cancel</button>
          <button type="submit">Create</button>
        </div>
      </form>
    </div>
  );
}
