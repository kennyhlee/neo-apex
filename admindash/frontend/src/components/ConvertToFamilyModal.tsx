import { useState, type FormEvent } from 'react';
import { convertLead } from '../api/client.ts';
import type { Lead } from '../types/models.ts';
import './DynamicForm.css';
import './LeadModal.css';

export default function ConvertToFamilyModal(
  { tenant, lead, onClose, onConverted }:
  { tenant: string; lead: Lead; onClose: () => void; onConverted: () => void },
) {
  const [familyName, setFamilyName] = useState(`${lead.guardian_name}`);
  const [address, setAddress] = useState('');
  const [firstName, setFirstName] = useState(lead.student_first_name ?? '');
  const [lastName, setLastName] = useState(lead.student_last_name ?? '');
  const [grade, setGrade] = useState(lead.grade_of_interest ?? '');
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!address.trim() || !firstName.trim() || !lastName.trim()) {
      setError('Address and student name are required.'); return;
    }
    try {
      await convertLead(tenant, lead.entity_id, {
        family_name: familyName, primary_address: address,
        primary_email: lead.email, primary_phone: lead.phone,
        student_first_name: firstName, student_last_name: lastName,
        grade_level: grade || undefined,
      });
      onConverted();
    } catch (err) { setError(String(err)); }
  }

  return (
    <div className="lead-modal-overlay" onClick={onClose}>
      <form className="lead-modal" onClick={(e) => e.stopPropagation()} onSubmit={submit}>
        <div className="lead-modal-header"><h3>Convert to Family</h3></div>
        <div className="lead-modal-body">
          {error && <div className="dynamic-form-error">{error}</div>}
          <div className="dynamic-form-fields">
            <div className="dynamic-form-field">
              <label>Family name</label>
              <input value={familyName} onChange={(e) => setFamilyName(e.target.value)} />
            </div>
            <div className="dynamic-form-field">
              <label>Primary address<span className="dynamic-form-required">*</span></label>
              <input value={address} onChange={(e) => setAddress(e.target.value)} />
            </div>
            <div className="dynamic-form-field">
              <label>Student first name<span className="dynamic-form-required">*</span></label>
              <input value={firstName} onChange={(e) => setFirstName(e.target.value)} />
            </div>
            <div className="dynamic-form-field">
              <label>Student last name<span className="dynamic-form-required">*</span></label>
              <input value={lastName} onChange={(e) => setLastName(e.target.value)} />
            </div>
            <div className="dynamic-form-field">
              <label>Grade</label>
              <input value={grade} onChange={(e) => setGrade(e.target.value)} />
            </div>
          </div>
          <div className="dynamic-form-actions">
            <button type="button" className="dynamic-form-btn-secondary" onClick={onClose}>Cancel</button>
            <button type="submit" className="dynamic-form-btn-primary">Convert</button>
          </div>
        </div>
      </form>
    </div>
  );
}
