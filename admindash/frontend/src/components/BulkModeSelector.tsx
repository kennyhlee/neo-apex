// admindash/frontend/src/components/BulkModeSelector.tsx
import { useTranslation } from '../hooks/useTranslation.ts';
import type { BatchMode } from '../types/bulkAdd.ts';
import './BulkModeSelector.css';

interface Props {
  onPick: (mode: BatchMode) => void;
}

export default function BulkModeSelector({ onPick }: Props) {
  const { t } = useTranslation();
  return (
    <div className="bulk-mode-selector">
      <button
        type="button"
        className="bulk-mode-card"
        onClick={() => onPick('documents')}
      >
        <h3>{t('bulkAdd.modeSelect.documents')}</h3>
        <p>{t('bulkAdd.modeSelect.documentsDesc')}</p>
      </button>
      <button
        type="button"
        className="bulk-mode-card"
        onClick={() => onPick('csv')}
      >
        <h3>{t('bulkAdd.modeSelect.csv')}</h3>
        <p>{t('bulkAdd.modeSelect.csvDesc')}</p>
      </button>
    </div>
  );
}
