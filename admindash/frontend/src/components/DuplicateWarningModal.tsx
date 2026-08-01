import type { DuplicateMatch } from '../types/models.ts';
import { useTranslation } from '../hooks/useTranslation.ts';
import Modal from './ui/Modal.tsx';
import Button from './ui/Button.tsx';
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
    <Modal
      open
      onClose={onGoBack}
      title={t('duplicateWarning.title')}
      className="duplicate-modal"
      footer={
        <>
          <Button variant="secondary" onClick={onGoBack}>
            {t('duplicateWarning.goBack')}
          </Button>
          <Button variant="primary" onClick={onSaveAnyway}>
            {t('duplicateWarning.saveAnyway')}
          </Button>
        </>
      }
    >
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
    </Modal>
  );
}
