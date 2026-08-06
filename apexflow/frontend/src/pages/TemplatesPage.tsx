// Placeholder — template picker/seed flow arrives in a later task.
// Route: `/templates`.
import { useTranslation } from '../hooks/useTranslation.ts';

export default function TemplatesPage() {
  const { t } = useTranslation();
  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">{t('templates.title')}</h1>
      </div>
      <p className="page-placeholder">{t('templates.comingSoon')}</p>
    </div>
  );
}
