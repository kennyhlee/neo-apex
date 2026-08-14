// Ported from admindash/frontend/src/components/DataTable.tsx (interface map §1f).
// Deliberate divergence from that port: `tabIndex` and `onKeyDown` on the row
// below are apexflow-only additions. Apexflow's workflows table opens a
// detail drawer on row click, and deleting `RowMenu` removed the only
// keyboard path to the lifecycle actions it used to hold — these restore
// keyboard reachability. Do not "fix" this drift by removing them.
import { useEffect, useRef, useState, Fragment, type ReactNode } from 'react';
import { useTranslation } from '../hooks/useTranslation.ts';
import './DataTable.css';

export interface Column<T> {
  key: string;
  label: string;
  i18nKey?: string;
  render?: (row: T) => ReactNode;
  /** Right-align and use tabular figures — for counts, dates, amounts. */
  numeric?: boolean;
  /** Keep this column visible when rows reflow to cards on small screens. */
  primary?: boolean;
}

export interface EmptyState {
  title: string;
  description?: string;
  action?: ReactNode;
}

interface DataTableProps<T> {
  columns: Column<T>[];
  data: T[];
  total: number;
  page: number;
  pageSize: number;
  loading?: boolean;
  onPageChange: (page: number) => void;
  rowKey: (row: T) => string;
  /** Accessible name for a row's checkbox, e.g. "Select Enrollment v3". */
  rowLabel?: (row: T) => string;
  // Sort
  sortBy?: string;
  sortDir?: 'asc' | 'desc';
  onSortChange?: (column: string) => void;
  // Page size
  pageSizeOptions?: number[];
  onPageSizeChange?: (size: number) => void;
  // Column visibility
  hiddenColumns?: string[];
  // Row styling
  rowClassName?: (row: T) => string;
  // Selection
  selectedIds?: Set<string>;
  onSelectionChange?: (ids: Set<string>) => void;
  /** Hide the selection column entirely. */
  selectable?: boolean;
  // Expandable rows (opt-in)
  renderExpanded?: (row: T) => ReactNode;
  expandedIds?: Set<string>;
  onToggleExpand?: (id: string) => void;
  /**
   * Per-row controls, revealed on hover and on keyboard focus.
   */
  rowActions?: (row: T) => ReactNode;
  /**
   * Clicking anywhere on the row opens the record. Clicks landing on the
   * selection cell, the action cell, or any control inside a cell are ignored,
   * so selecting and per-cell buttons keep working.
   */
  onRowClick?: (row: T) => void;
  /** Shown when there are no rows. Falls back to a generic message. */
  emptyState?: EmptyState;
  /** Describes the table for screen readers. */
  caption?: string;
}

const SKELETON_ROWS = 6;

/** Shared by `onRowClick`'s mouse and keyboard handlers: a click or Enter/
 * Space landing on the selection checkbox, the action cell, the expand
 * toggle, or any focusable control inside a cell must NOT also trigger the
 * row-level activation, or e.g. checking a box would also open the row. */
function isRowActivationTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement;
  return Boolean(
    el.closest?.(
      '.data-table-checkbox, .data-table-actions, .data-table-expand, button, a, input, select, textarea, label',
    ),
  );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export default function DataTable<T extends Record<string, any>>({
  columns,
  data,
  total,
  page,
  pageSize,
  loading,
  onPageChange,
  rowKey,
  rowLabel,
  sortBy,
  sortDir,
  onSortChange,
  pageSizeOptions,
  onPageSizeChange,
  hiddenColumns,
  rowClassName,
  selectedIds: controlledSelectedIds,
  onSelectionChange,
  selectable = true,
  renderExpanded,
  expandedIds,
  onToggleExpand,
  rowActions,
  onRowClick,
  emptyState,
  caption,
}: DataTableProps<T>) {
  const { t } = useTranslation();
  const [internalSelectedIds, setInternalSelectedIds] = useState<Set<string>>(new Set());
  const selectedIds = controlledSelectedIds ?? internalSelectedIds;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const headerCheckbox = useRef<HTMLInputElement>(null);

  const expandable = Boolean(renderExpanded);
  const expanded = expandedIds ?? new Set<string>();

  const hiddenSet = hiddenColumns ? new Set(hiddenColumns) : null;
  const visibleColumns = hiddenSet ? columns.filter((col) => !hiddenSet.has(col.key)) : columns;

  const selectedOnPage = data.filter((row) => selectedIds.has(rowKey(row))).length;
  const allOnPageSelected = data.length > 0 && selectedOnPage === data.length;
  const someOnPageSelected = selectedOnPage > 0 && !allOnPageSelected;

  // A partially-selected page now reads as partial rather than as unselected.
  useEffect(() => {
    if (headerCheckbox.current) headerCheckbox.current.indeterminate = someOnPageSelected;
  }, [someOnPageSelected]);

  function updateSelection(next: Set<string>) {
    if (onSelectionChange) onSelectionChange(next);
    else setInternalSelectedIds(next);
  }

  function toggleAll() {
    const next = new Set(selectedIds);
    if (allOnPageSelected) data.forEach((row) => next.delete(rowKey(row)));
    else data.forEach((row) => next.add(rowKey(row)));
    updateSelection(next);
  }

  function toggleRow(id: string) {
    const next = new Set(selectedIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    updateSelection(next);
  }

  const startRecord = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const endRecord = Math.min(page * pageSize, total);

  const maxButtons = 5;
  let btnStart = Math.max(1, page - Math.floor(maxButtons / 2));
  const btnEnd = Math.min(totalPages, btnStart + maxButtons - 1);
  if (btnEnd - btnStart < maxButtons - 1) btnStart = Math.max(1, btnEnd - maxButtons + 1);
  const pageButtons: number[] = [];
  for (let i = btnStart; i <= btnEnd; i++) pageButtons.push(i);

  const leadingCols = (selectable ? 1 : 0) + (expandable ? 1 : 0);
  const spanAll = visibleColumns.length + leadingCols + (rowActions ? 1 : 0);

  function ariaSortFor(key: string): 'ascending' | 'descending' | 'none' | undefined {
    if (!onSortChange) return undefined;
    if (sortBy !== key) return 'none';
    return sortDir === 'asc' ? 'ascending' : 'descending';
  }

  return (
    <div className="data-table-card">
      <div className="data-table-wrapper">
        <table className="data-table">
          {caption ? <caption className="sr-only">{caption}</caption> : null}
          <thead>
            <tr>
              {expandable && <th className="data-table-expand"><span className="sr-only">Expand</span></th>}
              {selectable && (
                <th className="data-table-checkbox">
                  <input
                    ref={headerCheckbox}
                    type="checkbox"
                    checked={allOnPageSelected}
                    onChange={toggleAll}
                    aria-label={allOnPageSelected ? 'Deselect all rows on this page' : 'Select all rows on this page'}
                  />
                </th>
              )}
              {visibleColumns.map((col) => {
                const label = col.i18nKey ? t(col.i18nKey) : col.label;
                return (
                  <th
                    key={col.key}
                    aria-sort={ariaSortFor(col.key)}
                    className={col.numeric ? 'data-table-numeric' : undefined}
                  >
                    {onSortChange ? (
                      // A real button, so sorting is reachable by keyboard.
                      <button
                        type="button"
                        className="data-table-sort-btn"
                        onClick={() => onSortChange(col.key)}
                      >
                        <span>{label}</span>
                        <span className="data-table-sort-indicator" aria-hidden="true">
                          {sortBy === col.key ? (sortDir === 'asc' ? '▲' : '▼') : '⇅'}
                        </span>
                      </button>
                    ) : (
                      <span className="data-table-header-content">{label}</span>
                    )}
                  </th>
                );
              })}
              {rowActions && (
                <th className="data-table-actions-head">
                  <span className="sr-only">Row actions</span>
                </th>
              )}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              // Skeleton rows hold the table's height, so the layout does not
              // collapse to a single line on every fetch.
              Array.from({ length: SKELETON_ROWS }).map((_, i) => (
                <tr key={`sk-${i}`} className="data-table-skeleton-row" aria-hidden="true">
                  {Array.from({ length: spanAll }).map((__, j) => (
                    <td key={j}>
                      <span className="data-table-skeleton" />
                    </td>
                  ))}
                </tr>
              ))
            ) : data.length === 0 ? (
              <tr>
                <td colSpan={spanAll} className="data-table-empty">
                  <div className="data-table-empty-inner">
                    <p className="data-table-empty-title">
                      {emptyState?.title ?? t('common.noResults')}
                    </p>
                    {emptyState?.description ? (
                      <p className="data-table-empty-desc">{emptyState.description}</p>
                    ) : null}
                    {emptyState?.action ? (
                      <div className="data-table-empty-action">{emptyState.action}</div>
                    ) : null}
                  </div>
                </td>
              </tr>
            ) : (
              data.map((row) => {
                const id = rowKey(row);
                const extraClass = rowClassName ? rowClassName(row) : '';
                const isExpanded = expanded.has(id);
                const isSelected = selectedIds.has(id);
                return (
                  <Fragment key={id}>
                    <tr
                      className={
                        [extraClass, isSelected ? 'is-selected' : '', onRowClick ? 'is-clickable' : '']
                          .filter(Boolean)
                          .join(' ') || undefined
                      }
                      // A row that opens something on click must also open on
                      // Enter/Space and be reachable by Tab — `RowMenu`'s old
                      // trigger was a real `<button>`, so replacing it with a
                      // bare clickable `<tr>` would have dropped keyboard/
                      // screen-reader access to whatever the click reveals.
                      // Deliberately NOT `role="button"`: that would replace
                      // the row's implicit `row` role, breaking the table's
                      // ARIA structure (`tbody[role=rowgroup]` would own a
                      // non-`row` child), and several AT implementations treat
                      // a `button`-role element's children as presentational —
                      // which would drop the row's own `Open` button and `↗`
                      // family link from the accessibility tree entirely. If a
                      // role is ever wanted here, the correct shape is a real
                      // `<button>` inside the primary cell, not one on the row.
                      tabIndex={onRowClick ? 0 : undefined}
                      onClick={
                        onRowClick
                          ? (e) => {
                              if (isRowActivationTarget(e.target)) return;
                              onRowClick(row);
                            }
                          : undefined
                      }
                      onKeyDown={
                        onRowClick
                          ? (e) => {
                              if (e.key !== 'Enter' && e.key !== ' ') return;
                              if (isRowActivationTarget(e.target)) return;
                              // Space's default is scrolling the page — only
                              // suppress it once we know this keypress is
                              // actually activating the row.
                              if (e.key === ' ') e.preventDefault();
                              onRowClick(row);
                            }
                          : undefined
                      }
                    >
                      {expandable && (
                        <td className="data-table-expand">
                          <button
                            type="button"
                            className="data-table-expand-btn"
                            aria-expanded={isExpanded}
                            aria-label={isExpanded ? 'Collapse row' : 'Expand row'}
                            onClick={() => onToggleExpand?.(id)}
                          >
                            <span aria-hidden="true">{isExpanded ? '▼' : '▶'}</span>
                          </button>
                        </td>
                      )}
                      {selectable && (
                        <td className="data-table-checkbox">
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={() => toggleRow(id)}
                            aria-label={rowLabel ? `Select ${rowLabel(row)}` : `Select row ${id}`}
                          />
                        </td>
                      )}
                      {visibleColumns.map((col) => (
                        <td
                          key={col.key}
                          data-label={col.i18nKey ? t(col.i18nKey) : col.label}
                          className={
                            [col.numeric ? 'data-table-numeric' : '', col.primary ? 'data-table-primary' : '']
                              .filter(Boolean)
                              .join(' ') || undefined
                          }
                        >
                          {col.render ? col.render(row) : String(row[col.key] ?? '—')}
                        </td>
                      ))}
                      {rowActions && (
                        <td className="data-table-actions">
                          <div className="data-table-actions-inner">{rowActions(row)}</div>
                        </td>
                      )}
                    </tr>
                    {expandable && isExpanded && (
                      <tr className="data-table-expanded-row">
                        <td colSpan={spanAll}>{renderExpanded!(row)}</td>
                      </tr>
                    )}
                  </Fragment>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      <div className="data-table-pagination">
        <div className="data-table-pagination-info">
          <span aria-live="polite">
            {t('common.showing')} {startRecord} {t('common.to')} {endRecord} {t('common.of')} {total}{' '}
            {t('common.records')}
          </span>
          {pageSizeOptions && onPageSizeChange && (
            <span className="data-table-page-size">
              <label htmlFor="data-table-page-size">{t('common.rowsPerPage')}</label>{' '}
              <select
                id="data-table-page-size"
                value={pageSize}
                onChange={(e) => onPageSizeChange(Number(e.target.value))}
              >
                {pageSizeOptions.map((opt) => (
                  <option key={opt} value={opt}>
                    {opt}
                  </option>
                ))}
              </select>
            </span>
          )}
        </div>
        <nav className="data-table-pagination-controls" aria-label="Pagination">
          <button type="button" disabled={page <= 1} onClick={() => onPageChange(page - 1)}>
            {t('common.previous')}
          </button>
          {pageButtons.map((p) => (
            <button
              type="button"
              key={p}
              className={p === page ? 'active' : ''}
              aria-current={p === page ? 'page' : undefined}
              aria-label={`Page ${p}`}
              onClick={() => onPageChange(p)}
            >
              {p}
            </button>
          ))}
          <button type="button" disabled={page >= totalPages} onClick={() => onPageChange(page + 1)}>
            {t('common.next')}
          </button>
        </nav>
      </div>
    </div>
  );
}
