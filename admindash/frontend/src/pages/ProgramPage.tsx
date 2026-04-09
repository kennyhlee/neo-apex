import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from '../hooks/useTranslation.ts';
import { useAuth } from '../contexts/AuthContext.tsx';
import { useModel } from '../contexts/ModelContext.tsx';
import { useDashboard } from '../contexts/DashboardContext.tsx';
import { useTablePreferences } from '../hooks/useTablePreferences.ts';
import { postQuery, archiveEntities, updateEntity, createEntity, fetchNextEntityId } from '../api/client.ts';
import DataTable, { type Column } from '../components/DataTable.tsx';
import DynamicForm from '../components/DynamicForm.tsx';
import FilterForm from '../components/FilterForm.tsx';
import StatusBadge from '../components/StatusBadge.tsx';
import type { ModelDefinition, ModelFieldDefinition } from '../types/models.ts';
// ProgramWeekView and ProgramMonthView will be created in Tasks 5 and 6
import ProgramWeekView from '../components/ProgramWeekView.tsx';
import ProgramMonthView from '../components/ProgramMonthView.tsx';
import './ProgramPage.css';

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
  if (val == null) return '-';
  const s = String(val);
  if (s.startsWith('[')) {
    try {
      const arr = JSON.parse(s);
      if (Array.isArray(arr)) return arr.join(', ') || '-';
    } catch { /* not JSON */ }
  }
  return s || '-';
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
        render: (row: DataRow) => {
          const name = String(row.name ?? '').trim() || '-';
          const avatarChar = name.charAt(0).toUpperCase();
          return (
            <div className="program-name-cell">
              <div className="program-avatar">{avatarChar}</div>
              <span className="program-display-name">{name}</span>
            </div>
          );
        },
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
        const val = field.type === 'bool' ? (raw ? 'Yes' : 'No') : formatSelectionValue(raw);
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
            const val = field.type === 'bool' ? (raw ? 'Yes' : 'No') : formatSelectionValue(raw);
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
      render: (row: DataRow) => {
        const name = String(row.name ?? '').trim() || '-';
        const avatarChar = name.charAt(0).toUpperCase();
        return (
          <div className="program-name-cell">
            <div className="program-avatar">{avatarChar}</div>
            <span className="program-display-name">{name}</span>
          </div>
        );
      },
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
  const [showComingSoon, setShowComingSoon] = useState(false);

  // Add program modal
  const [showAddModal, setShowAddModal] = useState(false);
  const [addFormInitialValues, setAddFormInitialValues] = useState<Record<string, unknown>>({});
  const [addSubmitting, setAddSubmitting] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);

  // View toggle
  const [activeView, setActiveView] = useState<'list' | 'week' | 'month'>('list');
  const [weekStartDate, setWeekStartDate] = useState<Date | undefined>(undefined);

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
  const { prefs, updatePrefs, toggleColumn } = useTablePreferences(userId, tenant, columnKeys);

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

  function handleSearch() {
    loadData(1, filters);
  }

  function handleReset() {
    const resetFilters: Record<string, string> = {};
    setFilters(resetFilters);
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

  // Dynamic filter fields from model
  const dynamicFilterFields = useMemo(() => getDynamicFilterFields(model), [model]);

  // Visible columns (respecting hidden)
  const visibleColumns = useMemo(
    () => columns.filter((c) => !prefs.hiddenColumns.includes(c.key)),
    [columns, prefs.hiddenColumns],
  );

  return (
    <div className="programs-page" ref={containerRef}>
      <h1>{t('program.title')}</h1>

      <div className="programs-toolbar">
        <button className="programs-toolbar-primary" onClick={handleOpenAddModal}>
          {t('program.addProgram')}
        </button>

        <div className="programs-toolbar-spacer" />

        {selectedIds.size > 0 && (
          <span className="programs-selected-count">
            {selectedIds.size} selected
          </span>
        )}

        {/* View toggle */}
        <div className="programs-view-toggle">
          <button
            className={activeView === 'list' ? 'programs-view-btn programs-view-btn-active' : 'programs-view-btn'}
            onClick={() => setActiveView('list')}
          >
            {t('program.viewList')}
          </button>
          <button
            className={activeView === 'week' ? 'programs-view-btn programs-view-btn-active' : 'programs-view-btn'}
            onClick={() => { setActiveView('week'); loadData(1, filters); }}
          >
            {t('program.viewWeek')}
          </button>
          <button
            className={activeView === 'month' ? 'programs-view-btn programs-view-btn-active' : 'programs-view-btn'}
            onClick={() => { setActiveView('month'); loadData(1, filters); }}
          >
            {t('program.viewMonth')}
          </button>
        </div>

        {/* Three-dot action menu */}
        <div className="programs-menu-toggle" ref={menuRef}>
          <button
            className="programs-menu-btn"
            onClick={() => setShowMenu((prev) => !prev)}
            aria-label="More actions"
          >
            ⋮
          </button>
          {showMenu && (
            <div className="programs-menu-popover">
              <div className="programs-menu-section-label">Actions</div>
              <button
                className="programs-menu-item"
                disabled={selectedIds.size === 0}
                onClick={() => {
                  setShowMenu(false);
                  if (selectedIds.size === 1) {
                    const entityId = [...selectedIds][0];
                    const row = data.find((r) => String(r.entity_id) === entityId);
                    if (row) setEditingEntity(row);
                  } else {
                    setShowComingSoon(true);
                  }
                }}
              >
                Edit Selected
              </button>
              <button
                className="programs-menu-item programs-menu-item-danger"
                disabled={selectedIds.size === 0}
                onClick={() => { setShowMenu(false); setShowArchiveConfirm(true); }}
              >
                Delete Selected
              </button>
              <button
                className="programs-menu-item"
                disabled={selectedIds.size === 0}
                onClick={() => { setShowMenu(false); alert('Export coming soon'); }}
              >
                Export Selected
              </button>
              <div className="programs-menu-divider" />
              <div className="programs-menu-section-label">Columns</div>
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

      {/* Archive confirmation dialog */}
      {showArchiveConfirm && (
        <div className="programs-confirm-overlay" onClick={() => setShowArchiveConfirm(false)}>
          <div className="programs-confirm-dialog" onClick={(e) => e.stopPropagation()}>
            <p>{t('program.archiveConfirmMessage')}</p>
            <div className="programs-confirm-actions">
              <button onClick={() => setShowArchiveConfirm(false)}>{t('common.cancel')}</button>
              <button className="programs-confirm-danger" onClick={handleArchive} disabled={archiving}>
                {archiving ? t('common.loading') : t('common.confirm')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Edit program modal */}
      {editingEntity && model && (
        <div className="programs-edit-overlay">
          <div className="programs-edit-dialog">
            <div className="programs-edit-dialog-header">
              <h3>Edit Program</h3>
              <span className="programs-edit-dialog-subtitle">
                {String(editingEntity.name ?? editingEntity.program_id ?? '')}
              </span>
            </div>
            <div className="programs-edit-dialog-body">
              <DynamicForm
                modelDefinition={model}
                initialValues={editingEntity as Record<string, unknown>}
                readOnlyFields={['program_id']}
                onSubmit={handleEditSave}
                onCancel={() => { setEditingEntity(null); setEditError(null); }}
                submitting={editSubmitting}
                error={editError}
              />
            </div>
          </div>
        </div>
      )}

      {/* Coming soon dialog for batch edit */}
      {showComingSoon && (
        <div className="programs-confirm-overlay" onClick={() => setShowComingSoon(false)}>
          <div className="programs-confirm-dialog" onClick={(e) => e.stopPropagation()}>
            <p>{t('program.batchEditComingSoon')}</p>
            <div className="programs-confirm-actions">
              <button onClick={() => setShowComingSoon(false)}>{t('common.close')}</button>
            </div>
          </div>
        </div>
      )}

      {/* Add program modal */}
      {showAddModal && model && (
        <div className="programs-confirm-overlay" onClick={() => setShowAddModal(false)}>
          <div className="programs-add-dialog" onClick={(e) => e.stopPropagation()}>
            <div className="programs-edit-dialog-header">
              <h3>{t('program.addProgram')}</h3>
            </div>
            <div className="programs-edit-dialog-body">
              <DynamicForm
                modelDefinition={model}
                initialValues={addFormInitialValues}
                readOnlyFields={['program_id']}
                onSubmit={handleAddSave}
                onCancel={() => { setShowAddModal(false); setAddError(null); }}
                submitting={addSubmitting}
                error={addError}
              />
            </div>
          </div>
        </div>
      )}

      {/* Views */}
      {activeView === 'list' && (
        <>
          <FilterForm onSearch={handleSearch} onReset={handleReset}>
            {dynamicFilterFields.map((field) => (
              <div className="filter-field" key={field.name}>
                <label>{formatFieldLabel(field.name)}</label>
                {field.type === 'selection' && field.options ? (
                  <select
                    value={filters[field.name] ?? ''}
                    onChange={(e) => updateFilter(field.name, e.target.value)}
                  >
                    <option value="">All</option>
                    {field.options.map((opt) => (
                      <option key={opt} value={opt}>{opt}</option>
                    ))}
                  </select>
                ) : (
                  <input
                    type="text"
                    placeholder={`Search ${formatFieldLabel(field.name).toLowerCase()}`}
                    value={filters[field.name] ?? ''}
                    onChange={(e) => updateFilter(field.name, e.target.value)}
                  />
                )}
              </div>
            ))}
          </FilterForm>

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
              sortBy={prefs.sortBy}
              sortDir={prefs.sortDir}
              onSortChange={handleSortChange}
              pageSizeOptions={[...PAGE_SIZE_OPTIONS]}
              onPageSizeChange={handlePageSizeChange}
              hiddenColumns={prefs.hiddenColumns}
              selectedIds={selectedIds}
              onSelectionChange={setSelectedIds}
            />
          )}
        </>
      )}

      {activeView === 'week' && model && (
        <ProgramWeekView
          programs={data}
          model={model}
          onEditProgram={setEditingEntity}
          weekStart={weekStartDate}
        />
      )}

      {activeView === 'month' && model && (
        <ProgramMonthView
          programs={data}
          model={model}
          onEditProgram={setEditingEntity}
          onSwitchToWeek={(date: Date) => {
            setActiveView('week');
            setWeekStartDate(date);
          }}
        />
      )}
    </div>
  );
}
