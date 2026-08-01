import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from '../hooks/useTranslation.ts';
import { postQuery, getStudentsByFamily } from '../api/client.ts';
import DataTable, { type Column } from '../components/DataTable.tsx';
import AddFamilyModal from '../components/AddFamilyModal.tsx';
import AddStudentModal from '../components/AddStudentModal.tsx';
import LinkExistingStudentModal from '../components/LinkExistingStudentModal.tsx';
import type { Family } from '../types/models.ts';
import './FamiliesPage.css';

interface FamiliesPageProps { tenant: string; }
type Row = Record<string, unknown>;

const PAGE_SIZE = 20;

export default function FamiliesPage({ tenant }: FamiliesPageProps) {
  const { t } = useTranslation();
  const [rows, setRows] = useState<Family[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadTick, setLoadTick] = useState(0);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [showAdd, setShowAdd] = useState(false);
  const [detail, setDetail] = useState<Family | null>(null);
  const [detailStudents, setDetailStudents] = useState<Row[]>([]);
  const [addStudentTo, setAddStudentTo] = useState<Family | null>(null);
  const [linkTo, setLinkTo] = useState<Family | null>(null);

  useEffect(() => {
    postQuery(tenant, 'entities',
      "SELECT * FROM data WHERE entity_type = 'family' AND _status = 'active'")
      .then((res) => {
        setRows(res.data as unknown as Family[]);
        setLoading(false);
      })
      .catch(() => {
        setRows([]);
        setLoading(false);
      });
  }, [tenant, loadTick]);

  const detailFamilyId = detail?.entity_id ?? null;

  useEffect(() => {
    Promise.resolve(detailFamilyId
      ? getStudentsByFamily(tenant, detailFamilyId)
      : Promise.resolve([] as Row[]))
      .then(setDetailStudents)
      .catch(() => setDetailStudents([]));
  }, [detailFamilyId, tenant]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((f) =>
      String(f.family_name ?? '').toLowerCase().includes(q) ||
      String(f.primary_email ?? '').toLowerCase().includes(q) ||
      String(f.primary_phone ?? '').toLowerCase().includes(q));
  }, [rows, search]);

  const currentPage = useMemo(() => {
    const maxPage = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
    return Math.min(page, maxPage);
  }, [filtered.length, page]);

  const paged = useMemo(() => {
    const start = (currentPage - 1) * PAGE_SIZE;
    return filtered.slice(start, start + PAGE_SIZE);
  }, [filtered, currentPage]);

  function handleSearch(e: React.ChangeEvent<HTMLInputElement>) {
    setSearch(e.target.value);
    setPage(1);
  }

  function handleReload() {
    setLoading(true);
    setLoadTick((n) => n + 1);
  }

  // DataTable has no onRowClick — open detail via a button in the family_name render.
  const columns: Column<Row>[] = useMemo(() => [
    {
      key: 'family_name',
      label: t('families.colName'),
      render: (r) => (
        <button
          className="families-name-btn"
          onClick={() => setDetail(r as unknown as Family)}
        >
          {String(r.family_name ?? '-')}
        </button>
      ),
    },
    { key: 'primary_email', label: t('families.colEmail'), render: (r) => String(r.primary_email ?? '-') },
    { key: 'primary_phone', label: t('families.colPhone'), render: (r) => String(r.primary_phone ?? '-') },
  ], [t]);

  return (
    <div className="families-page">
      <div className="families-header">
        <h2>{t('families.title')}</h2>
        <div className="families-actions">
          <input
            className="families-search" placeholder={t('families.search')}
            value={search} onChange={handleSearch}
          />
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
        />
      )}

      {showAdd && (
        <AddFamilyModal
          tenant={tenant}
          onClose={() => setShowAdd(false)}
          onSuccess={() => { setShowAdd(false); handleReload(); }}
        />
      )}

      {detail && (
        <div className="students-confirm-overlay" onClick={() => setDetail(null)}>
          <div className="families-detail" onClick={(e) => e.stopPropagation()}>
            <div className="families-detail-header">
              <h3>{String(detail.family_name ?? '')}</h3>
              <button onClick={() => setDetail(null)}>{t('families.close')}</button>
            </div>
            <dl className="families-detail-fields">
              <dt>{t('families.colEmail')}</dt><dd>{String(detail.primary_email ?? '-')}</dd>
              <dt>{t('families.colPhone')}</dt><dd>{String(detail.primary_phone ?? '-')}</dd>
            </dl>
            <h4>{t('families.detailStudents')}</h4>
            {detailStudents.length === 0 ? (
              <p className="families-empty">{t('families.noStudents')}</p>
            ) : (
              <ul className="families-detail-students">
                {detailStudents.map((s) => (
                  <li key={String(s.entity_id)}>
                    {String(s.first_name ?? '')} {String(s.last_name ?? '')}
                    {s.grade_level ? <span className="families-grade"> · {String(s.grade_level)}</span> : null}
                  </li>
                ))}
              </ul>
            )}
            <button
              className="families-add-btn"
              onClick={() => { setAddStudentTo(detail); setDetail(null); }}
            >
              {t('families.addStudentToFamily')}
            </button>
            <button
              className="families-add-btn"
              onClick={() => { setLinkTo(detail); setDetail(null); }}
            >
              {t('families.linkExistingStudent')}
            </button>
          </div>
        </div>
      )}

      {addStudentTo && (
        <AddStudentModal
          tenant={tenant}
          presetFamilyId={addStudentTo.entity_id}
          presetFamilyLabel={String(addStudentTo.family_name ?? '')}
          onClose={() => setAddStudentTo(null)}
          onSuccess={() => { setAddStudentTo(null); handleReload(); }}
        />
      )}

      {linkTo && (
        <LinkExistingStudentModal
          tenant={tenant}
          family={linkTo}
          onClose={() => setLinkTo(null)}
          onLinked={() => { setLinkTo(null); handleReload(); }}
        />
      )}
    </div>
  );
}
