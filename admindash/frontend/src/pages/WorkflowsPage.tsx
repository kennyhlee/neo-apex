import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from '../hooks/useTranslation.ts';
import { useAuth } from '../contexts/AuthContext.tsx';
import { useTablePreferences } from '../hooks/useTablePreferences.ts';
import { useAttention } from '../hooks/useAttention.ts';
import {
  listWorkflowDefinitions,
  visibleWorkflows,
  type DefinitionListEntry,
  type WorkflowRow,
} from '../api/workflows.ts';
import DataTable, { type Column } from '../components/DataTable.tsx';
import StatusBadge from '../components/StatusBadge.tsx';
import Button from '../components/ui/Button.tsx';
import './WorkflowsPage.css';

interface WorkflowsPageProps {
  tenant: string;
}

const PAGE_SIZE_OPTIONS = [10, 20, 30, 40, 50] as const;


/**
 * The workflows an administrator is currently running, and how much work is
 * waiting inside each. Row click opens that workflow's pipeline board.
 *
 * Deliberately carries NO workflow-lifecycle controls — no create, archive,
 * unarchive, or delete. Authoring a workflow's shape and lifecycle belongs to
 * the ApexFlow designer; this surface exists to check on and manage the work
 * items flowing through workflows that already exist.
 */
export default function WorkflowsPage({ tenant }: WorkflowsPageProps) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const navigate = useNavigate();

  const [definitions, setDefinitions] = useState<DefinitionListEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);

  // Reuses the one fetch already behind Home's queue and `/attention` — every
  // attention row carries its `definitionId`, so the per-workflow count is a
  // group-by, not a new query.
  const attention = useAttention(tenant);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await listWorkflowDefinitions(tenant);
      setDefinitions(res.definitions);
      setError(null);
    } catch (e) {
      setError(String(e));
      setDefinitions([]);
    } finally {
      setLoading(false);
    }
  }, [tenant]);

  useEffect(() => { void load(); }, [load]);

  const attentionByLineage = useMemo(() => {
    const counts = new Map<string, number>();
    for (const row of attention.result?.rows ?? []) {
      counts.set(row.definitionId, (counts.get(row.definitionId) ?? 0) + 1);
    }
    return counts;
  }, [attention.result]);

  const visible = useMemo(
    () => visibleWorkflows(definitions, attentionByLineage),
    [definitions, attentionByLineage],
  );

  const columnKeys = useMemo(
    () => ['name', 'lineage_status', 'channel_access', 'open_instances', 'needsAttention'],
    [],
  );
  const userId = user?.user_id ?? 'anonymous';
  const { prefs, updatePrefs } = useTablePreferences(userId, tenant, columnKeys, {
    namespace: 'workflow',
    defaultSortBy: 'name',
  });

  const paged = useMemo(() => {
    const start = (page - 1) * prefs.pageSize;
    return visible.slice(start, start + prefs.pageSize);
  }, [visible, page, prefs.pageSize]);

  function openLineage(row: WorkflowRow) {
    navigate(`/workflows/${row.definition_id}`, { state: { entry: row } });
  }

  const columns: Column<WorkflowRow>[] = [
    { key: 'name', label: t('workflows.colName'), primary: true },
    {
      // After filtering this is only ever `active` or `deprecated`, and the
      // difference is operational: deprecated still runs its in-flight work but
      // accepts nothing new.
      key: 'lineage_status',
      label: t('workflows.colIntake'),
      render: (row) => <StatusBadge status={row.lineage_status} />,
    },
    {
      // Whether families submit for themselves or staff key it in — that
      // changes how the work arrives.
      key: 'channel_access',
      label: t('workflows.colEntry'),
      render: (row) => <StatusBadge status={row.channel_access} />,
    },
    { key: 'open_instances', label: t('workflows.colOpenWorkItems'), numeric: true },
    {
      key: 'needsAttention',
      label: t('workflows.colNeedsAttention'),
      numeric: true,
      render: (row) => (row.needsAttention > 0
        ? <strong className="workflows-attention">{row.needsAttention}</strong>
        : <span>{attention.loaded ? 0 : '—'}</span>),
    },
  ];

  return (
    <div className="workflows-page">
      <header className="page-header">
        <h1 className="page-title">
          {t('workflows.title')}
          <span className="page-subtitle">
            {visible.length} {t('common.records')}
          </span>
        </h1>
      </header>

      {error && (
        <div className="student-error" role="alert">
          <span>{t('students.loadError')}</span>
          <Button variant="secondary" size="sm" onClick={() => void load()}>
            {t('common.retry')}
          </Button>
        </div>
      )}

      {!error && (
        <DataTable<WorkflowRow>
          columns={columns}
          data={paged}
          total={visible.length}
          page={page}
          pageSize={prefs.pageSize}
          loading={loading}
          onPageChange={setPage}
          rowKey={(row) => row.definition_id}
          rowLabel={(row) => row.name}
          caption={t('workflows.title')}
          pageSizeOptions={[...PAGE_SIZE_OPTIONS]}
          onPageSizeChange={(size) => updatePrefs({ pageSize: size as 10 | 20 | 30 | 40 | 50 })}
          onRowClick={openLineage}
          selectable={false}
          emptyState={{ title: t('workflows.empty') }}
        />
      )}
    </div>
  );
}
