import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from '../hooks/useTranslation.ts';
import { fetchStudents } from '../api/client.ts';
import DataTable, { type Column } from '../components/DataTable.tsx';
import FilterForm from '../components/FilterForm.tsx';
import StatusBadge from '../components/StatusBadge.tsx';
import type { Student } from '../types/models.ts';
import './StudentsPage.css';

const PAGE_SIZE = 10;

interface StudentsPageProps {
  tenant: string;
}

/**
 * Builds the required (fixed) columns that every tenant sees.
 */
function getRequiredColumns(): Column<Student>[] {
  return [
    {
      key: 'name',
      label: 'Student Name',
      i18nKey: 'students.name',
      render: (row: Student) => {
        const fullName =
          `${row.first_name ?? ''} ${row.last_name ?? ''}`.trim() || '-';
        const avatarChar = fullName.charAt(0);
        return (
          <div className="student-name-cell">
            <div className="student-avatar">{avatarChar}</div>
            <div className="student-name-info">
              <span className="student-display-name">{fullName}</span>
              {row.preferred_name && (
                <span className="student-preferred-name">
                  {row.preferred_name}
                </span>
              )}
            </div>
          </div>
        );
      },
    },
    { key: 'student_id', label: 'Student ID', i18nKey: 'students.studentId' },
    { key: 'gender', label: 'Gender', i18nKey: 'students.gender' },
    { key: 'dob', label: 'Date of Birth', i18nKey: 'students.dob' },
    {
      key: 'grade_level',
      label: 'Grade Level',
      i18nKey: 'students.gradeLevel',
    },
    { key: 'email', label: 'Email', i18nKey: 'students.email' },
    {
      key: 'guardian',
      label: 'Guardian',
      i18nKey: 'students.guardian',
      render: (row: Student) => {
        const name = [row.guardian1_first_name, row.guardian1_last_name]
          .filter(Boolean)
          .join(' ');
        return name || '-';
      },
    },
    {
      key: 'enrollment_status',
      label: 'Status',
      i18nKey: 'students.status',
      render: (row: Student) => (
        <StatusBadge status={row.enrollment_status} />
      ),
    },
  ];
}

/**
 * Discovers custom_fields keys across the current page of data and
 * builds dynamic columns for them. Keys are sorted alphabetically.
 */
function getCustomColumns(data: Student[]): Column<Student>[] {
  const keys = new Set<string>();
  for (const student of data) {
    if (student.custom_fields) {
      for (const k of Object.keys(student.custom_fields)) {
        keys.add(k);
      }
    }
  }
  return Array.from(keys)
    .sort()
    .map((key) => ({
      key: `custom:${key}`,
      label: formatCustomLabel(key),
      render: (row: Student) => {
        const val = row.custom_fields?.[key];
        if (val == null) return '-';
        if (typeof val === 'object') return JSON.stringify(val);
        return String(val);
      },
    }));
}

/**
 * Converts snake_case or camelCase field names to Title Case labels.
 * e.g. "school_name" -> "School Name", "emergencyPhone" -> "Emergency Phone"
 */
function formatCustomLabel(key: string): string {
  return key
    .replace(/_/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

export default function StudentsPage({ tenant }: StudentsPageProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [data, setData] = useState<Student[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Filter state
  const [filterName, setFilterName] = useState('');
  const [filterId, setFilterId] = useState('');
  const [filterGrade, setFilterGrade] = useState('');
  const [filterGender, setFilterGender] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [filterEmail, setFilterEmail] = useState('');

  const loadData = useCallback(
    async (p: number) => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetchStudents(tenant, PAGE_SIZE, (p - 1) * PAGE_SIZE);
        setData(res.data ?? []);
        setTotal(res.total ?? 0);
        setPage(p);
      } catch (err) {
        setError(
          `Failed to load students. Is the backend at http://localhost:8080 running? (${err})`,
        );
        setData([]);
        setTotal(0);
      } finally {
        setLoading(false);
      }
    },
    [tenant],
  );

  useEffect(() => {
    loadData(1);
  }, [loadData]);

  function handleSearch() {
    loadData(1);
  }

  function handleReset() {
    setFilterName('');
    setFilterId('');
    setFilterGrade('');
    setFilterGender('');
    setFilterStatus('');
    setFilterEmail('');
    loadData(1);
  }

  // Combine required + dynamic custom columns
  const requiredCols = useMemo(() => getRequiredColumns(), []);
  const customCols = useMemo(() => getCustomColumns(data), [data]);
  const columns = useMemo(
    () => [...requiredCols, ...customCols],
    [requiredCols, customCols],
  );

  return (
    <div className="students-page">
      <h1>{t('students.title')}</h1>

      <FilterForm onSearch={handleSearch} onReset={handleReset}>
        <div className="filter-field">
          <label>{t('students.searchName')}</label>
          <input
            type="text"
            placeholder={t('students.searchNamePlaceholder')}
            value={filterName}
            onChange={(e) => setFilterName(e.target.value)}
          />
        </div>
        <div className="filter-field">
          <label>{t('students.searchId')}</label>
          <input
            type="text"
            placeholder={t('students.searchIdPlaceholder')}
            value={filterId}
            onChange={(e) => setFilterId(e.target.value)}
          />
        </div>
        <div className="filter-field">
          <label>{t('students.searchGrade')}</label>
          <select
            value={filterGrade}
            onChange={(e) => setFilterGrade(e.target.value)}
          >
            <option value="">{t('students.allGrades')}</option>
            {[1, 2, 3, 4, 5, 6].map((g) => (
              <option key={g} value={`Grade ${g}`}>
                {t(`grade.grade${g}`)}
              </option>
            ))}
            {[1, 2, 3].map((g) => (
              <option key={`m${g}`} value={`Grade ${6 + g}`}>
                {t(`grade.middle${g}`)}
              </option>
            ))}
            {[1, 2, 3].map((g) => (
              <option key={`h${g}`} value={`Grade ${9 + g}`}>
                {t(`grade.high${g}`)}
              </option>
            ))}
          </select>
        </div>
        <div className="filter-field">
          <label>{t('students.searchGender')}</label>
          <select
            value={filterGender}
            onChange={(e) => setFilterGender(e.target.value)}
          >
            <option value="">{t('students.allGenders')}</option>
            <option value="Male">Male</option>
            <option value="Female">Female</option>
          </select>
        </div>
        <div className="filter-field">
          <label>{t('students.searchStatus')}</label>
          <select
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value)}
          >
            <option value="">{t('students.allStatus')}</option>
            <option value="Active">{t('students.status.active')}</option>
            <option value="On Leave">{t('students.status.onLeave')}</option>
            <option value="Suspended">{t('students.status.suspended')}</option>
            <option value="Graduated">{t('students.status.graduated')}</option>
            <option value="Dropped">{t('students.status.dropped')}</option>
          </select>
        </div>
        <div className="filter-field">
          <label>{t('students.searchEmail')}</label>
          <input
            type="text"
            placeholder={t('students.searchEmailPlaceholder')}
            value={filterEmail}
            onChange={(e) => setFilterEmail(e.target.value)}
          />
        </div>
      </FilterForm>

      <div className="students-toolbar">
        <button>{t('students.batchExport')}</button>
        <button>{t('students.batchActions')}</button>
        <button onClick={() => navigate('/students/add')}>{t('students.addStudent')}</button>
      </div>

      {error ? (
        <div className="student-error">{error}</div>
      ) : (
        <DataTable<Student>
          columns={columns}
          data={data}
          total={total}
          page={page}
          pageSize={PAGE_SIZE}
          loading={loading}
          onPageChange={loadData}
          rowKey={(row) => row.student_id}
        />
      )}
    </div>
  );
}
