import { useEffect, useState, useCallback, type FormEvent } from 'react';
import { useTranslation } from '../hooks/useTranslation.ts';
import { listActivities, addActivity, updateLeadStage } from '../api/client.ts';
import { useModel } from '../contexts/ModelContext.tsx';
import { leadStages, formModel } from '../utils/leadModel.ts';
import { type Lead, type LeadActivity } from '../types/models.ts';
import type { ModelDefinition } from '../types/models.ts';
import ConvertToFamilyModal from './ConvertToFamilyModal.tsx';
import './DynamicForm.css';
import './LeadModal.css';
import './LeadDetailDrawer.css';

const ACTIVITY_TYPES = ['call', 'email', 'note'] as const;

function formatLabel(name: string): string {
  return name.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function formatValue(val: unknown): string {
  if (Array.isArray(val)) return val.join(', ');
  return String(val);
}

export default function LeadDetailDrawer(
  { tenant, lead, onClose, onChanged }:
  { tenant: string; lead: Lead; onClose: () => void; onChanged: () => void },
) {
  const { t } = useTranslation();
  const { getModel } = useModel();
  const [model, setModel] = useState<ModelDefinition | null>(null);
  const [activities, setActivities] = useState<LeadActivity[]>([]);
  const [stage, setStage] = useState(lead.stage);
  const [pendingStage, setPendingStage] = useState<Lead['stage'] | null>(null);
  const [savingStage, setSavingStage] = useState(false);
  const [actType, setActType] = useState<(typeof ACTIVITY_TYPES)[number]>('note');
  const [actBody, setActBody] = useState('');
  const [showConvert, setShowConvert] = useState(false);

  useEffect(() => { getModel(tenant, 'lead').then(setModel).catch(() => setModel(null)); }, [tenant, getModel]);

  const stages = leadStages(model);

  const loadActs = useCallback(
    () => listActivities(tenant, lead.entity_id),
    [tenant, lead.entity_id],
  );
  useEffect(() => { loadActs().then(setActivities); }, [loadActs]);

  // Selecting a new stage only stages the change; it is committed on confirm.
  function requestStageChange(next: string) {
    if (next !== stage) setPendingStage(next as Lead['stage']);
  }

  async function confirmStageChange() {
    if (!pendingStage) return;
    const next = pendingStage;
    setSavingStage(true);
    try {
      await updateLeadStage(tenant, lead.entity_id, next);
      setStage(next);
      setActivities(await loadActs());
      onChanged();
      setPendingStage(null);
    } finally {
      setSavingStage(false);
    }
  }

  async function submitActivity(e: FormEvent) {
    e.preventDefault();
    if (!actBody.trim()) return;
    await addActivity(tenant, lead.entity_id, actType, actBody.trim());
    setActBody('');
    setActivities(await loadActs());
  }

  // Dynamic read-only field list from the model's non-reserved fields.
  const displayFields = model
    ? [...formModel(model).base_fields, ...formModel(model).custom_fields].filter(
        (fld) => {
          const v = lead[fld.name];
          return v != null && v !== '' && !(Array.isArray(v) && v.length === 0);
        },
      )
    : null;

  return (
    <div className="drawer-backdrop" onClick={onClose}>
      <aside className="lead-drawer" onClick={(e) => e.stopPropagation()}>
        <button className="drawer-close" onClick={onClose}>×</button>
        <h2>{String(lead.guardian_name ?? '')}</h2>

        {displayFields ? (
          <dl className="lead-detail-fields">
            {displayFields.map((fld) => (
              <div key={fld.name} className="lead-detail-field">
                <dt>{formatLabel(fld.name)}</dt>
                <dd>{formatValue(lead[fld.name])}</dd>
              </div>
            ))}
          </dl>
        ) : (
          <>
            <p>{lead.email} {lead.phone}</p>
            <p>{lead.student_first_name} {lead.student_last_name} — {lead.grade_of_interest}</p>
          </>
        )}

        <div className="dynamic-form-field">
          <label>{t('leads.stage')}</label>
          <select value={stage} onChange={(e) => requestStageChange(e.target.value)}>
            {stages.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>

        <button
          className={`dynamic-form-btn-primary ${lead.converted_family_id ? 'dynamic-form-btn-invalid' : ''}`}
          disabled={!!lead.converted_family_id}
          onClick={() => setShowConvert(true)}
        >
          {lead.converted_family_id ? `Converted → ${lead.converted_family_id}` : t('leads.convert')}
        </button>

        <form onSubmit={submitActivity} className="activity-form">
          <select value={actType} onChange={(e) => setActType(e.target.value as typeof actType)}>
            {ACTIVITY_TYPES.map((ty) => <option key={ty} value={ty}>{ty}</option>)}
          </select>
          <input value={actBody} onChange={(e) => setActBody(e.target.value)} placeholder={t('leads.addActivity')} />
          <button type="submit" className="dynamic-form-btn-primary">+</button>
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

        {pendingStage && (
          <div className="lead-modal-overlay" onClick={() => !savingStage && setPendingStage(null)}>
            <div className="lead-modal" onClick={(e) => e.stopPropagation()}>
              <div className="lead-modal-header"><h3>{t('leads.confirmStageTitle')}</h3></div>
              <div className="lead-modal-body">
                <p>{t('leads.confirmStagePrompt')}</p>
                <p className="stage-change-preview">
                  <strong>{stage}</strong> → <strong>{pendingStage}</strong>
                </p>
                <div className="dynamic-form-actions">
                  <button type="button" className="dynamic-form-btn-secondary"
                    disabled={savingStage} onClick={() => setPendingStage(null)}>
                    {t('leads.cancel')}
                  </button>
                  <button type="button" className="dynamic-form-btn-primary"
                    disabled={savingStage} onClick={() => void confirmStageChange()}>
                    {t('leads.confirm')}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {showConvert && (
          <ConvertToFamilyModal tenant={tenant} lead={lead}
            onClose={() => setShowConvert(false)}
            onConverted={() => { setShowConvert(false); onChanged(); onClose(); }} />
        )}
      </aside>
    </div>
  );
}
