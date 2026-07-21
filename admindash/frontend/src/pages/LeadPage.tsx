import { useEffect, useState, useCallback } from 'react';
import { useTranslation } from '../hooks/useTranslation.ts';
import { listLeads } from '../api/client.ts';
import { LEAD_STAGES, type Lead, type LeadStage } from '../types/models.ts';
import LeadDetailDrawer from '../components/LeadDetailDrawer.tsx';
import AddLeadModal from '../components/AddLeadModal.tsx';
import ImportEmailModal from '../components/ImportEmailModal.tsx';
import '../components/DynamicForm.css';
import './LeadPage.css';

export default function LeadPage({ tenant }: { tenant: string }) {
  const { t } = useTranslation();
  const [leads, setLeads] = useState<Lead[]>([]);
  const [filter, setFilter] = useState<LeadStage | ''>('');
  const [selected, setSelected] = useState<Lead | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try { setLeads(await listLeads(tenant, filter || undefined)); }
    catch (e) { setError(String(e)); }
  }, [tenant, filter]);

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void load(); }, [load]);

  const byStage = (s: LeadStage) => leads.filter((l) => l.stage === s);

  return (
    <div className="leads-page">
      <header className="leads-header">
        <h1>{t('leads.title')}</h1>
        <div className="leads-actions">
          <select className="leads-stage-filter" value={filter} onChange={(e) => setFilter(e.target.value as LeadStage | '')}>
            <option value="">{t('leads.filterAll')}</option>
            {LEAD_STAGES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <button className="dynamic-form-btn-primary" onClick={() => setShowAdd(true)}>{t('leads.addManual')}</button>
          <button className="dynamic-form-btn-secondary" onClick={() => setShowImport(true)}>{t('leads.importEmail')}</button>
        </div>
      </header>
      {error && <div className="dynamic-form-error">{error}</div>}
      {leads.length === 0 && <p>{t('leads.empty')}</p>}
      <div className="leads-board">
        {LEAD_STAGES.map((stage) => (
          <div key={stage} className="leads-column">
            <h2>{stage} <span>{byStage(stage).length}</span></h2>
            {byStage(stage).map((l) => (
              <button key={l.entity_id} className="lead-card" onClick={() => setSelected(l)}>
                <strong>{l.guardian_name}</strong>
                <small>{l.student_first_name} {l.student_last_name}</small>
                <small>{l.email || l.phone}</small>
              </button>
            ))}
          </div>
        ))}
      </div>
      {selected && (
        <LeadDetailDrawer tenant={tenant} lead={selected}
          onClose={() => setSelected(null)} onChanged={() => { void load(); }} />
      )}
      {showAdd && <AddLeadModal tenant={tenant}
        onClose={() => setShowAdd(false)} onCreated={() => { setShowAdd(false); void load(); }} />}
      {showImport && <ImportEmailModal tenant={tenant}
        onClose={() => setShowImport(false)} onCreated={() => { setShowImport(false); void load(); }} />}
    </div>
  );
}
