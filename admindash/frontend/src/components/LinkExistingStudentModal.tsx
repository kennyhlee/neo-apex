import { useEffect, useRef, useState } from 'react';
import { useTranslation } from '../hooks/useTranslation.ts';
import { useModel } from '../contexts/ModelContext.tsx';
import { searchStudents } from '../api/client.ts';
import EditStudentModal from './EditStudentModal.tsx';
import type { Family, ModelDefinition } from '../types/models.ts';
import './LinkExistingStudentModal.css';

interface LinkExistingStudentModalProps {
  tenant: string;
  family: Family;
  onClose: () => void;
  onLinked: () => void;
}

type Row = Record<string, unknown>;

export default function LinkExistingStudentModal({
  tenant, family, onClose, onLinked,
}: LinkExistingStudentModalProps) {
  const { t } = useTranslation();
  const { getModel } = useModel();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Row[]>([]);
  const [model, setModel] = useState<ModelDefinition | null>(null);
  const [confirmMove, setConfirmMove] = useState<Row | null>(null);
  const [editing, setEditing] = useState<Row | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => { getModel(tenant, 'student').then(setModel).catch(() => setModel(null)); }, [tenant, getModel]);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      if (!query.trim()) { setResults([]); return; }
      searchStudents(tenant, query).then(setResults).catch(() => setResults([]));
    }, 250);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [query, tenant]);

  // Pick a student: if already in a DIFFERENT family, confirm the move first; else edit directly.
  function pick(student: Row) {
    const fid = student.family_id ? String(student.family_id) : '';
    if (fid && fid !== family.entity_id) setConfirmMove(student);
    else setEditing(student);
  }

  function studentFamilyLabel(student: Row): string {
    const fid = student.family_id ? String(student.family_id) : '';
    if (!fid) return t('linkStudent.unlinked');
    if (fid === family.entity_id) return family.family_name;
    return t('linkStudent.alreadyInFamily');
  }

  // When EditStudentModal is open, defer to it (preset to this family).
  if (editing && model) {
    return (
      <EditStudentModal
        tenant={tenant}
        entity={editing}
        model={model}
        presetFamily={{ familyId: family.entity_id, label: family.family_name }}
        onClose={() => setEditing(null)}
        onSaved={() => { setEditing(null); onLinked(); }}
      />
    );
  }

  // Model failed to load — show an inline error so the user isn't stranded.
  if (editing && !model) {
    return (
      <div className="students-confirm-overlay">
        <div className="link-student-modal" onClick={(e) => e.stopPropagation()}>
          <div className="link-student-header">
            <h3>{t('linkStudent.title')}</h3>
            <button onClick={onClose}>{t('linkStudent.cancel')}</button>
          </div>
          <p className="link-student-empty">{t('linkStudent.modelError')}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="students-confirm-overlay" onClick={onClose}>
      <div className="link-student-modal" onClick={(e) => e.stopPropagation()}>
        <div className="link-student-header">
          <h3>{t('linkStudent.title')}</h3>
          <button onClick={onClose}>{t('linkStudent.cancel')}</button>
        </div>
        <input
          className="link-student-search"
          placeholder={t('linkStudent.search')}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          autoFocus
        />
        <ul className="link-student-results">
          {results.map((s) => (
            <li key={String(s.entity_id)}>
              <button type="button" onClick={() => pick(s)}>
                <span>{String(s.first_name ?? '')} {String(s.last_name ?? '')}</span>
                <span className="link-student-meta">
                  {String(s.student_id ?? '')} · {studentFamilyLabel(s)}
                </span>
              </button>
            </li>
          ))}
          {query.trim() && results.length === 0 && (
            <li className="link-student-empty">{t('linkStudent.noResults')}</li>
          )}
        </ul>

        {confirmMove && (
          <div className="students-confirm-overlay" onClick={() => setConfirmMove(null)}>
            <div className="students-confirm-dialog" onClick={(e) => e.stopPropagation()}>
              <h4>{t('linkStudent.moveTitle')}</h4>
              <p>{t('linkStudent.moveBody').replace('{family}', family.family_name)}</p>
              <div className="students-confirm-actions">
                <button onClick={() => setConfirmMove(null)}>{t('linkStudent.cancel')}</button>
                <button
                  className="students-confirm-danger"
                  onClick={() => { const s = confirmMove; setConfirmMove(null); setEditing(s); }}
                >
                  {t('linkStudent.moveConfirm')}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
