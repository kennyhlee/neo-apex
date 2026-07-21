import { useEffect, useState, useCallback, type FormEvent } from 'react';
import { useTranslation } from '../hooks/useTranslation.ts';
import { listActivities, addActivity, updateLeadStage } from '../api/client.ts';
import { LEAD_STAGES, type Lead, type LeadActivity } from '../types/models.ts';
import ConvertToFamilyModal from './ConvertToFamilyModal.tsx';
import './LeadDetailDrawer.css';

const ACTIVITY_TYPES = ['call', 'email', 'note'] as const;

export default function LeadDetailDrawer(
  { tenant, lead, onClose, onChanged }:
  { tenant: string; lead: Lead; onClose: () => void; onChanged: () => void },
) {
  const { t } = useTranslation();
  const [activities, setActivities] = useState<LeadActivity[]>([]);
  const [stage, setStage] = useState(lead.stage);
  const [actType, setActType] = useState<(typeof ACTIVITY_TYPES)[number]>('note');
  const [actBody, setActBody] = useState('');
  const [showConvert, setShowConvert] = useState(false);

  const loadActs = useCallback(
    () => listActivities(tenant, lead.entity_id),
    [tenant, lead.entity_id],
  );
  useEffect(() => { loadActs().then(setActivities); }, [loadActs]);

  async function changeStage(next: string) {
    setStage(next as Lead['stage']);
    await updateLeadStage(tenant, lead.entity_id, next);
    setActivities(await loadActs());
    onChanged();
  }

  async function submitActivity(e: FormEvent) {
    e.preventDefault();
    if (!actBody.trim()) return;
    await addActivity(tenant, lead.entity_id, actType, actBody.trim());
    setActBody('');
    setActivities(await loadActs());
  }

  return (
    <div className="drawer-backdrop" onClick={onClose}>
      <aside className="lead-drawer" onClick={(e) => e.stopPropagation()}>
        <button className="drawer-close" onClick={onClose}>×</button>
        <h2>{lead.guardian_name}</h2>
        <p>{lead.email} {lead.phone}</p>
        <p>{lead.student_first_name} {lead.student_last_name} — {lead.grade_of_interest}</p>

        <label>{t('leads.stage')}
          <select value={stage} onChange={(e) => void changeStage(e.target.value)}>
            {LEAD_STAGES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </label>

        <button disabled={!!lead.converted_family_id} onClick={() => setShowConvert(true)}>
          {lead.converted_family_id ? `Converted → ${lead.converted_family_id}` : t('leads.convert')}
        </button>

        <form onSubmit={submitActivity} className="activity-form">
          <select value={actType} onChange={(e) => setActType(e.target.value as typeof actType)}>
            {ACTIVITY_TYPES.map((ty) => <option key={ty} value={ty}>{ty}</option>)}
          </select>
          <input value={actBody} onChange={(e) => setActBody(e.target.value)} placeholder={t('leads.addActivity')} />
          <button type="submit">+</button>
        </form>

        <h3>{t('leads.activityTimeline')}</h3>
        <ul className="activity-list">
          {activities.map((a) => (
            <li key={a.entity_id}>
              <span className={`badge badge-${a.type}`}>{a.type}</span>
              <span>{a.type === 'stage_change' ? `${a.stage_from} → ${a.stage_to}` : a.body}</span>
              <small>{a._created_at?.slice(0, 16).replace('T', ' ')}</small>
            </li>
          ))}
        </ul>

        {showConvert && (
          <ConvertToFamilyModal tenant={tenant} lead={lead}
            onClose={() => setShowConvert(false)}
            onConverted={() => { setShowConvert(false); onChanged(); onClose(); }} />
        )}
      </aside>
    </div>
  );
}
