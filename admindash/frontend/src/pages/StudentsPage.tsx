import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useTranslation } from '../hooks/useTranslation.ts';
import { useAuth } from '../contexts/AuthContext.tsx';
import { useModel } from '../contexts/ModelContext.tsx';
import { useTablePreferences } from '../hooks/useTablePreferences.ts';
import { queryStudents } from '../api/client.ts';
import DataTable, { type Column } from '../components/DataTable.tsx';
import FilterForm from '../components/FilterForm.tsx';
import StatusBadge from '../components/StatusBadge.tsx';
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
const SKIP_DYNAMIC_FIELDS = new Set(['enrollment_status', '_status']);

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

    cols.push({
      key: field.name,
      label: formatFieldLabel(field.name),
      i18nKey: i18nMap[field.name],
      render: field.name === 'enrollment_status' || field.name === '_status'
        ? (row: DataRow) => <StatusBadge status={String(row._status ?? row.enrollment_status ?? '-')} />
        : undefined,
    });
  }

  // Status column from _status (always present in query response)
  // Add if not already included from base_fields
  if (!cols.some((c) => c.key === 'enrollment_status' || c.key === '_status')) {
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
  const navigate = useNavigate();
  const location = useLocation();
  const { user } = useAuth();
  const { getModel, getCachedModel } = useModel();

  // Data state
  const [data, setData] = useState<DataRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [modelLoaded, setModelLoaded] = useState(false);

  // Filter state — _status defaults to 'active'
  const [filters, setFilters] = useState<Record<string, string>>({ _status: 'active' });

  // Column popover state
  const [showColumnPopover, setShowColumnPopover] = useState(false);
  const columnToggleRef = useRef<HTMLDivElement>(null);

  // Highlight state from navigation
  const highlightEntityId = (location.state as { highlightEntityId?: string } | null)?.highlightEntityId ?? null;
  const [activeHighlight, setActiveHighlight] = useState<string | null>(highlightEntityId);

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
    async (p: number, currentFilters?: Record<string, string>) => {
      setLoading(true);
      setError(null);
      const f = currentFilters ?? filters;
      try {
        const res = await queryStudents(tenant, {
          ...f,
          sort_by: prefs.sortBy,
          sort_dir: prefs.sortDir,
          limit: prefs.pageSize,
          offset: (p - 1) * prefs.pageSize,
        });
        let rows = res.data ?? [];

        // Highlight: move newly-added entity to top of list on page 1
        if (activeHighlight && p === 1) {
          const idx = rows.findIndex((r) => String(r.entity_id) === activeHighlight);
          if (idx > 0) {
            // Already in results — move to top
            const [item] = rows.splice(idx, 1);
            rows = [item, ...rows];
          } else if (idx === -1) {
            // Not in current page (maybe filtered out) — fetch it directly
            try {
              const highlighted = await queryStudents(tenant, {
                _status: 'all',
                entity_id: activeHighlight,
                limit: 1,
                offset: 0,
              });
              const found = highlighted.data?.[0];
              if (found) {
                rows = [found, ...rows];
              }
            } catch {
              // ignore — highlight is best effort
            }
          }
          // idx === 0 means it's already at top, nothing to do
        }

        setData(rows);
        setTotal(res.total ?? 0);
        setPage(p);
      } catch (err) {
        setError(
          `Failed to load students. Is the datacore API at http://localhost:8081 running? (${err})`,
        );
        setData([]);
        setTotal(0);
      } finally {
        setLoading(false);
      }
    },
    [tenant, filters, prefs.sortBy, prefs.sortDir, prefs.pageSize, activeHighlight],
  );

  // Fetch on mount and when deps change
  useEffect(() => {
    if (modelLoaded) {
      loadData(1);
    }
  }, [modelLoaded, loadData]);

  // Close column popover on outside click
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (
        columnToggleRef.current &&
        !columnToggleRef.current.contains(e.target as Node)
      ) {
        setShowColumnPopover(false);
      }
    }
    if (showColumnPopover) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [showColumnPopover]);

  // Filter handlers
  function updateFilter(key: string, value: string) {
    setFilters((prev) => ({ ...prev, [key]: value }));
  }

  function handleSearch() {
    loadData(1);
  }

  function handleReset() {
    const resetFilters = { _status: 'active' };
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
            value={filters._status ?? ''}
            onChange={(e) => updateFilter('_status', e.target.value)}
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
        <div className="students-column-toggle" ref={columnToggleRef}>
          <button onClick={() => setShowColumnPopover((prev) => !prev)}>
            {t('students.columnSettings')}
          </button>
          {showColumnPopover && (
            <div className="students-column-popover">
              {columns.map((col) => (
                <label key={col.key} className="students-column-option">
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
        <button>{t('students.batchExport')}</button>
        <button>{t('students.batchActions')}</button>
        <button onClick={() => navigate('/students/add')}>
          {t('students.addStudent')}
        </button>
      </div>

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
          onPageChange={(p) => loadData(p)}
          rowKey={(row) => String(row.entity_id ?? '')}
          sortBy={prefs.sortBy === 'last_name' ? 'name' : prefs.sortBy}
          sortDir={prefs.sortDir}
          onSortChange={handleSortChange}
          pageSizeOptions={[...PAGE_SIZE_OPTIONS]}
          onPageSizeChange={handlePageSizeChange}
          hiddenColumns={prefs.hiddenColumns}
          rowClassName={rowClassName}
        />
      )}
    </div>
  );
}
