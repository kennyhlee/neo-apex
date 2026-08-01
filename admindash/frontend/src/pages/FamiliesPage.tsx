import { useEffect, useMemo, useState, useCallback } from 'react';
import { useTranslation } from '../hooks/useTranslation.ts';
import { useModel } from '../contexts/ModelContext.tsx';
import { postQuery, getStudentsByFamily } from '../api/client.ts';
import DataTable, { type Column } from '../components/DataTable.tsx';
import AddFamilyModal from '../components/AddFamilyModal.tsx';
import AddStudentModal from '../components/AddStudentModal.tsx';
import StudentDetailModal from '../components/StudentDetailModal.tsx';
import EditFamilyModal from '../components/EditFamilyModal.tsx';
import StudentNameCell from '../components/StudentNameCell.tsx';
import StatusBadge from '../components/StatusBadge.tsx';
import type { Family, ModelDefinition } from '../types/models.ts';
import './FamiliesPage.css';

interface FamiliesPageProps { tenant: string; }
type Row = Record<string, unknown>;

const PAGE_SIZE = 20;

export default function FamiliesPage({ tenant }: FamiliesPageProps) {
  const { t } = useTranslation();
  const { getModel } = useModel();
  const [rows, setRows] = useState<Family[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadTick, setLoadTick] = useState(0);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [showAdd, setShowAdd] = useState(false);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [studentsByFamily, setStudentsByFamily] = useState<Record<string, Row[]>>({});
  const [studentModel, setStudentModel] = useState<ModelDefinition | null>(null);
  const [familyModel, setFamilyModel] = useState<ModelDefinition | null>(null);
  const [addStudentTo, setAddStudentTo] = useState<Family | null>(null);
  const [detailStudent, setDetailStudent] = useState<Row | null>(null);
  const [editFamily, setEditFamily] = useState<Row | null>(null);

  useEffect(() => { getModel(tenant, 'student').then(setStudentModel).catch(() => setStudentModel(null)); }, [tenant, getModel]);
  useEffect(() => { getModel(tenant, 'family').then(setFamilyModel).catch(() => setFamilyModel(null)); }, [tenant, getModel]);

  useEffect(() => {
    postQuery(tenant, 'entities',
      "SELECT * FROM data WHERE entity_type = 'family' AND _status = 'active'")
      .then((res) => { setRows(res.data as unknown as Family[]); setLoading(false); })
      .catch(() => { setRows([]); setLoading(false); });
  }, [tenant, loadTick]);

  const loadStudents = useCallback((familyId: string) => {
    getStudentsByFamily(tenant, familyId)
      .then((list) => setStudentsByFamily((prev) => ({ ...prev, [familyId]: list })))
      .catch(() => setStudentsByFamily((prev) => ({ ...prev, [familyId]: [] })));
  }, [tenant]);

  function toggleExpand(id: string) {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else { next.add(id); loadStudents(id); }
      return next;
    });
  }

  function handleReload() {
    setLoading(true);
    // refresh any currently-expanded families' students too
    expandedIds.forEach((id) => loadStudents(id));
    setLoadTick((n) => n + 1);
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((f) =>
      String(f.family_name ?? '').toLowerCase().includes(q) ||
      String(f.primary_email ?? '').toLowerCase().includes(q) ||
      String(f.primary_phone ?? '').toLowerCase().includes(q) ||
      String(f.entity_id ?? '').toLowerCase().includes(q) ||
      String(f.family_id ?? '').toLowerCase().includes(q));
  }, [rows, search]);

  const currentPage = useMemo(() => {
    const maxPage = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
    return Math.min(page, maxPage);
  }, [filtered.length, page]);

  const paged = useMemo(() => {
    const start = (currentPage - 1) * PAGE_SIZE;
    return filtered.slice(start, start + PAGE_SIZE);
  }, [filtered, currentPage]);

  function handleSearch(e: React.ChangeEvent<HTMLInputElement>) { setSearch(e.target.value); setPage(1); }

  const columns: Column<Row>[] = useMemo(() => [
    { key: 'entity_id', label: t('families.colId'), render: (r) => (
      <button className="families-id-btn" onClick={() => setEditFamily(r)}>
        <code className="families-id">{String(r.family_id || r.entity_id || '-')}</code>
      </button>
    ) },
    { key: 'family_name', label: t('families.colName'), render: (r) => (
      <button className="families-name-btn" onClick={() => setEditFamily(r)}>
        {String(r.family_name ?? '-')}
      </button>
    ) },
    { key: 'primary_email', label: t('families.colEmail'), render: (r) => String(r.primary_email ?? '-') },
    { key: 'primary_phone', label: t('families.colPhone'), render: (r) => String(r.primary_phone ?? '-') },
  ], [t]);

  function renderExpanded(family: Row): React.ReactNode {
    const fid = String(family.entity_id ?? '');
    const students = studentsByFamily[fid];
    return (
      <div className="families-expanded">
        {students == null ? (
          <p>{t('common.loading')}</p>
        ) : students.length === 0 ? (
          <p className="families-empty">{t('families.noStudents')}</p>
        ) : (
          <table className="families-students-table">
            <thead>
              <tr>
                <th>{t('families.colStudentId')}</th>
                <th>{t('families.colStudentName')}</th>
                <th>{t('families.colGrade')}</th>
                <th>{t('families.colStatus')}</th>
              </tr>
            </thead>
            <tbody>
              {students.map((s) => (
                <tr key={String(s.entity_id)}>
                  <td>
                    <button
                      type="button"
                      className="families-student-id"
                      title={t('studentDetail.dblclickHint')}
                      onClick={() => setDetailStudent(s)}
                    >
                      {String(s.student_id ?? '-')}
                    </button>
                  </td>
                  <td><StudentNameCell row={s} /></td>
                  <td>{String(s.grade_level ?? '-')}</td>
                  <td><StatusBadge status={String(s.status ?? '-')} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <button
          className="families-add-btn"
          onClick={() => setAddStudentTo(family as unknown as Family)}
        >
          {t('families.addStudent')}
        </button>
      </div>
    );
  }

  return (
    <div className="families-page">
      <div className="families-header">
        <h2>{t('families.title')}</h2>
        <div className="families-actions">
          <input className="families-search" placeholder={t('families.search')} value={search} onChange={handleSearch} />
          <button className="families-add-btn" onClick={() => setShowAdd(true)}>{t('families.addFamily')}</button>
        </div>
      </div>

      {loading ? (
        <p>{t('common.loading')}</p>
      ) : filtered.length === 0 ? (
        <p className="families-empty">{t('families.empty')}</p>
      ) : (
        <DataTable<Row>
          columns={columns}
          data={paged}
          total={filtered.length}
          page={currentPage}
          pageSize={PAGE_SIZE}
          loading={false}
          onPageChange={setPage}
          rowKey={(r) => String(r.entity_id ?? '')}
          renderExpanded={renderExpanded}
          expandedIds={expandedIds}
          onToggleExpand={toggleExpand}
        />
      )}

      {showAdd && (
        <AddFamilyModal tenant={tenant} onClose={() => setShowAdd(false)} onSuccess={() => { setShowAdd(false); handleReload(); }} />
      )}

      {addStudentTo && (
        <AddStudentModal
          tenant={tenant}
          presetFamilyId={addStudentTo.entity_id}
          presetFamilyLabel={String(addStudentTo.family_name ?? '')}
          lockFamily
          onClose={() => setAddStudentTo(null)}
          onSuccess={() => { setAddStudentTo(null); handleReload(); }}
        />
      )}

      {detailStudent && studentModel && (
        <StudentDetailModal student={detailStudent} model={studentModel} onClose={() => setDetailStudent(null)} />
      )}

      {editFamily && familyModel && (
        <EditFamilyModal
          tenant={tenant}
          family={editFamily}
          model={familyModel}
          onClose={() => setEditFamily(null)}
          onSaved={() => { setEditFamily(null); handleReload(); }}
        />
      )}
    </div>
  );
}
