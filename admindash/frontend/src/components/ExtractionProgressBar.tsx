// admindash/frontend/src/components/ExtractionProgressBar.tsx
import { useTranslation } from '../hooks/useTranslation.ts';
import './ExtractionProgressBar.css';

interface Props {
  total: number;
  done: number;
  failed: number;
}

export default function ExtractionProgressBar({ total, done, failed }: Props) {
  const { t } = useTranslation();
  const pct = total === 0 ? 0 : Math.round((done / total) * 100);
  return (
    <div className="extraction-progress" role="status" aria-live="polite">
      <div className="extraction-progress__bar">
        <div className="extraction-progress__fill" style={{ width: `${pct}%` }} />
      </div>
      <p className="extraction-progress__label">
        {t('bulkAdd.progress.label')
          .replace('{done}', String(done))
          .replace('{total}', String(total))
          .replace('{failed}', String(failed))}
      </p>
    </div>
  );
}
