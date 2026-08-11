import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from '../hooks/useTranslation.ts';
import { useAuth } from '../contexts/AuthContext.tsx';
import { useTablePreferences } from '../hooks/useTablePreferences.ts';
import {
  isArchived,
  listWorkflowDefinitions,
  postDefinitionAction,
  type DefinitionListEntry,
} from '../api/workflows.ts';
import DataTable, { type Column } from '../components/DataTable.tsx';
import StatusBadge from '../components/StatusBadge.tsx';
import Button from '../components/ui/Button.tsx';
import ArchiveWorkflowModal from '../components/ArchiveWorkflowModal.tsx';
import useToast from '../hooks/useToast.ts';
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

  const { toast } = useToast();

  const [definitions, setDefinitions] = useState<DefinitionListEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  /** Archived lineages are out of the working set by default — that is what
   * "not available to be used" means for a list surface. */
  const [showArchived, setShowArchived] = useState(false);
  const [archiveTarget, setArchiveTarget] = useState<DefinitionListEntry | null>(null);

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

  const visible = useMemo(
    () => definitions.filter((d) => showArchived || !isArchived(d.lineage_status)),
    [definitions, showArchived],
  );

  // Toggling the filter can shrink the list past the current page, which would
  // otherwise strand the user on an empty one.
  useEffect(() => { setPage(1); }, [showArchived]);

  const paged = useMemo(() => {
    const start = (page - 1) * prefs.pageSize;
    return visible.slice(start, start + prefs.pageSize);
  }, [visible, page, prefs.pageSize]);

  function openLineage(row: DefinitionListEntry) {
    navigate(`/workflows/${row.definition_id}`, { state: { entry: row } });
  }

  async function unarchive(row: DefinitionListEntry) {
    try {
      await postDefinitionAction(tenant, row.entity_id, { action: 'unarchive' });
      toast({ message: t('workflows.unarchivedToast'), tone: 'success' });
      await load();
    } catch {
      toast({ message: t('workflows.unarchiveFailed'), tone: 'danger' });
    }
  }

  /** Lifecycle acts on the published row only (the backend's
   * `_require_published_row`), so draft/superseded rows get no controls. */
  function rowActions(row: DefinitionListEntry) {
    if (row.status !== 'published') return null;
    return isArchived(row.lineage_status) ? (
      <Button variant="secondary" size="sm" onClick={() => void unarchive(row)}>
        {t('workflows.unarchive')}
      </Button>
    ) : (
      <Button variant="secondary" size="sm" onClick={() => setArchiveTarget(row)}>
        {t('workflows.archive')}
      </Button>
    );
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
            {visible.length} {t('common.records')}
          </span>
        </h1>
        <label className="workflows-show-archived" htmlFor="workflows-show-archived">
          <input
            id="workflows-show-archived"
            type="checkbox"
            checked={showArchived}
            onChange={(e) => setShowArchived(e.target.checked)}
          />
          {t('workflows.showArchived')}
        </label>
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
          rowActions={rowActions}
          total={visible.length}
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

      {archiveTarget && (
        <ArchiveWorkflowModal
          open
          onClose={() => setArchiveTarget(null)}
          onArchived={() => {
            toast({ message: t('workflows.archivedToast'), tone: 'success' });
            void load();
          }}
          tenant={tenant}
          entityId={archiveTarget.entity_id}
          workflowName={archiveTarget.name}
        />
      )}
    </div>
  );
}
