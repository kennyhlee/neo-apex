import { useEffect, useState } from 'react';
import { useTranslation } from '../hooks/useTranslation.ts';
import { getStudentsByFamily } from '../api/client.ts';
import Modal from './ui/Modal.tsx';
import Button from './ui/Button.tsx';
import StudentNameCell from './StudentNameCell.tsx';
import StatusBadge from './StatusBadge.tsx';
import { toLabel } from '../utils/listValue.ts';
import './FamilyDetailModal.css';

type Row = Record<string, unknown>;

interface Props {
  tenant: string;
  family: Row;
  onClose: () => void;
  onEdit: (family: Row) => void;
  onAddStudent: (family: Row) => void;
  onOpenStudent: (student: Row) => void;
}

const CONTACT_FIELDS: Array<[string, string]> = [
  ['primary_email', 'families.colEmail'],
  ['primary_phone', 'families.colPhone'],
  ['primary_address', 'families.colAddress'],
];

/**
 * The family record.
 *
 * The list used to expand rows to reveal their students, which meant two
 * disclosure mechanisms on one row — a chevron for students and a button for
 * everything else. The record now holds both: contact details and the family's
 * students, with the add-student action where it belongs.
 */
export default function FamilyDetailModal({
  tenant,
  family,
  onClose,
  onEdit,
  onAddStudent,
  onOpenStudent,
}: Props) {
  const { t } = useTranslation();
  const [students, setStudents] = useState<Row[] | null>(null);

  const familyId = String(family.entity_id ?? '');

  useEffect(() => {
    let cancelled = false;
    getStudentsByFamily(tenant, familyId)
      .then((list) => {
        if (!cancelled) setStudents(list);
      })
      .catch(() => {
        if (!cancelled) setStudents([]);
      });
    return () => {
      cancelled = true;
    };
  }, [tenant, familyId]);

  const name = String(family.family_name ?? '—');
  const ref = String(family.family_id ?? family.entity_id ?? '');

  return (
    <Modal
      open
      onClose={onClose}
      variant="drawer"
      title={name}
      subtitle={ref || undefined}
      footerClassName="modal-footer-spread"
      footer={
        <>
          <Button variant="secondary" size="sm" onClick={() => onAddStudent(family)}>
            {t('families.addStudent')}
          </Button>
          <Button variant="primary" onClick={() => onEdit(family)}>
            {t('students.edit')}
          </Button>
        </>
      }
    >
      <dl className="fdm-contact">
        {CONTACT_FIELDS.filter(([key]) => family[key]).map(([key, label]) => (
          <div key={key}>
            <dt>{t(label)}</dt>
            <dd>{toLabel(family[key], '—')}</dd>
          </div>
        ))}
      </dl>

      <h3 className="fdm-section">
        {t('families.students')}
        {students ? <span>{students.length}</span> : null}
      </h3>

      {students === null ? (
        <p className="fdm-note">{t('common.loading')}</p>
      ) : students.length === 0 ? (
        <p className="fdm-note">{t('families.noStudents')}</p>
      ) : (
        <ul className="fdm-students">
          {students.map((s) => (
            <li key={String(s.entity_id)}>
              <button type="button" className="fdm-student" onClick={() => onOpenStudent(s)}>
                <StudentNameCell row={s} />
                <span className="fdm-student-meta">
                  <span>{toLabel(s.grade_level, '—')}</span>
                  <StatusBadge status={s.status ?? s._status} />
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}
