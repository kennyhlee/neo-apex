import { useEffect, useId, useState, type FormEvent } from 'react';
import { convertLead } from '../api/client.ts';
import { useModel } from '../contexts/ModelContext.tsx';
import { leadStages } from '../utils/leadModel.ts';
import type { Lead } from '../types/models.ts';
import type { ModelDefinition } from '../types/models.ts';
import Modal from './ui/Modal.tsx';
import Button from './ui/Button.tsx';
import './DynamicForm.css';

export default function ConvertToFamilyModal(
  { tenant, lead, onClose, onConverted }:
  { tenant: string; lead: Lead; onClose: () => void; onConverted: () => void },
) {
  const { getModel } = useModel();
  const formId = useId();
  const [model, setModel] = useState<ModelDefinition | null>(null);
  const [familyName, setFamilyName] = useState(`${lead.guardian_name}`);
  const [address, setAddress] = useState('');
  const [firstName, setFirstName] = useState(lead.student_first_name ?? '');
  const [lastName, setLastName] = useState(lead.student_last_name ?? '');
  const [grade, setGrade] = useState(lead.grade_of_interest ?? '');
  const [targetStage, setTargetStage] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => { getModel(tenant, 'lead').then(setModel).catch(() => setModel(null)); }, [tenant, getModel]);

  const stages = leadStages(model);

  // Default target stage to the last stage once stages resolve.
  useEffect(() => {
    setTargetStage((prev) => prev || stages[stages.length - 1] || '');
  }, [stages]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!address.trim() || !firstName.trim() || !lastName.trim()) {
      setError('Address and student name are required.'); return;
    }
    setSubmitting(true);
    try {
      await convertLead(tenant, lead.entity_id, {
        family_name: familyName, primary_address: address,
        primary_email: lead.email, primary_phone: lead.phone,
        student_first_name: firstName, student_last_name: lastName,
        grade_level: grade || undefined,
        target_stage: targetStage || undefined,
      });
      onConverted();
    } catch (err) { setError(String(err)); } finally { setSubmitting(false); }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="Convert to Family"
      dismissOnBackdrop={!submitting}
      dismissOnEscape={!submitting}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={submitting}>Cancel</Button>
          <Button type="submit" form={formId} variant="primary" disabled={submitting}>Convert</Button>
        </>
      }
    >
      <form id={formId} onSubmit={submit}>
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
          <div className="dynamic-form-field">
            <label>Move lead to stage</label>
            <select value={targetStage} onChange={(e) => setTargetStage(e.target.value)}>
              {stages.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
        </div>
      </form>
    </Modal>
  );
}
