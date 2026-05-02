// admindash/frontend/src/components/ResumeBatchPrompt.tsx
import { useTranslation } from '../hooks/useTranslation.ts';
import type { BatchDraft } from '../types/bulkAdd.ts';
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
    <div className="resume-prompt-overlay">
      <div className="resume-prompt">
        <h2>{t('bulkAdd.resume.title')}</h2>
        <div className="resume-prompt__primary">
          <p>
            <strong>
              {t('bulkAdd.resume.rowCount').replace('{n}', String(primary.rows.length))}
            </strong>
            {' '}— {new Date(primary.updatedAt).toLocaleString()}
          </p>
          <div className="resume-prompt__actions">
            <button onClick={onCancel}>{t('common.cancel')}</button>
            <button onClick={() => onDiscardOne(primary)}>{t('bulkAdd.resume.discardThis')}</button>
            <button
              className="resume-prompt__resume"
              onClick={() => onResume(primary)}
            >
              {t('bulkAdd.resume.resume')}
            </button>
          </div>
        </div>

        {others.length > 0 && (
          <details className="resume-prompt__others">
            <summary>{t('bulkAdd.resume.othersLabel').replace('{n}', String(others.length))}</summary>
            <ul>
              {others.map((d) => (
                <li key={d.id}>
                  <span>{d.rows.length} rows · {new Date(d.updatedAt).toLocaleString()}</span>
                  <button onClick={() => onResume(d)}>{t('bulkAdd.resume.resume')}</button>
                  <button onClick={() => onDiscardOne(d)}>{t('bulkAdd.resume.discardThis')}</button>
                </li>
              ))}
            </ul>
            <button onClick={onDiscardAll} className="resume-prompt__discard-all">
              {t('bulkAdd.resume.discardAll')}
            </button>
          </details>
        )}
      </div>
    </div>
  );
}
