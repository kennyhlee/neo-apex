// admindash/frontend/src/components/ResumeBatchPrompt.tsx
import { useTranslation } from '../hooks/useTranslation.ts';
import type { BatchDraft } from '../types/bulkAdd.ts';
import Modal from './ui/Modal.tsx';
import Button from './ui/Button.tsx';
import './ResumeBatchPrompt.css';

interface Props {
  drafts: BatchDraft[];
  onResume: (draft: BatchDraft) => void;
  onDiscardOne: (draft: BatchDraft) => void;
  onDiscardAll: () => void;
  onCancel: () => void;
}

export default function ResumeBatchPrompt({
  drafts, onResume, onDiscardOne, onDiscardAll, onCancel,
}: Props) {
  const { t } = useTranslation();
  if (drafts.length === 0) return null;
  const [primary, ...others] = drafts;

  return (
    <Modal
      open
      onClose={onCancel}
      title={t('bulkAdd.resume.title')}
      size="sm"
      footer={
        <>
          <Button variant="secondary" onClick={onCancel}>
            {t('common.cancel')}
          </Button>
          <Button variant="danger" onClick={() => onDiscardOne(primary)}>
            {t('bulkAdd.resume.discardThis')}
          </Button>
          <Button variant="primary" onClick={() => onResume(primary)}>
            {t('bulkAdd.resume.resume')}
          </Button>
        </>
      }
    >
      <div className="resume-prompt__primary">
        <p>
          <strong>
            {t('bulkAdd.resume.rowCount').replace('{n}', String(primary.rows.length))}
          </strong>
          {' '}— {new Date(primary.updatedAt).toLocaleString()}
        </p>
      </div>

      {others.length > 0 && (
        <details className="resume-prompt__others">
          <summary>{t('bulkAdd.resume.othersLabel').replace('{n}', String(others.length))}</summary>
          <ul>
            {others.map((d) => (
              <li key={d.id}>
                <span>{d.rows.length} rows · {new Date(d.updatedAt).toLocaleString()}</span>
                <Button variant="primary" size="sm" onClick={() => onResume(d)}>
                  {t('bulkAdd.resume.resume')}
                </Button>
                <Button variant="danger" size="sm" onClick={() => onDiscardOne(d)}>
                  {t('bulkAdd.resume.discardThis')}
                </Button>
              </li>
            ))}
          </ul>
          <Button variant="danger" onClick={onDiscardAll}>
            {t('bulkAdd.resume.discardAll')}
          </Button>
        </details>
      )}
    </Modal>
  );
}
