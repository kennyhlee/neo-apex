// Placeholder — the machine/steps editor bound to getBundle/validateDefinition
// arrives in a later task. Route: `/definitions/:entityId`.
import { useParams } from 'react-router-dom';
import { useTranslation } from '../hooks/useTranslation.ts';

export default function EditorPage() {
  const { t } = useTranslation();
  const { entityId } = useParams<{ entityId: string }>();
  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">{t('editor.title')}</h1>
        <span className="page-subtitle">{entityId}</span>
      </div>
      <p className="page-placeholder">{t('editor.comingSoon')}</p>
    </div>
  );
}
