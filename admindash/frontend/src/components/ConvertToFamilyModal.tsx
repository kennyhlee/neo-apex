import { useState, type FormEvent } from 'react';
import { convertLead } from '../api/client.ts';
import type { Lead } from '../types/models.ts';
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
    <div className="modal-backdrop" onClick={onClose}>
      <form className="modal" onClick={(e) => e.stopPropagation()} onSubmit={submit}>
        <h3>Convert to Family</h3>
        {error && <p className="error">{error}</p>}
        <label>Family name<input value={familyName} onChange={(e) => setFamilyName(e.target.value)} /></label>
        <label>Primary address*<input value={address} onChange={(e) => setAddress(e.target.value)} /></label>
        <label>Student first name*<input value={firstName} onChange={(e) => setFirstName(e.target.value)} /></label>
        <label>Student last name*<input value={lastName} onChange={(e) => setLastName(e.target.value)} /></label>
        <label>Grade<input value={grade} onChange={(e) => setGrade(e.target.value)} /></label>
        <div className="modal-actions">
          <button type="button" onClick={onClose}>Cancel</button>
          <button type="submit">Convert</button>
        </div>
      </form>
    </div>
  );
}
