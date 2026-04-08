import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { DATACORE_URL } from '../config.ts';
import { useLocation } from 'react-router-dom';
import { useTranslation } from '../hooks/useTranslation.ts';
import { useAuth } from '../contexts/AuthContext.tsx';
import { useModel } from '../contexts/ModelContext.tsx';
import { useDashboard } from '../contexts/DashboardContext.tsx';
import { useTablePreferences } from '../hooks/useTablePreferences.ts';
import { postQuery, archiveEntities, updateStudent } from '../api/client.ts';
import DataTable, { type Column } from '../components/DataTable.tsx';
import DynamicForm from '../components/DynamicForm.tsx';
import FilterForm from '../components/FilterForm.tsx';
import StatusBadge from '../components/StatusBadge.tsx';
import AddStudentModal from '../components/AddStudentModal.tsx';
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
 * Format a cell value that may be a JSON-encoded array (e.g. '["Male"]') into
 * a comma-separated string (e.g. "Male").
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
 * in model definition order. Special rendering for name and status fields.
 */
function buildColumnsFromModel(model: ModelDefinition): Column<DataRow>[] {
  const cols: Column<DataRow>[] = [];

  for (const field of model.base_fields) {
    if (field.name === 'first_name') {
      // Composite name column — placed at position of first_name
      cols.push({
        key: 'name',
        label: 'Student Name',
        i18nKey: 'students.name',
        render: (row: DataRow) => {
          const fullName =
            `${row.first_name ?? ''} ${row.last_name ?? ''}`.trim() || '-';
          const lastName = String(row.last_name ?? '');
          const avatarChar = (lastName.charAt(0) || fullName.charAt(0)).toUpperCase();
          return (
            <div className="student-name-cell">
              <div className="student-avatar">{avatarChar}</div>
              <div className="student-name-info">
                <span className="student-display-name">{fullName}</span>
                {row.preferred_name ? (
                  <span className="student-preferred-name">
                    {String(row.preferred_name)}
                  </span>
                ) : null}
              </div>
            </div>
          );
        },
      });
      continue;
    }
    if (field.name === 'last_name' || field.name === 'preferred_name') {
      // Consumed by composite name column
      continue;
    }

    const i18nMap: Record<string, string> = {
      student_id: 'students.studentId',
      gender: 'students.gender',
      dob: 'students.dob',
      grade_level: 'students.gradeLevel',
      email: 'students.email',
    };

    let render: ((row: DataRow) => React.ReactNode) | undefined;
    if (field.name === 'enrollment_status' || field.name === '_status' || field.name === 'status') {
      render = (row: DataRow) => <StatusBadge status={String(row._status ?? row.enrollment_status ?? row.status ?? '-')} />;
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
      label: 'Student Name',
      i18nKey: 'students.name',
      render: (row: DataRow) => {
        const fullName =
          `${row.first_name ?? ''} ${row.last_name ?? ''}`.trim() || '-';
        const avatarChar = fullName.charAt(0);
        return (
          <div className="student-name-cell">
            <div className="student-avatar">{avatarChar}</div>
            <div className="student-name-info">
              <span className="student-display-name">{fullName}</span>
              {row.preferred_name ? (
                <span className="student-preferred-name">
                  {String(row.preferred_name)}
                </span>
              ) : null}
            </div>
          </div>
        );
      },
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
  const location = useLocation();
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
  const [editSubmitting, setEditSubmitting] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  // Coming soon dialog
  const [showComingSoon, setShowComingSoon] = useState(false);

  // Add student modal
  const [showAddModal, setShowAddModal] = useState(false);

  // Model loading
  useEffect(() => {
    getModel(tenant, 'student').then(() => setModelLoaded(true)).catch(() => setModelLoaded(true));
  }, [tenant, getModel]);

  const model = getCachedModel('student');

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
      } catch (err) {
        setError(
          `Failed to load students. Is the datacore API at ${DATACORE_URL} running? (${err})`,
        );
        setData([]);
        setTotal(0);
      } finally {
        setLoading(false);
      }
    },
    [tenant, prefs.sortBy, prefs.sortDir, prefs.pageSize, activeHighlight],
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
    setShowArchiveConfirm(false);
    setArchiving(true);
    try {
      await archiveEntities(tenant, 'student', [...selectedIds]);
      setSelectedIds(new Set());
      invalidateStudentCount();
      loadData(1, filters);
    } catch (err) {
      setError(`Failed to archive students: ${err}`);
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
      await updateStudent(tenant, entityId, baseData, customFields);
      setEditingEntity(null);
      setSelectedIds(new Set());
      loadData(page, filters);
    } catch (err) {
      setEditError(`Failed to update student: ${err}`);
    } finally {
      setEditSubmitting(false);
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

  return (
    <div className="students-page" ref={containerRef}>
      <h1>{t('students.title')}</h1>

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
        {/* Dedicated Status dropdown */}
        <div className="filter-field">
          <label>{t('students.searchStatus')}</label>
          <select
            value={filters.status ?? ''}
            onChange={(e) => updateFilter('status', e.target.value)}
          >
            <option value="">{t('students.allStatus')}</option>
            {STATUS_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {t(opt.i18nKey)}
              </option>
            ))}
          </select>
        </div>
      </FilterForm>

      <div className="students-toolbar">
        <button className="students-toolbar-primary" onClick={() => setShowAddModal(true)}>
          {t('students.addStudent')}
        </button>

        <div style={{ flex: 1 }} />

        {selectedIds.size > 0 && (
          <span className="students-selection-count">
            {selectedIds.size} selected
          </span>
        )}

        <div className="students-menu-toggle" ref={menuRef}>
          <button
            className="students-menu-btn"
            onClick={() => setShowMenu((prev) => !prev)}
            aria-label="More actions"
          >
            ⋮
          </button>
          {showMenu && (
            <div className="students-menu-popover">
              <div className="students-menu-section-label">Actions</div>
              <button
                className="students-menu-item"
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
                className="students-menu-item students-menu-item-danger"
                disabled={selectedIds.size === 0}
                onClick={() => { setShowMenu(false); setShowArchiveConfirm(true); }}
              >
                Delete Selected
              </button>
              <button
                className="students-menu-item"
                disabled={selectedIds.size === 0}
                onClick={() => { setShowMenu(false); alert('Export coming soon'); }}
              >
                Export Selected
              </button>
              <div className="students-menu-divider" />
              <div className="students-menu-section-label">Columns</div>
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

      {/* Archive confirmation dialog */}
      {showArchiveConfirm && (
        <div className="students-confirm-overlay" onClick={() => setShowArchiveConfirm(false)}>
          <div className="students-confirm-dialog" onClick={(e) => e.stopPropagation()}>
            <p>Delete {selectedIds.size} student(s)?</p>
            <div className="students-confirm-actions">
              <button onClick={() => setShowArchiveConfirm(false)}>Cancel</button>
              <button className="students-confirm-danger" onClick={handleArchive} disabled={archiving}>
                {archiving ? 'Deleting...' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Edit student modal */}
      {editingEntity && model && (
        <div className="students-confirm-overlay">
          <div className="students-edit-modal">
            <div className="students-edit-modal-header">
              <h3>Edit Student</h3>
              <span className="students-edit-modal-subtitle">
                {String(editingEntity.first_name ?? '')} {String(editingEntity.last_name ?? '')}
              </span>
            </div>
            <div className="students-edit-modal-body">
              <DynamicForm
                modelDefinition={model}
                initialValues={editingEntity as Record<string, unknown>}
                readOnlyFields={['student_id', 'first_name', 'last_name', 'middle_name', 'family_id']}
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
        <div className="students-confirm-overlay" onClick={() => setShowComingSoon(false)}>
          <div className="students-confirm-dialog" onClick={(e) => e.stopPropagation()}>
            <p>Batch edit is coming soon.</p>
            <div className="students-confirm-actions">
              <button onClick={() => setShowComingSoon(false)}>OK</button>
            </div>
          </div>
        </div>
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

      {error ? (
        <div className="student-error">{error}</div>
      ) : (
        <DataTable<DataRow>
          columns={columns}
          data={data}
          total={total}
          page={page}
          pageSize={prefs.pageSize}
          loading={loading}
          onPageChange={(p) => loadData(p, filters)}
          rowKey={(row) => String(row.entity_id ?? '')}
          sortBy={prefs.sortBy === 'last_name' ? 'name' : prefs.sortBy}
          sortDir={prefs.sortDir}
          onSortChange={handleSortChange}
          pageSizeOptions={[...PAGE_SIZE_OPTIONS]}
          onPageSizeChange={handlePageSizeChange}
          hiddenColumns={prefs.hiddenColumns}
          rowClassName={rowClassName}
          selectedIds={selectedIds}
          onSelectionChange={setSelectedIds}
        />
      )}
    </div>
  );
}
