// admindash/frontend/src/components/CreatedStudentsDisclosure.tsx
import { Link } from 'react-router-dom';
import { useTranslation } from '../hooks/useTranslation.ts';
import type { BulkRow } from '../types/bulkAdd.ts';
import './CreatedStudentsDisclosure.css';

interface Props {
  rows: BulkRow[];
  defaultOpen?: boolean;
}

export default function CreatedStudentsDisclosure({ rows, defaultOpen = false }: Props) {
  const { t } = useTranslation();
  if (rows.length === 0) return null;
  return (
    <details className="created-disclosure" open={defaultOpen}>
      <summary>
        {t('bulkAdd.disclosure.label').replace('{n}', String(rows.length))}
      </summary>
      <ul>
        {rows.map((r) => (
          <li key={r.id}>
            <span>{String(r.values.first_name ?? '')} {String(r.values.last_name ?? '')}</span>
            <span className="created-disclosure__id">
              {r.assignedStudentId && (
                <Link to={`/students?id=${encodeURIComponent(r.assignedStudentId)}`}>
                  {r.assignedStudentId}
                </Link>
              )}
            </span>
            <span className="created-disclosure__source">{r.source}</span>
          </li>
        ))}
      </ul>
    </details>
  );
}
