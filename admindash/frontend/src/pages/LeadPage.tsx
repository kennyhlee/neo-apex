import { useEffect, useState, useCallback } from 'react';
import { useTranslation } from '../hooks/useTranslation.ts';
import { listLeads } from '../api/client.ts';
import { useModel } from '../contexts/ModelContext.tsx';
import { leadStages } from '../utils/leadModel.ts';
import type { Lead } from '../types/models.ts';
import type { ModelDefinition } from '../types/models.ts';
import Button from '../components/ui/Button.tsx';
import LeadDetailDrawer from '../components/LeadDetailDrawer.tsx';
import AddLeadModal from '../components/AddLeadModal.tsx';
import ImportEmailModal from '../components/ImportEmailModal.tsx';
import '../components/DynamicForm.css';
import './LeadPage.css';

export default function LeadPage({ tenant }: { tenant: string }) {
  const { t } = useTranslation();
  const { getModel } = useModel();
  const [model, setModel] = useState<ModelDefinition | null>(null);
  const [leads, setLeads] = useState<Lead[]>([]);
  const [filter, setFilter] = useState<string>('');
  const [selected, setSelected] = useState<Lead | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { getModel(tenant, 'lead').then(setModel).catch(() => setModel(null)); }, [tenant, getModel]);

  const stages = leadStages(model);

  const load = useCallback(async () => {
    try { setLeads(await listLeads(tenant, filter || undefined)); }
    catch (e) { setError(String(e)); }
  }, [tenant, filter]);

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void load(); }, [load]);

  const byStage = (s: string) => leads.filter((l) => l.stage === s);
  // Leads whose stage is set but no longer matches any known stage.
  const otherLeads = leads.filter((l) => l.stage && !stages.includes(l.stage));

  const renderCard = (l: Lead) => (
    <button key={l.entity_id} className="lead-card" onClick={() => setSelected(l)}>
      <strong>{String(l.guardian_name ?? l.student ?? l.contact ?? '')}</strong>
      <small>{l.student_first_name} {l.student_last_name}</small>
      <small>{l.email || l.phone}</small>
    </button>
  );

  return (
    <div className="leads-page">
      <header className="page-header">
        <h1 className="page-title">
          {t('leads.title')}
          <span className="page-subtitle">
            {leads.length} {t('common.records')}
          </span>
        </h1>
        <div className="page-header-actions">
          <label className="sr-only" htmlFor="leads-stage-filter">
            {t('leads.stage')}
          </label>
          <select
            id="leads-stage-filter"
            className="leads-stage-filter"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          >
            <option value="">{t('leads.filterAll')}</option>
            {stages.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <Button variant="secondary" onClick={() => setShowImport(true)}>
            {t('leads.importEmail')}
          </Button>
          <Button variant="primary" onClick={() => setShowAdd(true)}>
            {t('leads.addManual')}
          </Button>
        </div>
      </header>

      {error && (
        <div className="student-error" role="alert">
          <span>{t('students.loadError')}</span>
          <Button variant="secondary" size="sm" onClick={() => void load()}>
            {t('common.retry')}
          </Button>
        </div>
      )}

      {leads.length === 0 && !error && (
        <div className="leads-empty">
          <strong>{t('leads.empty')}</strong>
          <span>{t('today.inquiryLinkBody')}</span>
          <Button variant="primary" onClick={() => setShowAdd(true)}>
            {t('leads.addManual')}
          </Button>
        </div>
      )}

      <div className="leads-board">
        {stages.map((stage) => (
          <div key={stage} className="leads-column">
            <h2>{stage} <span>{byStage(stage).length}</span></h2>
            {byStage(stage).map(renderCard)}
          </div>
        ))}
        {otherLeads.length > 0 && (
          <div className="leads-column">
            <h2>{t('leads.otherStage')} <span>{otherLeads.length}</span></h2>
            {otherLeads.map(renderCard)}
          </div>
        )}
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
