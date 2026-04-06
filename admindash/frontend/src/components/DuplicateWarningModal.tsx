import type { DuplicateMatch } from '../types/models.ts';
import { useTranslation } from '../hooks/useTranslation.ts';
import './DuplicateWarningModal.css';

interface DuplicateWarningModalProps {
  matches: DuplicateMatch[];
  onGoBack: () => void;
  onSaveAnyway: () => void;
}

export default function DuplicateWarningModal({
  matches,
  onGoBack,
  onSaveAnyway,
}: DuplicateWarningModalProps) {
  const { t } = useTranslation();
  const displayed = [...matches]
    .sort((a, b) => b.similarity_score - a.similarity_score)
    .slice(0, 5);

  return (
    <div className="duplicate-modal-overlay" onClick={onGoBack}>
      <div className="duplicate-modal" onClick={(e) => e.stopPropagation()}>
        <h3 className="duplicate-modal-title">
          {t('duplicateWarning.title')}
        </h3>
        <p className="duplicate-modal-description">
          {t('duplicateWarning.description')}
        </p>

        <div className="duplicate-modal-matches">
          {displayed.map((match) => (
            <div key={match.entity_id} className="duplicate-modal-match-card">
              <div className="duplicate-modal-match-score">
                {Math.round(match.similarity_score * 100)}%
              </div>
              <div className="duplicate-modal-match-details">
                <div className="duplicate-modal-match-name">
                  {match.first_name} {match.last_name}
                </div>
                <div className="duplicate-modal-match-info">
                  <span>{t('duplicateWarning.studentId')}: {match.student_id}</span>
                  {match.dob && <span>{t('duplicateWarning.dob')}: {match.dob}</span>}
                  {match.primary_address && (
                    <span>{t('duplicateWarning.address')}: {match.primary_address}</span>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>

        <div className="duplicate-modal-actions">
          <button
            className="duplicate-modal-btn-secondary"
            onClick={onGoBack}
          >
            {t('duplicateWarning.goBack')}
          </button>
          <button
            className="duplicate-modal-btn-primary"
            onClick={onSaveAnyway}
          >
            {t('duplicateWarning.saveAnyway')}
          </button>
        </div>
      </div>
    </div>
  );
}
