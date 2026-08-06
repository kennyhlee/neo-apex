import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from '../hooks/useTranslation.ts';
import { useAuth } from '../contexts/AuthContext.tsx';
import { useTablePreferences } from '../hooks/useTablePreferences.ts';
import { listWorkflowDefinitions, type DefinitionListEntry } from '../api/workflows.ts';
import DataTable, { type Column } from '../components/DataTable.tsx';
import StatusBadge from '../components/StatusBadge.tsx';
import Button from '../components/ui/Button.tsx';
import './WorkflowsPage.css';

interface WorkflowsPageProps {
  tenant: string;
}

const PAGE_SIZE_OPTIONS = [10, 20, 30, 40, 50] as const;

/**
 * One row per lineage-version row (backend doc comment, `designer.py::
 * list_definitions`) — draft/published/superseded all show up, each its own
 * row. Row click always navigates by lineage (`definition_id`), so clicking
 * any version of the same lineage lands on the same pipeline board.
 */
export default function WorkflowsPage({ tenant }: WorkflowsPageProps) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const navigate = useNavigate();

  const [definitions, setDefinitions] = useState<DefinitionListEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);

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

  const columnKeys = useMemo(
    () => ['name', 'version', 'status', 'lineage_status', 'health', 'open_instances', 'channel_access'],
    [],
  );
  const userId = user?.user_id ?? 'anonymous';
  const { prefs, updatePrefs } = useTablePreferences(userId, tenant, columnKeys, {
    namespace: 'workflow',
    defaultSortBy: 'name',
  });

  const paged = useMemo(() => {
    const start = (page - 1) * prefs.pageSize;
    return definitions.slice(start, start + prefs.pageSize);
  }, [definitions, page, prefs.pageSize]);

  function openLineage(row: DefinitionListEntry) {
    navigate(`/workflows/${row.definition_id}`, { state: { entry: row } });
  }

  const columns: Column<DefinitionListEntry>[] = [
    { key: 'name', label: t('workflows.colName'), primary: true },
    { key: 'version', label: t('workflows.colVersion'), numeric: true },
    {
      key: 'status',
      label: t('workflows.colStatus'),
      render: (row) => <StatusBadge status={row.status} />,
    },
    {
      key: 'lineage_status',
      label: t('workflows.colLineageStatus'),
      render: (row) => <StatusBadge status={row.lineage_status} />,
    },
    {
      key: 'health',
      label: t('workflows.colHealth'),
      render: (row) => <StatusBadge status={row.health} />,
    },
    { key: 'open_instances', label: t('workflows.openInstances'), numeric: true },
    {
      key: 'channel_access',
      label: t('workflows.colChannelAccess'),
      render: (row) => <StatusBadge status={row.channel_access} />,
    },
  ];

  return (
    <div className="workflows-page">
      <header className="page-header">
        <h1 className="page-title">
          {t('workflows.title')}
          <span className="page-subtitle">
            {definitions.length} {t('common.records')}
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
        <DataTable<DefinitionListEntry>
          columns={columns}
          data={paged}
          total={definitions.length}
          page={page}
          pageSize={prefs.pageSize}
          loading={loading}
          onPageChange={setPage}
          rowKey={(row) => row.entity_id}
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
