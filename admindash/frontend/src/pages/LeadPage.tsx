import { useEffect, useMemo, useState, useCallback } from 'react';
import { useTranslation } from '../hooks/useTranslation.ts';
import { listLeads } from '../api/client.ts';
import { useModel } from '../contexts/ModelContext.tsx';
import { leadStages } from '../utils/leadModel.ts';
import { stageTone } from '../utils/tone.ts';
import type { Lead } from '../types/models.ts';
import type { ModelDefinition } from '../types/models.ts';
import Button from '../components/ui/Button.tsx';
import SearchField from '../components/ui/SearchField.tsx';
import EntityTile from '../components/ui/EntityTile.tsx';
import LeadDetailDrawer from '../components/LeadDetailDrawer.tsx';
import AddLeadModal from '../components/AddLeadModal.tsx';
import ImportEmailModal from '../components/ImportEmailModal.tsx';
import '../components/DynamicForm.css';
import './LeadPage.css';

/** Two initials read as a person; one reads as a filing code. */
function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '—';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export default function LeadPage({ tenant }: { tenant: string }) {
  const { t } = useTranslation();
  const { getModel } = useModel();
  const [model, setModel] = useState<ModelDefinition | null>(null);
  const [leads, setLeads] = useState<Lead[]>([]);
  const [search, setSearch] = useState('');
  const [applied, setApplied] = useState('');
  const [selected, setSelected] = useState<Lead | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { getModel(tenant, 'lead').then(setModel).catch(() => setModel(null)); }, [tenant, getModel]);

  const stages = leadStages(model);

  // Always fetch the whole board. The stage <select> that used to drive a
  // server-side filter has gone: the board already groups by stage, so
  // filtering to one stage only ever rendered a board with one column.
  const load = useCallback(async () => {
    try {
      setLeads(await listLeads(tenant));
      setError(null);
    } catch (e) {
      setError(String(e));
    }
  }, [tenant]);

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void load(); }, [load]);

  /** Search is what the board was missing — find a family by any handle. */
  const visible = useMemo(() => {
    const q = applied.trim().toLowerCase();
    if (!q) return leads;
    return leads.filter((l) =>
      [l.guardian_name, l.student_first_name, l.student_last_name, l.email, l.phone]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(q)),
    );
  }, [leads, applied]);

  const byStage = (s: string) => visible.filter((l) => l.stage === s);
  // Leads whose stage is set but no longer matches any known stage.
  const otherLeads = visible.filter((l) => l.stage && !stages.includes(l.stage));

  const renderCard = (l: Lead) => {
    const name = String(l.guardian_name ?? l.student ?? l.contact ?? '').trim() || '—';
    const student = [l.student_first_name, l.student_last_name].filter(Boolean).join(' ');
    return (
      <button key={l.entity_id} type="button" className="lead-card" onClick={() => setSelected(l)}>
        <EntityTile initials={initialsOf(name)} seed={name} />
        <span className="lead-card-text">
          <strong>{name}</strong>
          {student && <small>{student}</small>}
          <small>{l.email || l.phone}</small>
        </span>
      </button>
    );
  };

  const renderColumn = (label: string, rows: Lead[], tone: string) => (
    <div key={label} className={`leads-column leads-column--${tone}`}>
      <h2>
        {label} <span>{rows.length}</span>
      </h2>
      {rows.length === 0 ? (
        <p className="leads-column-empty">{t('leads.columnEmpty')}</p>
      ) : (
        rows.map(renderCard)
      )}
    </div>
  );

  return (
    <div className="leads-page">
      <header className="page-header">
        <h1 className="page-title">
          {t('leads.title')}
          <span className="page-subtitle">
            {visible.length} {t('common.records')}
          </span>
        </h1>
        <div className="page-header-actions">
          <SearchField
            id="leads-search"
            value={search}
            placeholder={t('leads.searchPlaceholder')}
            onChange={setSearch}
            onCommit={setApplied}
          />
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

      {leads.length > 0 && visible.length === 0 && (
        <div className="leads-empty">
          <strong>{t('leads.noMatch')}</strong>
          <Button
            variant="secondary"
            onClick={() => {
              setSearch('');
              setApplied('');
            }}
          >
            {t('students.clearSearch')}
          </Button>
        </div>
      )}

      <div className="leads-board">
        {stages.map((stage, i) => renderColumn(stage, byStage(stage), stageTone(i, stages.length)))}
        {otherLeads.length > 0 && renderColumn(t('leads.otherStage'), otherLeads, 'stage-5')}
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
