import { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from '../hooks/useTranslation.ts';
import { postQuery } from '../api/client.ts';
import { listWorkflowDefinitions, type DefinitionListEntry } from '../api/workflows.ts';
import {
  parseMachineStates,
  instancesByState,
  instanceSql,
  pinnedDefinitionSql,
  type InstanceRow,
} from '../utils/workflowData.ts';
import { stageTone } from '../utils/tone.ts';
import Button from '../components/ui/Button.tsx';
import './WorkflowPipelinePage.css';

interface WorkflowPipelinePageProps {
  tenant: string;
}

/** `opened_at` is an ISO timestamp on the wire; a value that doesn't parse
 * (or is absent) falls back to the raw string rather than "Invalid Date". */
function formatOpenedAt(value: string | undefined): string {
  if (!value) return '—';
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? value : d.toLocaleString();
}

/**
 * Per-definition pipeline board (`/workflows/:definitionId`). Columns come
 * from the lineage's PUBLISHED machine's declared states, in declaration
 * order — not from whatever states instances happen to be in. The board
 * fetches the whole active instance set for the lineage (LeadPage precedent,
 * `LeadPage.tsx:42-44`), including instances still pinned to older,
 * unpublished versions; any instance whose state the published machine no
 * longer declares (renamed/removed state, or a stale pinned version) lands
 * in the orphan column instead of vanishing.
 */
export default function WorkflowPipelinePage({ tenant }: WorkflowPipelinePageProps) {
  const { t } = useTranslation();
  const { definitionId = '' } = useParams<{ definitionId: string }>();
  const location = useLocation();
  const navigate = useNavigate();

  // Nav-state carries the row the list page was clicked from, so the header
  // has a name to show immediately — the page still re-fetches on load
  // rather than trusting it as the source of truth (definitions list can be
  // stale, and this page needs the FULL lineage, not just the clicked row).
  const navEntry = (location.state as { entry?: DefinitionListEntry } | null)?.entry;

  const [lineageRows, setLineageRows] = useState<DefinitionListEntry[]>([]);
  const [instances, setInstances] = useState<InstanceRow[]>([]);
  const [machineJson, setMachineJson] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  /** Seam for Task 11's instance detail drawer — a card click sets this;
   * nothing consumes it yet beyond the visual "selected" state. */
  const [selectedInstanceId, setSelectedInstanceId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const defsRes = await listWorkflowDefinitions(tenant);
      const rows = defsRes.definitions.filter((d) => d.definition_id === definitionId);
      setLineageRows(rows);

      const published = rows.find((d) => d.status === 'published');
      if (published) {
        const pinnedRes = await postQuery(
          tenant,
          'entities',
          pinnedDefinitionSql(definitionId, published.version),
        );
        setMachineJson(pinnedRes.data[0]?.machine ?? null);
      } else {
        setMachineJson(null);
      }

      const instRes = await postQuery(tenant, 'entities', instanceSql(definitionId));
      setInstances(instRes.data as unknown as InstanceRow[]);
      setError(null);
    } catch (e) {
      setError(String(e));
      setLineageRows([]);
      setInstances([]);
      setMachineJson(null);
    } finally {
      setLoading(false);
    }
  }, [tenant, definitionId]);

  useEffect(() => { void load(); }, [load]);

  const states = useMemo(() => parseMachineStates(machineJson), [machineJson]);
  const { columns, orphans } = useMemo(
    () => instancesByState(states, instances),
    [states, instances],
  );

  const publishedRow = lineageRows.find((d) => d.status === 'published');
  const name = publishedRow?.name ?? navEntry?.name ?? lineageRows[0]?.name ?? definitionId;

  function handleSelectInstance(row: InstanceRow) {
    setSelectedInstanceId(row.entity_id);
  }

  function renderCard(row: InstanceRow) {
    const displayId = row.instance_id || row.entity_id;
    return (
      <button
        key={row.entity_id}
        type="button"
        className={`workflow-instance-card${selectedInstanceId === row.entity_id ? ' is-selected' : ''}`}
        onClick={() => handleSelectInstance(row)}
      >
        <span className="workflow-instance-card-text">
          <strong>{row.applicant_email || t('workflows.noApplicantEmail')}</strong>
          <small>{displayId}</small>
          <small>{formatOpenedAt(row.opened_at)}</small>
        </span>
        {row.channel_started && (
          <span className="workflow-channel-chip">{row.channel_started}</span>
        )}
      </button>
    );
  }

  function renderColumn(key: string, label: string, rows: InstanceRow[], tone: string) {
    return (
      <div key={key} className={`workflow-column workflow-column--${tone}`}>
        <h2>
          {label} <span>{rows.length}</span>
        </h2>
        {rows.length === 0 ? (
          <p className="workflow-column-empty">{t('workflows.columnEmpty')}</p>
        ) : (
          rows.map(renderCard)
        )}
      </div>
    );
  }

  return (
    <div className="workflow-pipeline-page">
      <header className="page-header">
        <h1 className="page-title">
          {name}
          <span className="page-subtitle">
            {instances.length} {t('common.records')}
          </span>
        </h1>
        <div className="page-header-actions">
          <Button variant="primary" onClick={() => navigate(`/workflows/${definitionId}/new`)}>
            {t('workflows.startEntry')}
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

      {!error && !loading && states.length === 0 && (
        <div className="workflow-empty">
          <strong>{t('workflows.notPublished')}</strong>
        </div>
      )}

      {!error && (
        <div className="workflow-board">
          {columns.map((col, i) =>
            renderColumn(col.state.state_id, col.state.name, col.rows, stageTone(i, states.length)),
          )}
          {orphans.length > 0 &&
            renderColumn('__orphans__', t('workflows.otherStates'), orphans, 'stage-5')}
        </div>
      )}
    </div>
  );
}
