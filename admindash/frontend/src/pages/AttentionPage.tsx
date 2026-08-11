import { useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useTranslation } from '../hooks/useTranslation.ts';
import { postQuery } from '../api/client.ts';
import { useAttention } from '../hooks/useAttention.ts';
import {
  ageDays,
  bucketRows,
  publishedMachineSql,
  type AttentionRow,
  type BucketKey,
} from '../utils/attentionData.ts';
import { instanceSql, type InstanceRow } from '../utils/workflowData.ts';
import Button from '../components/ui/Button.tsx';
import WorkflowInstanceDrawer from '../components/WorkflowInstanceDrawer.tsx';
import './AttentionPage.css';

interface AttentionPageProps {
  tenant: string;
}

const BUCKETS: { key: BucketKey; label: string; what: string }[] = [
  { key: 'overdue', label: 'today.overdue', what: 'attention.overdueWhat' },
  { key: 'review', label: 'today.review', what: 'attention.reviewWhat' },
  { key: 'stalled', label: 'today.stalled', what: 'attention.stalledWhat' },
];

/**
 * The full list behind the Home page's counts (`/attention`).
 *
 * Reads the SAME grouping Home renders counts from (`useAttention`), so a
 * card's number is always the length of the list this page shows for that
 * bucket. `?bucket=` selects a group; absent, every group renders.
 *
 * Clicking a row opens `WorkflowInstanceDrawer`, which already performs
 * verify / reject / waive per item — staff act without leaving the list. The
 * drawer needs the full instance row and the pinned machine, neither of which
 * the attention grouping carries (it holds only what a row displays), so both
 * are fetched on demand for the clicked instance.
 */
export default function AttentionPage({ tenant }: AttentionPageProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const attention = useAttention(tenant);

  const [openInstance, setOpenInstance] = useState<InstanceRow | null>(null);
  const [openMachine, setOpenMachine] = useState<unknown>(null);

  const selected = params.get('bucket') as BucketKey | null;
  const shown = useMemo(
    () => BUCKETS.filter((b) => !selected || b.key === selected),
    [selected],
  );

  const total = attention.result?.rows.length ?? 0;

  function countOf(bucket: BucketKey): number {
    return attention.result ? bucketRows(attention.result, bucket).length : 0;
  }

  function selectBucket(bucket: BucketKey | null) {
    if (bucket) setParams({ bucket });
    else setParams({});
  }

  async function openRow(row: AttentionRow) {
    // The drawer needs the full instance row and the lineage's published
    // machine. The machine is fetched by `status = 'published'`, not by a
    // version number — an attention row carries no `definition_version`, and
    // assuming `1` would silently break on the first republish.
    const [instances, defs] = await Promise.all([
      postQuery(tenant, 'entities', instanceSql(row.definitionId)),
      postQuery(tenant, 'entities', publishedMachineSql(row.definitionId)),
    ]).catch(() => [null, null] as const);
    if (!instances) return;
    const match = (instances.data as unknown as InstanceRow[])
      .find((i) => i.entity_id === row.instanceEntityId);
    if (!match) return;
    setOpenMachine(defs?.data[0]?.machine ?? null);
    setOpenInstance(match);
  }

  function renderRow(row: AttentionRow, whatKey: string) {
    const what = whatKey === 'attention.stalledWhat'
      ? t(whatKey)
      : t(whatKey).replace('{title}', row.itemTitle);
    const age = row.ageMs === null
      ? t('attention.ageUnknown')
      : (row.bucket === 'overdue' ? t('attention.daysLate') : t('attention.daysWaiting'))
          .replace('{n}', String(ageDays(row.ageMs)));

    return (
      <button
        key={row.key}
        type="button"
        className="attention-row"
        onClick={() => void openRow(row)}
      >
        <span className="attention-row-text">
          <strong>
            {row.applicant || t('attention.noApplicant')}
            <span className="attention-wf">{row.workflowName}</span>
          </strong>
          <small>{what}</small>
        </span>
        <span className={`attention-age${row.bucket === 'overdue' ? ' is-late' : ''}`}>
          {age}
        </span>
      </button>
    );
  }

  return (
    <div className="attention-page">
      <header className="page-header">
        <h1 className="page-title">
          {t('attention.title')}
          <span className="page-subtitle">
            {t('attention.subtitle').replace('{n}', String(total))}
          </span>
        </h1>
        <div className="page-header-actions">
          <Button variant="secondary" onClick={() => navigate('/home')}>
            {t('nav.home')}
          </Button>
        </div>
      </header>

      {attention.loaded && Object.values(attention.failed).some(Boolean) && (
        <div className="student-error" role="alert">
          <span>{t('attention.loadError')}</span>
          <Button variant="secondary" size="sm" onClick={attention.reload}>
            {t('common.retry')}
          </Button>
        </div>
      )}

      <div className="attention-chips">
        <button
          type="button"
          className={`attention-chip${selected ? '' : ' is-on'}`}
          onClick={() => selectBucket(null)}
        >
          {t('attention.all')} {total}
        </button>
        {BUCKETS.map((b) => (
          <button
            key={b.key}
            type="button"
            className={`attention-chip${selected === b.key ? ' is-on' : ''}`}
            onClick={() => selectBucket(b.key)}
          >
            {t(b.label)} {countOf(b.key)}
          </button>
        ))}
      </div>

      {!attention.loaded ? (
        <p className="today-muted">{t('common.loading')}</p>
      ) : total === 0 ? (
        <div className="today-clear">
          <strong>{t('today.allClear')}</strong>
          <span>{t('attention.empty')}</span>
        </div>
      ) : (
        shown.map((b) => {
          const rows = attention.result ? bucketRows(attention.result, b.key) : [];
          return (
            <section key={b.key} className="attention-group" aria-labelledby={`grp-${b.key}`}>
              <h2 className="attention-group-title" id={`grp-${b.key}`}>
                {t(b.label)} <span>{rows.length}</span>
              </h2>
              {rows.length === 0 ? (
                <p className="today-muted">{t('attention.groupEmpty')}</p>
              ) : (
                rows.map((row) => renderRow(row, b.what))
              )}
            </section>
          );
        })
      )}

      {openInstance && (
        <WorkflowInstanceDrawer
          tenant={tenant}
          instance={openInstance}
          definition={openMachine}
          onClose={() => setOpenInstance(null)}
          onChanged={attention.reload}
        />
      )}
    </div>
  );
}
