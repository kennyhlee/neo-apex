import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from '../hooks/useTranslation.ts';
import { useAuth } from '../contexts/AuthContext.tsx';
import { useModel } from '../contexts/ModelContext.tsx';
import { useDashboard } from '../contexts/DashboardContext.tsx';
import { useTablePreferences } from '../hooks/useTablePreferences.ts';
import { postQuery, archiveEntities, updateEntity, createEntity, fetchNextEntityId } from '../api/client.ts';
import DataTable, { type Column } from '../components/DataTable.tsx';
import Button from '../components/ui/Button.tsx';
import Modal from '../components/ui/Modal.tsx';
import SearchField from '../components/ui/SearchField.tsx';
import ViewChips from '../components/ui/ViewChips.tsx';
import NameCell from '../components/ui/NameCell.tsx';
import DynamicForm from '../components/DynamicForm.tsx';
import FilterForm from '../components/FilterForm.tsx';
import StatusBadge from '../components/StatusBadge.tsx';
import { toBool } from '../utils/boolValue.ts';
import type { ModelDefinition, ModelFieldDefinition } from '../types/models.ts';
import ProgramWeekView from '../components/ProgramWeekView.tsx';
import ProgramMonthView from '../components/ProgramMonthView.tsx';
import './ProgramPage.css';
import { toLabel, toValues } from '../utils/listValue.ts';

type DataRow = Record<string, unknown>;

const PAGE_SIZE_OPTIONS = [10, 20, 30, 40, 50] as const;
const DEFAULT_PAGE_SIZE = 20;

/** Fields that get skipped in the dynamic filter (status-like) */
const SKIP_DYNAMIC_FIELDS = new Set(['_status', 'status']);

interface ProgramPageProps {
  tenant: string;
}

/**
 * Converts snake_case or camelCase field names to Title Case labels.
 */
function formatFieldLabel(key: string): string {
  return key
    .replace(/_/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * Format a cell value that may be a JSON-encoded array (e.g. '["Active"]') into
 * a comma-separated string (e.g. "Active").
 */
function formatSelectionValue(val: unknown): string {
  return toLabel(val, '—');
}

/** Abbreviated weekday names for the schedule line. */
const DAY_ABBR: Record<string, string> = {
  monday: 'Mon', tuesday: 'Tue', wednesday: 'Wed', thursday: 'Thu',
  friday: 'Fri', saturday: 'Sat', sunday: 'Sun',
};

/**
 * A program reads as a thing with a schedule, not a row. The secondary line
 * says what a colleague would say next: which days it runs and when.
 */
function ProgramNameCell({ row }: { row: DataRow }) {
  const name = String(row.name ?? '').trim() || '—';
  const initials = name.slice(0, 2).toUpperCase();

  const days = toValues(row.days_of_week)
    .map((d) => DAY_ABBR[d.trim().toLowerCase()] ?? d.trim())
    .filter(Boolean);

  const start = String(row.start_time ?? '').trim();
  const end = String(row.end_time ?? '').trim();
  const time = start && end ? `${start}–${end}` : start || '';

  const secondary = [days.join(', '), time].filter(Boolean).join(' · ');

  return <NameCell name={name} initials={initials} secondary={secondary || undefined} />;
}

/**
 * Build columns from a model definition. Base fields first, then custom fields,
 * in model definition order. Default sort by 'name'.
 */
function buildColumnsFromModel(model: ModelDefinition): Column<DataRow>[] {
  const cols: Column<DataRow>[] = [];

  for (const field of model.base_fields) {
    if (field.name === 'name') {
      cols.push({
        key: 'name',
        label: 'Program Name',
        primary: true,
        render: (row: DataRow) => <ProgramNameCell row={row} />,
      });
      continue;
    }

    let render: ((row: DataRow) => React.ReactNode) | undefined;
    if (field.name === '_status' || field.name === 'status') {
      render = (row: DataRow) => <StatusBadge status={String(row._status ?? row.status ?? '-')} />;
    } else if (field.type === 'selection' || field.type === 'bool') {
      render = (row: DataRow) => {
        const raw = row[field.name];
        if (raw == null) return '-';
        const val = field.type === 'bool' ? (toBool(raw) ? 'Yes' : 'No') : formatSelectionValue(raw);
        return val === '-' ? val : <StatusBadge status={val} />;
      };
    }

    cols.push({
      key: field.name,
      label: formatFieldLabel(field.name),
      render,
    });
  }

  // Add status column if not already included
  if (!cols.some((c) => c.key === '_status' || c.key === 'status')) {
    cols.push({
      key: '_status',
      label: 'Status',
      render: (row: DataRow) => <StatusBadge status={String(row._status ?? '-')} />,
    });
  }

  for (const field of model.custom_fields) {
    cols.push({
      key: field.name,
      label: formatFieldLabel(field.name),
      render: (field.type === 'selection' || field.type === 'bool')
        ? (row: DataRow) => {
            const raw = row[field.name];
            if (raw == null) return '-';
            const val = field.type === 'bool' ? (toBool(raw) ? 'Yes' : 'No') : formatSelectionValue(raw);
            return val === '-' ? val : <StatusBadge status={val} />;
          }
        : undefined,
    });
  }

  return cols;
}

/**
 * Build fallback columns when no model is available.
 */
function getFallbackColumns(): Column<DataRow>[] {
  return [
    {
      key: 'name',
      label: 'Program Name',
      primary: true,
      render: (row: DataRow) => <ProgramNameCell row={row} />,
    },
    { key: 'program_id', label: 'Program ID' },
    {
      key: '_status',
      label: 'Status',
      render: (row: DataRow) => <StatusBadge status={String(row._status ?? '-')} />,
    },
  ];
}

/**
 * Build dynamic filter fields from model base_fields, skipping status-like fields.
 */
function getDynamicFilterFields(model: ModelDefinition | undefined): ModelFieldDefinition[] {
  if (!model) return [];
  return model.base_fields.filter(
    (f) => !SKIP_DYNAMIC_FIELDS.has(f.name),
  );
}

export default function ProgramPage({ tenant }: ProgramPageProps) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const { getModel, getCachedModel } = useModel();
  const { invalidateProgramCount } = useDashboard();

  // Data state
  const [data, setData] = useState<DataRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [modelLoaded, setModelLoaded] = useState(false);

  // Filter state
  const [filters, setFilters] = useState<Record<string, string>>({});

  /** One search box plus saved-view chips, as on Students. The full
   *  column-per-field panel stays available behind "More filters". */
  const [search, setSearch] = useState('');
  const searchRef = useRef('');
  const [statusView, setStatusView] = useState('');
  const [viewCounts, setViewCounts] = useState<Record<string, number> | null>(null);
  const [showAdvanced, setShowAdvanced] = useState(false);

  // Selection state
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // Three-dot menu state
  const [showMenu, setShowMenu] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // Archive confirmation
  const [showArchiveConfirm, setShowArchiveConfirm] = useState(false);
  const [archiving, setArchiving] = useState(false);

  // Edit modal state
  const [editingEntity, setEditingEntity] = useState<DataRow | null>(null);
  const [editSubmitting, setEditSubmitting] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  // Coming soon dialog

  // Add program modal
  const [showAddModal, setShowAddModal] = useState(false);
  const [addFormInitialValues, setAddFormInitialValues] = useState<Record<string, unknown>>({});
  const [addSubmitting, setAddSubmitting] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);

  // View toggle
  const [activeView, setActiveView] = useState<'list' | 'week' | 'month'>('list');
  const [weekStartDate, setWeekStartDate] = useState<Date | undefined>(undefined);

  /**
   * Calendar views get their own unpaginated dataset.
   *
   * They previously rendered `data` — the current table page, at most
   * `pageSize` rows — so any program past page 1 was silently invisible, and
   * navigating to another week or month only re-bucketed the same rows
   * instead of fetching. The list view keeps its server-side paging; only the
   * calendar needs the whole set, and it is bounded by the same filters.
   */
  const [calendarPrograms, setCalendarPrograms] = useState<DataRow[]>([]);
  const [calendarLoading, setCalendarLoading] = useState(false);

  // Model loading
  useEffect(() => {
    getModel(tenant, 'program').then(() => setModelLoaded(true)).catch(() => setModelLoaded(true));
  }, [tenant, getModel]);

  const model = getCachedModel('program');

  // Build columns from model
  const columns = useMemo<Column<DataRow>[]>(() => {
    if (model) return buildColumnsFromModel(model);
    return getFallbackColumns();
  }, [model]);

  const columnKeys = useMemo(() => columns.map((c) => c.key), [columns]);

  // Table preferences
  const userId = user?.user_id ?? 'anonymous';
  const { prefs, updatePrefs, toggleColumn } = useTablePreferences(userId, tenant, columnKeys, {
    namespace: 'program',
    defaultSortBy: 'name',
  });

  // Adaptive page size on mount
  const containerRef = useRef<HTMLDivElement>(null);
  const hasUserChangedPageSize = useRef(false);

  useEffect(() => {
    if (hasUserChangedPageSize.current) return;
    if (prefs.pageSize !== DEFAULT_PAGE_SIZE) return;
    const el = containerRef.current;
    if (!el) return;
    const containerHeight = el.clientHeight;
    const estimatedRowHeight = 48;
    const headerOverhead = 260;
    const availableHeight = containerHeight - headerOverhead;
    if (availableHeight <= 0) return;
    const fittingRows = Math.floor(availableHeight / estimatedRowHeight);
    const rounded = Math.max(10, Math.min(50, Math.floor(fittingRows / 10) * 10));
    if (rounded !== prefs.pageSize) {
      updatePrefs({ pageSize: rounded as 10 | 20 | 30 | 40 | 50 });
    }
  }, [modelLoaded]); // eslint-disable-line react-hooks/exhaustive-deps

  // Load data
  const loadData = useCallback(
    async (p: number, currentFilters: Record<string, string>) => {
      setLoading(true);
      setError(null);
      try {
        const conditions: string[] = ["entity_type = 'program'", "_status = 'active'"];

        for (const [key, value] of Object.entries(currentFilters)) {
          if (!value) continue;
          const safeVal = value.replace(/'/g, "''");
          conditions.push(`${key} ILIKE '%${safeVal}%'`);
        }

        const q = searchRef.current.trim();
        if (q) {
          const sq = q.replace(/'/g, "''");
          conditions.push(
            `(name ILIKE '%${sq}%' OR program_id ILIKE '%${sq}%' OR location ILIKE '%${sq}%')`,
          );
        }

        const where = conditions.join(' AND ');
        const sortCol = prefs.sortBy;
        const dir = prefs.sortDir.toUpperCase();
        const limit = prefs.pageSize;
        const offset = (p - 1) * prefs.pageSize;

        const sql = `SELECT * FROM data WHERE ${where} ORDER BY ${sortCol} ${dir} LIMIT ${limit} OFFSET ${offset}`;
        const res = await postQuery(tenant, 'entities', sql);
        const rows = res.data ?? [];

        const countSql = `SELECT COUNT(*) as count FROM data WHERE ${where}`;
        const countRes = await postQuery(tenant, 'entities', countSql);
        const totalCount = Number(countRes.data[0]?.count ?? 0);

        setData(rows);
        setTotal(totalCount);
        setPage(p);
      } catch (err) {
        setError(`Failed to load programs: ${err}`);
        setData([]);
        setTotal(0);
      } finally {
        setLoading(false);
      }
    },
    [tenant, prefs.sortBy, prefs.sortDir, prefs.pageSize],
  );

  // Fetch on mount and when sort/page-size prefs change
  useEffect(() => {
    if (modelLoaded) {
      loadData(1, filters);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modelLoaded, loadData]);

  // Close menu on outside click
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setShowMenu(false);
      }
    }
    if (showMenu) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [showMenu]);

  // Filter handlers
  function updateFilter(key: string, value: string) {
    setFilters((prev) => ({ ...prev, [key]: value }));
  }

  /** Committing the term (including an empty one) is what re-runs the query. */
  function commitSearch(q: string) {
    searchRef.current = q;
    setSearch(q);
    loadData(1, filters);
  }

  function handleSearch() {
    commitSearch(search);
  }

  function handleReset() {
    const resetFilters: Record<string, string> = {};
    setFilters(resetFilters);
    setSearch('');
    setStatusView('');
    searchRef.current = '';
    loadData(1, resetFilters);
  }

  // Sort handler
  function handleSortChange(column: string) {
    const newDir =
      prefs.sortBy === column && prefs.sortDir === 'asc' ? 'desc' : 'asc';
    updatePrefs({ sortBy: column, sortDir: newDir });
  }

  // Page size handler
  function handlePageSizeChange(size: number) {
    hasUserChangedPageSize.current = true;
    updatePrefs({ pageSize: size as 10 | 20 | 30 | 40 | 50 });
  }

  async function handleArchive() {
    if (selectedIds.size === 0) return;
    setShowArchiveConfirm(false);
    setArchiving(true);
    try {
      await archiveEntities(tenant, 'program', [...selectedIds]);
      setSelectedIds(new Set());
      invalidateProgramCount();
      loadData(1, filters);
    } catch (err) {
      setError(`Failed to archive programs: ${err}`);
    } finally {
      setArchiving(false);
    }
  }

  async function handleEditSave(baseData: Record<string, unknown>, customFields: Record<string, unknown>) {
    if (!editingEntity) return;
    setEditSubmitting(true);
    setEditError(null);
    try {
      const entityId = String(editingEntity.entity_id);
      await updateEntity(tenant, 'program', entityId, baseData, customFields);
      setEditingEntity(null);
      setSelectedIds(new Set());
      loadData(page, filters);
    } catch (err) {
      setEditError(`Failed to update program: ${err}`);
    } finally {
      setEditSubmitting(false);
    }
  }

  async function handleOpenAddModal() {
    setAddError(null);
    setAddFormInitialValues({});
    try {
      const res = await fetchNextEntityId(tenant, 'program');
      setAddFormInitialValues({ program_id: res.next_id });
    } catch {
      setAddFormInitialValues({ program_id: t('program.autoIdUnavailable') });
    }
    setShowAddModal(true);
  }

  async function handleAddSave(baseData: Record<string, unknown>, customFields: Record<string, unknown>) {
    setAddSubmitting(true);
    setAddError(null);
    try {
      await createEntity(tenant, 'program', baseData, customFields);
      setShowAddModal(false);
      invalidateProgramCount();
      loadData(1, filters);
    } catch (err) {
      setAddError(`Failed to add program: ${err}`);
    } finally {
      setAddSubmitting(false);
    }
  }

  // Fetch the full program set whenever a calendar view is active.
  useEffect(() => {
    if (activeView === 'list') return;
    let cancelled = false;
    setCalendarLoading(true);

    const conditions: string[] = ["entity_type = 'program'", "_status = 'active'"];
    for (const [key, value] of Object.entries(filters)) {
      if (!value) continue;
      conditions.push(`${key} ILIKE '%${value.replace(/'/g, "''")}%'`);
    }

    postQuery(tenant, 'entities', `SELECT * FROM data WHERE ${conditions.join(' AND ')}`)
      .then((res) => {
        if (!cancelled) setCalendarPrograms((res.data ?? []) as DataRow[]);
      })
      .catch(() => {
        if (!cancelled) setCalendarPrograms([]);
      })
      .finally(() => {
        if (!cancelled) setCalendarLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [tenant, activeView, filters]);

  // Dynamic filter fields from model
  const dynamicFilterFields = useMemo(() => getDynamicFilterFields(model), [model]);

  /** The model's own status field drives the chips, same as on Students. */
  const statusFilter = useMemo(() => {
    const fields = [...(model?.base_fields ?? []), ...(model?.custom_fields ?? [])];
    const field = fields.find((f) => f.name === 'status' && f.options && f.options.length > 0);
    if (!field?.options) return null;
    return {
      column: field.name,
      options: field.options.map((o) => ({ value: o, label: o })),
    };
  }, [model]);

  useEffect(() => {
    const column = statusFilter?.column;
    if (!column || !tenant) return;
    let cancelled = false;
    postQuery(
      tenant,
      'entities',
      `SELECT ${column}, COUNT(*) AS count FROM data WHERE entity_type = 'program' AND _status = 'active' GROUP BY ${column}`,
    )
      .then((res) => {
        if (cancelled) return;
        // Values arrive in whatever shape they were written, so `Upcoming`
        // and `['Upcoming']` must fold into one bucket.
        const next: Record<string, number> = {};
        for (const row of res.data ?? []) {
          const key = toLabel(row[column], '');
          if (key) next[key] = (next[key] ?? 0) + Number(row.count ?? 0);
        }
        setViewCounts(next);
      })
      .catch(() => {
        if (!cancelled) setViewCounts({});
      });
    return () => {
      cancelled = true;
    };
  }, [tenant, statusFilter?.column, total]);

  function pickView(value: string) {
    const column = statusFilter?.column;
    setStatusView(value);
    const next = { ...filters };
    if (column) {
      if (value) next[column] = value;
      else delete next[column];
    }
    setFilters(next);
    loadData(1, next);
  }

  // Visible columns (respecting hidden)
  const visibleColumns = useMemo(
    () => columns.filter((c) => !prefs.hiddenColumns.includes(c.key)),
    [columns, prefs.hiddenColumns],
  );

  return (
    <div className="programs-page" ref={containerRef}>
      <header className="page-header">
        <h1 className="page-title">
          {t('program.title')}
          <span className="page-subtitle">
            {total} {t('common.records')}
          </span>
        </h1>
        {activeView === 'list' && (
          <div className="page-header-actions">
            <SearchField
              id="programs-search"
              value={search}
              placeholder={t('program.searchPlaceholder')}
              onChange={setSearch}
              onCommit={commitSearch}
            />
            <Button variant="primary" onClick={() => void handleOpenAddModal()}>
              {t('program.addProgram')}
            </Button>
          </div>
        )}
      </header>

      {/* View toggle — always visible */}
      <div className="programs-view-toggle-bar">
        <div className="programs-view-toggle">
          <button
            className={activeView === 'list' ? 'programs-view-btn programs-view-btn-active' : 'programs-view-btn'}
            onClick={() => setActiveView('list')}
          >
            {t('program.viewList')}
          </button>
          <button
            className={activeView === 'week' ? 'programs-view-btn programs-view-btn-active' : 'programs-view-btn'}
            onClick={() => setActiveView('week')}
          >
            {t('program.viewWeek')}
          </button>
          <button
            className={activeView === 'month' ? 'programs-view-btn programs-view-btn-active' : 'programs-view-btn'}
            onClick={() => setActiveView('month')}
          >
            {t('program.viewMonth')}
          </button>
        </div>
      </div>

      {/* Archive confirmation */}
      <Modal
        open={showArchiveConfirm}
        onClose={() => setShowArchiveConfirm(false)}
        title={t('program.archiveConfirmMessage')}
        size="sm"
        dismissOnBackdrop={!archiving}
        dismissOnEscape={!archiving}
        footer={
          <>
            <Button variant="secondary" onClick={() => setShowArchiveConfirm(false)} disabled={archiving}>
              {t('common.cancel')}
            </Button>
            <Button
              variant="danger"
              onClick={handleArchive}
              loading={archiving}
              loadingText={t('common.loading')}
            >
              {t('common.confirm')}
            </Button>
          </>
        }
      >
        <ul className="students-confirm-list">
          {[...selectedIds].slice(0, 8).map((id) => {
            const row = data.find((r) => String(r.entity_id) === id);
            return <li key={id}>{String(row?.name ?? row?.program_id ?? id)}</li>;
          })}
          {selectedIds.size > 8 && <li>+{selectedIds.size - 8}</li>}
        </ul>
      </Modal>

      {/* Edit program */}
      <Modal
        open={Boolean(editingEntity && model)}
        onClose={() => { setEditingEntity(null); setEditError(null); }}
        title={t('program.editTitle')}
        subtitle={String(editingEntity?.name ?? editingEntity?.program_id ?? '')}
        size="lg"
        dismissOnBackdrop={!editSubmitting}
        dismissOnEscape={!editSubmitting}
      >
        {editingEntity && model && (
          <DynamicForm
            modelDefinition={model}
            initialValues={editingEntity as Record<string, unknown>}
            readOnlyFields={['program_id']}
            onSubmit={handleEditSave}
            onCancel={() => { setEditingEntity(null); setEditError(null); }}
            submitting={editSubmitting}
            error={editError}
          />
        )}
      </Modal>

      {/* Add program */}
      <Modal
        open={Boolean(showAddModal && model)}
        onClose={() => { setShowAddModal(false); setAddError(null); }}
        title={t('program.addProgram')}
        size="lg"
        dismissOnBackdrop={!addSubmitting}
        dismissOnEscape={!addSubmitting}
      >
        {model && (
          <DynamicForm
            modelDefinition={model}
            initialValues={addFormInitialValues}
            readOnlyFields={['program_id']}
            onSubmit={handleAddSave}
            onCancel={() => { setShowAddModal(false); setAddError(null); }}
            submitting={addSubmitting}
            error={addError}
          />
        )}
      </Modal>

      {/* Views */}
      {activeView === 'list' && (
        <>
          {statusFilter && (
            <ViewChips
              options={statusFilter.options}
              active={statusView}
              onPick={pickView}
              counts={viewCounts}
              total={total}
              allLabel={t('program.filterAll')}
              ariaLabel={t('program.statusLabel')}
              showAdvanced={showAdvanced}
              onToggleAdvanced={() => setShowAdvanced((v) => !v)}
            />
          )}

          {(showAdvanced || !statusFilter) && (
          <FilterForm onSearch={handleSearch} onReset={handleReset}>
            {dynamicFilterFields.map((field) => (
              <div className="filter-field" key={field.name}>
                <label htmlFor={`programs-filter-${field.name}`}>
                  {formatFieldLabel(field.name)}
                </label>
                {field.type === 'selection' && field.options ? (
                  <select
                    id={`programs-filter-${field.name}`}
                    value={filters[field.name] ?? ''}
                    onChange={(e) => updateFilter(field.name, e.target.value)}
                  >
                    <option value="">{t('program.filterAll')}</option>
                    {field.options.map((opt) => (
                      <option key={opt} value={opt}>{opt}</option>
                    ))}
                  </select>
                ) : (
                  <input
                    id={`programs-filter-${field.name}`}
                    type="text"
                    placeholder={`${t('program.search')} ${formatFieldLabel(field.name).toLowerCase()}`}
                    value={filters[field.name] ?? ''}
                    onChange={(e) => updateFilter(field.name, e.target.value)}
                  />
                )}
              </div>
            ))}
          </FilterForm>
          )}

          <div className="programs-toolbar">
            {selectedIds.size > 0 && (
              <>
                <span className="programs-selected-count">
                  {selectedIds.size} {t('program.selectedSuffix')}
                </span>
                <Button variant="danger" size="sm" onClick={() => setShowArchiveConfirm(true)}>
                  {t('program.deleteSelected')}
                </Button>
              </>
            )}

            <div className="programs-toolbar-spacer" />

            {/* Three-dot action menu */}
            <div className="programs-menu-toggle" ref={menuRef}>
              <Button
                variant="ghost"
                icon
                onClick={() => setShowMenu((prev) => !prev)}
                aria-label={t('program.moreActions')}
                aria-expanded={showMenu}
              >
                ⋮
              </Button>
              {showMenu && (
                <div className="programs-menu-popover">
                  {/* Editing happens from the row itself now; the Export and
                      batch-edit entries only ever opened a "coming soon"
                      dialog, so they are gone rather than pretending. */}
                  <div className="programs-menu-section-label">{t('program.columnsLabel')}</div>
                  {columns.map((col) => (
                    <label key={col.key} className="programs-menu-column-option">
                      <input
                        type="checkbox"
                        checked={!prefs.hiddenColumns.includes(col.key)}
                        onChange={() => toggleColumn(col.key)}
                      />
                      {col.i18nKey ? t(col.i18nKey) : col.label}
                    </label>
                  ))}
                </div>
              )}
            </div>
          </div>

          {error ? (
            <div className="programs-error">{error}</div>
          ) : (
            <DataTable<DataRow>
              columns={visibleColumns}
              data={data}
              total={total}
              page={page}
              pageSize={prefs.pageSize}
              loading={loading}
              onPageChange={(p) => loadData(p, filters)}
              rowKey={(row) => String(row.entity_id ?? '')}
              rowLabel={(row) => String(row.name ?? row.program_id ?? row.entity_id ?? '')}
              caption={t('program.title')}
              sortBy={prefs.sortBy}
              sortDir={prefs.sortDir}
              onSortChange={handleSortChange}
              pageSizeOptions={[...PAGE_SIZE_OPTIONS]}
              onPageSizeChange={handlePageSizeChange}
              hiddenColumns={prefs.hiddenColumns}
              selectedIds={selectedIds}
              onSelectionChange={setSelectedIds}
              rowActions={(row) => (
                <Button variant="secondary" size="sm" onClick={() => setEditingEntity(row)}>
                  {t('students.edit')}
                </Button>
              )}
              emptyState={
                // When a search emptied the table, the useful action is
                // clearing it — not adding a program.
                searchRef.current || statusView
                  ? {
                      title: t('program.emptySearchTitle'),
                      description: t('program.emptySearchBody'),
                      action: (
                        <Button
                          variant="secondary"
                          onClick={() => {
                            setStatusView('');
                            handleReset();
                          }}
                        >
                          {t('students.clearSearch')}
                        </Button>
                      ),
                    }
                  : {
                      title: t('program.emptyTitle'),
                      description: t('program.emptyBody'),
                      action: (
                        <Button variant="primary" onClick={() => void handleOpenAddModal()}>
                          {t('program.addProgram')}
                        </Button>
                      ),
                    }
              }
            />
          )}
        </>
      )}

      {activeView === 'week' && model && (
        <>
          {calendarLoading && <p className="programs-calendar-loading">{t('common.loading')}</p>}
          <ProgramWeekView
            programs={calendarPrograms}
            model={model}
            onEditProgram={setEditingEntity}
            weekStart={weekStartDate}
          />
        </>
      )}

      {activeView === 'month' && model && (
        <>
          {calendarLoading && <p className="programs-calendar-loading">{t('common.loading')}</p>}
          <ProgramMonthView
            programs={calendarPrograms}
            model={model}
            onEditProgram={setEditingEntity}
            onSwitchToWeek={(date: Date) => {
              setActiveView('week');
              setWeekStartDate(date);
            }}
          />
        </>
      )}
    </div>
  );
}
