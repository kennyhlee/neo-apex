import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from '../hooks/useTranslation.ts';
import {
  listLineageInstances,
  postInstanceAction,
  WorkflowApiError,
  type LineageInstance,
} from '../api/workflows.ts';
import { filterInstances, type MachineStateView } from '../utils/workflowData.ts';
import DataTable, { type Column } from '../components/DataTable.tsx';
import StatusBadge from '../components/StatusBadge.tsx';
import Button from '../components/ui/Button.tsx';
import useToast from '../hooks/useToast.ts';
import './WorkflowItemsTable.css';

interface WorkflowItemsTableProps {
  tenant: string;
  definitionId: string;
  /** Declared states of the published machine — the state filter's options. */
  states: MachineStateView[];
}

type Openness = 'all' | 'open' | 'closed' | 'abandoned' | 'frozen';

/** `restore_instance`'s 409 `reason` mapped to its own copy. The raw wire
 * value must never reach the screen. */
const RESTORE_REASON_KEYS: Record<string, string> = {
  lineage_archived: 'workflows.restoreFailedLineageArchived',
  not_abandoned: 'workflows.restoreFailedNotAbandoned',
  state_unavailable: 'workflows.restoreFailedStateUnavailable',
};

function formatAt(value: string): string {
  if (!value) return '—';
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? value : d.toLocaleString();
}

/**
 * Every work item of one lineage, with the filters and bulk actions the
 * pipeline board deliberately does not carry.
 *
 * The board answers "what needs attention" and is open-only; this answers
 * "manage everything", so it is the only surface where a closed, cancelled, or
 * abandoned item is reachable — and restore is only ever offered on an
 * abandoned one.
 *
 * Filtering is client-side over the fetched set, never a refetch: the server
 * cannot put `archived_from_state` in a `where` clause without a binder error
 * on any tenant whose table predates the column.
 */
export default function WorkflowItemsTable({
  tenant, definitionId, states,
}: WorkflowItemsTableProps) {
  const { t } = useTranslation();
  const { toast } = useToast();

  const [rows, setRows] = useState<LineageInstance[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [stateFilter, setStateFilter] = useState('');
  const [openness, setOpenness] = useState<Openness>('all');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await listLineageInstances(tenant, definitionId);
      setRows(res.instances);
      setError(null);
    } catch (e) {
      setError(String(e));
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [tenant, definitionId]);

  useEffect(() => { void load(); }, [load]);

  const filtered = useMemo(
    () => filterInstances(rows, { state: stateFilter || undefined, openness }),
    [rows, stateFilter, openness],
  );

  function restoreErrorKey(e: unknown): string {
    if (e instanceof WorkflowApiError && e.status === 409) {
      const reason = (e.body as { detail?: { reason?: string } } | undefined)?.detail?.reason;
      if (reason && RESTORE_REASON_KEYS[reason]) return RESTORE_REASON_KEYS[reason];
    }
    return 'workflows.restoreFailed';
  }

  async function restoreOne(row: LineageInstance) {
    setBusy(true);
    try {
      await postInstanceAction(tenant, row.entity_id, { action: 'restore_instance' });
      toast({ message: t('workflows.restored'), tone: 'success' });
      await load();
    } catch (e) {
      toast({ message: t(restoreErrorKey(e)), tone: 'danger' });
    } finally {
      setBusy(false);
    }
  }

  async function cancelOne(row: LineageInstance) {
    setBusy(true);
    try {
      await postInstanceAction(tenant, row.entity_id, { action: 'cancel_instance' });
      toast({ message: t('workflows.cancelledToast'), tone: 'success' });
      await load();
    } catch {
      toast({ message: t('workflows.actionFailed'), tone: 'danger' });
    } finally {
      setBusy(false);
    }
  }

  /**
   * Bulk actions count outcomes instead of aborting on the first failure: one
   * work item whose prior state no longer exists in the machine must not stop
   * the other forty from being restored.
   */
  async function runBulk(action: 'restore_instance' | 'cancel_instance') {
    setBusy(true);
    let ok = 0;
    const ids = [...selected];
    const total = ids.length;
    for (const entityId of ids) {
      try {
        await postInstanceAction(tenant, entityId, { action });
        ok += 1;
      } catch {
        /* counted as a failure below */
      }
    }
    const failed = total - ok;
    toast({
      message: failed === 0
        ? t(action === 'restore_instance' ? 'workflows.restored' : 'workflows.cancelledToast')
        : t('workflows.bulkPartial')
            .replace('{ok}', String(ok))
            .replace('{total}', String(total))
            .replace('{failed}', String(failed)),
      tone: failed === 0 ? 'success' : 'attn',
    });
    setSelected(new Set());
    setBusy(false);
    await load();
  }

  const columns: Column<LineageInstance>[] = [
    { key: 'instance_id', label: t('workflows.colInstanceId'), primary: true },
    {
      key: 'state',
      label: t('workflows.colStatus'),
      // A freeze leaves `state` untouched, so it needs its own badge — without
      // this a suspended item is indistinguishable from a running one.
      render: (row) => (
        <>
          <StatusBadge status={row.state} />
          {row.frozen_at && <StatusBadge status="frozen" />}
        </>
      ),
    },
    { key: 'opened_at', label: t('workflows.colOpened'), render: (r) => formatAt(r.opened_at) },
    { key: 'closed_at', label: t('workflows.colClosed'), render: (r) => formatAt(r.closed_at) },
    { key: 'applicant_email', label: t('workflows.colApplicant') },
    { key: 'channel_started', label: t('workflows.colChannel') },
    { key: 'definition_version', label: t('workflows.colVersion'), numeric: true },
  ];

  function rowActions(row: LineageInstance) {
    return (
      <>
        {row.state === 'abandoned' && (
          <Button
            variant="secondary"
            size="sm"
            disabled={busy}
            onClick={() => void restoreOne(row)}
          >
            {row.archived_from_state
              ? t('workflows.restoreTo').replace('{state}', row.archived_from_state)
              : t('workflows.restore')}
          </Button>
        )}
        {/* A frozen item refuses every action until its workflow is
            unarchived, so offering Cancel here would only produce a 409. */}
        {!row.closed_at && !row.frozen_at && (
          <Button variant="ghost" size="sm" disabled={busy} onClick={() => void cancelOne(row)}>
            {t('workflows.cancelItem')}
          </Button>
        )}
      </>
    );
  }

  return (
    <div className="workflow-items">
      <div className="workflow-items-filters">
        <div className="workflow-items-filter">
          <label htmlFor="workflow-items-state">{t('workflows.filterState')}</label>
          <select
            id="workflow-items-state"
            value={stateFilter}
            onChange={(e) => setStateFilter(e.target.value)}
          >
            <option value="">{t('workflows.filterAll')}</option>
            {states.map((s) => (
              <option key={s.state_id} value={s.state_id}>{s.name}</option>
            ))}
            <option value="cancelled">cancelled</option>
            <option value="abandoned">{t('workflows.filterAbandoned')}</option>
          </select>
        </div>

        <div className="workflow-items-filter">
          <label htmlFor="workflow-items-openness">{t('workflows.filterOpenness')}</label>
          <select
            id="workflow-items-openness"
            value={openness}
            onChange={(e) => setOpenness(e.target.value as Openness)}
          >
            <option value="all">{t('workflows.filterAll')}</option>
            <option value="open">{t('workflows.filterOpen')}</option>
            <option value="closed">{t('workflows.filterClosed')}</option>
            <option value="abandoned">{t('workflows.filterAbandoned')}</option>
            <option value="frozen">{t('workflows.filterFrozen')}</option>
          </select>
        </div>

        {selected.size > 0 && (
          <div className="workflow-items-bulk">
            <Button
              variant="secondary"
              size="sm"
              disabled={busy}
              onClick={() => void runBulk('restore_instance')}
            >
              {t('workflows.bulkRestore')}
            </Button>
            <Button
              variant="danger"
              size="sm"
              disabled={busy}
              onClick={() => void runBulk('cancel_instance')}
            >
              {t('workflows.bulkCancel')}
            </Button>
          </div>
        )}
      </div>

      {error && (
        <div className="student-error" role="alert">
          <span>{t('students.loadError')}</span>
          <Button variant="secondary" size="sm" onClick={() => void load()}>
            {t('common.retry')}
          </Button>
        </div>
      )}

      {!error && (
        <DataTable<LineageInstance>
          columns={columns}
          data={filtered}
          total={filtered.length}
          page={1}
          pageSize={filtered.length || 1}
          loading={loading}
          onPageChange={() => {}}
          rowKey={(row) => row.entity_id}
          rowLabel={(row) => row.instance_id}
          caption={t('workflows.itemsTab')}
          rowActions={rowActions}
          selectable
          selectedIds={selected}
          onSelectionChange={setSelected}
          emptyState={{ title: t('workflows.itemsEmpty') }}
        />
      )}
    </div>
  );
}
