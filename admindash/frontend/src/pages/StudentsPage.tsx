import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useTranslation } from '../hooks/useTranslation.ts';
import { useDensity } from '../hooks/useDensity.ts';
import { useToast } from '../hooks/useToast.ts';
import { useAuth } from '../contexts/AuthContext.tsx';
import { useModel } from '../contexts/ModelContext.tsx';
import { useDashboard } from '../contexts/DashboardContext.tsx';
import { useTablePreferences } from '../hooks/useTablePreferences.ts';
import { postQuery, archiveEntities, restoreEntities } from '../api/client.ts';
import Modal from '../components/ui/Modal.tsx';
import Button from '../components/ui/Button.tsx';
import SearchField from '../components/ui/SearchField.tsx';
import ViewChips from '../components/ui/ViewChips.tsx';
import DataTable, { type Column } from '../components/DataTable.tsx';
import FilterForm from '../components/FilterForm.tsx';
import StatusBadge from '../components/StatusBadge.tsx';
import AddStudentModal from '../components/AddStudentModal.tsx';
import EditStudentModal from '../components/EditStudentModal.tsx';
import StudentDetailModal from '../components/StudentDetailModal.tsx';
import StudentNameCell from '../components/StudentNameCell.tsx';
import { toBool } from '../utils/boolValue.ts';
import { toLabel } from '../utils/listValue.ts';
import type { ModelDefinition, ModelFieldDefinition } from '../types/models.ts';
import './StudentsPage.css';

type DataRow = Record<string, unknown>;

const PAGE_SIZE_OPTIONS = [10, 20, 30, 40, 50] as const;
const DEFAULT_PAGE_SIZE = 20;

const STATUS_OPTIONS = [
  { value: 'active', i18nKey: 'students.status.active' },
  { value: 'on_leave', i18nKey: 'students.status.onLeave' },
  { value: 'suspended', i18nKey: 'students.status.suspended' },
  { value: 'graduated', i18nKey: 'students.status.graduated' },
  { value: 'dropped', i18nKey: 'students.status.dropped' },
];

/** Fields that get a dedicated Status dropdown instead of a dynamic input */
const SKIP_DYNAMIC_FIELDS = new Set(['_status', 'status']);

interface StudentsPageProps {
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
 * Format a cell value that may be a wrapped selection (`["Male"]`, `['Male']`
 * or `[Male]`) into a plain label. See utils/listValue.ts — the extraction
 * pipeline writes the single-quoted form, which the old JSON-only unwrapping
 * let through verbatim.
 */
function formatSelectionValue(val: unknown): string {
  return toLabel(val, '—');
}

/**
 * Build columns from a model definition. Base fields first, then custom fields,
 * in model definition order. Special rendering for name and status fields.
 */
function buildColumnsFromModel(model: ModelDefinition, onOpenRecord: (row: DataRow) => void, t: (key: string) => string): Column<DataRow>[] {
  const cols: Column<DataRow>[] = [];

  for (const field of model.base_fields) {
    if (field.name === 'first_name') {
      // Composite name column — placed at position of first_name
      cols.push({
        key: 'name',
        label: 'Student Name',
        i18nKey: 'students.name',
        primary: true,
        render: (row: DataRow) => (
          <StudentNameCell row={row} onOpen={() => onOpenRecord(row)} />
        ),
      });
      continue;
    }
    if (field.name === 'last_name' || field.name === 'preferred_name') {
      // Consumed by composite name column
      continue;
    }

    if (field.name === 'student_id') {
      cols.push({
        key: 'student_id',
        label: formatFieldLabel('student_id'),
        i18nKey: 'students.studentId',
        render: (row: DataRow) => (
          <button
            type="button"
            className="students-id-btn"
            title={t('studentDetail.dblclickHint')}
            onClick={() => onOpenRecord(row)}
          >
            {String(row.student_id ?? '-')}
          </button>
        ),
      });
      continue;
    }

    const i18nMap: Record<string, string> = {
      gender: 'students.gender',
      dob: 'students.dob',
      grade_level: 'students.gradeLevel',
      email: 'students.email',
    };

    let render: ((row: DataRow) => React.ReactNode) | undefined;
    if (field.name === 'enrollment_status' || field.name === '_status' || field.name === 'status') {
      render = (row: DataRow) => <StatusBadge status={formatSelectionValue(row[field.name])} />;
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
      i18nKey: i18nMap[field.name],
      render,
    });
  }

  // Status column from _status (always present in query response)
  // Add if not already included from base_fields
  if (!cols.some((c) => c.key === 'enrollment_status' || c.key === '_status' || c.key === 'status')) {
    cols.push({
      key: '_status',
      label: 'Status',
      i18nKey: 'students.status',
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
function getFallbackColumns(onOpenRecord: (row: DataRow) => void): Column<DataRow>[] {
  return [
    {
      key: 'name',
      label: 'Student Name',
      i18nKey: 'students.name',
      primary: true,
      render: (row: DataRow) => <StudentNameCell row={row} onOpen={() => onOpenRecord(row)} />,
    },
    { key: 'student_id', label: 'Student ID', i18nKey: 'students.studentId' },
    { key: 'gender', label: 'Gender', i18nKey: 'students.gender' },
    { key: 'dob', label: 'Date of Birth', i18nKey: 'students.dob' },
    { key: 'grade_level', label: 'Grade Level', i18nKey: 'students.gradeLevel' },
    { key: 'email', label: 'Email', i18nKey: 'students.email' },
    {
      key: '_status',
      label: 'Status',
      i18nKey: 'students.status',
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
    (f) => !SKIP_DYNAMIC_FIELDS.has(f.name) && f.name !== 'preferred_name',
  );
}

export default function StudentsPage({ tenant }: StudentsPageProps) {
  const { t } = useTranslation();
  const { density } = useDensity();
  const { toast } = useToast();
  const location = useLocation();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { getModel, getCachedModel } = useModel();
  const { invalidateStudentCount } = useDashboard();

  // Data state
  const [data, setData] = useState<DataRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [modelLoaded, setModelLoaded] = useState(false);

  // Filter state
  const [filters, setFilters] = useState<Record<string, string>>({});

  /**
   * Direction B replaces the permanent column-per-input panel with one search
   * box plus saved-view chips: filtering becomes a decision, not a form. The
   * full panel is still available, just folded away behind "More filters".
   */
  const [search, setSearch] = useState('');
  // Held in a ref so loadData's identity doesn't churn on every keystroke.
  const searchRef = useRef('');
  const [activeView, setActiveView] = useState('');
  const [viewCounts, setViewCounts] = useState<Record<string, number> | null>(null);
  const [showAdvanced, setShowAdvanced] = useState(false);

  // Highlight state from navigation
  const highlightEntityId = (location.state as { highlightEntityId?: string } | null)?.highlightEntityId ?? null;
  const [activeHighlight, setActiveHighlight] = useState<string | null>(highlightEntityId);

  // Selection state (controlled, passed to DataTable)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // Three-dot menu state
  const [showMenu, setShowMenu] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // Archive confirmation
  const [showArchiveConfirm, setShowArchiveConfirm] = useState(false);
  const [archiving, setArchiving] = useState(false);

  // Edit modal state
  const [editingEntity, setEditingEntity] = useState<DataRow | null>(null);

  // Detail modal state (read-only, opened via double-click on student_id)
  const [detailStudent, setDetailStudent] = useState<DataRow | null>(null);

  // Add student modal
  const [showAddModal, setShowAddModal] = useState(false);

  // Model loading
  useEffect(() => {
    getModel(tenant, 'student').then(() => setModelLoaded(true)).catch(() => setModelLoaded(true));
  }, [tenant, getModel]);

  const model = getCachedModel('student');

  // Build columns from model
  const columns = useMemo<Column<DataRow>[]>(() => {
    if (model) return buildColumnsFromModel(model, setDetailStudent, t);
    return getFallbackColumns(setDetailStudent);
  }, [model, t]); // setDetailStudent is a stable setter — safe to omit from deps

  const columnKeys = useMemo(() => columns.map((c) => c.key), [columns]);

  // Table preferences
  const userId = user?.user_id ?? 'anonymous';
  const { prefs, updatePrefs, toggleColumn } = useTablePreferences(userId, tenant, columnKeys, {
    namespace: 'student',
    defaultSortBy: 'last_name',
  });

  // Adaptive page size on mount
  const containerRef = useRef<HTMLDivElement>(null);
  const hasUserChangedPageSize = useRef(false);

  useEffect(() => {
    if (hasUserChangedPageSize.current) return;
    if (prefs.pageSize !== DEFAULT_PAGE_SIZE) return; // user had a saved non-default
    const el = containerRef.current;
    if (!el) return;
    const containerHeight = el.clientHeight;
    const estimatedRowHeight = 48; // approximate row height in px
    const headerOverhead = 260; // filters + toolbar + pagination + header
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
      const f = currentFilters;
      try {
        // Build WHERE clauses
        const conditions: string[] = ["entity_type = 'student'", "_status = 'active'"];

        for (const [key, value] of Object.entries(f)) {
          if (!value) continue;
          const safeVal = value.replace(/'/g, "''");
          conditions.push(`${key} ILIKE '%${safeVal}%'`);
        }

        // One search box across the fields a person actually recalls, rather
        // than a column-per-input panel.
        const q = searchRef.current.trim();
        if (q) {
          const s = q.replace(/'/g, "''");
          conditions.push(
            `(first_name ILIKE '%${s}%' OR last_name ILIKE '%${s}%' OR preferred_name ILIKE '%${s}%' OR student_id ILIKE '%${s}%')`,
          );
        }

        const where = conditions.join(' AND ');
        const sortCol = prefs.sortBy;
        const dir = prefs.sortDir.toUpperCase();
        const limit = prefs.pageSize;
        const offset = (p - 1) * prefs.pageSize;

        const sql = `SELECT * FROM data WHERE ${where} ORDER BY ${sortCol} ${dir} LIMIT ${limit} OFFSET ${offset}`;
        const res = await postQuery(tenant, 'entities', sql);
        let rows = res.data ?? [];

        // For total count, run a separate count query with same filters (no LIMIT/OFFSET)
        const countSql = `SELECT COUNT(*) as count FROM data WHERE ${where}`;
        const countRes = await postQuery(tenant, 'entities', countSql);
        const totalCount = Number(countRes.data[0]?.count ?? 0);

        // Highlight: move newly-added entity to top of list on page 1
        if (activeHighlight && p === 1) {
          const idx = rows.findIndex((r) => String(r.entity_id) === activeHighlight);
          if (idx > 0) {
            const [item] = rows.splice(idx, 1);
            rows = [item, ...rows];
          } else if (idx === -1) {
            try {
              const highlightSql = `SELECT * FROM data WHERE entity_id = '${activeHighlight.replace(/'/g, "''")}' LIMIT 1`;
              const highlighted = await postQuery(tenant, 'entities', highlightSql);
              const found = highlighted.data?.[0];
              if (found) {
                rows = [found, ...rows];
              }
            } catch {
              // ignore — highlight is best effort
            }
          }
        }

        setData(rows);
        setTotal(totalCount);
        setPage(p);
      } catch {
        // Plain language, and no internal host names in front of a school
        // administrator. The table keeps its toolbar and filters.
        setError(t('students.loadError'));
        setData([]);
        setTotal(0);
      } finally {
        setLoading(false);
      }
    },
    [tenant, prefs.sortBy, prefs.sortDir, prefs.pageSize, activeHighlight, t],
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

  /**
   * Applies a search term and reloads.
   *
   * The committed term lives in a ref so loadData's identity does not churn on
   * every keystroke — but that means nothing re-runs until something calls
   * this. Clearing the field therefore has to commit too, otherwise the list
   * stays filtered by a term that is no longer on screen.
   */
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
    setActiveView('');
    searchRef.current = '';
    loadData(1, resetFilters);
  }

  // Sort handler
  function handleSortChange(column: string) {
    // Map composite UI column keys to actual data column names
    const sortColumn = column === 'name' ? 'last_name' : column;
    const newDir =
      prefs.sortBy === sortColumn && prefs.sortDir === 'asc' ? 'desc' : 'asc';
    updatePrefs({ sortBy: sortColumn, sortDir: newDir });
    setActiveHighlight(null); // clear highlight on sort change
  }

  // Page size handler
  function handlePageSizeChange(size: number) {
    hasUserChangedPageSize.current = true;
    updatePrefs({ pageSize: size as 10 | 20 | 30 | 40 | 50 });
  }

  async function handleArchive() {
    if (selectedIds.size === 0) return;
    const ids = [...selectedIds];
    setArchiving(true);
    try {
      await archiveEntities(tenant, 'student', ids);
      setShowArchiveConfirm(false);
      setSelectedIds(new Set());
      invalidateStudentCount();
      loadData(1, filters);

      // A real undo, backed by the restore endpoint — not a confirm dialog
      // pretending to be safety.
      toast({
        message: t('students.archivedToast').replace('{n}', String(ids.length)),
        tone: 'success',
        onUndo: async () => {
          await restoreEntities(tenant, 'student', ids);
          invalidateStudentCount();
          loadData(page, filters);
        },
      });
    } catch {
      // Errors no longer replace the table, and no longer leak the API host.
      toast({
        message: t('students.loadError'),
        detail: t('common.retry'),
        tone: 'danger',
      });
    } finally {
      setArchiving(false);
    }
  }

  // Row class for highlight
  function rowClassName(row: DataRow): string {
    if (activeHighlight && String(row.entity_id) === activeHighlight) {
      return 'data-table-row-highlight';
    }
    return '';
  }

  // Clear highlight on navigation away
  useEffect(() => {
    return () => {
      // Replace state to remove highlightEntityId so back-nav doesn't re-highlight
      if (highlightEntityId) {
        window.history.replaceState({}, '');
      }
    };
  }, [highlightEntityId]);

  // Dynamic filter fields from model
  const dynamicFilterFields = useMemo(() => getDynamicFilterFields(model), [model]);

  /**
   * The dedicated Status dropdown has to target the column the tenant's model
   * actually defines. It previously always wrote `status`, while the query
   * hardcodes `_status = 'active'` separately — so on any tenant without a
   * literal `status` column, choosing Graduated or Dropped silently matched
   * nothing. Resolve the real column, and hide the control if there isn't one.
   */
  const statusFilter = useMemo(() => {
    const fields = model?.base_fields ?? [];
    const field =
      fields.find((f) => f.name === 'enrollment_status') ??
      fields.find((f) => f.name === 'status');
    if (!field) return null;
    return {
      column: field.name,
      options:
        field.options && field.options.length > 0
          ? field.options.map((o) => ({ value: o, label: o }))
          : STATUS_OPTIONS.map((o) => ({ value: o.value, label: t(o.i18nKey) })),
    };
  }, [model, t]);

  /**
   * Counts for the saved-view chips — one GROUP BY rather than a query per
   * chip. Refreshed whenever the underlying list reloads.
   */
  useEffect(() => {
    const column = statusFilter?.column;
    if (!column || !tenant) return;
    let cancelled = false;
    postQuery(
      tenant,
      'entities',
      `SELECT ${column}, COUNT(*) AS count FROM data WHERE entity_type = 'student' AND _status = 'active' GROUP BY ${column}`,
    )
      .then((res) => {
        if (cancelled) return;
        // Values come back in whatever shape they were written, so `Active`,
        // `["Active"]` and `['Active']` must fold into one bucket.
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

  /** Selecting a chip is just a one-field filter, applied immediately. */
  function pickView(value: string) {
    const column = statusFilter?.column;
    setActiveView(value);
    const next = { ...filters };
    if (column) {
      if (value) next[column] = value;
      else delete next[column];
    }
    setFilters(next);
    loadData(1, next);
  }

  return (
    <div className="students-page" ref={containerRef}>
      <header className="page-header">
        <h1 className="page-title">
          {t('students.title')}
          <span className="page-subtitle">
            {total} {t('common.records')}
          </span>
        </h1>
        <div className="page-header-actions">
          <SearchField
            id="students-search"
            value={search}
            placeholder={t('students.searchPlaceholder')}
            onChange={setSearch}
            onCommit={commitSearch}
          />
          <Button variant="secondary" onClick={() => navigate('/students/bulk-add')}>
            {t('bulkAdd.entryButton')}
          </Button>
          <Button variant="primary" onClick={() => setShowAddModal(true)}>
            {t('students.addStudent')}
          </Button>
        </div>
      </header>

      {/* Saved views — the everyday filter, in one row */}
      {statusFilter && (
        <ViewChips
          options={statusFilter.options}
          active={activeView}
          onPick={pickView}
          counts={viewCounts}
          total={total}
          allLabel={t('students.allStatus')}
          ariaLabel={t('students.searchStatus')}
          showAdvanced={showAdvanced}
          onToggleAdvanced={() => setShowAdvanced((v) => !v)}
        />
      )}

      {/* The full column-per-field panel, folded away by default */}
      {(showAdvanced || !statusFilter) && (
      <FilterForm onSearch={handleSearch} onReset={handleReset}>
        {dynamicFilterFields.map((field) => (
          <div className="filter-field" key={field.name}>
            <label htmlFor={`students-filter-${field.name}`}>
              {formatFieldLabel(field.name)}
            </label>
            {field.type === 'selection' && field.options ? (
              <select
                id={`students-filter-${field.name}`}
                value={filters[field.name] ?? ''}
                onChange={(e) => updateFilter(field.name, e.target.value)}
              >
                <option value="">{t('students.allStatus')}</option>
                {field.options.map((opt) => (
                  <option key={opt} value={opt}>{opt}</option>
                ))}
              </select>
            ) : (
              <input
                id={`students-filter-${field.name}`}
                type="text"
                placeholder={`${t('students.search')} ${formatFieldLabel(field.name).toLowerCase()}`}
                value={filters[field.name] ?? ''}
                onChange={(e) => updateFilter(field.name, e.target.value)}
              />
            )}
          </div>
        ))}
        {/* Dedicated Status dropdown, bound to the model's real status column */}
        {statusFilter && (
          <div className="filter-field">
            <label htmlFor="students-filter-status">{t('students.searchStatus')}</label>
            <select
              id="students-filter-status"
              value={filters[statusFilter.column] ?? ''}
              onChange={(e) => updateFilter(statusFilter.column, e.target.value)}
            >
              <option value="">{t('students.allStatus')}</option>
              {statusFilter.options.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>
        )}
      </FilterForm>
      )}

      <div className="students-toolbar">
        {selectedIds.size > 0 && (
          <>
            <span className="students-selection-count">
              {t('students.selectedCount').replace('{n}', String(selectedIds.size))}
            </span>
            <Button variant="danger" size="sm" onClick={() => setShowArchiveConfirm(true)}>
              {t('students.deleteSelected')}
            </Button>
          </>
        )}

        <div style={{ flex: 1 }} />

        <div className="students-menu-toggle" ref={menuRef}>
          <Button
            variant="ghost"
            icon
            onClick={() => setShowMenu((prev) => !prev)}
            aria-label={t('students.moreActions')}
            aria-expanded={showMenu}
          >
            ⋮
          </Button>
          {showMenu && (
            <div className="students-menu-popover">
              <div className="students-menu-section-label">{t('students.columnSettings')}</div>
              {columns.map((col) => (
                <label key={col.key} className="students-menu-column-option">
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

      {/* Archive confirmation */}
      <Modal
        open={showArchiveConfirm}
        onClose={() => setShowArchiveConfirm(false)}
        title={t('students.confirmDeleteTitle')}
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
              loadingText={t('students.deleting')}
            >
              {t('students.deleteSelected')}
            </Button>
          </>
        }
      >
        <p>{t('students.confirmDeleteBody')}</p>
        <ul className="students-confirm-list">
          {[...selectedIds].slice(0, 8).map((id) => {
            const row = data.find((r) => String(r.entity_id) === id);
            const name = row
              ? [row.first_name, row.last_name].filter(Boolean).join(' ') || String(row.student_id ?? id)
              : id;
            return <li key={id}>{name}</li>;
          })}
          {selectedIds.size > 8 && <li>+{selectedIds.size - 8}</li>}
        </ul>
      </Modal>

      {/* Edit student modal */}
      {editingEntity && model && (
        <EditStudentModal
          tenant={tenant}
          entity={editingEntity as Record<string, unknown>}
          model={model}
          onClose={() => { setEditingEntity(null); }}
          onSaved={() => { setEditingEntity(null); setSelectedIds(new Set()); loadData(page, filters); }}
        />
      )}

      {/* Student detail modal (read-only, opened via double-click on student_id) */}
      {detailStudent && model && (
        <StudentDetailModal
          student={detailStudent as Record<string, unknown>}
          model={model}
          onClose={() => setDetailStudent(null)}
          onEdit={(row) => {
            setDetailStudent(null);
            setEditingEntity(row as DataRow);
          }}
          onArchive={(row) => {
            setDetailStudent(null);
            setSelectedIds(new Set([String(row.entity_id ?? '')]));
            setShowArchiveConfirm(true);
          }}
        />
      )}

      {/* Add student modal */}
      {showAddModal && (
        <AddStudentModal
          tenant={tenant}
          onClose={() => setShowAddModal(false)}
          onSuccess={(entityId) => {
            setShowAddModal(false);
            setActiveHighlight(entityId);
            loadData(page, filters);
          }}
        />
      )}

      {/* An error no longer replaces the table, so the toolbar and filters
          the user needs in order to recover stay on screen. */}
      {error && (
        <div className="student-error" role="alert">
          <span>{error}</span>
          <Button variant="secondary" size="sm" onClick={() => loadData(page, filters)}>
            {t('common.retry')}
          </Button>
        </div>
      )}

      <DataTable<DataRow>
        columns={columns}
        data={data}
        total={total}
        page={page}
        pageSize={prefs.pageSize}
        loading={loading}
        onPageChange={(p) => loadData(p, filters)}
        rowKey={(row) => String(row.entity_id ?? '')}
        rowLabel={(row) =>
          [row.first_name, row.last_name].filter(Boolean).join(' ') ||
          String(row.student_id ?? row.entity_id ?? '')
        }
        caption={t('students.title')}
        sortBy={prefs.sortBy === 'last_name' ? 'name' : prefs.sortBy}
        sortDir={prefs.sortDir}
        onSortChange={handleSortChange}
        pageSizeOptions={[...PAGE_SIZE_OPTIONS]}
        onPageSizeChange={handlePageSizeChange}
        hiddenColumns={prefs.hiddenColumns}
        rowClassName={rowClassName}
        selectedIds={selectedIds}
        onSelectionChange={setSelectedIds}
        // Clicking the row opens the record; Edit lives inside it. That keeps
        // the action off the far end of a 17-column table, where it needed a
        // horizontal scroll to reach.
        onRowClick={setDetailStudent}
        // Compact is the registrar's grid — throughput matters more there, so
        // it keeps a one-click inline edit.
        rowActions={
          density === 'compact'
            ? (row) => (
                <Button variant="secondary" size="sm" onClick={() => setEditingEntity(row)}>
                  {t('students.edit')}
                </Button>
              )
            : undefined
        }
        emptyState={
          // When a search is what emptied the table, the useful action is
          // clearing it — not adding a student.
          searchRef.current || activeView
            ? {
                title: t('students.emptySearchTitle'),
                description: t('students.emptySearchBody'),
                action: (
                  <Button
                    variant="secondary"
                    onClick={() => {
                      setActiveView('');
                      handleReset();
                    }}
                  >
                    {t('students.clearSearch')}
                  </Button>
                ),
              }
            : {
                title: t('students.emptyTitle'),
                description: t('students.emptyBody'),
                action: (
                  <Button variant="primary" onClick={() => setShowAddModal(true)}>
                    {t('students.addStudent')}
                  </Button>
                ),
              }
        }
      />
    </div>
  );
}
