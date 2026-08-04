// enrollx/frontend/src/pages/ApplicationsPage.tsx
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { ApplicationStatus } from '@neoapex/flow-runtime';
import { useTranslation } from '../hooks/useTranslation.ts';
import { useAuth } from '../contexts/AuthContext.tsx';
import { escapeSql, postQuery } from '../api/client.ts';
import type { ApplicationRow } from '../types/registration.ts';
import { fmtDateTime } from '../utils/format.ts';
import Button from '../components/ui/Button.tsx';
import DataTable, { type Column } from '../components/DataTable.tsx';
import StatusBadge from '../components/StatusBadge.tsx';
import './ApplicationsPage.css';

const STATUS_ORDER: ApplicationStatus[] = [
  'draft', 'submitted', 'in_review', 'pending_items', 'approved',
  'enrolled', 'waitlisted', 'declined', 'withdrawn',
];

const PAGE_SIZE = 20;

/**
 * The applications pipeline: table + Kanban toggle over `registration_application`
 * rows, with school-year and status filters and per-status counts. School
 * year is the primary filter now that applications are school-wide (spec §5);
 * programs play no part in registration at all.
 *
 * SQL (rows): `entity_type = 'registration_application' AND _status = 'active'`
 * — both DataCore system columns, written by every entity type, never
 * single-writer. One appended filter, confirmed multi-writer:
 *   - `status = '<value>'` — written by `registration_application`,
 *     `application_item`, `registration_config`, and student entities alike
 *     (`actions.py`/`engine.py`, many call sites) — multi-writer, safe. This
 *     is the field the standing context calls out to double-check, so it's
 *     verified against the backend source rather than assumed.
 * `school_year` is deliberately NOT in the SQL predicate: `base_model.json`
 * declares it on `registration_application` only, and the only live write
 * path is `engine.create_application` — genuinely single-writer, so a tenant
 * with zero applications would 500 the query the moment a year is selected.
 * Filtered client-side in JS instead (see `load()` below), the same way
 * counts and ordering already are. That keeps the existing `LIMIT 1000`
 * pagination follow-up exactly as it was — no worse.
 * `SELECT *` (not naming individual columns) so a tenant that hasn't used
 * every optional field yet never trips the single-writer binder error.
 *
 * Row-linking uses `row.entity_id` (never the business `application_id`) in
 * every navigate() call, per the identifier convention — `application_id` is
 * still shown as the human-readable label in the table/board, but the value
 * sent as a route param is always `entity_id`, matching `NewApplicationPage`.
 */
export default function ApplicationsPage() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const tenant = user?.tenant_id ?? '';
  const navigate = useNavigate();

  const [rows, setRows] = useState<ApplicationRow[]>([]);
  const [view, setView] = useState<'table' | 'board'>('table');
  const [yearFilter, setYearFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!tenant) return;
    setLoading(true);
    try {
      const where = [
        "entity_type = 'registration_application'",
        "_status = 'active'",
        statusFilter ? `status = '${escapeSql(statusFilter)}'` : null,
      ].filter(Boolean).join(' AND ');
      const res = await postQuery(tenant, 'entities',
        `SELECT * FROM data WHERE ${where} LIMIT 1000`);
      let data = res.data as unknown as ApplicationRow[];
      // `school_year` is single-writer (see the file-level note above) — kept
      // out of the SQL predicate entirely and applied here in JS instead.
      if (yearFilter) data = data.filter((r) => r.school_year === yearFilter);
      // Newest submissions first; drafts (no submitted_at yet) sort to the
      // top since they're the ones most likely to need staff attention.
      // `submitted_at` is a top-level DataCore field, so it arrives as a
      // string already — this is a lexical ISO-timestamp compare, not a
      // numeric one, so no Number()/coercion is needed here.
      data.sort((a, b) =>
        String(b.submitted_at ?? '9999').localeCompare(String(a.submitted_at ?? '9999')));
      setRows(data);
      setError(null);
      setPage(1);
    } catch {
      setError(t('apps.loadError'));
    } finally {
      setLoading(false);
    }
  }, [tenant, yearFilter, statusFilter, t]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const years = useMemo(
    () => Array.from(new Set(rows.map((r) => r.school_year))).sort().reverse(),
    [rows],
  );

  // Per-status counts for the Kanban headers: plain equality over the
  // `status` string field, not arithmetic — no coercion applies.
  const countsByStatus = useMemo(() => {
    const counts = new Map<string, number>();
    for (const r of rows) counts.set(r.status, (counts.get(r.status) ?? 0) + 1);
    return counts;
  }, [rows]);

  const goToDetail = useCallback(
    (r: ApplicationRow) => navigate(`/applications/${r.entity_id}`),
    [navigate],
  );

  const columns: Column<ApplicationRow>[] = useMemo(() => [
    {
      key: 'application_id', label: 'Application', i18nKey: 'apps.colId', primary: true,
      render: (r) => (
        <button type="button" className="apps-link" onClick={() => goToDetail(r)}>
          {r.application_id}
        </button>
      ),
    },
    { key: 'school_year', label: 'School year', i18nKey: 'apps.colYear' },
    {
      key: 'status', label: 'Status', i18nKey: 'apps.colStatus',
      render: (r) => <StatusBadge status={r.status} label={t(`status.${r.status}`)} />,
    },
    {
      key: 'channel_started', label: 'Channel', i18nKey: 'apps.colChannel',
      render: (r) => t(`apps.channel.${r.channel_started}`),
    },
    {
      key: 'submitted_at', label: 'Submitted', i18nKey: 'apps.colSubmitted', numeric: true,
      render: (r) => fmtDateTime(r.submitted_at),
    },
  ], [goToDetail, t]);

  const pageRows = rows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  return (
    <div className="apps-page">
      <header className="page-header">
        <h1 className="page-title">
          {t('apps.title')}
          <span className="page-subtitle">{rows.length} {t('common.records')}</span>
        </h1>
        <div className="apps-header-actions">
          <fieldset className="apps-view-toggle">
            <legend className="sr-only">{t('apps.viewToggle')}</legend>
            <label className={`apps-view-choice ${view === 'table' ? 'is-active' : ''}`}>
              <input
                type="radio"
                name="apps-view"
                value="table"
                checked={view === 'table'}
                onChange={() => setView('table')}
              />
              {t('apps.table')}
            </label>
            <label className={`apps-view-choice ${view === 'board' ? 'is-active' : ''}`}>
              <input
                type="radio"
                name="apps-view"
                value="board"
                checked={view === 'board'}
                onChange={() => setView('board')}
              />
              {t('apps.board')}
            </label>
          </fieldset>
          <Button variant="primary" onClick={() => navigate('/applications/new')}>
            {t('newApp.title')}
          </Button>
        </div>
      </header>

      <div className="apps-filters">
        <label htmlFor="apps-f-year">{t('apps.filterYear')}</label>
        <select id="apps-f-year" value={yearFilter}
          onChange={(e) => setYearFilter(e.target.value)}>
          <option value="">{t('apps.all')}</option>
          {years.map((y) => <option key={y} value={y}>{y}</option>)}
        </select>
        <label htmlFor="apps-f-status">{t('apps.filterStatus')}</label>
        <select id="apps-f-status" value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}>
          <option value="">{t('apps.all')}</option>
          {STATUS_ORDER.map((s) => <option key={s} value={s}>{t(`status.${s}`)}</option>)}
        </select>
      </div>

      {error && (
        <div className="apps-error" role="alert">
          <span>{error}</span>
          <Button variant="secondary" size="sm" onClick={() => void load()}>
            {t('common.retry')}
          </Button>
        </div>
      )}

      {view === 'table' ? (
        <DataTable<ApplicationRow>
          columns={columns}
          data={pageRows}
          total={rows.length}
          page={page}
          pageSize={PAGE_SIZE}
          loading={loading}
          onPageChange={setPage}
          rowKey={(r) => r.entity_id}
          selectable={false}
          onRowClick={goToDetail}
          caption={t('apps.title')}
          emptyState={{
            title: t('apps.empty'),
            action: (
              <Button variant="primary" onClick={() => navigate('/applications/new')}>
                {t('newApp.title')}
              </Button>
            ),
          }}
        />
      ) : (
        <div className="apps-board">
          {STATUS_ORDER.map((s) => {
            const colRows = rows.filter((r) => r.status === s);
            return (
              <div key={s} className="apps-column">
                <h2>
                  {t(`status.${s}`)} <span>{countsByStatus.get(s) ?? 0}</span>
                </h2>
                {colRows.length === 0 ? (
                  <p className="apps-column-empty">{t('apps.columnEmpty')}</p>
                ) : colRows.map((r) => (
                  <button
                    key={r.entity_id}
                    type="button"
                    className="apps-card"
                    onClick={() => goToDetail(r)}
                  >
                    <strong>{r.application_id}</strong>
                    <small>{r.school_year}</small>
                    <small>{r.applicant_email || t(`apps.channel.${r.channel_started}`)}</small>
                  </button>
                ))}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
