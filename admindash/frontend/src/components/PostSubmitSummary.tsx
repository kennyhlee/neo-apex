// admindash/frontend/src/components/PostSubmitSummary.tsx
import { useTranslation } from '../hooks/useTranslation.ts';
import './PostSubmitSummary.css';

interface Props {
  successCount: number;
  failedCount: number;
  onRetryFailed: () => void;
  onDone: () => void;
}

export default function PostSubmitSummary({
  successCount, failedCount, onRetryFailed, onDone,
}: Props) {
  const { t } = useTranslation();
  return (
    <div className="post-submit-summary">
      <div className="post-submit-summary__counts">
        <span className="post-submit-summary__success">
          {t('bulkAdd.postSubmit.success').replace('{n}', String(successCount))}
        </span>
        {failedCount > 0 && (
          <span className="post-submit-summary__failed">
            {t('bulkAdd.postSubmit.failed').replace('{n}', String(failedCount))}
          </span>
        )}
      </div>
      <div className="post-submit-summary__actions">
        {failedCount > 0 && (
          <button
            className="post-submit-summary__btn-retry"
            onClick={onRetryFailed}
          >
            {t('bulkAdd.postSubmit.retryFailed').replace('{n}', String(failedCount))}
          </button>
        )}
        <button
          className="post-submit-summary__btn-done"
          onClick={onDone}
        >
          {t('bulkAdd.postSubmit.done')}
        </button>
      </div>
    </div>
  );
}
