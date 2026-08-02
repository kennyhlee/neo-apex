import { useEffect, useMemo, useState, useCallback } from 'react';
import { useTranslation } from '../hooks/useTranslation.ts';
import { useDensity } from '../hooks/useDensity.ts';
import { useModel } from '../contexts/ModelContext.tsx';
import { postQuery } from '../api/client.ts';
import DataTable, { type Column } from '../components/DataTable.tsx';
import Button from '../components/ui/Button.tsx';
import SearchField from '../components/ui/SearchField.tsx';
import NameCell from '../components/ui/NameCell.tsx';
import AddFamilyModal from '../components/AddFamilyModal.tsx';
import AddStudentModal from '../components/AddStudentModal.tsx';
import StudentDetailModal from '../components/StudentDetailModal.tsx';
import EditFamilyModal from '../components/EditFamilyModal.tsx';
import FamilyDetailModal from '../components/FamilyDetailModal.tsx';
import type { Family, ModelDefinition } from '../types/models.ts';
import './FamiliesPage.css';

interface FamiliesPageProps { tenant: string; }
type Row = Record<string, unknown>;

const PAGE_SIZE = 20;

/** Two initials read as a household; one reads as a filing code. */
function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '—';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export default function FamiliesPage({ tenant }: FamiliesPageProps) {
  const { t } = useTranslation();
  const { density } = useDensity();
  const { getModel } = useModel();
  const [rows, setRows] = useState<Family[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadTick, setLoadTick] = useState(0);
  const [search, setSearch] = useState('');
  const [applied, setApplied] = useState('');
  const [page, setPage] = useState(1);
  const [showAdd, setShowAdd] = useState(false);
  const [studentModel, setStudentModel] = useState<ModelDefinition | null>(null);
  const [familyModel, setFamilyModel] = useState<ModelDefinition | null>(null);
  const [addStudentTo, setAddStudentTo] = useState<Family | null>(null);
  const [detailStudent, setDetailStudent] = useState<Row | null>(null);
  const [detailFamily, setDetailFamily] = useState<Row | null>(null);
  const [editFamily, setEditFamily] = useState<Row | null>(null);

  useEffect(() => { getModel(tenant, 'student').then(setStudentModel).catch(() => setStudentModel(null)); }, [tenant, getModel]);
  useEffect(() => { getModel(tenant, 'family').then(setFamilyModel).catch(() => setFamilyModel(null)); }, [tenant, getModel]);

  useEffect(() => {
    postQuery(tenant, 'entities',
      "SELECT * FROM data WHERE entity_type = 'family' AND _status = 'active'")
      .then((res) => { setRows(res.data as unknown as Family[]); setLoading(false); })
      .catch(() => { setRows([]); setLoading(false); });
  }, [tenant, loadTick]);

  const handleReload = useCallback(() => {
    setLoading(true);
    setLoadTick((n) => n + 1);
  }, []);

  const filtered = useMemo(() => {
    const q = applied.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((f) =>
      String(f.family_name ?? '').toLowerCase().includes(q) ||
      String(f.primary_email ?? '').toLowerCase().includes(q) ||
      String(f.primary_phone ?? '').toLowerCase().includes(q) ||
      String(f.entity_id ?? '').toLowerCase().includes(q) ||
      String(f.family_id ?? '').toLowerCase().includes(q));
  }, [rows, applied]);

  const currentPage = useMemo(() => {
    const maxPage = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
    return Math.min(page, maxPage);
  }, [filtered.length, page]);

  const paged = useMemo(() => {
    const start = (currentPage - 1) * PAGE_SIZE;
    return filtered.slice(start, start + PAGE_SIZE);
  }, [filtered, currentPage]);

  function commitSearch(q: string) {
    setSearch(q);
    setApplied(q);
    setPage(1);
  }

  const columns: Column<Row>[] = useMemo(() => [
    {
      key: 'family_name',
      label: t('families.colName'),
      primary: true,
      render: (r) => {
        const name = String(r.family_name ?? '—');
        return (
          <NameCell
            name={name}
            initials={initialsOf(name)}
            secondary={String(r.family_id ?? r.entity_id ?? '')}
            onOpen={() => setDetailFamily(r)}
          />
        );
      },
    },
    { key: 'primary_email', label: t('families.colEmail'), render: (r) => String(r.primary_email ?? '—') },
    { key: 'primary_phone', label: t('families.colPhone'), render: (r) => String(r.primary_phone ?? '—') },
  ], [t]);

  return (
    <div className="families-page">
      <header className="page-header">
        <h1 className="page-title">
          {t('families.title')}
          <span className="page-subtitle">
            {filtered.length} {t('common.records')}
          </span>
        </h1>
        <div className="page-header-actions">
          <SearchField
            id="families-search"
            value={search}
            placeholder={t('families.search')}
            onChange={setSearch}
            onCommit={commitSearch}
          />
          <Button variant="primary" onClick={() => setShowAdd(true)}>
            {t('families.addFamily')}
          </Button>
        </div>
      </header>

      <DataTable<Row>
        columns={columns}
        data={paged}
        total={filtered.length}
        page={currentPage}
        pageSize={PAGE_SIZE}
        loading={loading}
        onPageChange={setPage}
        rowKey={(r) => String(r.entity_id ?? '')}
        rowLabel={(r) => String(r.family_name ?? r.family_id ?? r.entity_id ?? '')}
        caption={t('families.title')}
        selectable={false}
        // The row opens the family record, which now holds the students the
        // row used to expand to reveal.
        onRowClick={setDetailFamily}
        rowActions={
          density === 'compact'
            ? (r) => (
                <Button variant="secondary" size="sm" onClick={() => setEditFamily(r)}>
                  {t('students.edit')}
                </Button>
              )
            : undefined
        }
        emptyState={{
          title: t('families.empty'),
          description: applied ? t('families.emptySearchBody') : t('families.emptyBody'),
          action: applied ? (
            <Button variant="secondary" onClick={() => commitSearch('')}>
              {t('students.clearSearch')}
            </Button>
          ) : (
            <Button variant="primary" onClick={() => setShowAdd(true)}>
              {t('families.addFamily')}
            </Button>
          ),
        }}
      />

      {detailFamily && (
        <FamilyDetailModal
          tenant={tenant}
          family={detailFamily}
          onClose={() => setDetailFamily(null)}
          onEdit={(f) => { setDetailFamily(null); setEditFamily(f); }}
          onAddStudent={(f) => { setDetailFamily(null); setAddStudentTo(f as unknown as Family); }}
          onOpenStudent={(s) => { setDetailFamily(null); setDetailStudent(s); }}
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
