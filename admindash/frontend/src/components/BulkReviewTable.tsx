// admindash/frontend/src/components/BulkReviewTable.tsx
import { useMemo } from 'react';
import { useTranslation } from '../hooks/useTranslation.ts';
import type { BulkRow } from '../types/bulkAdd.ts';
import type { ModelDefinition } from '../types/models.ts';
import { validateRowAgainstModel } from '../utils/validateField.ts';
import './BulkReviewTable.css';

interface Props {
  rows: BulkRow[];
  modelDef: ModelDefinition;
  onEditRow: (rowId: string) => void;
  onDeleteRow: (rowId: string) => void;
  onRetryExtract: (rowId: string) => void;
}

export default function BulkReviewTable({
  rows, modelDef, onEditRow, onDeleteRow, onRetryExtract,
}: Props) {
  const { t } = useTranslation();

  const issuesByRow = useMemo(() => {
    const map = new Map<string, number>();
    for (const r of rows) {
      const errs = validateRowAgainstModel(r.values, modelDef);
      map.set(r.id, Object.keys(errs).length);
    }
    return map;
  }, [rows, modelDef]);

  return (
    <table className="bulk-review-table">
      <thead>
        <tr>
          <th>#</th>
          <th>{t('bulkAdd.table.status')}</th>
          <th>{t('bulkAdd.table.name')}</th>
          <th>{t('bulkAdd.table.dob')}</th>
          <th>{t('bulkAdd.table.source')}</th>
          <th>{t('bulkAdd.table.issues')}</th>
          <th>{t('bulkAdd.table.actions')}</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => {
          const issues = issuesByRow.get(r.id) ?? 0;
          return (
            <tr key={r.id} className={`bulk-review-row bulk-review-row--${r.status}`}>
              <td>{i + 1}</td>
              <td><StatusPill status={r.status} /></td>
              <td>
                {String(r.values.first_name ?? '')} {String(r.values.last_name ?? '')}
              </td>
              <td>{String(r.values.dob ?? '')}</td>
              <td className="bulk-review-table__source">{r.source}</td>
              <td className="bulk-review-table__issues">
                {r.error ? (
                  <span title={r.error.message} className="bulk-review-table__error-pill">
                    {r.error.message}
                  </span>
                ) : issues > 0 ? (
                  <span className="bulk-review-table__issue-count">{issues}</span>
                ) : (
                  <span className="bulk-review-table__ok">—</span>
                )}
              </td>
              <td className="bulk-review-table__actions">
                {r.status === 'extract_failed' ? (
                  <button onClick={() => onRetryExtract(r.id)}>
                    {t('bulkAdd.table.retryExtract')}
                  </button>
                ) : (
                  <button onClick={() => onEditRow(r.id)} disabled={r.status === 'extracting'}>
                    {t('bulkAdd.table.edit')}
                  </button>
                )}
                <button
                  onClick={() => onDeleteRow(r.id)}
                  className="bulk-review-table__delete"
                  disabled={r.status === 'extracting' || r.status === 'creating'}
                >
                  {t('bulkAdd.table.delete')}
                </button>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function StatusPill({ status }: { status: BulkRow['status'] }) {
  const { t } = useTranslation();
  return (
    <span className={`status-pill status-pill--${status}`}>
      {t(`bulkAdd.status.${status}`)}
    </span>
  );
}
