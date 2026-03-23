import { useState, type ReactNode } from 'react';
import { useTranslation } from '../hooks/useTranslation.ts';
import './DataTable.css';

export interface Column<T> {
  key: string;
  label: string;
  i18nKey?: string;
  render?: (row: T) => ReactNode;
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
}: DataTableProps<T>) {
  const { t } = useTranslation();
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  const allOnPageSelected =
    data.length > 0 && data.every((row) => selectedIds.has(rowKey(row)));

  function toggleAll() {
    if (allOnPageSelected) {
      const next = new Set(selectedIds);
      data.forEach((row) => next.delete(rowKey(row)));
      setSelectedIds(next);
    } else {
      const next = new Set(selectedIds);
      data.forEach((row) => next.add(rowKey(row)));
      setSelectedIds(next);
    }
  }

  function toggleRow(id: string) {
    const next = new Set(selectedIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelectedIds(next);
  }

  const startRecord = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const endRecord = Math.min(page * pageSize, total);

  const maxButtons = 5;
  let btnStart = Math.max(1, page - Math.floor(maxButtons / 2));
  const btnEnd = Math.min(totalPages, btnStart + maxButtons - 1);
  if (btnEnd - btnStart < maxButtons - 1) {
    btnStart = Math.max(1, btnEnd - maxButtons + 1);
  }
  const pageButtons: number[] = [];
  for (let i = btnStart; i <= btnEnd; i++) pageButtons.push(i);

  return (
    <div className="data-table-card">
      <div className="data-table-wrapper">
        <table className="data-table">
          <thead>
            <tr>
              <th className="data-table-checkbox">
                <input
                  type="checkbox"
                  checked={allOnPageSelected}
                  onChange={toggleAll}
                />
              </th>
              {columns.map((col) => (
                <th key={col.key}>
                  {col.i18nKey ? t(col.i18nKey) : col.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td
                  colSpan={columns.length + 1}
                  className="data-table-empty"
                >
                  {t('common.loading')}
                </td>
              </tr>
            ) : data.length === 0 ? (
              <tr>
                <td
                  colSpan={columns.length + 1}
                  className="data-table-empty"
                >
                  {t('students.noResults')}
                </td>
              </tr>
            ) : (
              data.map((row) => {
                const id = rowKey(row);
                return (
                  <tr key={id}>
                    <td className="data-table-checkbox">
                      <input
                        type="checkbox"
                        checked={selectedIds.has(id)}
                        onChange={() => toggleRow(id)}
                      />
                    </td>
                    {columns.map((col) => (
                      <td key={col.key}>
                        {col.render
                          ? col.render(row)
                          : (String(row[col.key] ?? '-'))}
                      </td>
                    ))}
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
      <div className="data-table-pagination">
        <div className="data-table-pagination-info">
          {t('common.showing')} {startRecord} {t('common.to')} {endRecord}{' '}
          {t('common.of')} {total} {t('common.records')}
        </div>
        <div className="data-table-pagination-controls">
          <button
            disabled={page <= 1}
            onClick={() => onPageChange(page - 1)}
          >
            {t('common.previous')}
          </button>
          {pageButtons.map((p) => (
            <button
              key={p}
              className={p === page ? 'active' : ''}
              onClick={() => onPageChange(p)}
            >
              {p}
            </button>
          ))}
          <button
            disabled={page >= totalPages}
            onClick={() => onPageChange(page + 1)}
          >
            {t('common.next')}
          </button>
        </div>
      </div>
    </div>
  );
}
